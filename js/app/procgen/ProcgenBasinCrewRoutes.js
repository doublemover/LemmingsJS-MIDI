import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { MAX_LOCAL_ROUTE_DISTANCE as DISTANCE, MAX_ROUTE_PROBES as WORK, ROUTE_LANES_PER_TICK as LANES } from './ProcgenHazardPlanner.js';
import { procgenTileRevision } from './ProcgenTerrainRetention.js';
import { MAX_PROJECT_CREW } from './ProcgenCrewProjects.js';

const MAX_BASIN_SECTIONS = 4, BASIN_PROJECT_TICKS = 1200;
const signature = basin => basin && [basin.id, basin.sourceRevision, basin.object.id, basin.object.x, basin.object.y, basin.object.width, basin.object.height,
  basin.trigger.x1, basin.trigger.y1, basin.trigger.x2, basin.trigger.y2, basin.bounds.x1, basin.bounds.y1, basin.bounds.x2, basin.bounds.y2, ...basin.shores.flatMap(shore => [shore.x1, shore.x2, shore.y, shore.direction]), basin.floor.x1, basin.floor.x2, basin.floor.y, basin.floor.supportColumns].join(':');
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// A source receipt identifies an actual exposed pool, never a successful route.
// Each section is separately replayed with shared actions on a private patch.
// The same live actor owns all sections and naturally finishes each full BUILD.
class ProcgenBasinCrewRoutes {
  constructor(world) {
    this.world = world; this.scenes = new Array(world.laneCount).fill(null); this.nearby = [];
    this.actions = { [State.BUILDING]: new ActionBuildSystem(), [State.SHRUG]: new ActionShrugSystem(),
      [State.WALKING]: new ActionWalkSystem(), [State.FALLING]: new ActionFallSystem(), [State.JUMPING]: new ActionJumpSystem() };
    this.stats = { sections: 0, proofs: 0, probes: 0, actionSteps: 0, connected: 0, completed: 0, failed: 0, maxWork: 0 };
  }
  _object(lane, chunk, index) { return this.world.terrain.describe(this.world.laneSeeds[lane], chunk).objects[index]; }
  _enabled(lane, chunk, index, basin) {
    const world = this.world, object = this._object(lane, chunk, index);
    if (signature(object?.basin) !== signature(basin) || world.terrainGrowth && !world.terrainGrowth.objectReady(lane, chunk, index)) return false;
    world.hazards.nearby(lane, basin.object.x, { behind: 0, ahead: 1 }, this.nearby);
    return this.nearby.some(h => h.chunk === chunk && h.objectIndex === index && h.enabled);
  }
  candidate(actor, observations, maxWork) {
    const world = this.world;
    const active = this.scenes[actor.laneIndex];
    if (active && actor.x >= active.bounds.x1 - 8 && actor.x <= active.bounds.x2 + DISTANCE && Math.abs(actor.y - active.startY) <= 64) return { handled: true, proposal: null, probes: 0 };
    for (const h of observations) {
      if (!h.enabled || h.lane !== actor.laneIndex) continue;
      const object = this._object(h.lane, h.chunk, h.objectIndex), basin = object?.basin;
      if (!basin || actor.y !== h.lane * world.laneHeight + basin.object.y || actor.x < basin.shores[0].x1 || actor.x >= basin.object.x) continue;
      if (!world.workerLimits.builders || !world.workerLimits.bashers) return { handled: true, proposal: null, probes: 0, failure: 'resources' };
      if (!world.lanePolicy.projects.canBegin(actor)) return { handled: true, proposal: null, probes: 0, failure: 'crew-capacity' };
      const distance = basin.object.x - actor.x;
      // Preserve ordinary approach motion. The actual rear blocker can occupy
      // this bank only once the builder is at least eight pixels beyond it.
      if (distance > 10) return { handled: true, proposal: null, probes: 0 };
      if (distance < 6 || !this._enabled(h.lane, h.chunk, h.objectIndex, basin)) return { handled: true, proposal: null, probes: 0, failure: 'launch' };
      const sections = Math.ceil((basin.shores[1].x1 - actor.x + 8) / 24);
      if (sections < 1 || sections > MAX_BASIN_SECTIONS) return { handled: true, proposal: null, probes: 0, failure: 'section-limit' };
      const scene = { basin, chunk: h.chunk, objectIndex: h.objectIndex, sections, section: 0, lane: h.lane, startX: actor.x, startY: actor.y };
      const proof = this.prove(actor, scene, maxWork);
      if (proof.proposal) proof.proposal.basinScene = scene;
      return { ...proof, handled: true };
    }
    return { handled: false, proposal: null, probes: 0 };
  }
  prove(actor, scene, maxWork = WORK) {
    const world = this.world, last = scene.section + 1 === scene.sections;
    maxWork = Math.max(0, Math.min(WORK, Math.trunc(maxWork) || 0)); this.stats.proofs++;
    const left = actor.x - 1, right = actor.x + DISTANCE, top = actor.y - 24;
    const bankY = scene.lane * world.laneHeight + scene.basin.object.y, bottom = Math.max(actor.y + 2, last ? bankY + 2 : actor.y + 2);
    const footprint = { x1: actor.x, x2: actor.x + 28, y1: actor.y - 12, y2: actor.y + 1 };
    let probes = 0, actionSteps = 0, failure = null, built = 0, shrugged = false, fell = false;
    const cells = new Map(), patch = new Set(), key = (x, y) => y * (DISTANCE + 2) + x - left;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk)) { failure ||= 'unrevealed'; return 0; }
      const at = key(x, y);
      if (!cells.has(at)) {
        if (probes + actionSteps >= maxWork) { failure ||= 'budget'; return 0; }
        probes++; cells.set(at, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
      }
      return patch.has(at) ? 1 : cells.get(at);
    };
    for (const task of world.accessTasks[actor.laneIndex] || []) if (task.owner && task.owner !== actor && task.owner.action === task.action && task.footprint && overlap(footprint, task.footprint)) failure ||= 'construction';
    const hazards = [], nearby = [];
    for (let lane = Math.max(0, Math.floor(top / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight)); lane++) {
      world.hazards.nearby(lane, actor.x, { ahead: DISTANCE, behind: 1 }, nearby);
      if (nearby.length >= 8) failure ||= 'hazard-limit'; hazards.push(...nearby);
    }
    const safe = lem => !hazards.some(h => lem.x + 2 > h.x1 && lem.x - 2 < h.x2 && lem.y + 1 > h.y1 && lem.y - 10 < h.y2);
    const triggers = world.triggerManager.byLane[actor.laneIndex] || [];
    if (triggers.length > 64) failure ||= 'blocker-limit';
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level,
      hasGroundAt: (x, y) => !!(read(x, y) & 1), isArrowAt: (x, y, direction) => world.isArrowAt(x, y, direction),
      setGroundAt(x, y) {
        if (read(x, y) & 2 || world.isArrowAt(x, y, true)) { failure ||= 'protected'; return; }
        patch.add(key(x, y)); built++;
      },
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; } };
    if (!level.hasGroundAt(actor.x, actor.y) || !safe(actor)) failure ||= 'launch-support';
    const worker = new Lemming(actor.x, actor.y, actor.id); worker.lookRight = true; worker.setAction(this.actions[State.BUILDING]);
    for (let tick = 0; tick < 300 && !failure; tick++) {
      if (probes + actionSteps >= maxWork) { failure ||= 'budget'; break; }
      actionSteps++; const next = worker.process(level);
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && worker.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'terminal'; break; }
        worker.setAction(this.actions[next]);
      }
      if (!worker.lookRight) failure ||= 'turned';
      if (!safe(worker)) failure ||= 'hazard';
      if (triggers.some(t => t.owner !== actor && t.owner.action === world.actions[State.BLOCKING] && !t.owner.removed && !t.owner.failureReason && worker.x >= t.x1 && worker.x < t.x2 && worker.y >= t.y1 && worker.y < t.y2)) failure ||= 'blocker-contact';
      if (worker.action === this.actions[State.SHRUG]) shrugged = true;
      if (worker.action === this.actions[State.FALLING]) fell = true;
      if (shrugged && worker.action === this.actions[State.WALKING]) {
        if (!last) {
          if (worker.x !== actor.x + 24 || worker.y !== actor.y - 12 || !level.hasGroundAt(worker.x, worker.y + 1)) failure ||= 'endpoint';
          break;
        }
        if (fell && worker.y === bankY && worker.x >= scene.basin.shores[1].x1) {
          if (!level.hasGroundAt(worker.x, worker.y + 1)) failure ||= 'landing-support';
          break;
        }
      }
    }
    if (built !== 72 || !shrugged || worker.action !== this.actions[State.WALKING] || last && !fell) failure ||= 'incomplete';
    this.stats.probes += probes; this.stats.actionSteps += actionSteps; this.stats.maxWork = Math.max(this.stats.maxWork, probes + actionSteps);
    return { proposal: failure ? null : { kind: 'builders', targetX: actor.x + 28, footprint, reason: 'staged-source-basin',
      estimatedTicks: actionSteps, materialCost: 12, score: 120, routeEvidence: { sections: scene.sections, section: scene.section + 1, endpointX: worker.x, endpointY: worker.y, naturalFall: fell, independentQualification: false } },
    probes: probes + actionSteps, groundProbes: probes, actionSteps, failure };
  }
  begin(actor, proposal, task) {
    const world = this.world, scene = proposal.basinScene;
    scene.id = `${world.generation}:${actor.laneIndex}:${scene.basin.id}`;
    if (actor.scout) world.lanePolicy.remember(actor, 'scout-basin-encounter', 'enabled-source-liquid'); scene.ownerId = actor.id; scene.generation = world.generation; scene.startTick = world.tickIndex;
    scene.phase = 'building'; scene.section = 1; scene.task = task; scene.originalTask = task;
    scene.endpoint = proposal.routeEvidence; scene.projectId = world.lanePolicy.projects.begin(actor, 'builders', { ...task,
      footprint: { x1: scene.basin.bounds.x1, x2: Math.min(scene.basin.bounds.x1 + 128, actor.x + scene.sections * 24 + 9), y1: actor.y - scene.sections * 12 - 24, y2: actor.laneIndex * world.laneHeight + scene.basin.floor.y + 1 } });
    if (!scene.projectId) { this.stats.lastFailure = { lane: scene.lane, reason: 'crew-admission-changed', tick: world.tickIndex }; world.nukeLane(scene.lane); return false; }
    const project = world.lanePolicy.projects.lanes[scene.lane].projects.find(p => p.id === scene.projectId);
    project.exitX = scene.basin.shores[1].x1; scene.project = project;
    // Only an initially scout-only scene waits for one actual bank cohort.
    // Prepared ordinary crews keep their existing admission and release rules.
    if (actor.scout && ![...project.members.values()].some(member => member.id !== actor.id && member.ordinary)) {
      scene.arrival = { phase: 'open', observationTick: -1, approaches: new Map(), cohortTick: null, cohort: [] };
      project.basinArrival = scene.arrival;
    }
    project.scene = { crewSceneId: scene.id, sceneSourceRevision: scene.basin.sourceRevision, sceneProduction: scene.basin.production, constructionSections: scene.sections };
    scene.bounds = project.bounds; scene.guardTiles = [];
    const width = world.terrain.chunkWidth;
    for (let chunk = Math.floor(scene.bounds.x1 / width); chunk <= Math.floor(scene.bounds.x2 / width); chunk++) {
      const key = scene.lane * 0x800000 + chunk; scene.guardTiles.push([key, procgenTileRevision(world, key)]);
    }
    task.crewProjectId = scene.projectId; task.basinSceneId = scene.id; this.scenes[actor.laneIndex] = scene;
    actor._basinSceneId = scene.id; this.stats.sections++; return true;
  }
  _bankApproach(actor, scene) {
    const world = this.world, shore = scene.basin.shores[0];
    return scene.generation === world.generation && actor.laneIndex === scene.lane && Number.isFinite(actor.spawnTick) && actor.spawnTick <= scene.startTick &&
      !actor.removed && !actor.disabled && !actor.failureReason && !actor.terminalReason && !actor.scout && !actor.canClimb && !actor.hasParachute &&
      actor.action === world.actions[State.WALKING] && actor.x >= shore.x1 && actor.x < shore.x2 && actor.y === scene.startY && world.hasGroundAt(actor.x, actor.y + 1);
  }
  observeApproach(actor) {
    const scene = this.scenes[actor.laneIndex], arrival = scene?.arrival;
    if (!arrival || arrival.phase !== 'open' || scene.phase === 'failed') return;
    const tick = this.world.tickIndex;
    if (arrival.observationTick !== tick) { arrival.observationTick = tick; arrival.approaches.clear(); }
    if (!this._bankApproach(actor, scene)) return;
    if (!arrival.approaches.has(actor.id) && arrival.approaches.size >= MAX_PROJECT_CREW) { arrival.overflowTick = tick; return; }
    arrival.approaches.set(actor.id, { id: actor.id, tick, generation: scene.generation, lane: scene.lane, spawnTick: actor.spawnTick, x: actor.x, y: actor.y });
  }
  canContain(actor, task) {
    const scene = this.scenes[task.startLane];
    if (!task.basinSceneId || scene?.id !== task.basinSceneId || !scene.arrival) return !task.basinSceneId || scene?.id === task.basinSceneId;
    if (scene.arrival.phase === 'closed') return scene.project.members.has(actor.id);
    return this._bankApproach(actor, scene);
  }
  _freezeArrival(scene, state) {
    const world = this.world, arrival = scene.arrival;
    if (!arrival || arrival.phase !== 'open' || arrival.observationTick !== world.tickIndex) return;
    const candidates = [...arrival.approaches.values()].filter(record => {
      const live = state.live.get(record.id);
      return live?.tick === world.tickIndex && live.generation === scene.generation && live.lane === scene.lane && live.spawnTick === record.spawnTick && live.ordinary &&
        (live.walking || live.blocking && live.heldProjectId === scene.projectId);
    });
    if (!candidates.length) return;
    const newMembers = candidates.filter(record => !scene.project.members.has(record.id));
    if (arrival.overflowTick === world.tickIndex || state.overflowTick >= world.tickIndex - 1 || scene.project.members.size + newMembers.length > MAX_PROJECT_CREW) {
      this._fail(scene, 'arrival-capacity'); return;
    }
    for (const record of newMembers) {
      const live = state.live.get(record.id);
      scene.project.members.set(record.id, { id: record.id, ordinary: true, crossed: false, blocker: live.blocking, lastSeenTick: world.tickIndex });
    }
    arrival.phase = 'closed'; arrival.cohortTick = world.tickIndex; arrival.cohort = candidates.map(record => ({ ...record })); arrival.approaches.clear();
    scene.project.scene.arrivalTick = world.tickIndex; scene.project.scene.arrivalCrewIds = arrival.cohort.map(record => record.id);
  }
  canRelease(task) {
    const scene = this.scenes[task.startLane];
    return !task.basinSceneId || scene?.id === task.basinSceneId && scene.phase === 'connected' && scene.arrival?.phase !== 'open';
  }
  _fail(scene, reason) {
    if (scene.phase === 'failed') return;
    scene.phase = 'failed'; scene.failure = reason; this.stats.failed++;
    this.world.lanePolicy.projects.fail(scene.lane, scene.projectId, reason);
    // Failed physical containment is retired by the existing real cascade;
    // never release promised walkers onto an incomplete bridge invisibly.
    this.stats.lastFailure = { lane: scene.lane, sceneId: scene.id, reason, tick: this.world.tickIndex, section: scene.section };
    this.world.nukeLane(scene.lane);
  }
  _assignSceneWorker(scene, actor, kind, targetX = actor.x, footprint = null) {
    const bounds = footprint || this.world._workerClaimBounds(actor, this.world.actions[State.BASHING]);
    const claim = { manager: this, project: scene.project, scene, actor, kind, bounds, x: actor.x, y: actor.y, direction: actor.lookRight, tick: this.world.tickIndex };
    this._claim = claim;
    try { return this.world.assignWorker(actor, kind, targetX, footprint, claim); }
    finally { this._claim = null; }
  }
  allowsProjectClaim(claim, actor, action, bounds) {
    const world = this.world, scene = claim.scene, b = claim.bounds;
    if (claim !== this._claim || claim.actor !== actor || this.scenes[actor.laneIndex] !== scene || scene.project !== claim.project || scene.ownerId !== actor.id ||
        actor._basinSceneId !== scene.id || scene.failure || scene.generation !== world.generation || claim.tick !== world.tickIndex ||
        world.tickIndex < scene.startTick || world.tickIndex - scene.startTick > BASIN_PROJECT_TICKS || actor.x !== claim.x || actor.y !== claim.y || actor.lookRight !== claim.direction ||
        !b || !['x1', 'x2', 'y1', 'y2'].every(key => bounds[key] === b[key]) || actor.action !== world.actions[State.BLOCKING] ||
        scene.guardTiles.some(([key, revision]) => procgenTileRevision(world, key) !== revision) || !this._enabled(scene.lane, scene.chunk, scene.objectIndex, scene.basin)) return false;
    if (claim.kind === 'builders') return scene.phase === 'waiting' && scene.project.phase === 'working' && action === world.actions[State.BUILDING];
    return claim.kind === 'bashers' && scene.phase === 'connected' && scene.project.phase === 'connected' && scene.release && action === world.actions[State.BASHING] && world._emptyBashMasks(actor);
  }
  assist(actor) {
    const world = this.world, scene = this.scenes[actor.laneIndex];
    if (!scene || actor._basinSceneId !== scene.id) return false;
    if (scene.ownerId !== actor.id) return false;
    if (scene.project.phase === 'complete') { actor._basinSceneId = null; return true; }
    if (scene.generation !== world.generation || world.tickIndex < scene.startTick || world.tickIndex - scene.startTick > BASIN_PROJECT_TICKS || actor.removed || actor.failureReason || actor.terminalReason) { this._fail(scene, 'scene-owner'); return true; }
    if (scene.guardTiles.some(([key, revision]) => procgenTileRevision(world, key) !== revision)) { this._fail(scene, 'changed-route'); return true; }
    if (scene.phase === 'connected') {
      if (scene.release && actor.action === world.actions[State.BLOCKING] && world._emptyBashMasks(actor)) this._assignSceneWorker(scene, actor, 'bashers');
      return true;
    }
    if (scene.phase !== 'waiting') return true;
    if (!world.workerLimits.builders || !world.workerLimits.bashers) return true;
    if (actor.action !== world.actions[State.BLOCKING]) { this._fail(scene, 'endpoint-owner'); return true; }
    const stride = Math.max(1, Math.ceil(world.laneCount / LANES));
    if (actor.laneIndex % stride !== world.tickIndex % stride) return true;
    const ledger = world.hazardPlanner.admission.begin(actor.laneIndex);
    if (ledger.consumed || ledger.probes >= WORK) return true;
    if (!this._enabled(scene.lane, scene.chunk, scene.objectIndex, scene.basin)) { this._fail(scene, 'source-or-reveal'); return true; }
    const result = this.prove(actor, scene, WORK - ledger.probes);
    world.hazardPlanner.admission.served(actor, Math.min(WORK, ledger.probes + result.probes));
    if (result.failure === 'budget' || result.failure === 'unrevealed') return true;
    if (result.failure) { this._fail(scene, result.failure); return true; }
    if (!this._assignSceneWorker(scene, actor, 'builders', result.proposal.targetX, result.proposal.footprint)) return true;
    scene.task = world.accessTasks[actor.laneIndex].find(task => task.owner === actor); scene.task.crewProjectId = scene.projectId; scene.task.basinSceneId = scene.id;
    scene.section++; scene.endpoint = result.proposal.routeEvidence; scene.phase = 'building'; this.stats.sections++; return true;
  }
  observe(actor, previousAction) {
    const world = this.world, scene = this.scenes[actor.laneIndex];
    if (!scene) { actor._basinSceneId = null; return; }
    this.observeApproach(actor);
    if (actor._basinSceneId !== scene.id || scene.ownerId !== actor.id) return;
    if (actor.failureReason || actor.terminalReason || actor.removed || actor.disabled || !actor.lookRight) { this._fail(scene, 'worker-loss'); return; }
    if (scene.phase === 'building' && previousAction === world.actions[State.SHRUG] && actor.action === world.actions[State.WALKING]) {
      if (scene.section < scene.sections) {
        if (actor.x !== scene.endpoint.endpointX || actor.y !== scene.endpoint.endpointY || !world.hasGroundAt(actor.x, actor.y + 1)) { this._fail(scene, 'endpoint'); return; }
        actor.setAction(world.actions[State.BLOCKING]); world.stats.blockers++; actor.assists++; scene.phase = 'waiting';
      } else scene.phase = 'landing';
    }
    if (scene.phase === 'landing' && actor.action === world.actions[State.WALKING] && actor.y === scene.startY && actor.x >= scene.basin.shores[1].x1) {
      if (!world.hasGroundAt(actor.x, actor.y + 1)) { this._fail(scene, 'shore-support'); return; }
      scene.phase = 'connected'; scene.connectionTick = world.tickIndex; this.stats.connected++;
      actor.setAction(world.actions[State.BLOCKING]); world.stats.blockers++; actor.assists++;
      const project = world.lanePolicy.projects.lanes[scene.lane].projects.find(p => p.id === scene.projectId);
      if (project) project.members.get(actor.id).blocker = true;
      world.lanePolicy.projects.connect(scene.lane, scene.projectId, scene.basin.shores[1].x1, scene.startY, []);
      scene.tiles = project?.tiles || []; world.lanePolicy.lanes[scene.lane].successes++;
    }
  }
  finish(lane) {
    const scene = this.scenes[lane]; if (!scene) return;
    const world = this.world, state = world.lanePolicy.projects.lanes[lane], project = scene.project;
    if (scene.generation !== world.generation || world._manualNukeLanes[lane] || world.stall.phase !== 'running' || world.tickIndex - scene.startTick > BASIN_PROJECT_TICKS) this._fail(scene, 'scene-cancelled');
    if (project.phase === 'failed') this._fail(scene, project.failure || 'crew-loss');
    if (scene.phase !== 'failed') this._freezeArrival(scene, state);
    if (scene.phase === 'connected') {
      if (scene.tiles.some(([key, revision]) => procgenTileRevision(world, key) !== revision)) this._fail(scene, 'changed-route');
      else if (project) scene.release = scene.arrival?.phase !== 'open' && [...project.members.values()].every(member => member.id === scene.ownerId || (() => {
        const live = state.live.get(member.id); return live?.tick === world.tickIndex && live.walking && live.x > project.goalX && Math.abs(live.y - project.goalY) <= 32;
      })());
    }
    const workerOnly = scene.phase === 'connected' && ![...project.members.values()].some(member => member.ordinary && member.id !== scene.ownerId) &&
      state.live.get(scene.ownerId)?.walking && state.live.get(scene.ownerId)?.x > project.goalX;
    if (workerOnly) { world.lanePolicy.projects.fail(lane, scene.projectId, 'no-passive-cohort'); this.stats.workerOnly = (this.stats.workerOnly || 0) + 1; }
    if (project.phase === 'complete' || scene.phase === 'failed' || workerOnly) {
      if (project.phase === 'complete') this.stats.completed++;
      scene.originalTask.basinSceneId = null; scene.task.basinSceneId = null; this.scenes[lane] = null;
    }
  }
  edit(x, y, ownerId) {
    const scene = this.scenes[Math.floor(y / this.world.laneHeight)]; if (!scene || scene.phase === 'failed') return;
    const key = scene.lane * 0x800000 + Math.floor(x / this.world.terrain.chunkWidth), b = scene.bounds;
    if (x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2 && (ownerId !== scene.ownerId || scene.phase !== 'building')) { this._fail(scene, 'foreign-route-edit'); return; }
    const revision = procgenTileRevision(this.world, key);
    for (const tile of scene.guardTiles) if (tile[0] === key) tile[1] = revision;
    for (const tile of scene.project.tiles) if (tile[0] === key) tile[1] = revision;
  }
  snapshot() { return { ...this.stats, active: this.scenes.filter(Boolean).length }; }
  reset() {
    for (const actor of this.world.actors || []) actor._basinSceneId = null;
    for (const scene of this.scenes) if (scene) { scene.originalTask.basinSceneId = null; scene.task.basinSceneId = null; }
    this.scenes.fill(null); this.nearby.length = 0;
  }
  dispose() { this.reset(); this.world = null; }
}
export { ProcgenBasinCrewRoutes, MAX_BASIN_SECTIONS, BASIN_PROJECT_TICKS };
