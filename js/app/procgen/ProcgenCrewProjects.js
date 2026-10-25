import { recordPhysicalCrewFact, finishPhysicalCrewEvidence, discardPhysicalCrewEvidence } from './PhysicalCrewEvidence.js';
import { attachCrewOrigin } from './ProcgenBirthCohorts.js';
import { procgenTileRevision } from './ProcgenTerrainRetention.js';
import { SoundEventTypes, SoundEffectIds } from '../../game/SoundEvents.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';

const MAX_CREW_PROJECTS = 4, MAX_PROJECT_CREW = 64, PROJECT_LIFETIME_TICKS = 1600;

// Numeric observations from the existing actor pass. Projects promise only the
// bounded local cohort observed through its admission tick, never later births.
class ProcgenCrewProjects {
  constructor(world, credit) { this.world = world; this.credit = credit; this.reset(); }
  reset() {
    this.lanes = Array.from({ length: this.world.laneCount }, () => ({ live: new Map(), projects: [], completed: 0, failed: 0, deferred: 0, retiredOwnerOnly: 0, nextId: 0, overflowTick: -Infinity, lastTick: this.world.tickIndex }));
  }
  _alive(actor) { return !actor.failureReason && !actor.terminalReason && !actor.removed && !actor.disabled; }
  _ordinary(actor) { return !actor.scout && !actor.canClimb && !actor.hasParachute; }
  _valid(project) { return project.tiles.every(([key, revision]) => procgenTileRevision(this.world, key) === revision); }
  _fail(project, reason) {
    if (project.phase === 'complete' || project.phase === 'failed' || project.phase === 'retired') return;
    finishPhysicalCrewEvidence(this.world, project, reason);
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
    state.projects = state.projects.filter(project => project.phase !== 'complete' && project.phase !== 'failed' && project.phase !== 'retired');
    return state;
  }
  claimConflict(actor, action, bounds, continuation = null) {
    if (!bounds || !Object.values(bounds).every(Number.isFinite) || bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1 || bounds.x2 - bounds.x1 > 128 || bounds.y2 - bounds.y1 > 256) return true;
    const world = this.world, height = world.laneHeight, margin = Math.ceil(256 / height);
    const first = Math.max(0, Math.floor(bounds.y1 / height) - margin), last = Math.min(world.laneCount - 1, Math.floor((bounds.y2 - 1) / height) + margin);
    for (let lane = first; lane <= last; lane++) for (const project of this.lanes[lane].projects) {
      if (!['working', 'connected'].includes(project.phase) || project.generation !== world.generation) continue;
      const b = project.bounds;
      if (bounds.x1 >= b.x2 || bounds.x2 <= b.x1 || bounds.y1 >= b.y2 || bounds.y2 <= b.y1) continue;
      const manager = continuation?.manager;
      if (continuation?.project === project && this._valid(project) && (manager === this || manager === world || manager === world.basinRoutes || manager === world.tunnelRoutes) &&
          manager.allowsProjectClaim?.(continuation, actor, action, bounds)) continue;
      return true;
    }
    return false;
  }
  canBegin(actor) {
    const state = this._refresh(actor.laneIndex);
    if (!Number.isInteger(actor.id) || state.overflowTick >= this.world.tickIndex - 1 || state.projects.length >= MAX_CREW_PROJECTS) return false;
    let members = 1;
    for (const record of state.live.values()) if (record.id !== actor.id && record.ordinary && !record.blocking && record.x >= actor.x - 128 && record.x <= actor.x + 40 && Math.abs(record.y - actor.y) <= 32) members++;
    return members <= MAX_PROJECT_CREW;
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
    task.crewProjectId = project.id; state.projects.push(project); recordPhysicalCrewFact(this.world, project, 'CrewRouteOpened');
    for (const member of this.world.actors) if (members.has(member.id)) attachCrewOrigin(this.world, member, project.id);
    return project.id;
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
    project.connectionTick = this.world.tickIndex; recordPhysicalCrewFact(this.world, project, 'CrewRouteConnected');
  }
  fail(lane, id, reason = 'worker-failure') {
    const project = this.lanes[lane]?.projects.find(entry => entry.id === id); if (project) this._fail(project, reason);
  }
  beginChain(actor, proposal, task) {
    const id = this.begin(actor, proposal.kind, task), project = this.lanes[actor.laneIndex].projects.find(entry => entry.id === id);
    if (!project) return false;
    const proof = proposal.chain;
    project.chain = { stages: proof.stages.map(stage => ({ ...stage, footprint: { ...stage.footprint } })), index: 0,
      exitX: proof.exitX, exitY: proof.exitY, bounds: { ...proof.bounds }, changed: false, lostOwners: [], stageStartTick: this.world.tickIndex };
    project.tiles = proof.tiles.map(tile => [...tile]); project.exitX = proof.exitX - 8;
    actor._crewChainId = id;
    return true;
  }
  allowsProjectClaim(continuation, actor, action, bounds) {
    const project = continuation.project, chain = project?.chain, stage = chain?.stages[chain.index];
    return project?.phase === 'working' && project.ownerId === actor.id && !chain.changed && stage &&
      actor.x === stage.x && actor.y === stage.y && action === this.world.actions[stage.kind === 'builders' ? State.BUILDING : stage.kind === 'bashers' ? State.BASHING : State.MINING] &&
      bounds.x1 >= project.bounds.x1 && bounds.x2 <= project.bounds.x2 && bounds.y1 >= project.bounds.y1 && bounds.y2 <= project.bounds.y2;
  }
  edit(x, y, ownerId) {
    const world = this.world, key = Math.floor(y / world.laneHeight) * 0x800000 + Math.floor(x / (world.terrain?.chunkWidth || 256));
    const lane = Math.floor(y / world.laneHeight), margin = Math.ceil(128 / world.laneHeight);
    for (let index = Math.max(0, lane - margin); index <= Math.min(world.laneCount - 1, lane + margin); index++) for (const project of this.lanes[index].projects) {
      if (!project.chain || project.phase !== 'working') continue;
      const b = project.chain.bounds;
      if (x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2 && ownerId !== project.ownerId) project.chain.changed = true;
      if (ownerId === project.ownerId) for (const tile of project.tiles) if (tile[0] === key) tile[1] = procgenTileRevision(world, key);
    }
  }
  assistChain(actor) {
    const world = this.world, state = this.lanes[actor.laneIndex];
    if (!state) return false;
    world.hazardPlanner.observeContact(actor);
    const held = state.projects.find(entry => entry.id === actor._crewChainHoldId);
    if (actor._crewChainHoldId && actor.action === world.actions[State.BLOCKING]) {
      if (!held || held.phase === 'failed' || (held.phase === 'connected' || held.phase === 'working' && held.ownerId == null) && this._valid(held)) {
        const stride = Math.max(1, Math.ceil(world.laneCount / 8)), service = world.hazardPlanner.admission.begin(actor.laneIndex);
        if (actor.laneIndex % stride === world.tickIndex % stride && !service.consumed && service.probes + 256 <= 1024) {
          world.hazardPlanner.admission.served(actor, service.probes + 256);
          if (world._emptyBashMasks(actor) && world.assignWorker(actor, 'bashers', actor.x)) actor._crewChainHoldId = null;
        }
      }
      return true;
    }
    const waiting = state.projects.find(entry => entry.chain && entry.phase === 'working' && entry.ownerId !== actor.id && entry.members.has(actor.id));
    if (waiting && waiting.ownerId != null && actor.action === world.actions[State.WALKING] && actor.lookRight && actor.x >= waiting.startX - 32 && actor.x <= waiting.startX - 12 &&
        Math.abs(actor.y - waiting.startY) <= 3 && world.hasGroundAt(actor.x, actor.y + 1) && world.workerLimits.bashers && world._emptyBashMasks(actor)) {
      actor.setAction(world.actions[State.BLOCKING]); actor._crewChainHoldId = waiting.id; waiting.members.get(actor.id).blocker = true; world.stats.blockers++; actor.assists++;
      return true;
    }
    let project = state.projects.find(entry => entry.id === actor._crewChainId && entry.phase === 'working');
    if (!project) {
      actor._crewChainId = null;
      // Replacement workers must physically reach the pending launch pose.
      project = state.projects.find(entry => entry.chain && entry.phase === 'working' && entry.ownerId == null && entry.members.has(actor.id) &&
        actor.action === world.actions[State.WALKING] && actor.lookRight && actor.x === entry.chain.stages[entry.chain.index].x && actor.y === entry.chain.stages[entry.chain.index].y);
      if (!project) return false;
      project.ownerId = actor.id; actor._crewChainId = project.id; project.chain.pending = true; project.chain.changed = true;
    }
    const chain = project.chain;
    if (!this._alive(actor)) return false;
    if (!actor.lookRight || world.tickIndex - chain.stageStartTick > 400) { this._fail(project, 'chain-deviation'); actor._crewChainId = null; return false; }
    if (actor.action !== world.actions[State.WALKING] && !(chain.waitingService && actor.action === world.actions[State.BLOCKING])) return true;
    if (!chain.pending) {
      const next = chain.stages[chain.index + 1];
      if (!next) {
        if (actor.x >= chain.exitX && Math.abs(actor.y - chain.exitY) <= 3 && !chain.changed && this._valid(project)) {
          this.connect(project.lane, project.id, chain.exitX - 8, chain.exitY, project.tiles); actor._crewChainId = null;
        }
        return true;
      }
      if (actor.x < next.x) return true;
      if (actor.x !== next.x || actor.y !== next.y) { this._fail(project, 'chain-launch-missed'); actor._crewChainId = null; return false; }
      chain.index++; chain.pending = true;
    }
    const planned = chain.stages[chain.index];
    if (actor.x !== planned.x || actor.y !== planned.y) { this._fail(project, 'chain-launch-missed'); actor._crewChainId = null; return false; }
    const proof = world.hazardPlanner.revalidateChain(actor, project);
    if (proof?.deferred) {
      if (!chain.waitingService && world.hasGroundAt(actor.x, actor.y + 1)) {
        actor.setAction(world.actions[State.BLOCKING]); world.stats.blockers++; actor.assists++; chain.waitingService = true;
      }
      return true;
    }
    if (!proof?.safe) { this._fail(project, proof?.failure || 'chain-service-deferred'); actor._crewChainId = null; return false; }
    chain.stages.splice(chain.index, chain.stages.length - chain.index, ...proof.stages);
    chain.exitX = proof.exitX; chain.exitY = proof.exitY; project.exitX = proof.exitX - 8; project.tiles = proof.tiles; chain.changed = false;
    const next = chain.stages[chain.index];
    if (!world.assignWorker(actor, next.kind, next.x + (next.kind === 'builders' ? 24 : 8), next.footprint, { manager: this, project })) {
      this._fail(project, 'chain-claim'); actor._crewChainId = null; return false;
    }
    const task = world.accessTasks[actor.laneIndex].find(entry => entry.owner === actor); if (task) task.crewProjectId = project.id;
    chain.pending = false; chain.waitingService = false; chain.stageStartTick = world.tickIndex;
    return true;
  }
  retire(actor, reason = 'crew-loss') {
    const lane = actor._crewObservedLane ?? actor.laneIndex, state = this.lanes[lane]; if (!state) return;
    state.live.delete(actor.id);
    for (const project of state.projects) if (project.members.has(actor.id)) {
      if (project.chain && project.phase === 'working' && project.ownerId === actor.id && project.members.size > 1) {
        project.chain.lostOwners.push(actor.id); project.members.delete(actor.id); project.ownerId = null; project.chain.changed = true;
      } else this._fail(project, reason);
    }
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
      if (project && !project.basinArrival && !project.members.has(actor.id)) {
        if (project.members.size >= MAX_PROJECT_CREW) this._fail(project, 'containment-capacity');
        else project.members.set(actor.id, { id: actor.id, ordinary: this._ordinary(actor), crossed: false, blocker: true, lastSeenTick: this.world.tickIndex });
      }
      if (project?.members.has(actor.id)) { project.members.get(actor.id).blocker = true; attachCrewOrigin(this.world, actor, project.id); }
    }
    let observation = state.live.get(actor.id);
    if (!observation && state.live.size < MAX_PROJECT_CREW) { observation = { id: actor.id }; state.live.set(actor.id, observation); }
    if (observation) {
      observation.x = actor.x; observation.y = actor.y; observation.tick = this.world.tickIndex;
      observation.generation = this.world.generation; observation.lane = lane; observation.spawnTick = actor.spawnTick; observation.heldProjectId = held?.crewProjectId ?? null;
      observation.walking = actor.action === this.world.actions[State.WALKING];
      observation.ordinary = this._ordinary(actor); observation.blocking = actor.action === this.world.actions[State.BLOCKING];
    } else state.overflowTick = this.world.tickIndex;
    for (const project of state.projects) {
      if (!project.basinArrival && project.phase === 'working' && project.startTick === this.world.tickIndex && !project.members.has(actor.id) && this._ordinary(actor) &&
          actor.action !== this.world.actions[State.BLOCKING] && actor.x >= project.startX - 128 && actor.x <= project.startX + 40 && Math.abs(actor.y - project.startY) <= 32) {
        if (project.members.size >= MAX_PROJECT_CREW) this._fail(project, 'admission-capacity');
        else project.members.set(actor.id, { id: actor.id, ordinary: true, crossed: false, blocker: false, lastSeenTick: this.world.tickIndex });
      }
      const member = project.members.get(actor.id); if (member) { member.lastSeenTick = this.world.tickIndex; attachCrewOrigin(this.world, actor, project.id); }
      if (member?.ordinary && !this._ordinary(actor)) { this._fail(project, 'crew-changed'); continue; }
      if (project.phase !== 'connected' || !this._valid(project)) continue;
      if (!member || member.crossed || actor.action !== this.world.actions[State.WALKING] ||
          project.direction * (actor.x - project.goalX) <= 0 || Math.abs(actor.y - project.goalY) > 32) continue;
      member.crossed = true; recordPhysicalCrewFact(this.world, project, 'CrewMemberArrived', actor.id);
      if (member.ordinary && actor.id !== project.ownerId) {
        project.ordinaryCrossings++;
        if (!project.passageRewarded) { project.passageRewarded = true; this.credit(project.lane, project.kind, 'passage'); }
      }
    }
    if (state.lastTick !== this.world.tickIndex) { state.lastTick = this.world.tickIndex; this._refresh(lane); }
  }
  _retireOwnerOnly(project, state) {
    // This owner has fulfilled its only promise. A scene or passive recipient
    // keeps its original lifetime and can never be evicted for a new project.
    if (project.phase !== 'connected' || project.members.size !== 1 || project.scene || project.basinArrival || !this._valid(project)) return false;
    const member = project.members.get(project.ownerId), live = state.live.get(project.ownerId);
    if (!member?.crossed || member.blocker || !live || live.tick !== this.world.tickIndex || live.generation !== project.generation || live.lane !== project.lane ||
        !live.walking || live.blocking || live.heldProjectId != null || project.direction * (live.x - project.goalX) <= 0 || Math.abs(live.y - project.goalY) > 32) return false;
    discardPhysicalCrewEvidence(this.world, project.id); project.phase = 'retired'; project.retirement = 'fulfilled-owner-only'; state.retiredOwnerOnly++;
    return true;
  }
  finish(lane) {
    const state = this._refresh(lane);
    if (this.world._manualNukeLanes?.[lane] || this.world.stall && this.world.stall.phase !== 'running') {
      for (const project of state.projects) this._fail(project, 'scene-cancelled');
      return;
    }
    for (const project of state.projects) {
      if (this._retireOwnerOnly(project, state)) continue;
      if (project.phase !== 'connected' || !project.ordinaryCrossings || !this._valid(project)) continue;
      let arrived = true, blockers = 0;
      for (const member of project.members.values()) {
        const live = state.live.get(member.id);
        if (!member.crossed || !live || live.tick !== this.world.tickIndex || !live.walking ||
            project.direction * (live.x - project.goalX) <= 0 || Math.abs(live.y - project.goalY) > 32) { arrived = false; break; }
        if (member.blocker) blockers++;
      }
      if (!arrived) continue;
      finishPhysicalCrewEvidence(this.world, project);
      project.phase = 'complete'; state.completed++; this.credit(project.lane, project.kind, 'crew-complete');
      this.world.soundEvents?.emit({ type: SoundEventTypes.PROCGEN_ROUTE_COMPLETE, sfxId: SoundEffectIds.PROCGEN_ROUTE_COMPLETE, lemmingId: project.ownerId, laneIndex: project.lane, laneCount: this.world.laneCount,
        generation: project.generation, tick: this.world.tickIndex, crewProjectId: project.id, routeRevisionsUnchanged: true, kind: project.kind,
        ordinaryCrossings: project.ordinaryCrossings, admittedCrew: project.members.size, x: project.goalX, y: project.goalY,
        startTick: project.startTick, connectionTick: project.connectionTick, recoveredBlockers: blockers,
        ...(project.chain ? { chainStages: project.chain.stages.map(stage => stage.kind), lostWorkers: project.chain.lostOwners.length } : {}), ...project.scene });
    }
  }
  signals(lane) {
    const state = this.lanes[lane];
    return state ? { active: state.projects.filter(project => project.phase === 'working' || project.phase === 'connected').length,
      completed: state.completed, failed: state.failed, deferred: state.deferred, retiredOwnerOnly: state.retiredOwnerOnly, observedCrew: state.live.size } : null;
  }
  dispose() { this.lanes.length = 0; this.world = null; this.credit = null; }
}
export { ProcgenCrewProjects, MAX_CREW_PROJECTS, MAX_PROJECT_CREW, PROJECT_LIFETIME_TICKS };
