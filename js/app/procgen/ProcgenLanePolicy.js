import { ProcgenCrewProjects } from './ProcgenCrewProjects.js';
import { procgenTileRevision } from './ProcgenTerrainRetention.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
const MAX_LANE_KNOWLEDGE = 8;
const PREFERENCE_DECAY_TICKS = 256;
const KINDS = ['builders', 'bashers', 'diggers', 'miners'];
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

// Preferences are bounded tie-breakers for independently screened physical
// proposals. Observed failures never certify geometry or grant an ability.
class ProcgenLanePolicy {
  constructor(world) { this.world = world; this.projects = new ProcgenCrewProjects(world, (lane, kind, stage) => this._credit(lane, kind, stage)); this.reset(); }
  reset() {
    this.lanes = Array.from(this.world.laneSeeds, seed => {
      const initialBias = Object.fromEntries(KINDS.map((kind, index) => [kind, (mix(seed ^ Math.imul(index + 1, 0x9e3779b1)) % 7) - 3 + (kind === 'builders' ? 2 : kind === 'miners' ? -4 : 0)]));
      return { initialBias, learned: { builders: 0, bashers: 0, diggers: 0, miners: 0 }, attempts: 0, successes: 0, failures: 0,
        ordinaryCrossings: 0, lastDecayTick: this.world.tickIndex, knowledge: [], nextKnowledge: 0 };
    });
    this.projects.reset();
  }
  _decay(lane) {
    const elapsed = this.world.tickIndex - lane.lastDecayTick;
    if (elapsed < 0) { for (const kind of KINDS) lane.learned[kind] = 0; lane.lastDecayTick = this.world.tickIndex; return; }
    const steps = Math.floor(elapsed / PREFERENCE_DECAY_TICKS);
    if (!steps) return;
    for (const kind of KINDS) lane.learned[kind] = Math.sign(lane.learned[kind]) * Math.max(0, Math.abs(lane.learned[kind]) - steps);
    lane.lastDecayTick += steps * PREFERENCE_DECAY_TICKS;
  }
  _credit(index, kind, stage) {
    const lane = this.lanes[index]; if (!lane || !KINDS.includes(kind)) return;
    this._decay(lane); lane.learned[kind] = Math.max(-3, Math.min(3, lane.learned[kind] + (stage === 'crew-failure' ? -1 : 1)));
  }
  _tiles(x, y) {
    const world = this.world, width = world.terrain?.chunkWidth || 256, result = [];
    for (let lane = Math.max(0, Math.floor((y - 12) / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor((y + 12) / world.laneHeight)); lane++)
      for (let chunk = Math.max(0, Math.floor((x - 16) / width)); chunk <= Math.floor((x + 16) / width); chunk++) {
        const key = lane * 0x800000 + chunk; result.push([key, procgenTileRevision(world, key)]);
      }
    return result;
  }
  _valid(record) { return record.tiles.every(([key, revision]) => procgenTileRevision(this.world, key) === revision); }
  remember(actor, kind, type = null) {
    const lane = this.lanes[actor.laneIndex]; if (!lane) return;
    const cell = Math.floor(actor.x / 32), band = Math.floor(actor.y / 24);
    const record = { kind, type, x: actor.x, y: actor.y, cell, band, tick: this.world.tickIndex, tiles: this._tiles(actor.x, actor.y) };
    const existing = lane.knowledge.findIndex(entry => entry.cell === cell && entry.band === band && entry.kind === kind);
    if (existing >= 0) lane.knowledge[existing] = record;
    else if (lane.knowledge.length < MAX_LANE_KNOWLEDGE) lane.knowledge.push(record);
    else { lane.knowledge[lane.nextKnowledge] = record; lane.nextKnowledge = (lane.nextKnowledge + 1) % MAX_LANE_KNOWLEDGE; }
  }
  score(actor, proposal) {
    const lane = this.lanes[actor.laneIndex]; if (!lane || !proposal) return 0;
    this._decay(lane);
    let observedTrouble = false;
    for (let index = lane.knowledge.length - 1; index >= 0; index--) {
      const record = lane.knowledge[index];
      if (!this._valid(record)) { lane.knowledge.splice(index, 1); continue; }
      if (record.kind !== 'connected-route' && record.x >= actor.x - 4 && record.x <= actor.x + 40 && Math.abs(record.y - actor.y) <= 32) observedTrouble = true;
    }
    const explore = (mix(this.world.laneSeeds[actor.laneIndex] ^ Math.imul(lane.attempts + 1, 0x85ebca6b)) % 4);
    return (lane.initialBias[proposal.kind] || 0) + (lane.learned[proposal.kind] || 0) + (KINDS[explore] === proposal.kind ? 1 : 0) +
      (observedTrouble && proposal.kind === 'builders' ? 4 : 0);
  }
  connectedConstruction(actor) {
    const lane = this.lanes[actor.laneIndex];
    return lane?.knowledge.some(record => record.kind === 'connected-route' && record.type === 'builders' && Number.isFinite(record.startX) && Number.isFinite(record.startY) && this._valid(record) &&
      actor.x >= record.startX - 2 && actor.x <= record.x + 8 && Math.abs(actor.y - record.y) <= 16) || false;
  }
  descentPreference(actor) {
    return this.score(actor, { kind: 'miners' }) > this.score(actor, { kind: 'diggers' }) ? 'miners' : 'diggers';
  }
  begin(actor, proposal) {
    const lane = this.lanes[actor.laneIndex], task = this.world.accessTasks[actor.laneIndex]?.find(entry => entry.owner === actor);
    if (!lane || !task) return;
    this._decay(lane); lane.attempts++;
    if (proposal.basinScene) { this.world.basinRoutes.begin(actor, proposal, task); return; }
    this.projects.begin(actor, proposal.kind, task);
    this.world.tunnelRoutes?.begin(actor, proposal, task);
    actor._laneRouteAttempt = { lane: actor.laneIndex, kind: proposal.kind, task, action: actor.action, x: actor.x, y: actor.y, falling: false };
  }
  observe(actor, previousAction, previousX) {
    const world = this.world, lane = this.lanes[actor.laneIndex]; if (!lane) return;
    if (actor.scout && previousAction === world.actions[State.CLIMBING] && actor.action === world.actions[State.FALLING] && Math.abs(actor.x - previousX) === 2)
      this.remember(actor, 'failed-climb');
    if (actor.scout && (actor.terminalReason || actor.failureReason) && !actor._scoutFailureRemembered) {
      actor._scoutFailureRemembered = true; this.remember(actor, actor.terminalReason ? 'hazard-contact' : 'unsafe-approach', actor.lastTriggerType || null);
    }
    const attempt = actor._laneRouteAttempt;
    if (attempt && (actor.action !== attempt.action || actor.failureReason || actor.terminalReason || actor.removed)) {
      const state = State;
      if (!actor.failureReason && !actor.terminalReason && !actor.removed && [world.actions[state.FALLING], world.actions[state.JUMPING]].includes(actor.action) && ['diggers', 'miners'].includes(attempt.kind)) attempt.falling = true;
      else {
        const owner = this.lanes[attempt.lane], alive = !actor.failureReason && !actor.terminalReason && !actor.removed;
        const connected = attempt.kind === 'builders' ? world._constructionPassage(attempt.task) === true :
          ['diggers', 'miners'].includes(attempt.kind) ? attempt.falling && actor.action === world.actions[state.WALKING] && actor.y > attempt.y && actor.y - attempt.y <= 32 : actor.x - attempt.x >= 8;
        const success = alive && connected;
        owner[success ? 'successes' : 'failures']++; this._decay(owner);
        if (!success) { owner.learned[attempt.kind] = Math.max(-3, owner.learned[attempt.kind] - 1); this.projects.fail(attempt.lane, attempt.task.crewProjectId); }
        if (!success) this.remember(actor, 'failed-route');
        else {
          this.remember(actor, 'connected-route', attempt.kind);
          const record = lane.knowledge.find(entry => entry.kind === 'connected-route' && entry.cell === Math.floor(actor.x / 32) && entry.band === Math.floor(actor.y / 24));
          if (record) {
            record.ownerId = actor.id;
            if (attempt.kind === 'builders') {
              record.startX = attempt.x; record.startY = attempt.y;
              for (const tile of this._tiles(attempt.x, attempt.y)) if (!record.tiles.some(([key]) => key === tile[0])) record.tiles.push(tile);
            }
            this.projects.connect(attempt.lane, attempt.task.crewProjectId, actor.x, actor.y, record.tiles);
          }
        }
        actor._laneRouteAttempt = null;
      }
    }
    // A crossing is a physical ordinary actor moving past an observed trouble
    // point. It is an outcome signal, not a claim that the whole route is solved.
    if (!actor.scout && !actor.canClimb && !actor.hasParachute && !actor.failureReason && !actor.terminalReason && actor.x > previousX) {
      let crossed = false;
      for (const record of lane.knowledge) if (this._valid(record) && previousX <= record.x + 8 && actor.x > record.x + 8 && Math.abs(actor.y - record.y) <= 32) {
        crossed = true;
      }
      if (crossed) lane.ordinaryCrossings++;
    }
    this.projects.observe(actor);
  }
  signals(lane) { const state = this.lanes[lane]; if (!state) return null; this._decay(state); state.crewProjects = this.projects.signals(lane); return state; }
  dispose() { for (const actor of this.world.actors || []) { actor._laneRouteAttempt = null; actor._crewObservedLane = null; } this.projects.dispose(); this.lanes.length = 0; this.world = null; }
}
export { ProcgenLanePolicy, MAX_LANE_KNOWLEDGE, PREFERENCE_DECAY_TICKS };
