import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ProcgenGuardRecovery, GUARD_RECOVERY_STEPS } from './ProcgenGuardRecovery.js';
import { procgenTileRevision } from './ProcgenTerrainRetention.js';

const TUNNEL_GUARD_TICKS = 1000;
// One current local port per physical lane. A positive shared-action copy proof
// precedes the request, and an arriving supported actor owns the real BLOCK.
class ProcgenTunnelCrewRoutes {
  constructor(world) { this.world = world; this.recovery = new ProcgenGuardRecovery(world); this.scenes = new Array(world.laneCount).fill(null); this.nearby = []; this.stats = { requested: 0, guards: 0, connected: 0, released: 0, failed: 0 }; }
  request(actor, evidence) {
    const world = this.world;
    if (!evidence || !Number.isFinite(evidence.guardY) || this.scenes[actor.laneIndex] || !world.workerLimits.bashers || !world.lanePolicy.projects.canBegin(actor)) return false;
    const bounds = evidence.observedBounds ? { ...evidence.observedBounds } : { x1: actor.x - 16, x2: evidence.exitX + 1, y1: actor.y - 16, y2: actor.y + 33 };
    const initialClaim = world._workerClaimBounds(actor, world.actions[State.BASHING]);
    if (world.lanePolicy.projects.claimConflict(actor, world.actions[State.BASHING], initialClaim) || world.lanePolicy.projects.claimConflict(actor, world.actions[State.BASHING], bounds)) return false;
    this.scenes[actor.laneIndex] = { lane: actor.laneIndex, generation: world.generation, startTick: world.tickIndex, startX: actor.x, startY: actor.y,
      bounds, port: { ...evidence }, phase: 'pending', guard: null, task: null, worker: null };
    this.stats.requested++; return true;
  }
  guard(actor) {
    const scene = this.scenes[actor.laneIndex];
    return scene?.phase === 'guarded' && !scene.failure && !scene.retirement && Math.abs(actor.x - scene.startX) <= 3 && Math.abs(actor.y - scene.startY) <= 3 ? scene.guard : null;
  }
  reserved(actor) {
    const scene = this.scenes[actor.laneIndex];
    return scene?.guard && ['guarded', 'working', 'connected'].includes(scene.phase) && actor !== scene.guard && actor !== scene.worker &&
      actor.x >= scene.guard.x - 8 && actor.x < scene.startX && Math.abs(actor.y - scene.guard.y) <= 12;
  }
  _guardProof(actor, maxWork) {
    const world = this.world, cells = new Map(); let failure = null;
    const read = (x, y) => {
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth), key = `${x}:${y}`;
      if (x < world.leftEdgeX || y < 0 || y >= world.height || x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x)) { failure ||= 'unrevealed'; return false; }
      if (!cells.has(key)) { if (cells.size >= maxWork) { failure ||= 'budget'; return false; } cells.set(key, world.hasGroundAt(x, y)); }
      return cells.get(key);
    };
    if (!read(actor.x, actor.y) || !read(actor.x, actor.y + 1)) failure ||= 'support';
    const masks = world.actions[State.BASHING].masks?.get(actor.getDirection());
    for (let index = 0; index < 4 && !failure; index++) {
      const mask = masks?.GetMask(index); if (!mask) { failure = 'masks'; break; }
      for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(actor.x + mask.offsetX + dx, actor.y + mask.offsetY + dy)) failure ||= 'blocked-recovery';
    }
    world.hazards.nearby(actor.laneIndex, actor.x, { ahead: 16, behind: 4 }, this.nearby);
    if (this.nearby.some(h => actor.x + 2 > h.x1 && actor.x - 2 < h.x2 && actor.y + 1 > h.y1 && actor.y - 10 < h.y2)) failure ||= 'hazard';
    return { safe: !failure, probes: cells.size };
  }
  _releaseGuard(scene, actor) {
    const world = this.world, project = world.lanePolicy.projects.lanes[scene.lane].projects.find(p => p.id === scene.task?.crewProjectId);
    const claim = { manager: this, project, scene, actor, bounds: world._workerClaimBounds(actor, world.actions[State.BASHING]), tick: world.tickIndex };
    this._claim = claim;
    try { return world.assignWorker(actor, 'bashers', actor.x, null, claim); }
    finally { this._claim = null; }
  }
  allowsProjectClaim(claim, actor, action, bounds) {
    const world = this.world, scene = claim.scene, b = claim.bounds, triggers = world.triggerManager.byOwner.get(actor) || [];
    const key = triggers.map(t => `${t.type}:${t.x1}:${t.x2}:${t.y1}:${t.y2}`).join(',');
    return claim === this._claim && claim.actor === actor && this.scenes[actor.laneIndex] === scene && scene.guard === actor && actor._tunnelScene === scene &&
      scene.task?.crewProjectId === claim.project.id && claim.project.phase === 'connected' && scene.phase === 'connected' && scene.releaseReady && !scene.failure &&
      scene.generation === world.generation && world.tickIndex >= scene.startTick && world.tickIndex - scene.startTick <= TUNNEL_GUARD_TICKS && claim.tick === world.tickIndex &&
      actor.action === world.actions[State.BLOCKING] && actor.x === scene.guardX && actor.y === scene.guardY && actor.lookRight && triggers.length === 2 && key === scene.triggerKey &&
      action === world.actions[State.BASHING] && b && ['x1', 'x2', 'y1', 'y2'].every(field => bounds[field] === b[field]) && world._emptyBashMasks(actor);
  }
  assist(actor) {
    const world = this.world, scene = this.scenes[actor.laneIndex]; if (!scene) return false;
    if (actor === scene.guard) {
      if (scene.phase === 'recovering') return true;
      if (scene.phase === 'connected' && scene.releaseReady && actor.action === world.actions[State.BLOCKING] && world._emptyBashMasks(actor) && this._releaseGuard(scene, actor)) {
        scene.phase = 'released'; this.stats.released++;
      }
      return actor.action === world.actions[State.BLOCKING];
    }
    // Preserve the privately observed natural worker continuation to its exit;
    // this leaves shared movement running and admits no replacement skill.
    if (actor === scene.worker && scene.phase === 'working') return true;
    if (scene.phase !== 'pending' || actor.action !== world.actions[State.WALKING] || !actor.lookRight || actor.scout || actor.canClimb || actor.hasParachute || actor.failureReason || actor.terminalReason || actor.removed ||
        actor.x < scene.port.guardX - 2 || actor.x > scene.port.guardX + 2 || Math.abs(actor.y - scene.port.guardY) > 2) return false;
    // Request capacity cannot authorize a later job over another still-promised
    // route. Recheck the planned worker's real masks before creating any BLOCK.
    const future = { x: scene.startX, y: scene.startY, getDirection: () => 'right' };
    const initialClaim = world._workerClaimBounds(future, world.actions[State.BASHING]);
    if (world.lanePolicy.projects.claimConflict(actor, world.actions[State.BASHING], initialClaim) || world.lanePolicy.projects.claimConflict(actor, world.actions[State.BASHING], scene.bounds)) { this.scenes[scene.lane] = null; return false; }
    const stride = Math.max(1, Math.ceil(world.laneCount / 8)); if (actor.laneIndex % stride !== world.tickIndex % stride) return false;
    const ledger = world.hazardPlanner.admission.begin(actor.laneIndex); if (ledger.consumed || ledger.probes >= 1024 || !world.lanePolicy.projects.canBegin(actor)) return false;
    const proof = this._guardProof(actor, 1024 - ledger.probes); ledger.probes += proof.probes;
    if (!proof.safe) return false;
    actor.setAction(world.actions[State.BLOCKING]); actor._tunnelScene = scene; scene.guard = actor; scene.guardX = actor.x; scene.guardY = actor.y; scene.phase = 'guarded'; world.stats.blockers++; actor.assists++; this.stats.guards++;
    return true;
  }
  begin(actor, proposal, task) {
    const scene = this.scenes[actor.laneIndex];
    if (scene?.phase !== 'guarded' || scene.failure || scene.retirement || !scene.guard || proposal.routeEvidence?.rearBlockerId !== scene.guard.id) return;
    scene.worker = actor; scene.task = task; scene.phase = 'working'; scene.exitX = proposal.routeEvidence.exitX; scene.exitY = proposal.continuationY;
    scene.crossed = new Set();
    scene.guard.assistConstructionTask = task; task.blocker = scene.guard; task.tunnelScene = scene;
    const project = this.world.lanePolicy.projects.lanes[actor.laneIndex].projects.find(entry => entry.id === task.crewProjectId);
    if (project) {
      project.exitX = scene.exitX - 8;
      const live = this.world.lanePolicy.projects.lanes[actor.laneIndex].live;
      scene.releaseOrdinary = new Set([...project.members.values()].filter(member => member.ordinary).map(member => member.id));
      scene.releaseMembers = [...project.members.keys()].filter(id => id !== scene.guard.id && live.get(id)?.x >= scene.guard.x + 7);
      if (!scene.releaseMembers.includes(actor.id)) scene.releaseMembers.push(actor.id);
    }
  }
  observe(actor) {
    const scene = this.scenes[actor.laneIndex];
    if (scene?.phase === 'recovering' && scene.guard === actor && !actor.failureReason && !actor.terminalReason && !actor.removed && !actor.disabled) {
      const exit = scene.recoveryExit;
      scene.recoverySteps++;
      if (actor.action === this.world.actions[State.WALKING] && actor.x === exit.x && actor.y === exit.y && actor.lookRight === exit.lookRight && this.world.hasGroundAt(actor.x, actor.y)) {
        scene.recoveryReached = true;
      }
      if (scene.recoverySteps > GUARD_RECOVERY_STEPS) scene.failure ||= 'recovery-exit';
    }
    if (scene?.releaseMembers?.includes(actor.id) && actor.action === this.world.actions[State.WALKING] && actor.x >= scene.exitX && Math.abs(actor.y - scene.exitY) <= 12 && !actor.failureReason && !actor.terminalReason) scene.crossed.add(actor.id);
    if (scene?.worker === actor && scene.phase === 'working' && actor.action === this.world.actions[State.WALKING] &&
        actor.x >= scene.exitX && Math.abs(actor.y - scene.exitY) <= 3 && !actor.failureReason && !actor.terminalReason && actor.lookRight) {
      scene.phase = 'connected'; this.stats.connected++;
    }
  }
  edit(x, y, ownerId) {
    const scene = this.scenes[Math.floor(y / this.world.laneHeight)], bounds = scene?.recoveryExit?.bounds || scene?.task?.footprint || scene?.bounds;
    if (bounds && x >= bounds.x1 && x < bounds.x2 && y >= bounds.y1 && y < bounds.y2 && ownerId !== scene.worker?.id) scene.failure = 'changed-route';
    if (scene?.phase === 'recovering') {
      const key = scene.lane * 0x800000 + Math.floor(x / this.world.terrain.chunkWidth);
      // Foreign edits outside the actually observed recovery cannot make its
      // tile metadata look stale. Relevant edits still take the failure path.
      for (const tile of scene.recoveryExit.tiles) if (tile[0] === key) tile[1] = procgenTileRevision(this.world, key);
    }
  }
  _recover(scene) {
    const world = this.world, actor = scene.guard, stride = Math.max(1, Math.ceil(world.laneCount / 8));
    if (!this.recovery.validOwner(scene)) return false;
    if (!world.workerLimits.bashers) return !!scene.retirement;
    if (scene.lane % stride !== world.tickIndex % stride) return true;
    const ledger = world.hazardPlanner.admission.begin(scene.lane);
    if (ledger.consumed || ledger.probes >= 1024) return true;
    const proof = this.recovery.prove(scene, 1024 - ledger.probes);
    world.hazardPlanner.admission.served(actor, ledger.probes + proof.probes);
    if (proof.failure === 'budget' || proof.failure === 'unrevealed') return true;
    if (!proof.safe) { scene.failure = `recovery-${proof.failure}`; return false; }
    if (proof.actionSteps > scene.startTick + TUNNEL_GUARD_TICKS - world.tickIndex) { scene.failure = 'recovery-deadline'; return false; }
    if (!world.assignWorker(actor, 'bashers', actor.x, proof.bounds)) return true;
    scene.phase = 'recovering'; scene.recoveryExit = proof; scene.recoverySteps = 0; scene.failure = null;
    this.stats.recoveryStarted = (this.stats.recoveryStarted || 0) + 1; return true;
  }
  finish(lane) {
    const world = this.world, scene = this.scenes[lane]; if (!scene) return;
    if (scene.guard && !['released', 'recovering'].includes(scene.phase)) {
      const triggers = world.triggerManager.byOwner.get(scene.guard) || [];
      const key = triggers.map(trigger => `${trigger.type}:${trigger.x1}:${trigger.x2}:${trigger.y1}:${trigger.y2}`).join(',');
      if (scene.guard.action !== world.actions[State.BLOCKING] || scene.guard.x !== scene.guardX || scene.guard.y !== scene.guardY || triggers.length !== 2 || scene.triggerKey != null && scene.triggerKey !== key) scene.failure ||= 'changed-guard';
      scene.triggerKey ??= key;
    }
    if (scene.phase === 'recovering' && (scene.recoveryExit.tiles.some(([key, revision]) => procgenTileRevision(world, key) !== revision) ||
        scene.guard.scout || scene.guard.canClimb || scene.guard.hasParachute || ![world.actions[State.BASHING], world.actions[State.WALKING], world.actions[State.JUMPING], world.actions[State.FALLING]].includes(scene.guard.action))) scene.failure ||= 'changed-recovery';
    const cancelled = scene.generation !== world.generation || world.tickIndex < scene.startTick || world.tickIndex - scene.startTick > TUNNEL_GUARD_TICKS ||
      world._manualNukeLanes[lane] || world.stall.phase !== 'running';
    // A never-started guard can retire through its current physical recovery,
    // without certifying the abandoned port or extending its original lifetime.
    const unstarted = scene.phase === 'guarded' && !scene.worker && !scene.task && !scene.project && !scene.releaseMembers?.length && !scene.crossed?.size;
    if (!cancelled && unstarted && !scene.failure && world.tickIndex >= scene.startTick + TUNNEL_GUARD_TICKS - GUARD_RECOVERY_STEPS) scene.retirement = 'unstarted-deadline';
    if (!cancelled && unstarted && (scene.failure === 'changed-route' || scene.retirement) && this._recover(scene)) return;
    if (scene.generation !== world.generation || world.tickIndex < scene.startTick || world.tickIndex - scene.startTick > TUNNEL_GUARD_TICKS || scene.failure ||
        world._manualNukeLanes[lane] || world.stall.phase !== 'running' ||
        scene.guard && (scene.guard.removed || scene.guard.failureReason || scene.guard.terminalReason || scene.guard.disabled || scene.guard.laneIndex !== lane) ||
        scene.phase === 'working' && scene.worker && (scene.worker.removed || scene.worker.failureReason || scene.worker.terminalReason || scene.worker.disabled || scene.worker.laneIndex !== lane)) {
      if (!scene.guard) { this.scenes[lane] = null; return; }
      world.nukeLane(lane); this.stats.failed++; this.stats.lastFailure = { lane, tick: world.tickIndex, reason: scene.failure || 'tunnel-guard-retirement' }; this._clear(scene); return;
    }
    if (scene.phase === 'recovering' && scene.recoveryReached) {
      const actor = scene.guard, exit = scene.recoveryExit;
      if (actor.action === world.actions[State.WALKING] && actor.x === exit.x && actor.y === exit.y && actor.lookRight === exit.lookRight && world.hasGroundAt(actor.x, actor.y)) {
        this.stats.recovered = (this.stats.recovered || 0) + 1; this._clear(scene); return;
      }
    }
    if (scene.phase === 'connected') {
      const live = world.lanePolicy.projects.lanes[lane].live;
      scene.releaseReady = scene.releaseMembers?.every(id => {
        const actor = live.get(id);
        return actor?.tick === world.tickIndex && actor.walking && actor.x >= scene.exitX && (!scene.releaseOrdinary.has(id) || actor.ordinary) && scene.crossed.has(id);
      }) || false;
    }
    if (scene.phase === 'released' && scene.guard.action === world.actions[State.WALKING]) this._clear(scene);
  }
  _clear(scene) {
    if (scene.guard) { scene.guard._tunnelScene = null; this.world._clearConstructionCrew(scene.guard); }
    if (scene.task) scene.task.tunnelScene = null;
    this.scenes[scene.lane] = null;
  }
  reset() { for (const scene of this.scenes) if (scene) this._clear(scene); this.recovery.reset(); this.nearby.length = 0; }
  snapshot() { return { ...this.stats, active: this.scenes.reduce((n, scene) => n + !!scene, 0) }; }
  dispose() { this.reset(); this.recovery.dispose(); this.world = null; }
}
export { ProcgenTunnelCrewRoutes, TUNNEL_GUARD_TICKS };