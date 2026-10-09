import { procgenTileRevision } from './ProcgenTerrainRetention.js';
import { SoundEventTypes, SoundEffectIds } from '../../game/SoundEvents.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';

const MAX_CREW_PROJECTS = 4, MAX_PROJECT_CREW = 64, PROJECT_LIFETIME_TICKS = 1600;

// Numeric observations from the existing actor pass. Projects promise only the
// bounded local cohort observed through its admission tick, never later births.
class ProcgenCrewProjects {
  constructor(world, credit) { this.world = world; this.credit = credit; this.reset(); }
  reset() {
    this.lanes = Array.from({ length: this.world.laneCount }, () => ({ live: new Map(), projects: [], completed: 0, failed: 0, deferred: 0, nextId: 0, overflowTick: -Infinity, lastTick: this.world.tickIndex }));
  }
  _alive(actor) { return !actor.failureReason && !actor.terminalReason && !actor.removed && !actor.disabled; }
  _ordinary(actor) { return !actor.scout && !actor.canClimb && !actor.hasParachute; }
  _valid(project) { return project.tiles.every(([key, revision]) => procgenTileRevision(this.world, key) === revision); }
  _fail(project, reason) {
    if (project.phase === 'complete' || project.phase === 'failed') return;
    project.phase = 'failed'; project.failure = reason; this.lanes[project.lane].failed++;
    if (reason === 'crew-loss' && project.passageRewarded) this.credit(project.lane, project.kind, 'crew-failure');
  }
  _refresh(lane) {
    const state = this.lanes[lane], tick = this.world.tickIndex;
    for (const [id, record] of state.live) if (record.tick < tick - 1) state.live.delete(id);
    for (const project of state.projects) {
      if (project.generation !== this.world.generation || tick < project.startTick) this._fail(project, 'generation-or-rewind');
      else if (tick - project.startTick > PROJECT_LIFETIME_TICKS) this._fail(project, 'deadline');
      else if (project.phase === 'connected' && !this._valid(project)) this._fail(project, 'changed-route');
      else if ([...project.members.keys()].some(id => !state.live.has(id) && project.members.get(id).lastSeenTick < tick - 1)) this._fail(project, 'missing-crew');
    }
    state.projects = state.projects.filter(project => project.phase !== 'complete' && project.phase !== 'failed');
    return state;
  }
  begin(actor, kind, task) {
    const state = this._refresh(actor.laneIndex);
    if (task.crewProjectId != null) return;
    if (!Number.isInteger(actor.id) || state.overflowTick >= this.world.tickIndex - 1) { state.deferred++; return; }
    if (state.projects.length >= MAX_CREW_PROJECTS) { state.deferred++; return; }
    const members = new Map();
    for (const record of state.live.values()) if (record.ordinary && record.x >= actor.x - 128 && record.x <= actor.x + 40 && Math.abs(record.y - actor.y) <= 32 && !record.blocking)
      members.set(record.id, { id: record.id, ordinary: true, crossed: false, blocker: false, lastSeenTick: this.world.tickIndex });
    if (!members.has(actor.id)) members.set(actor.id, { id: actor.id, ordinary: this._ordinary(actor), crossed: false, blocker: false, lastSeenTick: this.world.tickIndex });
    if (members.size > MAX_PROJECT_CREW) { state.deferred++; return; }
    const project = { id: `${this.world.generation}:${actor.laneIndex}:${state.nextId++}`, generation: this.world.generation, lane: actor.laneIndex,
      kind, ownerId: actor.id, startTick: this.world.tickIndex, startX: actor.x, startY: actor.y, direction: actor.lookRight !== false ? 1 : -1,
      bounds: task.footprint ? { ...task.footprint } : { x1: actor.x - 16, x2: actor.x + 16, y1: actor.y - 12, y2: actor.y + 12 },
      exitX: actor.lookRight !== false ? Math.max(actor.x, task.footprint?.x2 ?? task.targetX ?? actor.x) : Math.min(actor.x, task.footprint?.x1 ?? task.targetX ?? actor.x), phase: 'working', members, ordinaryCrossings: 0, passageRewarded: false, tiles: [] };
    task.crewProjectId = project.id; state.projects.push(project); return project.id;
  }
  connect(lane, id, x, y, tiles) {
    const project = this.lanes[lane]?.projects.find(entry => entry.id === id);
    if (!project || project.phase !== 'working') return;
    project.phase = 'connected'; project.goalX = (project.direction > 0 ? Math.max(x, project.exitX) : Math.min(x, project.exitX)) + project.direction * 8; project.goalY = y;
    project.tiles = tiles.map(tile => [...tile]);
    const width = this.world.terrain?.chunkWidth || 256, bounds = project.bounds;
    if (!Object.values(bounds).every(Number.isFinite) || bounds.x2 < bounds.x1 || bounds.y2 < bounds.y1 || bounds.x2 - bounds.x1 > 128 || bounds.y2 - bounds.y1 > 256) {
      this._fail(project, 'revision-capacity'); return;
    }
    for (let lane = Math.max(0, Math.floor(bounds.y1 / (this.world.laneHeight || 144))); lane <= Math.min(this.world.laneCount - 1, Math.floor(bounds.y2 / (this.world.laneHeight || 144))); lane++)
      for (let chunk = Math.max(0, Math.floor(bounds.x1 / width)); chunk <= Math.floor(bounds.x2 / width); chunk++) {
        const key = lane * 0x800000 + chunk;
        if (!project.tiles.some(tile => tile[0] === key)) project.tiles.push([key, procgenTileRevision(this.world, key)]);
      }
    if (project.tiles.length > 8) { this._fail(project, 'revision-capacity'); return; }
    project.connectionTick = this.world.tickIndex;
  }
  fail(lane, id, reason = 'worker-failure') {
    const project = this.lanes[lane]?.projects.find(entry => entry.id === id); if (project) this._fail(project, reason);
  }
  retire(actor, reason = 'crew-loss') {
    const lane = actor._crewObservedLane ?? actor.laneIndex, state = this.lanes[lane]; if (!state) return;
    state.live.delete(actor.id);
    for (const project of state.projects) if (project.members.has(actor.id)) this._fail(project, reason);
    actor._crewObservedLane = null;
  }
  observe(actor) {
    if (actor._crewObservedLane != null && actor._crewObservedLane !== actor.laneIndex) this.retire(actor, 'crew-transfer');
    const lane = actor.laneIndex, state = this.lanes[lane]; if (!state) return;
    if (!this._alive(actor)) { this.retire(actor); return; }
    actor._crewObservedLane = lane;
    const held = actor.assistConstructionTask;
    if (held?.crewProjectId != null) {
      const project = state.projects.find(entry => entry.id === held.crewProjectId);
      if (project && !project.members.has(actor.id)) {
        if (project.members.size >= MAX_PROJECT_CREW) this._fail(project, 'containment-capacity');
        else project.members.set(actor.id, { id: actor.id, ordinary: this._ordinary(actor), crossed: false, blocker: true, lastSeenTick: this.world.tickIndex });
      }
      if (project?.members.has(actor.id)) project.members.get(actor.id).blocker = true;
    }
    let observation = state.live.get(actor.id);
    if (!observation && state.live.size < MAX_PROJECT_CREW) { observation = { id: actor.id }; state.live.set(actor.id, observation); }
    if (observation) {
      observation.x = actor.x; observation.y = actor.y; observation.tick = this.world.tickIndex;
      observation.walking = actor.action === this.world.actions[State.WALKING];
      observation.ordinary = this._ordinary(actor); observation.blocking = actor.action === this.world.actions[State.BLOCKING];
    } else state.overflowTick = this.world.tickIndex;
    for (const project of state.projects) {
      if (project.phase === 'working' && project.startTick === this.world.tickIndex && !project.members.has(actor.id) && this._ordinary(actor) &&
          actor.action !== this.world.actions[State.BLOCKING] && actor.x >= project.startX - 128 && actor.x <= project.startX + 40 && Math.abs(actor.y - project.startY) <= 32) {
        if (project.members.size >= MAX_PROJECT_CREW) this._fail(project, 'admission-capacity');
        else project.members.set(actor.id, { id: actor.id, ordinary: true, crossed: false, blocker: false, lastSeenTick: this.world.tickIndex });
      }
      const member = project.members.get(actor.id); if (member) member.lastSeenTick = this.world.tickIndex;
      if (member?.ordinary && !this._ordinary(actor)) { this._fail(project, 'crew-changed'); continue; }
      if (project.phase !== 'connected' || !this._valid(project)) continue;
      if (!member || member.crossed || actor.action !== this.world.actions[State.WALKING] ||
          project.direction * (actor.x - project.goalX) <= 0 || Math.abs(actor.y - project.goalY) > 32) continue;
      member.crossed = true;
      if (member.ordinary && actor.id !== project.ownerId) {
        project.ordinaryCrossings++;
        if (!project.passageRewarded) { project.passageRewarded = true; this.credit(project.lane, project.kind, 'passage'); }
      }
    }
    if (state.lastTick !== this.world.tickIndex) { state.lastTick = this.world.tickIndex; this._refresh(lane); }
  }
  finish(lane) {
    const state = this._refresh(lane);
    for (const project of state.projects) {
      if (project.phase !== 'connected' || !project.ordinaryCrossings || !this._valid(project)) continue;
      let arrived = true, blockers = 0;
      for (const member of project.members.values()) {
        const live = state.live.get(member.id);
        if (!member.crossed || !live || live.tick !== this.world.tickIndex || !live.walking ||
            project.direction * (live.x - project.goalX) <= 0 || Math.abs(live.y - project.goalY) > 32) { arrived = false; break; }
        if (member.blocker) blockers++;
      }
      if (!arrived) continue;
      project.phase = 'complete'; state.completed++; this.credit(project.lane, project.kind, 'crew-complete');
      this.world.soundEvents?.emit({ type: SoundEventTypes.PROCGEN_ROUTE_COMPLETE, sfxId: SoundEffectIds.PROCGEN_ROUTE_COMPLETE, lemmingId: project.ownerId, laneIndex: project.lane, laneCount: this.world.laneCount,
        generation: project.generation, tick: this.world.tickIndex, crewProjectId: project.id, routeRevisionsUnchanged: true, kind: project.kind,
        ordinaryCrossings: project.ordinaryCrossings, admittedCrew: project.members.size, x: project.goalX, y: project.goalY,
        startTick: project.startTick, connectionTick: project.connectionTick, recoveredBlockers: blockers });
    }
  }
  signals(lane) {
    const state = this.lanes[lane];
    return state ? { active: state.projects.filter(project => project.phase === 'working' || project.phase === 'connected').length,
      completed: state.completed, failed: state.failed, deferred: state.deferred, observedCrew: state.live.size } : null;
  }
  dispose() { this.lanes.length = 0; this.world = null; this.credit = null; }
}
export { ProcgenCrewProjects, MAX_CREW_PROJECTS, MAX_PROJECT_CREW, PROJECT_LIFETIME_TICKS };
