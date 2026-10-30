import { validateActorBirthAbilities } from './ActorBirthAbilities.js';
import { causalRandomDecision } from './workstation/CausalRandom.js';
import { isNotifyingProcgenBoundary, publishProcgenCommittedBoundary } from './ProcgenCommittedBoundary.js';
import { createPhysicalFeedbackState } from './workstation/physical/PhysicalFeedback.js';
import { releaseLanePhases, validateReleaseGesture } from './ReleaseGesture.js';
import { createPhysicalCrewEvidence } from './PhysicalCrewEvidence.js';
import { createPhysicalAuthoringState, preparePhysicalAuthoringConfiguration } from './PhysicalAuthoring.js';
import { createPhysicalJunctionState, queryPhysicalJunction } from './PhysicalJunctions.js';
import { disposeTerrainTopology, resetTerrainTopology, createTerrainTopologyState, prepareTerrainTopologyConfiguration, configureTerrainTopology, captureTerrainTopology, terrainTopologySnapshot } from './ProcgenTerrainTopology.js';
import { createTerrainScoreState, rememberTerrainCell, commitTerrainScore, terrainContactProvenance } from './TerrainScoreLayer.js';
import { planTerrainCommand } from './TerrainAuthoringAdapter.js';
import { observePhysicalFlightStep } from '../../actions/PhysicalFlightFacts.js';
import { recordBirthCohortSlot, completedBirthCohorts } from './ProcgenBirthCohorts.js';
import { recordProcgenRecoveryStep, getProcgenRecoveryJournal } from './workstation/ProcgenRecoveryJournal.js';
import { physicalContactForMotion } from '../../actions/PhysicalMotionFacts.js';
import { ProcgenTerrainEdits, ProcgenTerrainRevisions } from './ProcgenTerrainRetention.js';
import { ProcgenTunnelCrewRoutes } from './ProcgenTunnelCrewRoutes.js';
import { ProcgenBasinCrewRoutes } from './ProcgenBasinCrewRoutes.js';
import { ProcgenLanePolicy } from './ProcgenLanePolicy.js';
import { PROJECT_LIFETIME_TICKS } from './ProcgenCrewProjects.js';
import { DEFAULT_LANE_HEIGHT, MAX_LANE_HEIGHT, normalizeLaneHeight } from './ProcgenLaneGeometry.js';
import { CharacterParticles } from '../../lemmings/CharacterParticles.js';
import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../../actions/ActionFloatingSystem.js';
import { ActionDrowningSystem } from '../../actions/ActionDrowningSystem.js';
import { ActionFryingSystem } from '../../actions/ActionFryingSystem.js';
import { ActionSplatterSystem } from '../../actions/ActionSplatterSystem.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { ProcgenHazards } from './ProcgenHazards.js';
import { ProcgenHazardPlanner, MAX_ROUTE_PROBES } from './ProcgenHazardPlanner.js';
import { ProcgenTriggerManager } from './ProcgenTriggerManager.js';
import { MAX_PROCGEN_WORKERS, normalizeWorkerLimits } from './ProcgenWorkerLimits.js';
import { ActionBlockerSystem } from '../../actions/ActionBlockerSystem.js';
import { ActionDiggSystem } from '../../actions/ActionDiggSystem.js';
import { ActionMineSystem } from '../../actions/ActionMineSystem.js';
import { ProcgenTerrainGrowth } from './ProcgenTerrainGrowth.js';
import { ProcgenPopulationPolicy, DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy, quantizeProcgenSpawnTick } from './ProcgenPopulationPolicy.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionClimbSystem } from '../../actions/ActionClimbSystem.js';
import { ActionHoistSystem } from '../../actions/ActionHoistSystem.js';
import { ActionOhNoSystem } from '../../actions/ActionOhNoSystem.js';
import { ActionExplodingSystem } from '../../actions/ActionExplodingSystem.js';
import { ProcgenStallPolicy, DEFAULT_STALL_POLICY } from './ProcgenStallPolicy.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { SoundEventTypes, SoundEffectIds } from '../../game/SoundEvents.js';
import { ProcgenSoundEventBus } from './ProcgenSoundEventBus.js';
import { EventHandler } from '../../util/EventHandler.js';
import { normalizeSeed, deriveSeed } from '../../core/seededRandom.js';
import { ProcgenScenery } from './ProcgenScenery.js';
import { publishProcgenActorVisibility } from './ProcgenActorVisibility.js';
import { createInterventionState, prepareInterventionBatch, prepareIntervention, enqueueIntervention, cancelIntervention, cancelPendingInterventions, applyInterventions } from './ProcgenInterventionCommands.js';
import { observePhysicalSupport } from '../../actions/PhysicalContactFacts.js';

const MAX_PROCGEN_LANES = 1024;
const LANE_HEIGHT = 96;
const CHUNK_WIDTH = 256;
const EDIT_CHUNK_WIDTH = 32;
const PROCGEN_LEFT_EDGE = 8;
const normalizeLaneCount = value => Math.max(1, Math.min(MAX_PROCGEN_LANES, Math.trunc(Number(value)) || 1));
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

// Terrain is queried in one shared coordinate system. No world-sized bitmap,
// per-lane Game, or rendering dependency is needed by the real action systems.
class ProcgenLaneWorld {
  constructor({ laneCount = 1, laneHeight = 96, seed = 1, worldId = null, sprites = null, masks, assists = true, speed = 3, cohorts = false, spawnSpreadTicks = null, maxActors = 16384, stallPolicy = {}, populationPolicy = {}, initialReleaseGesture = null, actorBirthAbilities = null, previousDistances = [], workerLimits = {}, policyConfig = {}, particleTable = null, terrain = null, workstation = false, hazardSpacing = 160 } = {}) {
    this.laneCount = normalizeLaneCount(laneCount); this.actorBirthAbilities = validateActorBirthAbilities(actorBirthAbilities, this.laneCount);
    if (initialReleaseGesture !== null && !cohorts) throw new Error('An authored initial release policy requires cohort admission.');
    const initialRelease = initialReleaseGesture === null ? null : validateReleaseGesture(initialReleaseGesture, this.laneCount);
    this.laneHeight = normalizeLaneHeight(laneHeight);
    this.seed = normalizeSeed(seed);
    this.worldId = worldId || `procgen:${this.seed}`;
    this.workstationEnabled = workstation;
    this.width = 0x3fffffff;
    this.height = this.laneCount * this.laneHeight;
    this.tickIndex = 0;
    this._stepping = false; this._failedTick = false;
    this.physicalCrewEvidence = createPhysicalCrewEvidence(); this.physicalAuthoring = createPhysicalAuthoringState(); this.interventionState = createInterventionState(); this.physicalJunctions = createPhysicalJunctionState();
    Object.defineProperties(this, {
      _completedPhysicalSnapshot: { value: null, writable: true, configurable: true },
      _snapshotRetainers: { value: 0, writable: true, configurable: true }
    });
    this.assists = assists;
    this.accessTasks = new Array(this.laneCount).fill(null);
    this.workerLimits = normalizeWorkerLimits(workerLimits); this.edgeBlockers = new Array(this.laneCount).fill(null);
    this._edgeWallCache = new Array(this.laneCount); this._edgeWallRevisions = new Float64Array(this.laneCount); this._edgeWallHazards = [];
    this.leftEdgeX = PROCGEN_LEFT_EDGE; this._processingLane = null;
    this.sprites = sprites;
    this._assistedColumn = { valid: false, x: 0, y: 0, height: 0, revision: 0, value: 0 };
    this.terrain = terrain;
    terrain?.configure?.(this.laneCount, maxActors, { laneHeight: this.laneHeight, workstation, hazardSpacing: workstation ? hazardSpacing : 0 });
    this.terrainTopology = createTerrainTopologyState();
    this.terrainScoreState = createTerrainScoreState(); this.terrainScorePending = { cells: [], overflow: false, revisionBefore: 0 };
    this.terrainRevision = 0; this.frontierRevision = 0; this.terrainTileRevisions = new ProcgenTerrainRevisions(this.laneCount, Math.max(128, this.laneCount * 16));
    this.frontiers = new Float64Array(this.laneCount); this.frontiers.fill(36);
    this.generatedThrough = new Float64Array(this.laneCount); this.generatedThrough.fill(terrain?.sceneTerrainLayout?.width || terrain?.chunkWidth || CHUNK_WIDTH);
    this._laneChunk = new Array(this.laneCount);
    this._chunkSlots = 1;
    while (this._chunkSlots < Math.min(1024, Math.ceil(maxActors / this.laneCount / 2) + 4)) this._chunkSlots *= 2;
    this._collisionSlots = new Array(this.laneCount * this._chunkSlots);
    this._collisionIndices = new Int32Array(this._collisionSlots.length); this._collisionIndices.fill(-1);
    this._editSlots = this._chunkSlots * 4;
    this._editCache = new Array(this.laneCount * this._editSlots);
    this._editIndices = new Int32Array(this._editCache.length); this._editIndices.fill(-1);
    this._laneEdits = new Array(this.laneCount);
    this._laneEditIndex = new Int32Array(this.laneCount); this._laneEditIndex.fill(-1);
    this._laneChunkIndex = new Int32Array(this.laneCount); this._laneChunkIndex.fill(-1);
    this.cohorts = cohorts;
    this.spawnSpreadTicks = initialRelease?.spreadTicks ?? normalizePopulationPolicy({ spawnSpreadTicks: spawnSpreadTicks ?? populationPolicy.spawnSpreadTicks }).spawnSpreadTicks;
    this.maxActors = Math.max(this.laneCount, maxActors);
    this.admissionPaused = false; this._manualNukeLanes = new Uint8Array(this.laneCount);
    this.nextActorId = 0;
    this.generation = 1;
    this.generationStartTick = 0;
    this.spawnedTotal = 0; this.activeCount = 0;
    this.population = new ProcgenPopulationPolicy(this.laneCount, stallPolicy.releaseIntervalTicks ?? DEFAULT_STALL_POLICY.releaseIntervalTicks, populationPolicy, Object.hasOwn(stallPolicy, 'releaseIntervalTicks'));
    this.population.settings.spawnSpreadTicks = this.spawnSpreadTicks;
    if (initialRelease) this.population.initializeReleaseGesture(initialRelease);
    this._completedPhysicalBatchId = null;
    this.terrainActivityTicks = new Float64Array(this.laneCount); this.terrainActivityTicks.fill(-Infinity);
    this.pendingTerrainWork = new Uint32Array(this.laneCount);
    this._effectiveTerrainWork = new Uint32Array(this.laneCount);
    this._stallWork = { terrainActivityTicks: this.terrainActivityTicks, pendingTerrainWork: this._effectiveTerrainWork };
    this.stall = new ProcgenStallPolicy(this.laneCount, stallPolicy, previousDistances, { laneHeight: this.laneHeight });
    this.failureReasons = {};
    this.editChunks = new ProcgenTerrainEdits(EDIT_CHUNK_WIDTH * this.laneHeight, Math.max(64, this.laneCount * 8), key => this._invalidateEditChunk(key));
    this.challengeCache = new Map();
    this.challengeCacheLimit = Math.max(128, this.laneCount * 8);
    this.laneSeeds = Uint32Array.from({ length: this.laneCount }, (_, lane) => mix(this.seed ^ Math.imul(lane + 1, 0x9e3779b1)));
    this._spawnPhaseRanks = new Uint16Array(this.laneCount); this._spawnPhases = new Uint16Array(this.laneCount);
    this._laneAdmissionCohorts = new Float64Array(this.laneCount); this._resetSpawnPhases();
    terrain?.registerLanes?.(this.laneSeeds, this.seed, this.generation);
    this.terrainGrowth = terrain?.supportsFineGrowth ? new ProcgenTerrainGrowth(this.laneCount, terrain.chunkWidth, { justAhead: workstation }) : null;
    this.terrainGrowth?.reset(this.generatedThrough, this.frontiers);
    this._prepareGrowthChunk = (lane, chunk, options) => this.terrain.growthPlan?.(this.laneSeeds[lane], chunk, options);
    this._revealGrowth = (lane, previous, next, chunk, job) => {
      this.terrainRevision++; this.frontierRevision++;
      if (job?.kind === 'foundation' || job?.kind === 'terrain') this.terrainActivityTicks[lane] = this.tickIndex;
      this.terrainTileRevisions.set(lane * 0x800000 + chunk, this.terrainRevision);
      if (chunk === 0) this._edgeWallRevisions[lane]++;
    };
    this.scenery = workstation && terrain ? new ProcgenScenery({ terrain, laneSeeds: this.laneSeeds, laneHeight: this.laneHeight, solidLead: this.terrainGrowth?.targetLead || 96 }) : null;
    if (workstation) for (let lane = 0; lane < this.laneCount; lane++) this.terrainGrowth?.ensureLocal(lane, 36, { through: this.generatedThrough, frontiers: this.frontiers, prepare: this._prepareGrowthChunk, reveal: this._revealGrowth });
    this.eventTimeMs = 0;
    // Source time belongs to physics. The legacy event clock may use a RAF
    // timestamp shared by several catch-up ticks, but this clock never does.
    this.simulationTimeMs = 0;
    this.timer = { speedFactor: speed, onGameTick: new EventHandler(), getGameTicks: () => this.tickIndex,
      TIME_PER_FRAME_MS: 60,
      get frameTime() { return 60 / Math.max(0.001, this.speedFactor); },
      get tps() { return Math.min(Number.MAX_VALUE, 1000 / this.frameTime); }, getEventTimeMs: () => this.eventTimeMs };
    this.soundEvents = new ProcgenSoundEventBus(this.timer, this.laneCount, this.laneHeight);
    this.soundEvents._queueLimit = 0;
    this.soundEvents.laneCount = this.laneCount;
    this.soundEvents.laneIndex = 0;
    Object.defineProperty(this, '_authoritativeActors', { value: new WeakSet(), writable: true, configurable: true });
    const runtime = { soundEvents: this.soundEvents, physicalFacts: {
      tick: () => this.tickIndex,
      enabled: actor => !!this.soundEvents._tick && this.soundEvents.onBatch.handlers.size > 0 && this._authoritativeActors.has(actor),
      observing: actor => this.soundEvents.onBatch.handlers.size > 0 && this._authoritativeActors.has(actor),
      canMutate: actor => !this._authoritativeActors.has(actor) || !this._stepping || !!this.soundEvents._tick,
      emit: fact => this.soundEvents.emitPhysicalFact(fact)
    } };
    this.runtime = runtime;
    this.characterParticles = sprites ? new CharacterParticles() : null;
    this.hazards = new ProcgenHazards(this); this.triggerManager = new ProcgenTriggerManager(this, this.hazards);
    this.hazardPlanner = new ProcgenHazardPlanner(this);
    this.lanePolicy = new ProcgenLanePolicy(this, policyConfig);
    this.actions = {
      [State.WALKING]: new ActionWalkSystem(sprites), [State.FALLING]: new ActionFallSystem(sprites),
      [State.FLOATING]: new ActionFloatingSystem(sprites),
      [State.DROWNING]: new ActionDrowningSystem(sprites), [State.FRYING]: new ActionFryingSystem(sprites),
      [State.SPLATTING]: new ActionSplatterSystem(sprites),
      [State.JUMPING]: new ActionJumpSystem(sprites), [State.BUILDING]: new ActionBuildSystem(sprites),
      [State.BASHING]: new ActionBashSystem(sprites, masks), [State.DIGGING]: new ActionDiggSystem(sprites), [State.MINING]: new ActionMineSystem(sprites, masks),
      [State.BLOCKING]: new ActionBlockerSystem(sprites, this.triggerManager), [State.SHRUG]: new ActionShrugSystem(sprites),
      [State.CLIMBING]: new ActionClimbSystem(sprites), [State.HOISTING]: new ActionHoistSystem(sprites),
      [State.OHNO]: new ActionOhNoSystem(sprites),
      [State.EXPLODING]: new ActionExplodingSystem(sprites, masks, this.triggerManager, particleTable)
    };
    for (const action of Object.values(this.actions)) { action.setRuntime(runtime); action.characterParticles = this.characterParticles; }
    this.basinRoutes = new ProcgenBasinCrewRoutes(this); this.tunnelRoutes = new ProcgenTunnelCrewRoutes(this);
    this.physicalFeedback = createPhysicalFeedbackState('initial', this.generation, this.tickIndex);
    this.actors = []; this.birthCohortRecords = []; this.birthCohortRevision = 0; this._physicalWorkBounds = null;
    this._musicActorPositions = new Map(); this._musicCompletedSlot = 0; this._musicCompletedTick = this.tickIndex;
    if (!cohorts) for (let lane = 0; lane < this.laneCount; lane++) this._spawn(lane, false);
    this._retainTerrainDescriptors();
    this.stats = { builds: 0, bashes: 0, digs: 0, mines: 0, blockers: 0, turns: 0, failures: 0, groundQueries: 0, removedPixels: 0, laneTransfers: 0 };
  }


  _spawn(lane, emit = true) {
    this.soundEvents.laneIndex = lane;
    if (!Number.isSafeInteger(this.nextActorId) || this.nextActorId < 0 || !Number.isSafeInteger(this.nextActorId + 1)) throw new RangeError('Actor identity exhausted.');
    const actor = new Lemming(36, lane * this.laneHeight + this.laneHeight - LANE_HEIGHT + 42, this.nextActorId++, this.runtime);
    this._authoritativeActors.add(actor);
    actor.appearanceIndex = lane; actor._musicPositionId = actor.id;
    actor.laneIndex = lane; actor.spawnLaneIndex = lane;
    actor.spawnTick = this.tickIndex;
    actor.spawnOrdinal = this.stall.lanes[lane].spawned;
    actor.birthCohortId = recordBirthCohortSlot(this, lane, actor); actor.crewOriginIds = []; actor.crewOriginComplete = true;
    const release = this.population.cohortReleaseGesture; actor.releaseGesture = release ? Object.freeze({ id: release.id, revision: release.revision, requestedTick: this.population.cohortStartTick + this._spawnPhaseForLane(lane), realizedTick: this.tickIndex, cohortOrdinal: this.population.gestureRun.cohortOrdinal, clockMode: release.clockMode, sourceCommandId: this.population.releaseGestureCommandId }) : null; if (actor.releaseGesture?.sourceCommandId) actor._physicalInterventionId = actor.releaseGesture.sourceCommandId;
    actor.proceduralSeed = deriveSeed(this.laneSeeds[lane], `procgen:actor:${actor.spawnOrdinal}`);
    actor.scoutDecision = this.population.scoutDecision(this.laneSeeds[lane], actor.spawnOrdinal); actor.scoutAbilities = actor.scoutDecision.abilities; actor.scout = !!actor.scoutAbilities;
    const birthAbilities = this.actorBirthAbilities?.[lane]; if (birthAbilities) { actor.canClimb = birthAbilities.climb; actor.hasParachute = birthAbilities.parachute; }
    actor.spawnPhaseTicks = this._spawnPhaseForLane(lane);
    actor.lastProgressTick = this.tickIndex;
    actor.furthestX = actor.x;
    actor.assists = 0;
    actor.failureReason = null;
    const birth = { kind: 'ActorBorn', ...(birthAbilities ? { birthAbilities: { schema: 'lemmings-actor-birth-abilities/v1', ...birthAbilities } } : {}), actorId: actor.id, laneId: lane, scoutDecision: actor.scoutDecision, birthCohortId: actor.birthCohortId, spawnTick: actor.spawnTick, spawnOrdinal: actor.spawnOrdinal, ...(actor.releaseGesture ? { releaseGesture: actor.releaseGesture, parentCauseIds: actor.releaseGesture.sourceCommandId ? [actor.releaseGesture.sourceCommandId] : [] } : {}), positionAfter: { x: actor.x, y: actor.y } };
    if (!actor._queuePhysicalTransition(birth)) actor._physicalPendingTransitions = [birth];
    actor.setAction(this.actions[State.FALLING]);
    this.actors.push(actor); this.activeCount++;
    this.stall.spawn(lane, this.tickIndex); this.spawnedTotal++;
    const signal = this.stall.lanes[lane]; signal.alive++; signal.peakAlive = Math.max(signal.peakAlive, signal.alive);
    signal.lowestSurvivingActorId ??= actor.id;
    if (emit) this.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN,
      { lemmingId: actor.id, laneIndex: lane, laneCount: this.laneCount, x: actor.x, y: actor.y, spawnTick: actor.spawnTick, spawnPhaseTicks: actor.spawnPhaseTicks, presentationPhase: lane / this.laneCount });
    return actor;
  }
  _resetSpawnPhases() {
    const order = Array.from({ length: this.laneCount }, (_, lane) => ({ lane, draw: causalRandomDecision({ seed: this.seed, namespace: 'population', mappingId: 'default-release', generation: this.workstationEnabled ? 1 : this.generation, stableCauseId: `lane:${lane}`, drawPurpose: 'phase-rank' }).drawUint32 })).sort((a, b) => a.draw - b.draw || a.lane - b.lane);
    for (let rank = 0; rank < order.length; rank++) this._spawnPhaseRanks[order[rank].lane] = rank;
    if (!this.population.cohortReleaseGesture) this.population.cohortSpreadTicks = this.spawnSpreadTicks;
    this._laneAdmissionCohorts.fill(-Infinity); this._spawnPhaseCohortTick = -Infinity; this._computeSpawnPhases();
  }
  _computeSpawnPhases() {
    if (this.population.cohortReleaseGesture) { this._spawnPhases.set(releaseLanePhases(this.population.cohortReleaseGesture, { laneCount: this.laneCount, generation: this.generation, cohortOrdinal: this.population.gestureRun.cohortOrdinal, worldSeed: this.seed })); return; }
    const spread = Math.min(this.population.cohortSpreadTicks, this.population.intervalTicks - 1);
    const start = this.population.cohortStartTick, beatTicks = this.population.cohortBeatTicks;
    for (let lane = 0; lane < this.laneCount; lane++) {
      const offset = this._spawnPhaseRanks[lane] * spread / this.laneCount;
      this._spawnPhases[lane] = beatTicks > 0
        ? quantizeProcgenSpawnTick(start + offset, this.generationStartTick, beatTicks, start, start + spread) - start
        : Math.floor(offset);
    }
  }
  _spawnPhaseForLane(lane) { return this._spawnPhases[lane]; }
  setPopulationPolicy(next = {}) {
    const settings = this.population.setSettings(next);
    this.spawnSpreadTicks = settings.spawnSpreadTicks;
    return { ...settings };
  }
  setReleaseGesture(value, commandId = null) {
    if (!this.cohorts) throw new Error('Release gestures require physical cohort admission.');
    const outcome = this.population.setReleaseGesture(value, commandId); this.soundEvents.emitPhysicalFact({ kind: 'ReleaseGestureRequested', gestureId: value.id, gestureRevision: value.revision, requestedAtTick: this.tickIndex, effectiveBoundary: outcome.effectiveBoundary, admissionPrecision: 'integer-simulation-ticks', sourceCommandId: commandId }); return outcome;
  }
  _spawnCohort() {
    if (!this.cohorts || this.stall.phase !== 'running') return;
    const phase = this.population.phaseAt(this.tickIndex, this.activeCount);
    this.admissionPaused = this.activeCount >= this.maxActors;
    if (phase < 0) return;
    if (this._spawnPhaseCohortTick !== this.population.cohortStartTick) { this._computeSpawnPhases(); this._spawnPhaseCohortTick = this.population.cohortStartTick; const gesture = this.population.cohortReleaseGesture; if (gesture) this.soundEvents.emitPhysicalFact({ kind: 'ReleaseScheduleCommitted', gestureId: gesture.id, gestureRevision: gesture.revision, cohortStartTick: this.population.cohortStartTick, cohortOrdinal: this.population.gestureRun.cohortOrdinal, spreadTicks: gesture.spreadTicks, requestedGapTicks: gesture.nominalGapTicks, realizedGapTicks: this.population.cohortIntervalTicks, adaptiveIntervalTicks: this.population.intervalTicks, clockMode: gesture.clockMode, remainingAttempts: this.population.gestureRun.remaining, paused: gesture.paused, sourceCommandId: this.population.releaseGestureCommandId }); }
    for (let lane = 0; lane < this.laneCount; lane++) {
      if (this._spawnPhaseForLane(lane) !== phase || this._laneAdmissionCohorts[lane] === this.population.cohortStartTick) continue;
      const state = this.stall.lanes[lane];
      const stalledLongEnough = this.tickIndex - state.lastProgressTick >= this.stall.settings.secondsWithoutProgress * this.stall.settings.ticksPerSecond;
      const reservedProbe = stalledLongEnough && state.spawnsSinceProgress < this.stall.allowance(state);
      const capacity = this.activeCount < this.maxActors || !this.population.cohortReleaseGesture && reservedProbe, admission = this.population.admitGestureSlot(capacity);
      this._laneAdmissionCohorts[lane] = this.population.cohortStartTick;
      if (admission.status !== 'admitted') { this.admissionPaused = admission.status === 'missed' || this.admissionPaused; recordBirthCohortSlot(this, lane, null, admission.reason); if (admission.status === 'missed') this.soundEvents.emitPhysicalFact({ kind: 'BirthAdmissionMissed', laneId: lane, cohortId: `${this.worldId}:${this.generation}:cohort:${this.population.cohortStartTick}`, reason: admission.reason, requestedTick: this.tickIndex, gestureId: admission.gestureId ?? null, gestureRevision: admission.gestureRevision ?? null, sourceCommandId: this.population.releaseGestureCommandId }); continue; }
      this._spawn(lane);
    }
  }
  _restart(previousDistances) {
    cancelPendingInterventions(this, 'generation-reset');
    for (const actor of this.actors) actor.endPhysicalLifecycle('cohort-reset');
    const completed = this._terminalPhysicalSnapshot('generation');
    this.soundEvents.sealGeneration(completed, this.terrainRevision, this.generation + 1);
    if (this.workstationEnabled) {
      // Each displayed seed defines its run and the next seed, including after Replay Seed.
      const nextSeed = deriveSeed(this.seed, 'procgen:auto-reset');
      this.seed = nextSeed === this.seed ? (nextSeed + 1) >>> 0 : nextSeed;
    }
    this.characterParticles?.clear(); this.triggerManager.reset(); this.hazardPlanner.reset(); this.basinRoutes.reset(); this.tunnelRoutes.reset(); this.edgeBlockers.fill(null); this._processingLane = null;
    this._assistedColumn.valid = false; this.accessTasks.fill(null); this._edgeWallCache.fill(null); this._edgeWallRevisions.fill(0); this._edgeWallHazards.length = 0;
    this._musicActorPositions.clear(); this._musicCompletedSlot = 0; this._musicCompletedTick = this.tickIndex;
    for (const actor of this.actors) { this._clearConstructionCrew(actor); actor._laneRouteAttempt = null; actor._basinSceneId = null; }
    this.actors.length = 0; this.birthCohortRecords = []; this.birthCohortRevision = (this.birthCohortRevision || 0) + 1; this.activeCount = 0; this.admissionPaused = false; this._manualNukeLanes.fill(0); this.editChunks.clear(); this.terrainScoreState = createTerrainScoreState(); this.terrainScorePending = { cells: [], overflow: false, revisionBefore: this.terrainRevision }; this.terrainTileRevisions.clear(); this.challengeCache.clear(); this.terrain?.reset?.();
    this._laneChunk.fill(null); this._laneChunkIndex.fill(-1); this._collisionSlots.fill(null); this._collisionIndices.fill(-1); this._laneEdits.fill(null); this._laneEditIndex.fill(-1); this._editCache.fill(null); this._editIndices.fill(-1); this.frontiers.fill(36);
    this.generatedThrough.fill(this.terrain?.sceneTerrainLayout?.width || this.terrain?.chunkWidth || CHUNK_WIDTH); this.terrainRevision++; this.frontierRevision++; this.generation++; resetTerrainTopology(this); this.physicalCrewEvidence = createPhysicalCrewEvidence(); this.physicalJunctions.actual.clear(); this.generationStartTick = this.tickIndex;
    const terrainGeneration = this.workstationEnabled ? 1 : this.generation;
    for (let lane = 0; lane < this.laneCount; lane++) this.laneSeeds[lane] = mix(this.seed ^ Math.imul(lane + 1, 0x9e3779b1) ^ Math.imul(terrainGeneration - 1, 0x85ebca6b));
    this.terrain?.registerLanes?.(this.laneSeeds, this.seed, terrainGeneration);
    this._completedPhysicalBatchId = null; this.population.reset(this.generationStartTick); this._resetSpawnPhases(); this.lanePolicy.reset(); this.terrainActivityTicks.fill(-Infinity); this.pendingTerrainWork.fill(0); this._effectiveTerrainWork.fill(0); this.terrainGrowth?.reset(this.generatedThrough, this.frontiers);
    this.scenery?.reset();
    if (this.workstationEnabled) for (let lane = 0; lane < this.laneCount; lane++) this.terrainGrowth?.ensureLocal(lane, 36, { through: this.generatedThrough, frontiers: this.frontiers, prepare: this._prepareGrowthChunk, reveal: this._revealGrowth });
    this.stall = new ProcgenStallPolicy(this.laneCount, this.stall.settings, previousDistances, { laneHeight: this.laneHeight });
    for (const lane of this.stall.lanes) lane.lastProgressTick = this.tickIndex;
    this._retainTerrainDescriptors();
    this.onRestart?.();
  }

  // Requests enter the existing simulation pass; pause never advances OHNO.
  preparePhysicalAuthoring(graph, instances = []) { return preparePhysicalAuthoringConfiguration(this, graph, instances); }
  configurePhysicalAuthoring(graph, instances = []) { return this.preparePhysicalAuthoring(graph, instances).commit(); }
  prepareInterventions(commands) { return prepareInterventionBatch(this, commands); }
  prepareIntervention(command) { return prepareIntervention(this, command); }
  enqueueIntervention(command) { return enqueueIntervention(this, command); }
  cancelIntervention(commandId) { return cancelIntervention(this, commandId); }
  nukeLane(lane) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= this.laneCount) return false;
    this._manualNukeLanes[lane] = 1; return true;
  }
  nukeAll() { this._manualNukeLanes.fill(1); return this.laneCount; }
  _applyManualNukes() {
    if (!this._manualNukeLanes.some(Boolean)) return;
    let changed = false;
    for (const actor of this.actors) {
      if (!this._manualNukeLanes[actor.laneIndex] || actor.failureReason || actor.removed || actor.terminalReason ||
          actor.action === this.actions[State.OHNO] || actor.action === this.actions[State.EXPLODING]) continue;
      actor.countdown = 0; actor.countdownAction = null;
      actor.setAction(this.actions[State.OHNO]); this._syncTriggerOwner(actor);
      changed = true;
      this.soundEvents.emitSfx(SoundEventTypes.LEMMING_OHNO, SoundEffectIds.OHNO,
        { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: this.laneCount, x: actor.x, y: actor.y });
    }
    this._manualNukeLanes.fill(0);
    return changed;
  }

  _refreshCompletedLaneActions() {
    for (const lane of this.stall.lanes) {
      lane.buildingCount = 0; lane.bashingCount = 0; lane.diggingCount = 0;
      lane.miningCount = 0; lane.blockingCount = 0; lane.floatingCount = 0;
    }
    for (const actor of this.actors) if (!actor.failureReason && !actor.removed) {
      const lane = this.stall.lanes[actor.laneIndex], action = actor.action;
      if (action === this.actions[State.BUILDING]) lane.buildingCount++;
      if (action === this.actions[State.BASHING]) lane.bashingCount++;
      if (action === this.actions[State.DIGGING]) lane.diggingCount++;
      if (action === this.actions[State.MINING]) { lane.miningCount++; lane.diggingCount++; }
      if (action === this.actions[State.BLOCKING]) lane.blockingCount++;
      if (action === this.actions[State.FLOATING]) lane.floatingCount++;
    }
  }

  setPendingTerrainWork(lane, count = 0) {
    if (Number.isInteger(lane) && lane >= 0 && lane < this.laneCount) this.pendingTerrainWork[lane] = Math.max(0, Math.min(65535, Math.trunc(count) || 0));
  }

  queryJunction(id, options) { return queryPhysicalJunction(this, id, options); }
  prepareTopologyRegions(regions) { return prepareTerrainTopologyConfiguration(this, regions); }
  configureTopologyRegions(regions) { return configureTerrainTopology(this, regions); }
  captureTerrainTopology(phase = 'postTransaction') { captureTerrainTopology(this, phase); }
  planTerrainCommand(command) { return planTerrainCommand(command, this); }
  commitTerrainWork(metadata) { return commitTerrainScore(this, metadata); }
  terrainContactProvenance(x, y, revision = this.terrainRevision) { return terrainContactProvenance(this, x, y, revision); }

  getLanePolicySignals(lane) { return this.lanePolicy.signals(lane); }
  getLaneMusicSignals(lane) { return this.stall.lanes[lane] || null; }
  retainCompletedPhysicalSnapshots() {
    this._snapshotRetainers++;
    let released = false;
    return () => { if (!released) { released = true; this._snapshotRetainers--; } };
  }
  getCompletedPhysicalSnapshot() { return this._completedPhysicalSnapshot; }
  _terminalPhysicalSnapshot(reason) {
    const snapshot = this._physicalSnapshot();
    if (!snapshot) return null;
    return Object.freeze({ ...snapshot, revision: `${snapshot.revision}:${reason}`, status: 'terminal', actors: Object.freeze([]),
      lanes: Object.freeze(snapshot.lanes.map(lane => Object.freeze({ ...lane, alive: 0, buildingCount: 0, bashingCount: 0,
        diggingCount: 0, miningCount: 0, blockingCount: 0, floatingCount: 0 }))) });
  }
  _physicalSnapshot() {
    if (!this.soundEvents.onBatch.handlers.size && !this._snapshotRetainers) return null;
    const actors = Object.freeze(this.actors.filter(actor => !actor.removed && !actor.failureReason).map(actor => Object.freeze({
      actorId: actor.id, laneId: actor.laneIndex, x: actor.x, y: actor.y,
      action: actor.action?.getActionName?.() || actor.action?.actionName || null, actionInstanceId: actor._physicalActionInstanceId,
      terminalReason: actor.terminalReason ?? null, spawnTick: actor.spawnTick, spawnLaneIndex: actor.spawnLaneIndex,
      direction: actor.lookRight ? 'right' : 'left', birthCohortId: actor.birthCohortId ?? null,
      crewOriginIds: Object.freeze([...(actor.crewOriginIds || [])]), crewOriginComplete: actor.crewOriginComplete !== false,
      terrainProvenance: Object.freeze(terrainContactProvenance(this, actor.x, actor.y + 1)),
      abilities: Object.freeze({ climb: !!actor.canClimb, parachute: !!actor.hasParachute })
    })));
    const lanes = Object.freeze(this.stall.lanes.map((lane, index) => Object.freeze({ laneId: index,
      alive: lane.alive, buildingCount: lane.buildingCount, bashingCount: lane.bashingCount,
      diggingCount: lane.diggingCount, miningCount: lane.miningCount, blockingCount: lane.blockingCount,
      floatingCount: lane.floatingCount, crew: Object.freeze(this.lanePolicy.projects.signals(index) || {}) })));
    return Object.freeze({ revision: `${this.generation}:${this.tickIndex}`, generation: this.generation,
      tick: this.tickIndex, terrainRevision: this.terrainRevision, actors, lanes, cohorts: completedBirthCohorts(this), ...(this.terrainTopology.profiles.length ? { topology: terrainTopologySnapshot(this) } : {}) });
  }
  getLaneMusicActorPosition(id, lane) {
    const record = this._musicActorPositions.get(id);
    if (!record || record.lane !== lane || record.generation !== this.generation || record.actor.removed || record.actor.failureReason) return null;
    const position = record.positions[this._musicCompletedSlot];
    return position.tick === this._musicCompletedTick ? position : null;
  }
  _cacheMusicPosition(actor, slot) {
    let record = this._musicActorPositions.get(actor._musicPositionId);
    if (!record) {
      if (this._musicActorPositions.size >= this.maxActors) return;
      record = { actor, lane: actor.laneIndex, generation: this.generation, positions: [{ x: 0, y: 0, tick: -1 }, { x: 0, y: 0, tick: -1 }] };
      this._musicActorPositions.set(actor._musicPositionId, record);
    }
    record.lane = actor.laneIndex;
    const position = record.positions[slot]; position.x = actor.x; position.y = actor.y; position.tick = this.tickIndex;
  }

  getGameTimer() { return this.timer; }
  getGroundMaskLayer() { return this; }
  getLemmingManager() { return { lemmings: this.actors, activeLemmings: this.actors }; }
  get level() { return this; }

  chunkCode(lane, chunk) { return mix(this.laneSeeds[lane] ^ Math.imul(chunk + 1, 0x85ebca6b)); }
  surfaceAt(lane, x) {
    if (this.terrain) return lane * this.laneHeight + this.terrain.surface(this.laneSeeds[lane], x);
    const p = ((x % CHUNK_WIDTH) + CHUNK_WIDTH) % CHUNK_WIDTH;
    const code = this.chunkCode(lane, Math.floor(x / CHUNK_WIDTH));
    const rise = Math.max(0, Math.min(Math.floor((p - 40) / 4), Math.floor((116 - p) / 4), 6 + code % 5));
    return lane * this.laneHeight + this.laneHeight - LANE_HEIGHT + 72 - rise;
  }
  challengeAt(lane, x) {
    if (this.terrain) return this._terrainChunk(lane, x);
    const chunk = Math.floor(x / CHUNK_WIDTH), key = lane * 0x400000 + chunk;
    const cached = this.challengeCache.get(key);
    if (cached) return cached;
    const code = this.chunkCode(lane, chunk);
    const challenge = { barrierX: chunk * CHUNK_WIDTH + 142 + code % 9, barrierWidth: 8 + (code >>> 4) % 9,
      gapX: chunk * CHUNK_WIDTH + 210 + (code >>> 8) % 5, gapWidth: 4 + (code >>> 12) % 3 };
    if (this.terrain) {
      if (!this.terrain.isFlat(this.laneSeeds[lane], challenge.barrierX)) challenge.barrierWidth = 0;
      if (!this.terrain.isFlat(this.laneSeeds[lane], challenge.gapX)) challenge.gapWidth = 0;
    }
    if (this.challengeCache.size >= this.challengeCacheLimit) this.challengeCache.delete(this.challengeCache.keys().next().value);
    this.challengeCache.set(key, challenge);
    return challenge;
  }
  _terrainChunk(lane, x) {
    const width = this.terrain.chunkWidth, index = Math.floor(x / width);
    if (this._laneChunkIndex[lane] !== index) {
      const slot = lane * this._chunkSlots + (index & (this._chunkSlots - 1));
      if (this._collisionIndices[slot] !== index) {
        this._collisionIndices[slot] = index;
        this._collisionSlots[slot] = this.terrain.getChunk(this.laneSeeds[lane], index);
      }
      this._laneChunkIndex[lane] = index;
      this._laneChunk[lane] = this._collisionSlots[slot];
    }
    return this._laneChunk[lane];
  }
  basePixelAt(x, y) {
    const lane = Math.floor(y / this.laneHeight);
    if (!this.terrain || lane < 0 || lane >= this.laneCount || x < this.leftEdgeX || this.terrainGrowth && x >= this.generatedThrough[lane]) return 0;
    const chunk = Math.floor(x / this.terrain.chunkWidth), state = this.terrainGrowth?.stateFor(lane, chunk);
    if (state && !state.plan) return 0;
    return state ? this.terrain.rasterSample(this.laneSeeds[lane], chunk, x % this.terrain.chunkWidth, y % this.laneHeight, state.plan?.descriptor, state) : this.terrain.sample(this.laneSeeds[lane], x, y % this.laneHeight);
  }
  baseGroundAt(x, y) {
    if (this.terrain) {
      const lane = Math.floor(y / this.laneHeight);
      if (lane < 0 || lane >= this.laneCount || x < this.leftEdgeX || this.terrainGrowth && x >= this.generatedThrough[lane]) return 0;
      const chunk = Math.floor(x / this.terrain.chunkWidth), state = this.terrainGrowth?.stateFor(lane, chunk);
      if (state && !state.plan) return 0;
      if (state) return this.terrain.solidSample(this.laneSeeds[lane], chunk, x % this.terrain.chunkWidth, y % this.laneHeight, state.plan?.descriptor, state) ? 1 : 0;
      const p = this._terrainChunk(lane, x), index = (y % this.laneHeight) * this.terrain.chunkWidth + x % this.terrain.chunkWidth;
      return p.solid[index >>> 5] & (1 << (index & 31)) ? 1 : 0;
    }
    const lane = Math.floor(y / this.laneHeight);
    if (lane < 0 || lane >= this.laneCount || x < this.leftEdgeX) return 0;
    const p = x % CHUNK_WIDTH, code = this.chunkCode(lane, Math.floor(x / CHUNK_WIDTH));
    const gapX = 210 + (code >>> 8) % 5;
    if (p >= gapX && p < gapX + 4 + (code >>> 12) % 3) return 0;
    const surface = this.surfaceAt(lane, x);
    if (y >= surface && y < (lane + 1) * this.laneHeight - LANE_HEIGHT + 84) return 1;
    const barrierX = 142 + code % 9;
    return p >= barrierX && p < barrierX + 8 + (code >>> 4) % 9 && y >= surface - 13 && y < surface ? 2 : 0;
  }
  _editKey(x, y) { return Math.floor(y / this.laneHeight) * 0x2000000 + Math.floor(x / EDIT_CHUNK_WIDTH); }
  getTerrainTileRevision(key) { return this.terrainTileRevisions.read(key); }
  peekTerrainTileRevision(key) { return this.terrainTileRevisions.peek(key); }
  _invalidateEditChunk(key) {
    const lane = Math.floor(key / 0x2000000), index = key % 0x2000000, slot = lane * this._editSlots + (index & (this._editSlots - 1));
    if (this._laneEditIndex[lane] === index) { this._laneEditIndex[lane] = -1; this._laneEdits[lane] = null; }
    if (this._editIndices[slot] === index) { this._editIndices[slot] = -1; this._editCache[slot] = null; }
  }
  _editsAt(lane, x) {
    const index = Math.floor(x / EDIT_CHUNK_WIDTH);
    if (this._laneEditIndex[lane] !== index) {
      const slot = lane * this._editSlots + (index & (this._editSlots - 1));
      if (this._editIndices[slot] !== index) {
        this._editIndices[slot] = index;
        this._editCache[slot] = this.editChunks.get(lane * 0x2000000 + index);
      }
      this._laneEditIndex[lane] = index;
      this._laneEdits[lane] = this._editCache[slot];
    }
    return this._laneEdits[lane];
  }
  groundColorAt(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    const lane = Math.floor(y / this.laneHeight), localY = y - lane * this.laneHeight;
    const edits = this._editsAt(lane, x), edit = edits?.[localY * EDIT_CHUNK_WIDTH + x % EDIT_CHUNK_WIDTH] || 0;
    if (edit) return edit - 1;
    if (x < this.leftEdgeX) return 0;
    if (!this.terrain) return this.baseGroundAt(x, y);
    if (this.terrainGrowth && x >= this.generatedThrough[lane]) return 0;
    const chunk = Math.floor(x / this.terrain.chunkWidth), state = this.terrainGrowth?.stateFor(lane, chunk);
    if (state && !state.plan) return 0;
    if (state) return this.terrain.solidSample(this.laneSeeds[lane], chunk, x % this.terrain.chunkWidth, localY, state.plan?.descriptor, state) ? 1 : 0;
    const p = this._terrainChunk(lane, x), index = localY * this.terrain.chunkWidth + x % this.terrain.chunkWidth;
    return p.solid[index >>> 5] & (1 << (index & 31)) ? 1 : 0;
  }
  groundPixelAt(x, y) {
    const color = this.groundColorAt(x, y);
    return color === 3 ? 0xff86cbea : color ? this.basePixelAt(x, y) : 0;
  }
  hasGroundAt(x, y) { this.stats.groundQueries++; return this.groundColorAt(x, y) > 0; }
  peekGroundAt(x, y) { return this._peekContactAt(x, y, false); }
  peekSteelAt(x, y) { return this._peekContactAt(x, y, true); }
  _peekContactAt(x, y, steel) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    const lane = Math.floor(y / this.laneHeight), localY = y % this.laneHeight;
    if (!steel) {
      const edit = this.editChunks.peekValue(this._editKey(x, y), localY * EDIT_CHUNK_WIDTH + x % EDIT_CHUNK_WIDTH);
      if (edit) return edit > 1;
    }
    if (x < this.leftEdgeX) return false;
    if (!this.terrain) return steel ? false : this.baseGroundAt(x, y) > 0;
    if (this.terrainGrowth && x >= this.generatedThrough[lane]) return null;
    const state = this.terrainGrowth?.stateFor(lane, Math.floor(x / this.terrain.chunkWidth));
    return this.terrain.peekCollisionAt?.(this.laneSeeds[lane], x, localY, steel, state) ?? null;
  }
  getColumnStepHeight(x, yTop, height) {
    const cached = this._assistedColumn;
    if (cached.valid) {
      cached.valid = false;
      if (cached.x === x && cached.y === yTop && cached.height === height && cached.revision === this.terrainRevision) return cached.value;
    }
    const lane = Math.floor(yTop / this.laneHeight);
    if (this.terrain && x >= this.leftEdgeX && x < this.width && lane >= 0 && yTop + height <= (lane + 1) * this.laneHeight && lane < this.laneCount && (!this.terrainGrowth || x < this.generatedThrough[lane] && !this.terrainGrowth.stateFor(lane, Math.floor(x / this.terrain.chunkWidth)))) {
      const solid = this._terrainChunk(lane, x).solid, edits = this._editsAt(lane, x), sx = x % this.terrain.chunkWidth, ex = x % EDIT_CHUNK_WIDTH;
      for (let i = 0, y = yTop + height - 1 - lane * this.laneHeight; i < height; i++, y--) {
        this.stats.groundQueries++;
        const edit = edits?.[y * EDIT_CHUNK_WIDTH + ex] || 0, index = y * this.terrain.chunkWidth + sx;
        if (edit ? edit === 1 : !(solid[index >>> 5] & (1 << (index & 31)))) return i;
      }
      return height;
    }
    for (let i = 0; i < height; i++) if (!this.hasGroundAt(x, yTop + height - 1 - i)) return i;
    return height;
  }
  getColumnGapDepth(x, yTop, height) {
    const lane = Math.floor(yTop / this.laneHeight);
    if (this.terrain && x >= this.leftEdgeX && x < this.width && lane >= 0 && yTop + height <= (lane + 1) * this.laneHeight && lane < this.laneCount && (!this.terrainGrowth || x < this.generatedThrough[lane] && !this.terrainGrowth.stateFor(lane, Math.floor(x / this.terrain.chunkWidth)))) {
      const solid = this._terrainChunk(lane, x).solid, edits = this._editsAt(lane, x), sx = x % this.terrain.chunkWidth, ex = x % EDIT_CHUNK_WIDTH;
      for (let i = 0, y = yTop - lane * this.laneHeight; i < height; i++, y++) {
        this.stats.groundQueries++;
        const edit = edits?.[y * EDIT_CHUNK_WIDTH + ex] || 0, index = y * this.terrain.chunkWidth + sx;
        if (edit ? edit > 1 : solid[index >>> 5] & (1 << (index & 31))) return i + 1;
      }
      return height + 1;
    }
    for (let i = 0; i < height; i++) if (this.hasGroundAt(x, yTop + i)) return i + 1;
    return height + 1;
  }
  _setPixel(x, y, color) {
    if (this._stepping && !this.soundEvents._tick) throw new Error('Physical terrain mutations require a future command boundary.');
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    if (![x, y, color].every(Number.isSafeInteger) || color < 0 || color > 3) return false;
    const before = this.groundColorAt(x, y); if (before === color) return false;
    if (!Number.isSafeInteger(this.terrainRevision + 1)) throw new RangeError('Terrain revision exhausted.');
    const key = this._editKey(x, y);
    let chunk = this.editChunks.get(key);
    if (!chunk) {
      chunk = new Uint8Array(EDIT_CHUNK_WIDTH * this.laneHeight); this.editChunks.set(key, chunk);
      const lane = Math.floor(y / this.laneHeight);
      const editIndex = Math.floor(x / EDIT_CHUNK_WIDTH), slot = lane * this._editSlots + (editIndex & (this._editSlots - 1));
      if (this._laneEditIndex[lane] === editIndex) this._laneEdits[lane] = chunk;
      if (this._editIndices[slot] === editIndex) this._editCache[slot] = chunk;
    }
    const index = (y % this.laneHeight) * EDIT_CHUNK_WIDTH + x % EDIT_CHUNK_WIDTH;
    if (chunk[index] !== color + 1) {
      rememberTerrainCell(this, x, y, before, color, this.terrainRevision);
      chunk[index] = color + 1; this.terrainRevision++;
      if (this.soundEvents._tick && this.soundEvents.onBatch.handlers.size) { const b = this._physicalWorkBounds; this._physicalWorkBounds = b ? { x1: Math.min(b.x1, x), y1: Math.min(b.y1, y), x2: Math.max(b.x2, x + 1), y2: Math.max(b.y2, y + 1) } : { x1: x, y1: y, x2: x + 1, y2: y + 1 }; }
      if (x >= this.leftEdgeX && x <= this.leftEdgeX + 12) this._edgeWallRevisions[Math.floor(y / this.laneHeight)]++;
      this.terrainActivityTicks[Math.floor(y / this.laneHeight)] = this.tickIndex;
      const width = this.terrain?.chunkWidth || CHUNK_WIDTH;
      this.terrainTileRevisions.set(Math.floor(y / this.laneHeight) * 0x800000 + Math.floor(x / width), this.terrainRevision);
      this.basinRoutes?.edit(x, y, this._processingActorId); this.tunnelRoutes?.edit(x, y, this._processingActorId); this.lanePolicy?.edit(x, y, this._processingActorId);
      if (!this._stepping) commitTerrainScore(this, { causeKind: 'direct-world-edit', operation: 'mutation' });
      return true;
    }
    return false;
  }
  setGroundAt(x, y) { return this._setPixel(x, y, 3); }
  isArrowAt() { return false; }
  hasSteelAt(x, y) {
    const lane = Math.floor(y / this.laneHeight);
    if (!this.terrain || lane < 0 || lane >= this.laneCount || x < this.leftEdgeX || this.terrainGrowth && x >= this.generatedThrough[lane]) return false;
    const chunk = Math.floor(x / this.terrain.chunkWidth), state = this.terrainGrowth?.stateFor(lane, chunk);
    if (state) return this.terrain.steelSample?.(this.laneSeeds[lane], chunk, x % this.terrain.chunkWidth, y % this.laneHeight, state.plan?.descriptor, state) || false;
    const p = this._terrainChunk(lane, x), index = (y % this.laneHeight) * this.terrain.chunkWidth + x % this.terrain.chunkWidth;
    return !!(p.steel[index >>> 5] & (1 << (index & 31)));
  }
  hasSteelUnderMask(mask, x, y) {
    for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) {
      if (!mask.at(dx, dy) && this.hasSteelAt(x + mask.offsetX + dx, y + mask.offsetY + dy)) return true;
    }
    return false;
  }
  hasArrowUnderMask() { return false; }
  clearGroundWithMaskCount(mask, x, y) {
    let removed = 0;
    for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) {
      const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy;
      if (!mask.at(dx, dy) && this.hasGroundAt(px, py) && !this.hasSteelAt(px, py)) { this._setPixel(px, py, 0); removed++; }
    }
    this.stats.removedPixels += removed;
    return removed;
  }
  clearGroundWithMask(mask, x, y) { this.clearGroundWithMaskCount(mask, x, y); }

  setWorkerLimits(next = {}) {
    this.workerLimits = normalizeWorkerLimits(next, this.workerLimits);
    return { ...this.workerLimits };
  }
  _workerKind(action) {
    return action === this.actions[State.BASHING] ? 'bashers' : (action === this.actions[State.DIGGING] || action === this.actions[State.MINING]) ? 'diggers' : action === this.actions[State.BUILDING] ? 'builders' : null;
  }
  _accessTaskRecords(lane) {
    const tasks = this.accessTasks[lane] ||= [];
    for (let index = tasks.length - 1; index >= 0; index--) {
      const task = tasks[index], owner = task.owner;
      if (owner && (owner.removed || owner.failureReason || owner.terminalReason || owner.action !== task.action && owner.assistRetreatX == null)) {
        task.owner = null; task.retryAt = this.tickIndex + 90;
      }
      if (!task.owner && this.tickIndex >= task.retryAt) tasks.splice(index, 1);
    }
    return tasks;
  }
  _accessTask(lane) {
    const tasks = this._accessTaskRecords(lane);
    return tasks.find(task => task.owner) || tasks[tasks.length - 1] || null;
  }
  _workerClaimBounds(actor, action) {
    if (action === this.actions[State.BUILDING]) return { x1: actor.x + (actor.lookRight ? 0 : -26), x2: actor.x + (actor.lookRight ? 28 : 2), y1: actor.y - 12, y2: actor.y + 1 };
    if (action === this.actions[State.DIGGING]) return { x1: actor.x - 4, x2: actor.x + 5, y1: actor.y - 2, y2: actor.y + 1 };
    const count = action === this.actions[State.BASHING] ? 4 : action === this.actions[State.MINING] ? 2 : 0;
    const masks = action.masks?.get(actor.getDirection()); let bounds = null;
    for (let index = 0; index < count; index++) {
      const mask = masks?.GetMask(index); if (!mask) return null;
      const x = actor.x + mask.offsetX, y = actor.y + mask.offsetY;
      if (!bounds) bounds = { x1: x, x2: x + mask.width, y1: y, y2: y + mask.height };
      else { bounds.x1 = Math.min(bounds.x1, x); bounds.x2 = Math.max(bounds.x2, x + mask.width); bounds.y1 = Math.min(bounds.y1, y); bounds.y2 = Math.max(bounds.y2, y + mask.height); }
    }
    return bounds;
  }
  _claimAccess(actor, action, targetX, footprint = null, continuation = null, commit = true) {
    const kind = this._workerKind(action);
    if (!kind || !this.workerLimits[kind]) return false;
    const initial = this._workerClaimBounds(actor, action), projects = this.lanePolicy.projects;
    if (projects.claimConflict(actor, action, initial, continuation) || footprint && projects.claimConflict(actor, action, footprint, continuation)) return false;
    const tasks = this._accessTaskRecords(actor.laneIndex);
    if (kind === 'builders' && !footprint) footprint = { x1: actor.x + (actor.lookRight ? 0 : -26), x2: actor.x + (actor.lookRight ? 28 : 2), y1: actor.y - 12, y2: actor.y + 1 };
    let active = 0;
    for (const task of tasks) {
      if (!task.owner && continuation?.manager === projects && continuation.project?.ownerId === actor.id &&
          continuation.project.chain?.lostOwners.length && task.crewProjectId === continuation.project.id) continue;
      if (task.owner && this._workerKind(task.action) === kind) active++;
      const sameFootprint = task.action === action && Math.abs(task.targetX - targetX) < 12 && Math.abs(task.targetY - actor.y) < 8;
      if (sameFootprint && (task.owner || this.tickIndex < task.retryAt)) return false;
      // Concurrent independent jobs remain legal; claimed physical footprints
      // cannot be excavated twice or cut through another active construction.
      if (task.owner && footprint && task.footprint && footprint.x1 < task.footprint.x2 && footprint.x2 > task.footprint.x1 && footprint.y1 < task.footprint.y2 && footprint.y2 > task.footprint.y1) return false;
    }
    if (active >= this.workerLimits[kind]) return false;
    const prepared = { owner: actor, action, targetX, targetY: actor.y, footprint, direction: actor.lookRight, startX: actor.x, startY: actor.y, startLane: actor.laneIndex, startTick: this.tickIndex };
    if (!commit) return prepared;
    this._commitAccessClaim(actor.laneIndex, prepared);
    return true;
  }
  _commitAccessClaim(lane, prepared) {
    const tasks = this._accessTaskRecords(lane);
    tasks.push(prepared);
    while (tasks.length > MAX_PROCGEN_WORKERS * 3 + 8) {
      const index = tasks.findIndex(task => !task.owner);
      if (index < 0) break;
      tasks.splice(index, 1);
    }
  }
  assignWorker(actor, kind, targetX = actor?.x, footprint = null, continuation = null) {
    if (this._stepping && !this.soundEvents._tick) throw new Error('Physical mutations require a future command boundary.');
    const state = kind === 'bashers' ? State.BASHING : kind === 'diggers' ? State.DIGGING : kind === 'miners' ? State.MINING : kind === 'builders' ? State.BUILDING : null;
    if (!state || !actor || actor.runtime !== this.runtime || actor.removed || actor.disabled || actor.failureReason || actor.terminalReason ||
        !Number.isFinite(targetX) || ![this.actions[State.WALKING], this.actions[State.BLOCKING], this.actions[State.SHRUG]].includes(actor.action) || !this.hasGroundAt(actor.x, actor.y)) return false;
    const action = this.actions[state];
    if (state === State.BASHING) {
      const mask = action.masks?.get(actor.getDirection())?.GetMask(1);
      if (!mask || this.hasSteelUnderMask(mask, actor.x, actor.y) || this.hasArrowUnderMask(mask, actor.x, actor.y, actor.lookRight)) return false;
    }
    if (state === State.MINING) for (const index of [0, 1]) {
      const mask = action.masks?.get(actor.getDirection())?.GetMask(index);
      if (!mask || this.hasSteelUnderMask(mask, actor.x, actor.y) || this.hasArrowUnderMask(mask, actor.x, actor.y, actor.lookRight)) return false;
    }
    const prepared = this._claimAccess(actor, action, targetX, footprint, continuation, false);
    if (!prepared) return false;
    if (!action.triggerLemAction(actor)) return false;
    if (continuation?.manager === this.lanePolicy.projects && continuation.project?.ownerId === actor.id && continuation.project.chain?.lostOwners.length) {
      const tasks = this._accessTaskRecords(actor.laneIndex);
      for (let index = tasks.length - 1; index >= 0; index--) if (!tasks[index].owner && tasks[index].crewProjectId === continuation.project.id) tasks.splice(index, 1);
    }
    this._commitAccessClaim(actor.laneIndex, prepared);
    this._syncTriggerOwner(actor);
    this.stats[kind === 'bashers' ? 'bashes' : kind === 'diggers' ? 'digs' : kind === 'miners' ? 'mines' : 'builds']++; actor.assists++;
    return true;
  }
  isSteelGround(x, y) { return this.hasSteelAt(x, y); }
  isOutOfLevel(y) {
    return y < 0 || y >= this.height;
  }
  clearGroundAt(x, y) {
    if (!this.isOutOfLevel(y) && this.hasGroundAt(x, y) && !this.hasSteelAt(x, y)) { this._setPixel(x, y, 0); this.stats.removedPixels++; }
  }
  clearGroundRow(x, y, width) {
    if (!Number.isFinite(y) || this.isOutOfLevel(y)) return 0;
    let removed = 0;
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(this.width, Math.ceil(x + width)); px++) {
      if (this.hasGroundAt(px, y) && !this.hasSteelAt(px, y)) { this._setPixel(px, y, 0); removed++; }
    }
    this.stats.removedPixels += removed; return removed;
  }
  _prepareActorTerrain(actor) {
    if (!this.terrainGrowth || !Number.isFinite(actor.y)) return;
    // Shared actions can sample across a stripe before the actor's feet cross.
    // Prepare only that local footprint, never every intervening distant chunk.
    const first = Math.max(0, Math.floor((actor.y - 16) / this.laneHeight));
    const last = Math.min(this.laneCount - 1, Math.floor((actor.y + 6) / this.laneHeight));
    for (let lane = first; lane <= last; lane++) this.terrainGrowth.ensureLocal(lane, actor.x, {
      through: this.generatedThrough, frontiers: this.frontiers, prepare: this._prepareGrowthChunk, reveal: this._revealGrowth
    });
  }
  _synchronizeLane(actor) {
    if (!Number.isFinite(actor.y) || actor.y < 0 || actor.y >= this.height + 6) return;
    const lane = Math.min(this.laneCount - 1, Math.floor(actor.y / this.laneHeight)), previous = actor.laneIndex;
    if (lane === previous) return;
    actor.laneIndex = lane; this._clearConstructionCrew(actor); this.stats.laneTransfers++;
    this.soundEvents.emitPhysicalFact({ kind: 'ActorLaneTransferred', actorId: actor.id, laneId: lane, previousLaneId: previous, birthLaneId: actor.spawnLaneIndex, birthCohortId: actor.birthCohortId, positionAfter: { x: actor.x, y: actor.y } });
    const departed = this.stall.lanes[previous], arrived = this.stall.lanes[lane];
    departed.transferredOut = (departed.transferredOut || 0) + 1; arrived.transferredIn = (arrived.transferredIn || 0) + 1;
    departed.populationPeak = Math.max(0, (departed.populationPeak ?? departed.peakAlive) - 1);
    arrived.populationPeak = (arrived.populationPeak ?? arrived.peakAlive) + 1;
    const tasks = this.accessTasks[previous];
    if (tasks) for (let index = tasks.length - 1; index >= 0; index--) if (tasks[index].owner === actor) {
      (this.accessTasks[lane] ||= []).push(tasks.splice(index, 1)[0]);
    }
    if (this.edgeBlockers[previous] === actor) {
      this.edgeBlockers[previous] = null;
      if (!this._edgeBlocker(lane)) this.edgeBlockers[lane] = actor;
    }
    this.triggerManager.synchronize(actor);
    this.onLaneTransfer?.(actor.id, previous, lane, this.laneCount);
  }
  _syncTriggerOwner(actor) {
    if (actor.removed || actor.failureReason || actor.terminalReason || [this.actions[State.OHNO], this.actions[State.EXPLODING]].includes(actor.action)) actor._basinSceneId = null;
    this.triggerManager.synchronize(actor);
    if (actor.assistConstructionTask && (actor.removed || actor.failureReason || actor.disabled || actor.terminalReason || actor.action !== this.actions[State.BLOCKING] || actor.laneIndex !== actor.assistConstructionTask.startLane)) this._clearConstructionCrew(actor);
    if (this.edgeBlockers[actor.laneIndex] === actor && (actor.removed || actor.failureReason || actor.disabled || actor.terminalReason || actor.action !== this.actions[State.BLOCKING])) this.edgeBlockers[actor.laneIndex] = null;
  }
  _edgeBlocker(lane) {
    const owner = this.edgeBlockers[lane];
    if (owner && !owner.failureReason && !owner.removed && !owner.disabled && !owner.terminalReason && owner.action === this.actions[State.BLOCKING]) return owner;
    this.edgeBlockers[lane] = null; return null;
  }
  _rearEdgeWall(actor) {
    const lane = actor.laneIndex, y = actor.y, revision = this._edgeWallRevisions[lane];
    const tileRevision = this.getTerrainTileRevision(lane * 0x800000);
    let cached = this._edgeWallCache[lane], hazardKey = cached?.hazardKey || '';
    if (!cached || cached.tileRevision !== tileRevision || cached.y !== y || cached.revision !== revision) {
      this.hazards.nearby(lane, this.leftEdgeX + 12, { ahead: 0, behind: 12 }, this._edgeWallHazards);
      hazardKey = this._edgeWallHazards.map(hazard => `${hazard.x1}:${hazard.y1}:${hazard.x2}:${hazard.y2}`).join(',');
    }
    if (!cached || cached.revision !== revision || cached.y !== y || cached.hazardKey !== hazardKey) {
      let wallX = null, feet = y;
      for (let x = this.leftEdgeX + 12; x >= this.leftEdgeX; x--) {
        if (this._edgeWallHazards.some(hazard => x + 2 > hazard.x1 && x - 2 < hazard.x2 && feet + 1 > hazard.y1 && feet - 10 < hazard.y2)) break;
        const up = this.getColumnStepHeight(x, feet - 7, 8);
        if (up === 8) { wallX = x; break; }
        if (up > 3) break; // Larger shared jumps need their own continuation proof.
        if (up) feet -= up - 1;
        else {
          const down = this.getColumnGapDepth(x, feet + 1, 12);
          if (down === 13) break;
          const landing = feet + down;
          if (this._edgeWallHazards.some(hazard => x + 2 > hazard.x1 && x - 2 < hazard.x2 && landing + 1 > hazard.y1 && feet - 10 < hazard.y2)) break;
          feet = landing;
        }
        if (feet < 0 || feet >= this.height || Math.abs(feet - y) > 12) break;
        // A real short stair remains a traversable return corridor. Only local
        // edits/source activation/hazards invalidate this bounded observation.
      }
      this._edgeWallCache[lane] = cached = { revision, y, wallX, hazardKey, tileRevision };
    }
    cached.tileRevision = tileRevision;
    return cached.wallX != null && actor.x > cached.wallX;
  }
  _clearConstructionCrew(actor) {
    const task = actor.assistConstructionTask;
    if (!task) return;
    if (task.blocker === actor) {
      task.blocker = task.coincidentBlockers?.values().next().value || null;
      if (task.blocker) task.coincidentBlockers.delete(task.blocker);
    } else task.coincidentBlockers?.delete(actor);
    actor.assistConstructionTask = null;
  }
  _constructionPassage(task) {
    if (task.passageRevision === this.terrainRevision) return task.passage;
    task.passageRevision = this.terrainRevision; task.passage = false;
    if (!task.direction || !task.footprint || !Number.isFinite(task.startX) || !Number.isFinite(task.startY) || !Number.isFinite(task.footprint.x2) ||
        task.footprint.x2 < task.startX || task.footprint.x2 - task.startX > 40) return false;
    let y = task.startY;
    for (let x = task.startX; x <= task.footprint.x2; x++) {
      const up = this.getColumnStepHeight(x, y - 7, 8);
      // A solid wall already turns ordinary walkers. Only an open drop needs
      // temporary crowd containment while the shared builder lays its route.
      if (up === 8) return task.passage = null;
      if (up) y -= up - 1;
      else {
        const down = this.getColumnGapDepth(x, y + 1, 12);
        if (down === 13) return false;
        y += down;
      }
      if (y < 0 || y >= this.height) return false;
    }
    return task.passage = true;
  }
  _emptyBashMasks(actor) {
    const masks = this.actions[State.BASHING].masks?.get(actor.getDirection());
    for (let index = 0; index < 4; index++) {
      const mask = masks?.GetMask(index); if (!mask) return false;
      for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) {
        if (!mask.at(dx, dy) && this.hasGroundAt(actor.x + mask.offsetX + dx, actor.y + mask.offsetY + dy)) return false;
      }
    }
    return true;
  }
  _recoverConstructionCrew(actor, task) {
    const project = this.lanePolicy.projects.lanes[task.startLane]?.projects.find(p => p.id === task.crewProjectId);
    let recovery = null;
    if (!this._emptyBashMasks(actor)) {
      // A close guard can overlap the first stair. Permit only the exact cells
      // removed by a successful shared-action recovery, within the lane budget.
      const scene = this.basinRoutes.scenes[actor.laneIndex], planner = this.hazardPlanner, service = planner.admission.begin(actor.laneIndex);
      if (service.consumed || !project || project.phase !== 'connected' || !scene || scene.id !== task.basinSceneId || scene.basin.production !== 'observed-fire-span' || scene.phase !== 'connected') return false;
      const hazards = this.hazards.nearby(actor.laneIndex, actor.x, { ahead: 40, behind: 4 });
      recovery = planner.localTunnels.prove(actor, (x, y) => this.hasGroundAt(x, y), hazards, Math.max(0, MAX_ROUTE_PROBES - service.probes), task.startX + 8, true);
      planner.admission.served(actor, Math.min(MAX_ROUTE_PROBES, service.probes + recovery.probes + recovery.actionSteps));
      if (!recovery.safe) return false;
      recovery.revision = this.terrainRevision;
    }
    const claim = { manager: this, project, actor, task, recovery, bounds: this._workerClaimBounds(actor, this.actions[State.BASHING]) };
    this._constructionClaim = claim;
    try {
      const assigned = this.assignWorker(actor, 'bashers', actor.x, null, claim);
      if (assigned && recovery) {
        const scene = this.basinRoutes.scenes[actor.laneIndex];
        (scene.recoveries ||= new Map()).set(actor.id, { actor, until: this.tickIndex + recovery.bashTicks + 1,
          cells: new Set(recovery.removedCells.map(([x, y]) => `${x}:${y}`)) });
      }
      return assigned;
    }
    finally { this._constructionClaim = null; }
  }
  allowsProjectClaim(claim, actor, action, bounds) {
    const project = claim.project, task = claim.task, b = claim.bounds;
    return claim === this._constructionClaim && claim.actor === actor && actor.assistConstructionTask === task && (task.blocker === actor || task.coincidentBlockers?.has(actor)) && task.crewProjectId === project.id &&
      project.generation === this.generation && actor.laneIndex === project.lane && this.tickIndex >= project.startTick && this.tickIndex - project.startTick <= PROJECT_LIFETIME_TICKS &&
      project.members.has(actor.id) && action === this.actions[State.BASHING] && actor.action === this.actions[State.BLOCKING] &&
      b && ['x1', 'x2', 'y1', 'y2'].every(key => bounds[key] === b[key]) && this.basinRoutes.canRelease(task) &&
      (task.basinSceneId || this._constructionPassage(task) !== false) && (this._emptyBashMasks(actor) || claim.recovery?.safe && claim.recovery.revision === this.terrainRevision);
  }
  _assistConstructionCrew(actor) {
    const held = actor.assistConstructionTask;
    if (held && actor.action === this.actions[State.BLOCKING]) {
      if (this.basinRoutes.canRelease(held) && (held.basinSceneId || this._constructionPassage(held) !== false)) this._recoverConstructionCrew(actor, held);
      return true;
    }
    if (actor.action !== this.actions[State.WALKING] || !actor.lookRight || actor.scout || actor.canClimb || actor.hasParachute || !this.workerLimits.bashers) return false;
    const tasks = this.accessTasks[actor.laneIndex];
    if (!tasks) return false;
    for (const task of tasks) {
      const owner = task.owner, containment = this.basinRoutes.requiresContainment(task);
      if (task.blocker && containment && actor.x >= task.blocker.x - 3 && actor.x <= task.startX && Math.abs(actor.y - task.blocker.y) <= 3 &&
          this.hasGroundAt(actor.x, actor.y + 1) && this._emptyBashMasks(actor) && this.basinRoutes.canContain(actor, task)) {
        // A walker already inside the blocker's central gap cannot hit its
        // left trigger. Hold that original actor too, then release both legally.
        actor.setAction(this.actions[State.BLOCKING]); actor.assistConstructionTask = task;
        (task.coincidentBlockers ||= new Set()).add(actor); this.stats.blockers++; actor.assists++; return true;
      }
      if (task.blocker || !owner || owner.removed || owner.failureReason || owner.terminalReason || owner.action !== this.actions[State.BUILDING] ||
          !task.direction || task.startLane !== actor.laneIndex || actor.x < task.startX - (task.basinSceneId && !containment ? 8 : 16) || actor.x > task.startX - (containment ? 0 : 8) ||
          Math.abs(actor.y - task.startY) > 3 || !this.hasGroundAt(actor.x, actor.y + 1) ||
          this._constructionPassage(task) !== false && !this.basinRoutes.requiresContainment(task) || !this._emptyBashMasks(actor) || !this.basinRoutes.canContain(actor, task)) continue;
      actor.setAction(this.actions[State.BLOCKING]); actor.assistConstructionTask = task; task.blocker = actor;
      this.stats.blockers++; actor.assists++; return true;
    }
    return false;
  }
  _assist(actor) {
    if (!this.assists) return;
    if (this.lanePolicy.projects.assistChain(actor)) return;
    if (this.tunnelRoutes.assist(actor) || this.basinRoutes.assist(actor) || this._assistConstructionCrew(actor)) return;
    const route = actor._laneRouteAttempt;
    if (route?.buildExit && actor.lookRight && this.tickIndex <= route.buildDeadlineTick) return;
    const scoutReady = this.population.scoutReady(actor, this.tickIndex);
    const climbReady = scoutReady && !!(actor.scoutAbilities & 1), floatReady = scoutReady && !!(actor.scoutAbilities & 2);
    if (floatReady && actor.action === this.actions[State.FALLING] && actor.state > 16 &&
        this.actions[State.FLOATING].triggerLemAction(actor)) actor.assists++;
    // A shared skill owns its full action lifecycle, including its last mask or
    // brick. Route assistance must not replace a working basher at a gap.
    if (actor.action !== this.actions[State.WALKING]) return;
    const x = actor.x, y = actor.y;
    if (actor.assistRetreatX != null) {
      if (x > actor.assistRetreatX) { actor.lookRight = false; return; }
      actor.assistRetreatX = null; actor.lookRight = true;
      actor.setAction(this.actions[State.BUILDING]); this.stats.builds++; actor.assists++;
      return;
    }
    if (!actor.lookRight) {
      if (x <= this.leftEdgeX + 12 && this.hasGroundAt(x, y + 1) && !this.hasGroundAt(x - 13, y + 1) && !this._rearEdgeWall(actor)) {
        const owner = this._edgeBlocker(actor.laneIndex);
        const contact = owner && this.triggerManager.byOwner.get(owner)?.find(trigger => trigger.type === TriggerTypes.BLOCKER_RIGHT);
        // A coincident follower can already be behind a newly admitted owner's
        // real contact. It may legally contain itself, never turn invisibly.
        const behindContact = contact && x < contact.x1 && y >= contact.y1 && y < contact.y2;
        if (!owner || behindContact) {
          actor.setAction(this.actions[State.BLOCKING]); if (!owner) this.edgeBlockers[actor.laneIndex] = actor;
          this.stats.blockers++; actor.assists++;
        }
      }
      return;
    }
    if (this.terrain) {
      // Preserve the real climb owned by an eligible scout or explicit ability.
      // Other ordinary walkers can excavate access while the scout probes above.
      if ((actor.canClimb || climbReady) && this.getColumnStepHeight(x + 1, y - 7, 8) === 8) {
        if (climbReady && this.actions[State.CLIMBING].triggerLemAction(actor)) actor.assists++;
        return;
      }
      if (this.tunnelRoutes.reserved(actor)) return;
      const proposal = this.hazardPlanner.plan(actor);
      if (proposal && this.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)) { this.lanePolicy.begin(actor, proposal); return; }
      // A rejected or deferred source route continues ordinary movement;
      // legacy descriptor heuristics must not bypass the local safety decision.
      return;
    }
    const gap = this.challengeAt(actor.laneIndex, x);
    if (gap.gapWidth > 0 && x >= gap.gapX - 5 && x < gap.gapX && y >= this.surfaceAt(actor.laneIndex, x) - 2 && !this.hasGroundAt(x + 5, y + 1) &&
        this._claimAccess(actor, this.actions[State.BUILDING], gap.gapX)) {
      actor.setAction(this.actions[State.BUILDING]); this.stats.builds++; actor.assists++;
      return;
    }
    // Only the immediately following walk action may consume this column.
    const column = this.getColumnStepHeight(x + 1, y - 7, 8), cached = this._assistedColumn;
    cached.x = x + 1; cached.y = y - 7; cached.height = 8; cached.value = column; cached.revision = this.terrainRevision; cached.valid = true;
    if (column !== 8) return;
    if (actor.canClimb || climbReady) {
      if (climbReady && this.actions[State.CLIMBING].triggerLemAction(actor)) actor.assists++;
      return;
    }
    const bash = this.actions[State.BASHING], mask = bash.masks?.get(actor.getDirection())?.GetMask(1);
    // Actual source shelves and partial tunnels need access too; descriptor
    // barrier bounds describe placement, not eligibility for the shared skill.
    if (mask && !this.hasSteelUnderMask(mask, x, y) && !this.hasArrowUnderMask(mask, x, y, true) &&
        this._claimAccess(actor, bash, x + 1)) {
      bash.triggerLemAction(actor); this.stats.bashes++; actor.assists++;
    }
  }
  step(eventTimeMs = null) {
    if (this._stepping || isNotifyingProcgenBoundary(this)) throw new Error('A physical tick cannot be reentered.');
    if (this._failedTick) throw new Error('The previous physical tick was incomplete; restore a checkpoint before stepping.');
    if (!Number.isSafeInteger(this.tickIndex + 1)) throw new RangeError('Physical tick identity exhausted.');
    const recoverySpeed = this.timer.speedFactor;
    this._stepping = true;
    try {
      const generation = this.generation, terrainRevisionBefore = this.terrainRevision;
      this.tickIndex++;
      this.simulationTimeMs += this.timer.TIME_PER_FRAME_MS;
      this.soundEvents.beginTick({ worldId: this.worldId, generation, tick: this.tickIndex, terrainRevisionBefore,
        sourceTimeMs: this.simulationTimeMs, tickDurationMs: this.timer.frameTime });
      const observePhysical = this.soundEvents.onBatch.handlers.size > 0;
      const nextMusicSlot = 1 - this._musicCompletedSlot;
      this.eventTimeMs = Number.isFinite(eventTimeMs) ? eventTimeMs : this.eventTimeMs + this.timer.frameTime;
      this.characterParticles?.tick();
      this._spawnCohort();
      applyInterventions(this);
      let activeCount = 0;
      for (const lane of this.stall.lanes) { lane.alive = 0; lane.lowestSurvivingActorId = null; lane.buildingCount = 0; lane.bashingCount = 0; lane.floatingCount = 0; lane.diggingCount = 0; lane.miningCount = 0; lane.blockingCount = 0; }
      for (const actor of this.actors) {
        if (observePhysical) actor.flushPhysicalTransitions();
        else actor._physicalPendingTransitions = null;
        if (actor.failureReason || actor.removed) { if (observePhysical) actor.endPhysicalLifecycle(actor.failureReason || 'removed'); this.lanePolicy.projects.retire(actor); this._musicActorPositions.delete(actor._musicPositionId); this._syncTriggerOwner(actor); continue; }
        const initialX = actor.x, initialY = actor.y, initialDirection = actor.lookRight, initialId = actor.id;
        this.soundEvents.laneIndex = actor.laneIndex;
        this._synchronizeLane(actor);
        this.soundEvents.laneIndex = actor.laneIndex;
        this._prepareActorTerrain(actor);
        if (!this.cohorts && this.tickIndex === 1) this.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN,
          { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: this.laneCount, x: actor.x, y: actor.y, spawnTick: actor.spawnTick, spawnPhaseTicks: actor.spawnPhaseTicks, presentationPhase: actor.laneIndex / this.laneCount });
        this._assistedColumn.valid = false;
        this.basinRoutes.observeApproach(actor);
        if (this.stall.phase === 'running') this._assist(actor);
        const previousX = actor.x, previousY = actor.y, previousAction = actor.action, motionActionInstanceId = actor._physicalActionInstanceId;
        this._processingLane = actor.laneIndex; this._processingActorId = actor.id; this._physicalWorkBounds = null;
        const next = actor.process(this);
        commitTerrainScore(this, { actorId: actor.id, actionInstanceId: actor._physicalActionInstanceId, operation: previousAction?.actionName === 'exploding' ? 'explode' : 'mutation' });
        observePhysicalFlightStep(actor, previousX, previousY);
        this._synchronizeLane(actor);
        this.soundEvents.laneIndex = actor.laneIndex;
        if (observePhysical && (actor.x !== previousX || actor.y !== previousY) && actor._physicalMotionFactTick !== this.tickIndex) {
          const contactSpanId = physicalContactForMotion(this, actor, previousX, previousY);
          this.soundEvents.emitPhysicalFact({ kind: 'MotionCommitted', contactSpanId, actorId: initialId,
            laneId: actor.laneIndex, positionBefore: { x: previousX, y: previousY }, positionAfter: { x: actor.x, y: actor.y },
            actionPhase: actor.frameIndex, action: previousAction?.actionName || null, actionInstanceId: motionActionInstanceId,
            parentCauseIds: actor._physicalInterventionId ? [actor._physicalInterventionId] : [],
            precision: 'endpoint', physicalPayload: { displacementPixels: Math.hypot(actor.x - previousX, actor.y - previousY), pathEvidence: 'endpoint-chord', contactObserved: contactSpanId !== null, contactEvidence: contactSpanId ? 'consecutive-support-endpoints' : 'unknown' } });
        }
        this.terrainGrowth?.observe(actor.laneIndex, actor.x - previousX);
        this._assistedColumn.valid = false;
        if (next !== State.NO_STATE_TYPE && next !== State.JUMPING) {
        // Keep ordinary unsafe-fall failure timing; generated source contacts
        // enter the shared terminal actions below and finish their lifecycle.
          if (this.actions[next] && next !== State.SPLATTING) actor.setAction(this.actions[next]);
          else {
            if (next === State.SPLATTING) this.characterParticles?.emitDeath(actor, 'splatter', actor.action?.spriteProvider);
            actor.failureReason = next === State.SPLATTING ? 'unsafe-fall' : actor.terminalReason || (actor.action === this.actions[State.EXPLODING] ? 'cascade-complete' : 'out-of-world');
            this.stats.failures++; this.failureReasons[actor.failureReason] = (this.failureReasons[actor.failureReason] || 0) + 1;
          }
        } else if (next === State.JUMPING && actor.action !== this.actions[next]) actor.setAction(this.actions[next]);

        if (!actor.failureReason && !actor.removed) {
          const contact = lemmingManagerInteractionMethods.runTrigger.call(this, actor, this.tickIndex);
          if (contact !== State.NO_STATE_TYPE) {
            actor.countdown = 0; actor.countdownAction = null;
            actor.terminalReason = contact === State.DROWNING ? 'drowned' : contact === State.FRYING ? 'fried' : actor.lastTriggerType === TriggerTypes.TRAP ? 'trapped' : 'killed';
            actor.setAction(this.actions[contact]);
          }
        }

        this.tunnelRoutes.observe(actor); this.basinRoutes.observe(actor, previousAction);
        this.lanePolicy.observe(actor, previousAction, previousX);
        this._syncTriggerOwner(actor);
        if (observePhysical) {
          if (actor.lookRight !== initialDirection && actor._physicalDirectionFactTick !== this.tickIndex) this.soundEvents.emitPhysicalFact({ kind: 'DirectionChanged', actorId: initialId,
            laneId: actor.laneIndex, directionBefore: initialDirection ? 'right' : 'left', directionAfter: actor.lookRight ? 'right' : 'left', causeKind: 'unknown' });
          if (actor.failureReason || actor.removed) actor.endPhysicalLifecycle(actor.failureReason || 'removed');
        }
        if (!actor.failureReason && !actor.removed) {
          activeCount++; this._cacheMusicPosition(actor, nextMusicSlot);
          const lane = this.stall.lanes[actor.laneIndex]; lane.alive++;
          lane.lowestSurvivingActorId = lane.lowestSurvivingActorId == null ? actor.id : Math.min(lane.lowestSurvivingActorId, actor.id);
          if (actor.action === this.actions[State.BUILDING]) lane.buildingCount++;
          if (actor.action === this.actions[State.BASHING]) lane.bashingCount++;
          if (actor.action === this.actions[State.DIGGING]) lane.diggingCount++;
          if (actor.action === this.actions[State.MINING]) { lane.miningCount++; lane.diggingCount++; }
          if (actor.action === this.actions[State.BLOCKING]) lane.blockingCount++;
          if (actor.action === this.actions[State.FLOATING]) lane.floatingCount++;
        } else this._musicActorPositions.delete(actor._musicPositionId);
        if (actor.x > this.frontiers[actor.laneIndex]) {
          this.frontiers[actor.laneIndex] = actor.x;
          const width = this.terrain?.chunkWidth || CHUNK_WIDTH;
          const through = this.terrainGrowth ? this.generatedThrough[actor.laneIndex] : Math.ceil((actor.x + 64) / width) * width;
          if (through > this.generatedThrough[actor.laneIndex]) { this.generatedThrough[actor.laneIndex] = through; this.terrainRevision++; this.frontierRevision++; }
        }
        if (actor.x > actor.furthestX) { actor.furthestX = actor.x; actor.lastProgressTick = this.tickIndex; }
      }
      this._processingLane = null; this._processingActorId = null; this.activeCount = activeCount;
      this.terrainGrowth?.update({ through: this.generatedThrough, frontiers: this.frontiers, lanes: this.stall.lanes, prepare: this._prepareGrowthChunk, reveal: this._revealGrowth });
      this.scenery?.update({ frontiers: this.frontiers, tick: this.tickIndex });
      for (let laneIndex = 0; laneIndex < this.laneCount; laneIndex++) {
        const lane = this.stall.lanes[laneIndex]; lane.peakAlive = Math.max(lane.peakAlive, lane.alive);
        lane.populationPeak = Math.max(lane.populationPeak || 0, lane.alive);
        this.tunnelRoutes.finish(laneIndex); this.basinRoutes.finish(laneIndex);
        this.lanePolicy.projects.finish(laneIndex);
        lane.admitted = Math.max(0, lane.spawned + (lane.transferredIn || 0) - (lane.transferredOut || 0));
        this._effectiveTerrainWork[laneIndex] = Math.min(65535, this.pendingTerrainWork[laneIndex] + (this.terrainGrowth?.pending[laneIndex] || 0));
        lane.lastTerrainActivityTick = this.terrainActivityTicks[laneIndex];
        if (!this.cohorts) lane.pendingTerrainWork = this._effectiveTerrainWork[laneIndex];
        if (!this.cohorts && this.frontiers[laneIndex] > lane.maxX) { lane.maxX = this.frontiers[laneIndex]; lane.lastProgressTick = this.tickIndex; }
      }
      let actionCountsChanged = this._applyManualNukes();
      if (this.cohorts) {
        this.stall.update(this.actors, this.tickIndex, this._stallWork);
        const dueIds = this.stall.takeDue(this.tickIndex);
        const due = dueIds.length ? new Set(dueIds) : null;
        if (due) for (const actor of this.actors) if (due.has(actor.id) && !actor.failureReason && !actor.terminalReason) {
          actor.setAction(this.actions[State.OHNO]);
          actionCountsChanged = true;
          this.soundEvents.emitSfx(SoundEventTypes.LEMMING_OHNO, SoundEffectIds.OHNO, { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: this.laneCount, x: actor.x, y: actor.y });
        }
        const previous = this.stall.consumeRestart();
        if (previous) this._restart(previous);
        else if (this.tickIndex % 54 === 0) this.actors = this.actors.filter(actor => !actor.failureReason && !actor.removed);
      }
      if (actionCountsChanged) this._refreshCompletedLaneActions();
      if (this.tickIndex % 32 === 0) this.hazards.prune(this.tickIndex);
      if (this.tickIndex % 32 === 0) this._retainTerrainDescriptors();
      if (this.tickIndex % 128 === 0) this._pruneEdits();
      this._musicCompletedSlot = nextMusicSlot; this._musicCompletedTick = this.tickIndex;
      if (observePhysical) for (const actor of this.actors) observePhysicalSupport(this, actor);
      captureTerrainTopology(this, 'endOfTick');
      this.soundEvents.laneIndex = 0;
      this._completedPhysicalSnapshot = this._physicalSnapshot();
      this._completedPhysicalBatchId = this.soundEvents.pendingBatchIdentity();
      publishProcgenActorVisibility(this);
      this.soundEvents.commitTick(this._completedPhysicalSnapshot, this.terrainRevision);
      recordProcgenRecoveryStep(this, Number.isFinite(eventTimeMs) ? eventTimeMs : null, recoverySpeed);
    } catch (error) {
      if (this.soundEvents._tick) { this.soundEvents.abortTick(); this._failedTick = true; }
      throw error;
    } finally { this._stepping = false; }
    publishProcgenCommittedBoundary(this);
    this.timer.onGameTick.trigger(this.tickIndex);
  }
  _retainTerrainDescriptors() {
    if (!this.terrain?.retainDescriptors) return;
    const width = this.terrain.chunkWidth, interests = new Map();
    const add = (lane, x1, x2) => {
      const seed = this.laneSeeds[lane]; let chunks = interests.get(seed);
      if (!chunks) { chunks = new Set(); interests.set(seed, chunks); }
      const first = Math.max(0, Math.floor(x1 / width)), last = Math.max(first, Math.floor(x2 / width));
      for (let chunk = first; chunk <= last; chunk++) chunks.add(chunk);
    };
    for (let lane = 0; lane < this.laneCount; lane++) {
      const front = this.frontiers[lane];
      add(lane, front - width, front + (this.terrainGrowth?.preparationLead || width * 2));
    }
    for (const actor of this.actors) if (!actor.removed && !actor.failureReason) {
      const first = Math.max(0, Math.floor((actor.y - 16) / this.laneHeight)), last = Math.min(this.laneCount - 1, Math.floor((actor.y + 6) / this.laneHeight));
      for (let lane = first; lane <= last; lane++) add(lane, actor.x - 128, actor.x + 128);
    }
    for (const tasks of this.accessTasks) for (const task of tasks || []) {
      const owner = task.owner, box = task.footprint;
      if (!box || !owner || owner.removed || owner.failureReason || owner.action !== task.action) continue;
      for (let lane = Math.max(0, Math.floor(box.y1 / this.laneHeight)); lane <= Math.min(this.laneCount - 1, Math.floor((box.y2 - 1) / this.laneHeight)); lane++) add(lane, box.x1 - 16, box.x2 + 16);
    }
    for (const state of this.terrainGrowth?.states.values() || []) add(state.lane, state.chunk * width, state.chunk * width);
    this.terrain.retainDescriptors(interests);
  }
  _pruneEdits() {
    const edits = new Set(), tiles = new Set(), width = this.terrain?.chunkWidth || CHUNK_WIDTH;
    const interest = (lane, x1, x2) => {
      x1 = Math.max(0, Math.floor(x1)); x2 = Math.min(this.width - 1, Math.ceil(x2));
      for (let chunk = Math.floor(x1 / EDIT_CHUNK_WIDTH); chunk <= Math.floor(x2 / EDIT_CHUNK_WIDTH); chunk++) edits.add(lane * 0x2000000 + chunk);
      for (let chunk = Math.floor(x1 / width); chunk <= Math.floor(x2 / width); chunk++) tiles.add(lane * 0x800000 + chunk);
    };
    for (const actor of this.actors) if (!actor.failureReason && !actor.removed) {
      const first = Math.max(0, Math.floor((actor.y - 16) / this.laneHeight));
      const last = Math.min(this.laneCount - 1, Math.floor((actor.y + 6) / this.laneHeight));
      // A stationary blocker needs its real contact/support band, not every
      // edited chunk between it and the advancing crew. Other return corridors
      // remain losslessly reconstructible even outside these dense interests.
      const radius = actor.action === this.actions[State.BLOCKING] ? 16 : 128;
      for (let lane = first; lane <= last; lane++) interest(lane, actor.x - radius, actor.x + radius);
    }
    for (const tasks of this.accessTasks) for (const task of tasks || []) {
      const owner = task.owner, footprint = task.footprint;
      if (!owner || owner.failureReason || owner.removed || owner.terminalReason || owner.action !== task.action || !footprint) continue;
      for (let lane = Math.max(0, Math.floor(footprint.y1 / this.laneHeight)); lane <= Math.min(this.laneCount - 1, Math.floor((footprint.y2 - 1) / this.laneHeight)); lane++) interest(lane, footprint.x1 - 16, footprint.x2 + 16);
    }
    for (const state of this.terrainGrowth?.states?.values() || []) tiles.add(state.lane * 0x800000 + state.chunk);
    for (const record of this.hazards.chunks.values()) tiles.add(record.lane * 0x800000 + record.chunk);
    this.editChunks.compactExcept(edits, Math.max(64, edits.size + this.laneCount * 8));
    this.terrainTileRevisions.retain(tiles);
  }
  getDebugState() {
    let minDistance = Infinity, maxDistance = 0, distance = 0, stalled = 0;
    const failureReasons = {};
    for (const actor of this.actors) {
      const d = Math.max(0, actor.furthestX - 36);
      minDistance = Math.min(minDistance, d); maxDistance = Math.max(maxDistance, d); distance += d;
      if (actor.failureReason) failureReasons[actor.failureReason] = (failureReasons[actor.failureReason] || 0) + 1;
      if (!actor.failureReason && this.tickIndex - actor.lastProgressTick > 240) stalled++;
    }
    let residentCollisionBytes = 0;
    if (this.terrain) {
      const retained = new Set(this._collisionSlots);
      for (const chunk of this.terrain.collision.values()) retained.add(chunk);
      for (const chunk of retained) if (chunk) residentCollisionBytes += chunk.solid.byteLength + chunk.steel.byteLength + chunk.topProfile.byteLength;
    }
    return { mode: 'shared-lanes', seed: this.seed, lanes: this.laneCount, tick: this.tickIndex,
      requestedTicksPerSecond: this.timer.tps, achievedTicksPerSecond: this.timer.achievedTicksPerSecond ?? null,
      alive: this.activeCount, activeCount: this.activeCount, survival: this.activeCount / Math.max(1, this.spawnedTotal), stalled, failureReasons: this.cohorts ? { ...this.failureReasons } : failureReasons,
      generation: this.generation, spawnedTotal: this.spawnedTotal, admissionPaused: this.admissionPaused, maxActors: this.maxActors,
      population: this.population.snapshot(), workerLimits: { ...this.workerLimits }, musicActorPositions: this._musicActorPositions.size, leftEdgeX: this.leftEdgeX, actorTriggers: this.triggerManager.snapshot(),
      stall: this.cohorts ? this.stall.snapshot(this.tickIndex) : null,
      distance: { min: Number.isFinite(minDistance) ? minDistance : 0, max: maxDistance, mean: distance / Math.max(1, this.actors.length) },
      terrainGrowth: this.terrainGrowth?.snapshot() || null, generatedHazards: this.hazards.snapshot(), basinCrew: this.basinRoutes.snapshot(), tunnelCrew: this.tunnelRoutes.snapshot(), routePlanner: { ...this.hazardPlanner.stats, tunnels: { ...this.hazardPlanner.tunnels.stats }, descents: { ...this.hazardPlanner.descents.stats } },
      terrainGeneration: this.terrain?.getDebugState?.() || null, collisionResidentSlots: this._collisionSlots.length, residentCollisionMB: residentCollisionBytes / 1048576,
      frontierMargins: Array.from(this.generatedThrough, (x, lane) => x - this.frontiers[lane]),
      laneThemes: this.terrain?.laneThemes || null,
      terrainRecipe: this.terrain?.recipe.id || null, recipeMemoryMB: this.terrain?.memoryMB || 0,
      laneHeight: this.laneHeight, cachedChallenges: this.challengeCache.size, terrainEdits: this.editChunks.size,
      terrainEditStorage: this.editChunks.snapshot(), terrainRevisionStorage: this.terrainTileRevisions.snapshot(),
      terrainMemoryMB: this.editChunks.snapshot().totalBytes / 1048576,
      ...this.stats };
  }
  dispose() {
    if (this._disposalError) throw this._disposalError; if (this._disposed) return;
    this._disposed = true;
    let recoveryRetirementError = null; try { getProcgenRecoveryJournal(this)?.dispose(); } catch (error) { recoveryRetirementError = error; }
    cancelPendingInterventions(this, 'world-disposed');
    if (this.soundEvents.onBatch.handlers.size && !this.soundEvents._tick) {
      this.soundEvents.beginTick({ worldId: this.worldId, generation: this.generation, tick: this.tickIndex,
        terrainRevisionBefore: this.terrainRevision, ordinal: 1,
        sourceTimeMs: this.simulationTimeMs, tickDurationMs: this.timer.frameTime });
      for (const actor of this.actors) { actor.flushPhysicalTransitions(); actor.endPhysicalLifecycle('world-disposed'); }
      const snapshot = this._terminalPhysicalSnapshot('dispose');
      this.soundEvents.commitTick(snapshot, this.terrainRevision);
    }
    this._completedPhysicalSnapshot = null;
    this._manualNukeLanes.fill(0); for (const actor of this.actors) this._clearConstructionCrew(actor); this._musicActorPositions.clear(); this.triggerManager.dispose(); this.hazardPlanner.dispose(); this.basinRoutes.dispose(); this.tunnelRoutes.dispose(); this.lanePolicy.dispose(); this.terrainGrowth?.dispose(); this.scenery?.dispose(); this.edgeBlockers.fill(null); this.accessTasks.fill(null); this._edgeWallCache.fill(null); this._edgeWallHazards.length = 0; disposeTerrainTopology(this); this.physicalAuthoring = createPhysicalAuthoringState(); this.physicalJunctions.definitions = []; this.physicalJunctions.actual.clear(); this.onRestart = null; this.onLaneTransfer = null; this.characterParticles?.clear(); this.timer.onGameTick.dispose(); this.soundEvents.dispose(); this.editChunks.clear(); this.terrainScoreState = createTerrainScoreState(); this.terrainScorePending = { cells: [], overflow: false, revisionBefore: this.terrainRevision }; this.terrainTileRevisions.clear(); this.challengeCache.clear(); this._laneChunk.fill(null); this._collisionSlots.fill(null); this._laneEdits.fill(null); this._editCache.fill(null); this.terrain?.reset?.();
    if (recoveryRetirementError) { this._disposalError = recoveryRetirementError; throw recoveryRetirementError; }
  }
}

export { ProcgenLaneWorld, MAX_PROCGEN_LANES, LANE_HEIGHT, CHUNK_WIDTH, PROCGEN_LEFT_EDGE, normalizeLaneCount, DEFAULT_LANE_HEIGHT, MAX_LANE_HEIGHT, normalizeLaneHeight, DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy };
