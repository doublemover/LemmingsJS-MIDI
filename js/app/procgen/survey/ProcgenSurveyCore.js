import { ProcgenLaneWorld } from '../ProcgenLaneWorld.js';
import { ProcgenSurveyTerrain, captureControlledSurveyTerrain } from './ProcgenSurveyTerrain.js';
import { normalizeSurveyScenario, normalizeSurveyCandidate, surveyTrialIdentity } from './ProcgenSurveyScenario.js';
import { freezeSurveyData, hashSurveyValue, SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA } from './ProcgenSurveyCanonical.js';
import { LemmingStateType as State } from '../../../lemmings/LemmingStateType.js';
import { Trigger } from '../../../level/Trigger.js';
import { TriggerTypes } from '../../../level/TriggerTypes.js';
import { SoundEventTypes, SoundEffectIds } from '../../../game/SoundEvents.js';

const activeTerrainOwners = new WeakSet();
const MAX_MILESTONES = 256, MAX_EVENTS = 256;
const STATUSES = ['completed', 'failed', 'timeout', 'cancelled', 'interrupted', 'unsupported', 'infrastructure-error'];
const ignoredKeys = new Set(['world', 'runtime', 'sprites', 'spriteProvider', 'characterParticles', 'log', 'logger', 'masks', 'credit',
  'particleTable', 'timer', 'soundEvents', 'onEvent', 'onGameTick', 'generationSamples', 'generationSampleCount', 'generationMs', 'maxGenerationMs', 'elapsedMs',
  'recipe', 'patterns', 'ingredients', 'pieces', 'objects', 'compiledAssemblies', 'sourceGroups', 'wideSourceGroups', 'assemblySources', 'sourceRegions',
  'sourceDescriptor', 'assemblyCatalog', 'wordPlanner', 'descriptor', 'groups', 'groupsByRole', 'pairs', 'rasters']);
const stateOwners = ['tickIndex', 'generation', 'generationStartTick', 'seed', 'laneSeeds', 'laneCount', 'laneHeight', 'eventTimeMs', 'simulationTimeMs', 'interventionState', 'nextActorId',
  'worldId', 'width', 'height', 'leftEdgeX', 'workstationEnabled', 'assists', 'workerLimits', 'actorBirthAbilities', 'cohorts', 'spawnSpreadTicks', 'maxActors',
  'physicalJunctions', 'physicalFeedback', 'terrainScoreState', 'terrainScorePending', 'birthCohortRecords', 'birthCohortRevision',
  'spawnedTotal', 'activeCount', 'admissionPaused', 'frontiers', 'generatedThrough', 'terrainRevision', 'frontierRevision', 'terrainActivityTicks',
  'pendingTerrainWork', '_effectiveTerrainWork', '_manualNukeLanes', '_spawnPhases', '_spawnPhaseRanks', '_laneAdmissionCohorts', '_spawnPhaseCohortTick',
  'accessTasks', 'edgeBlockers', 'failureReasons', 'stats', 'population', 'stall', 'terrainGrowth', 'lanePolicy', 'hazardPlanner', 'tunnelRoutes', 'basinRoutes',
  'hazards', 'triggerManager', 'terrainTileRevisions', 'challengeCache', '_edgeWallCache', '_edgeWallRevisions', '_edgeWallHazards'];
const knownWorldOwners = new Set([...stateOwners, 'actors', 'actions', 'terrain', 'editChunks', 'timer', 'soundEvents', 'runtime', 'sprites', 'characterParticles',
  'physicalAuthoring', 'physicalCrewEvidence', 'terrainTopology', 'scenery', 'challengeCacheLimit', '_assistedColumn', '_chunkSlots', '_collisionSlots', '_collisionIndices',
  '_laneChunk', '_laneChunkIndex', '_laneEdits', '_laneEditIndex', '_editSlots', '_editCache', '_editIndices', '_stallWork', '_physicalWorkBounds',
  '_musicActorPositions', '_musicCompletedSlot', '_musicCompletedTick', '_completedPhysicalBatchId', '_completedPhysicalSnapshot', '_snapshotRetainers', '_authoritativeActors',
  '_processingActorId', '_processingLane', '_stepping', '_failedTick', '_disposed', '_disposalError']);

// Read own data only. No snapshot, terrain query, revision read, or cache get.
const captureState = (world, records, eventHash, { physicalOnly = false, scenarioOnly = false } = {}) => {
  for (const key of Object.getOwnPropertyNames(world)) {
    const descriptor = Object.getOwnPropertyDescriptor(world, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Object.assign(new Error('Survey state owner cannot be an accessor: ' + key.slice(0, 128)), { name: 'SurveyStateProjectionError', code: 'accessor-state-owner' });
    if (typeof descriptor.value !== 'function' && !knownWorldOwners.has(key)) throw Object.assign(new Error('Unclassified survey world owner: ' + key.slice(0, 128)), { name: 'SurveyStateProjectionError', code: 'unclassified-state-owner' });
  }
  const actions = new Map(Object.entries(world.actions).map(([id, action]) => [action, Number(id)])), actors = new Map(records.filter(record => record.actor).map(record => [record.actor, record.id]));
  const seen = new Map();
  const encode = (value, path) => {
    if (value == null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
    if (actions.has(value)) return { action: actions.get(value) };
    if (actors.has(value) && !path.startsWith('actors.')) return { actor: actors.get(value) };
    if (seen.has(value)) return { reference: seen.get(value) };
    seen.set(value, path);
    if (ArrayBuffer.isView(value)) return { typed: value.constructor.name, length: value.length ?? value.byteLength,
      byteOffset: value.byteOffset, byteLength: value.byteLength, hash: hashSurveyValue(value) };
    if (value instanceof Map) return { map: Array.from(Map.prototype.entries.call(value), ([key, entry], index) => [encode(key, `${path}.key${index}`), encode(entry, `${path}.value${index}`)]),
      properties: Object.fromEntries(Object.keys(value).filter(key => !ignoredKeys.has(key) && !key.startsWith('_last')).sort().map(key => [key, encode(Object.getOwnPropertyDescriptor(value, key)?.value, `${path}.${key}`)])) };
    if (value instanceof Set) return { set: Array.from(value, (entry, index) => encode(entry, `${path}.${index}`)) };
    if (Array.isArray(value)) return { array: value.map((entry, index) => encode(entry, `${path}.${index}`)),
      properties: Object.fromEntries(Object.keys(value).filter(key => !/^\d+$/.test(key)).sort().map(key => [key, encode(Object.getOwnPropertyDescriptor(value, key)?.value, `${path}.${key}`)])) };
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (path === 'stats' && key === 'groundQueries') continue;
      if (scenarioOnly && (path === 'lanePolicy' && key === 'config' || path.startsWith('lanePolicy.lanes.') && key === 'initialBias')) continue;
      if (ignoredKeys.has(key) || physicalOnly && ['stats', 'groundQueries', 'interests', '_lastIndex', '_lastChunk', '_lastRevision'].includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value === 'function') continue;
      if (key === 'piece' || key === 'image' || key === 'composite') { out[key] = { assetId: descriptor.value?.id ?? null, width: descriptor.value?.width ?? null, height: descriptor.value?.height ?? null }; continue; }
      out[key] = encode(descriptor.value, `${path}.${key}`);
    }
    if (value instanceof Trigger) out.disabledUntilTick = value.disabledUntilTick;
    return out;
  };
  const out = { schema: SURVEY_STATE_SCHEMA, actors: records.map(record => ({ identity: record.id, generation: record.generation,
    current: record.actor ? encode(record.actor, `actors.${record.id}`) : record.terminal,
    arrivalTick: record.arrivalTick, deathTick: record.deathTick, retired: record.retired })) };
  for (const key of stateOwners) {
    if (physicalOnly && ['eventTimeMs', 'stats', 'challengeCache', '_edgeWallCache', '_edgeWallRevisions', '_edgeWallHazards'].includes(key)) continue;
    out[key] = encode(Object.getOwnPropertyDescriptor(world, key)?.value, key);
  }
  out.edits = { resident: encode(new Map(Map.prototype.entries.call(world.editChunks)), 'edits.resident'), cold: encode(world.editChunks.cold, 'edits.cold') };
  out.revisions = { epochs: encode(world.terrainTileRevisions.epochs, 'revisions.epochs'), ...(physicalOnly ? {} : { interests: encode(world.terrainTileRevisions.interests, 'revisions.interests') }) };
  out.clock = { speedFactor: world.timer.speedFactor, simulationTimeMs: world.simulationTimeMs };
  const terrain = world.terrain;
  out.terrain = encode(terrain instanceof ProcgenSurveyTerrain ? captureControlledSurveyTerrain(terrain) : { descriptions: terrain?.descriptions, collision: terrain?.collision, growthPlans: terrain?.growthPlans,
    ...(physicalOnly ? {} : { descriptorResidency: terrain?.descriptorResidency, zoneCache: terrain?.zonePlanner?.cache, wideZoneCache: terrain?.wideZonePlanner?.cache }),
    selectedTerrainIds: terrain?.selectedTerrainIds, selectedObjectIds: terrain?.selectedObjectIds }, 'terrain');
  if (!physicalOnly) out.eventHash = eventHash;
  return out;
};

class ProcgenSurveyTrial {
  constructor({ scenario, candidate, masks, terrain = null, attemptId = 'attempt-1' } = {}) {
    this.scenario = normalizeSurveyScenario(scenario); this.candidate = normalizeSurveyCandidate(candidate);
    this.trialId = surveyTrialIdentity(this.scenario, this.candidate); this.attemptId = String(attemptId);
    if (this.scenario.mode === 'generated' && !terrain) throw new Error('Generated survey requires fresh loaded terrain');
    terrain ||= new ProcgenSurveyTerrain(this.scenario.geometry);
    if (activeTerrainOwners.has(terrain)) throw new Error('Survey replicas cannot share mutable terrain');
    activeTerrainOwners.add(terrain); this._terrain = terrain;
    this._records = []; this._activeRecords = new Set(); this._byIdentity = new Map(); this._pendingAdmission = null; this._nextAdmission = 0; this._disposed = false;
    this._openRecords = new Set(); this._byActorIdentity = new Map(); this._pendingFinalizations = []; this._physicalEvidenceIncomplete = false;
    this._observationWork = { actorVisits: 0, finalizedActors: 0, telemetryProjections: 0 };
    this._counts = { admitted: 0, arrived: 0, qualified: 0, deaths: 0, unresolved: this.scenario.designatedCohort.length,
      retired: 0, deathsByCause: {}, firstDeathTick: null, ordinary: 0, scouts: 0, workers: 0, guards: 0 };
    this._events = []; this._eventCount = 0; this._eventHash = hashSurveyValue(['logical-events-v1']); this._milestones = []; this._milestonesOmitted = 0;
    this._resets = 0; this._actorSteps = 0; this._missingActors = 0; this._allDeaths = 0; this._illegitimateTraits = false; this._lastStatus = null; this._protectedViolation = false;
    const s = this.scenario;
    try {
      this.world = new ProcgenLaneWorld({ ...s.worldOptions, masks, terrain, laneCount: s.physicalLaneCount, laneHeight: s.laneHeight,
        seed: s.environmentSeed, maxActors: s.maxActors, speed: s.worldOptions.speed ?? 1,
        cohorts: s.mode === 'controlled' ? true : s.worldOptions.cohorts !== false, policyConfig: this.candidate.configuration });
      this._spawnOriginal = this.world._spawn;
      this.world._spawn = (lane, emit = true) => { const actor = this._spawnOriginal.call(this.world, lane, emit); this._register(actor); return actor; };
      this._setPixelOriginal = this.world._setPixel;
      this.world._setPixel = (x, y, color) => {
        if (color === 0 && this.scenario.mode === 'controlled' && this.scenario.geometry.steel.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)) this._protectedViolation = true;
        return this._setPixelOriginal.call(this.world, x, y, color);
      };
      for (const actor of this.world.actors) this._register(actor);
      this._restartOriginal = this.world._restart;
      this.world._restart = previous => {
        this._observe();
        for (const record of this._activeRecords) if (record.generation === this.world.generation && !record.deathReason && !record.retired) {
          record.retired = 'generation-reset'; record.retiredTick = this.world.tickIndex; if (record.designated) this._counts.retired++;
        }
        for (const record of this._activeRecords) if (record.retired || record.deathReason) this._activeRecords.delete(record);
        for (const record of this._openRecords) this._finalizeRecord(record, { simTick: this.world.tickIndex, causalSequence: null, terminationReason: 'generation-reset' });
        this._resets++; this._recordEvent({ type: 'generation-reset', generation: this.world.generation, tick: this.world.tickIndex });
        this._restartOriginal.call(this.world, previous);
      };
      this._eventListener = event => this._recordEvent(event); this.world.soundEvents.onEvent.on(this._eventListener);
      this._batchListener = batch => {
        if (batch.completeness?.status !== 'complete') this._physicalEvidenceIncomplete = true;
        for (const fact of batch.facts) if (fact.kind === 'ActorTerminated') {
          const record = this._byActorIdentity.get(`${batch.generation}:${fact.actorId}`);
          if (record) this._pendingFinalizations.push({ record, fact });
        }
      };
      this.world.soundEvents.onBatch.on(this._batchListener);
      if (s.mode === 'controlled') { this.world.cohorts = false; this._installHazards(); this._admit(); }
      this._observe(); this._refreshTelemetry();
      const initial = this.snapshot(); this.initialStateHash = initial.stateHash; this.initialPhysicalStateHash = initial.physicalStateHash; const scenarioState = captureState(this.world, this._records, this._eventHash, { physicalOnly: true, scenarioOnly: true });
      scenarioState.controlledTriggers = initial.state.controlledTriggers;
      this.initialScenarioStateHash = hashSurveyValue({ schema: 'paired-initial-physical-v2', state: scenarioState });
      this.observeMilestone();
    } catch (error) { activeTerrainOwners.delete(terrain); this.world?.dispose(); throw error; }
  }
  _register(actor) {
    const id = this._pendingAdmission?.id ?? `${this.world.generation}:${actor.spawnLaneIndex}:${actor.spawnOrdinal}`;
    if (this._byIdentity.has(id)) throw new Error(`Duplicate actor birth identity: ${id}`);
    const record = { id, actor, actorId: actor.id, generation: this.world.generation, birthTick: actor.spawnTick,
      birthLane: actor.spawnLaneIndex, birthOrdinal: actor.spawnOrdinal, designated: this.scenario.designatedCohort.includes(id),
      scout: actor.scout, worker: false, guard: false, allowedClimb: actor.canClimb || !!(actor.scoutAbilities & 1),
      allowedFloat: actor.hasParachute || !!(actor.scoutAbilities & 2), arrivalTick: null, qualifiedTick: null, deathTick: null, deathReason: null, retired: null };
    this._records.push(record); this._activeRecords.add(record); this._byIdentity.set(id, record);
    this._openRecords.add(record); this._byActorIdentity.set(`${record.generation}:${record.actorId}`, record);
    if (record.designated) { this._counts.admitted++; this._counts[record.scout ? 'scouts' : 'ordinary']++; }
    return record;
  }
  _admit() {
    const tape = this.scenario.admissions, world = this.world;
    while (this._nextAdmission < tape.length && tape[this._nextAdmission].tick === world.tickIndex) {
      const admission = tape[this._nextAdmission++];
      if (world.activeCount >= this.scenario.maxActors) { this._recordEvent({ type: 'admission-suppressed', identity: admission.id, tick: world.tickIndex }); continue; }
      this._pendingAdmission = admission;
      const actor = world._spawn(admission.lane, false); this._pendingAdmission = null;
      Object.assign(actor, { x: admission.x, y: admission.y, lookRight: admission.lookRight, canClimb: admission.canClimb, hasParachute: admission.hasParachute,
        scout: admission.canClimb || admission.hasParachute, scoutAbilities: (admission.canClimb ? 1 : 0) | (admission.hasParachute ? 2 : 0), furthestX: admission.x });
      actor.setAction(world.actions[State[admission.state]]); world._syncTriggerOwner(actor);
      const record = this._byIdentity.get(admission.id);
      if (record.designated && record.scout !== actor.scout) { this._counts[record.scout ? 'scouts' : 'ordinary']--; this._counts[actor.scout ? 'scouts' : 'ordinary']++; }
      record.scout = actor.scout; record.allowedClimb = actor.canClimb; record.allowedFloat = actor.hasParachute;
      if (world.tickIndex > 0) world.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN,
        { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: world.laneCount, x: actor.x, y: actor.y, spawnTick: actor.spawnTick });
    }
  }
  _installHazards() {
    const world = this.world;
    this._fixedTriggers = this.scenario.geometry.hazards.map(value => {
      const trigger = new Trigger(value.type, value.x, value.y, value.x + value.width, value.y + value.height, value.cooldownTicks);
      trigger.runtime = world.runtime; trigger.surveyId = value.id; return trigger;
    });
    const triggerOriginal = world.hazards.trigger.bind(world.hazards), nearbyOriginal = world.hazards.nearby.bind(world.hazards);
    world.hazards.trigger = (x, y, actor, tick = world.tickIndex) => {
      for (const trigger of this._fixedTriggers) if (x >= trigger.x1 && x < trigger.x2 && y >= trigger.y1 && y < trigger.y2) {
        const type = trigger.trigger(x, y, tick, actor);
        if (type !== TriggerTypes.DISABLED && type !== TriggerTypes.NO_TRIGGER) return type;
      }
      return triggerOriginal(x, y, actor, tick);
    };
    world.hazards.nearby = (lane, x, options = {}, out = []) => {
      nearbyOriginal(lane, x, options, out);
      for (const trigger of this._fixedTriggers) if (out.length < 8 && trigger.x2 > x - Math.min(32, options.behind ?? 8) && trigger.x1 < x + Math.min(64, options.ahead ?? 40) &&
          trigger.y2 > lane * world.laneHeight && trigger.y1 < (lane + 1) * world.laneHeight)
        out.push({ lane, type: trigger.type, x1: trigger.x1, x2: trigger.x2, y1: trigger.y1, y2: trigger.y2, enabled: true, cooling: trigger.disabledUntilTick > world.tickIndex, disabledUntilTick: trigger.disabledUntilTick });
      return out;
    };
  }
  _recordEvent(event) {
    const record = JSON.parse(JSON.stringify(event));
    this._eventHash = hashSurveyValue([this._eventHash, record]); this._eventCount++;
    this._events.push(record); if (this._events.length > MAX_EVENTS) this._events.shift();
  }
  _finalizeRecord(record, fact) {
    if (!record.actor) return;
    const actor = record.actor;
    record.terminal = freezeSurveyData({ schemaVersion: 1, tick: fact.simTick, causalSequence: fact.causalSequence,
      terminationReason: fact.terminationReason, actor: { x: actor.x, y: actor.y, laneIndex: actor.laneIndex,
        action: actor.action?.actionName || null, actionInstanceId: fact.actionInstanceId ?? actor._physicalActionInstanceId ?? null,
        lookRight: actor.lookRight, disabled: !!actor.disabled } });
    record.actor = null; this._openRecords.delete(record); this._byActorIdentity.delete(`${record.generation}:${record.actorId}`);
    this._observationWork.finalizedActors++;
  }
  _observe() {
    const world = this.world, completed = world.getCompletedPhysicalSnapshot?.(), goal = this.scenario.goal;
    const completedBoundary = completed?.tick === world.tickIndex && completed.generation === world.generation;
    const live = completedBoundary ? new Set(completed.actors.map(actor => actor.actorId)) : new Set(world.actors);
    for (const record of this._activeRecords) {
      this._observationWork.actorVisits++;
      const actor = record.actor;
      if (!record.worker && [State.BUILDING, State.BASHING, State.MINING, State.DIGGING].some(state => actor.action === world.actions[state])) { record.worker = true; if (record.designated) this._counts.workers++; }
      if (!record.guard && actor.action === world.actions[State.BLOCKING]) { record.guard = true; if (record.designated) this._counts.guards++; }
      this._illegitimateTraits ||= !!actor.canClimb && !record.allowedClimb || !!actor.hasParachute && !record.allowedFloat;
      if (!record.deathReason && (actor.failureReason || actor.terminalReason)) {
        record.deathReason = actor.terminalReason || actor.failureReason; record.deathTick = world.tickIndex; this._allDeaths++;
        if (record.designated) { this._counts.deaths++; this._counts.deathsByCause[record.deathReason] = (this._counts.deathsByCause[record.deathReason] || 0) + 1;
          this._counts.firstDeathTick = Math.min(this._counts.firstDeathTick ?? world.tickIndex, world.tickIndex); if (record.arrivalTick == null) this._counts.unresolved--; }
      }
      if (!record.retired && actor.removed && !record.deathReason) { record.retired = 'removed'; record.retiredTick = world.tickIndex; if (record.designated) this._counts.retired++; }
      if (!record.retired && !record.deathReason && !live.has(completedBoundary ? record.actorId : actor)) { record.retired = 'missing'; record.retiredTick = world.tickIndex; this._missingActors++; if (record.designated) this._counts.retired++; }
      const alive = !record.deathReason && !record.retired && !actor.disabled;
      if (alive && record.arrivalTick == null && actor.x >= goal.x && actor.x < goal.x + goal.width && actor.y >= goal.y && actor.y < goal.y + goal.height &&
          (!goal.requireWalking || actor.action === world.actions[State.WALKING])) {
        record.arrivalTick = world.tickIndex; this._recordEvent({ type: 'designated-arrival', identity: record.id, designated: record.designated, tick: world.tickIndex });
        if (record.designated) { this._counts.arrived++; this._counts.unresolved--; }
      }
      if (alive && record.arrivalTick != null && record.qualifiedTick == null && world.tickIndex - record.arrivalTick >= goal.postArrivalTicks) { record.qualifiedTick = world.tickIndex; if (record.designated) this._counts.qualified++; }
      if (record.deathReason || record.retired) this._activeRecords.delete(record);
    }
    for (const { record, fact } of this._pendingFinalizations) this._finalizeRecord(record, fact);
    this._pendingFinalizations.length = 0;
  }
  _accounting() {
    const counts = this._counts, designated = this.scenario.designatedCohort.length;
    let alive = 0; for (const record of this._activeRecords) if (record.designated && !record.actor.disabled) alive++;
    return { designated, planned: designated, admitted: counts.admitted, suppressed: designated - counts.admitted,
      arrived: counts.arrived, qualified: counts.qualified, alive, deaths: counts.deaths,
      unresolved: counts.unresolved, retired: counts.retired, deathsByCause: { ...counts.deathsByCause }, firstDeathTick: counts.firstDeathTick,
      ordinary: counts.ordinary, scouts: counts.scouts, workers: counts.workers, guards: counts.guards,
      totalBirths: this._records.length, additionalBirths: this._records.length - counts.admitted, allDeaths: this._allDeaths,
      resets: this._resets, missingActors: this._missingActors };
  }
  _refreshTelemetry() {
    this._observationWork.telemetryProjections++;
    const world = this.world, stats = world.stats, accounting = this._accounting();
    const skills = { builds: stats.builds, bashes: stats.bashes, digs: stats.digs, mines: stats.mines, blockers: stats.blockers };
    const completed = world.getCompletedPhysicalSnapshot?.();
    const actors = completed?.tick === world.tickIndex && completed.generation === world.generation ? completed.actors.slice(0, 128).map(actor => ({ id: actor.actorId, x: actor.x, y: actor.y, lane: actor.laneId,
      action: actor.action, lookRight: actor.direction === 'right', scout: this._byActorIdentity.get(`${world.generation}:${actor.actorId}`)?.scout || false, terminalReason: actor.terminalReason })) :
      world.actors.filter(actor => !actor.failureReason && !actor.removed).slice(0, 128).map(actor => ({ id: actor.id, x: actor.x, y: actor.y, lane: actor.laneIndex,
        action: actor.action?.actionName || null, lookRight: actor.lookRight, scout: actor.scout, terminalReason: actor.terminalReason || null }));
    this._telemetry = freezeSurveyData({ trialId: this.trialId, scenarioId: this.scenario.id, candidateId: this.candidate.id,
      tick: world.tickIndex, generation: world.generation, accounting, skills, excavatedPixels: stats.removedPixels,
      eventCount: this._eventCount, eventHash: this._eventHash, routePhase: world.stall.phase,
      routeProjects: world.lanePolicy.projects.lanes.map(lane => ({ active: lane.projects.length, completed: lane.completed, failed: lane.failed })),
      operations: { actorSteps: this._actorSteps, plannerProbes: world.hazardPlanner.stats.probes, groundQueries: stats.groundQueries },
      preview: { actors, actorsOmitted: Math.max(0, world.activeCount - actors.length), geometry: this.scenario.mode === 'controlled' ? this.scenario.geometry : null } });
  }
  get done() { return this.world.tickIndex >= this.scenario.horizonTicks || this._lastStatus != null; }
  step(count = 1, { telemetry = true } = {}) {
    if (this._disposed) throw new Error('Survey trial is disposed');
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error('Invalid survey step count');
    for (let at = 0; at < count && !this.done; at++) {
      if (this.scenario.mode === 'controlled') this._admit();
      this._actorSteps += this.world.actors.length; this.world.step(); this._observe();
      if (this.world.tickIndex % this.scenario.checkpointEvery === 0 || this.done) { this._refreshTelemetry(); this.observeMilestone(); }
      if (this._records.length >= this.scenario.actorRecordLimit) this._lastStatus = 'infrastructure-error';
    }
    return telemetry ? this.telemetry() : null;
  }
  telemetry() { this._assertCompletedBoundary(); if (this._telemetry.tick !== this.world.tickIndex) this._refreshTelemetry(); return this._telemetry; }
  observationWork() { return Object.freeze({ ...this._observationWork, activeRecords: this._activeRecords.size,
    openLifecycles: this._openRecords.size, retainedRecords: this._records.length }); }
  preview({ maximumChunks = 4 } = {}) {
    if (!Number.isInteger(maximumChunks) || maximumChunks < 0 || maximumChunks > 4) throw new Error('Invalid preview chunk budget');
    const world = this.world, chunks = [], width = world.terrain?.chunkWidth || 128, height = world.laneHeight;
    let available = 0;
    for (let slot = 0; slot < world._collisionSlots.length; slot++) {
      const source = world._collisionSlots[slot], index = world._collisionIndices[slot];
      if (!source?.solid || index < 0) continue;
      available++; if (chunks.length >= maximumChunks) continue;
      const lane = Math.floor(slot / world._chunkSlots), cells = [];
      for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
        const bit = y * width + x, wx = index * width + x;
        cells.push(wx < world.generatedThrough[lane] ? source.steel?.[bit >>> 5] & (1 << (bit & 31)) ? 2 : source.solid[bit >>> 5] & (1 << (bit & 31)) ? 1 : 0 : 0);
      }
      chunks.push({ lane, x: index * width, y: lane * height, width, height, cellSize: 4, cells });
    }
    return freezeSurveyData({ ...this.telemetry().preview, chunks, chunksOmitted: Math.max(0, available - chunks.length),
      terrainScope: 'Already cached base collision only; edits and partial growth are not reconstructed.' });
  }
  _assertCompletedBoundary() {
    if (this._disposed) throw new Error('Survey trial is disposed');
    if (this.world._stepping || this.world._failedTick) {
      const error = new Error('Survey evidence requires a completed physical tick');
      error.name = 'SurveyInvalidStateError'; error.kind = 'incomplete-physical-boundary'; throw error;
    }
  }
  snapshot() {
    this._assertCompletedBoundary();
    for (const tick of this.world.terrainActivityTicks) {
      if (tick !== -Infinity && (!Number.isFinite(tick) || tick < 0)) {
        const error = new Error('Invalid terrain activity tick in survey state');
        error.name = 'SurveyInvalidStateError'; error.kind = 'invalid-state'; error.field = 'terrainActivityTicks';
        throw error;
      }
    }
    const state = captureState(this.world, this._records, this._eventHash);
    state.controlledTriggers = this._fixedTriggers?.map(trigger => ({ id: trigger.surveyId, cooldown: trigger.disabledUntilTick })) || [];
    state.evaluation = { resets: this._resets, missingActors: this._missingActors, protectedViolation: this._protectedViolation,
      illegitimateTraits: this._illegitimateTraits, physicalEvidenceIncomplete: this._physicalEvidenceIncomplete };
    const physical = captureState(this.world, this._records, this._eventHash, { physicalOnly: true }); physical.controlledTriggers = state.controlledTriggers;
    return freezeSurveyData({ tick: this.world.tickIndex, stateHash: hashSurveyValue(state), physicalStateHash: hashSurveyValue(physical), eventHash: this._eventHash, state });
  }
  observeMilestone() {
    this._assertCompletedBoundary();
    const previous = this._milestones[this._milestones.length - 1]; if (previous?.tick === this.world.tickIndex) return previous;
    const snapshot = this.snapshot(), milestone = freezeSurveyData({ tick: snapshot.tick, stateHash: snapshot.stateHash, physicalStateHash: snapshot.physicalStateHash, eventHash: snapshot.eventHash, telemetry: this.telemetry() });
    if (this._milestones.length >= MAX_MILESTONES) { this._milestones.splice(1, 1); this._milestonesOmitted++; }
    this._milestones.push(milestone); return milestone;
  }
  result(status = null) {
    if (status != null && !STATUSES.includes(status)) throw new Error('Invalid survey result status');
    this.telemetry();
    const accounting = this._accounting(), horizonReached = this.world.tickIndex >= this.scenario.horizonTicks;
    status ||= this._lastStatus || (horizonReached ? accounting.qualified === accounting.designated ? 'completed' : accounting.deaths || accounting.retired ? 'failed' : 'timeout' : 'cancelled');
    const episodeComplete = horizonReached && ['completed', 'failed', 'timeout'].includes(status);
    if (!horizonReached && ['completed', 'failed', 'timeout'].includes(status)) throw new Error('Incomplete horizon cannot be a scored episode');
    this._lastStatus = status;
    const final = this.observeMilestone(), records = this._records.map(record => ({ id: record.id, actorId: record.actorId, generation: record.generation,
      designated: record.designated, birthTick: record.birthTick, birthLane: record.birthLane, birthOrdinal: record.birthOrdinal,
      scout: record.scout, worker: record.worker, guard: record.guard, allowedClimb: record.allowedClimb, allowedFloat: record.allowedFloat, arrivalTick: record.arrivalTick, qualifiedTick: record.qualifiedTick,
      deathTick: record.deathTick, deathReason: record.deathReason, retired: record.retired, retiredTick: record.retiredTick ?? null,
      x: record.actor?.x ?? record.terminal.actor.x, y: record.actor?.y ?? record.terminal.actor.y,
      lane: record.actor?.laneIndex ?? record.terminal.actor.laneIndex, action: record.actor ? record.actor.action?.actionName || null : record.terminal.actor.action,
      terminal: record.terminal || null }));
    const metrics = { skillCount: Object.values(this._telemetry.skills).reduce((sum, value) => sum + value, 0), skills: this._telemetry.skills,
      excavatedPixels: this.world.stats.removedPixels, stalls: this.world.stall.lanes.filter(lane => lane.reason).length, resets: this._resets,
      lastArrivalTick: records.filter(record => record.designated && record.arrivalTick != null).reduce((last, record) => Math.max(last ?? 0, record.arrivalTick), null),
      operations: this._telemetry.operations };
    return freezeSurveyData({ schemaVersion: 1, trialId: this.trialId, scenarioId: this.scenario.id, candidateId: this.candidate.id, policySeed: this.candidate.configuration.policySeed,
      scenario: this.scenario, candidate: this.candidate, status, episodeComplete, terminationReason: episodeComplete ? status === 'completed' ? 'declared-goal-qualified' : 'declared-horizon' : status,
      lastTick: this.world.tickIndex, accounting, metrics, crew: records,
      initialStateHash: this.initialStateHash, initialPhysicalStateHash: this.initialPhysicalStateHash, initialScenarioStateHash: this.initialScenarioStateHash, finalStateHash: final.stateHash, finalPhysicalStateHash: final.physicalStateHash, eventHash: this._eventHash,
      provenance: { scenarioHash: hashSurveyValue(this.scenario), budgetHash: hashSurveyValue({ horizonTicks: this.scenario.horizonTicks, maxActors: this.scenario.maxActors, worldOptions: this.scenario.worldOptions }),
        sourceHash: hashSurveyValue({ engineCommit: this.scenario.engineCommit, assetHashes: this.scenario.assetHashes, generatorVersion: this.scenario.generatorVersion }),
        harnessVersion: 1, stateSchema: SURVEY_STATE_SCHEMA, canonicalSchema: SURVEY_CANONICAL_SCHEMA },
      validity: { deterministic: null, accountingComplete: this._missingActors === 0 && !this._physicalEvidenceIncomplete && accounting.admitted + accounting.suppressed === accounting.designated,
        protectedTerrain: this.scenario.mode === 'controlled' ? !this._protectedViolation : this.world.editChunks.size === 0 && !this._resets ? true : null, legitimateActions: !this._illegitimateTraits },
      milestones: [...this._milestones], events: [...this._events], evidence: { eventCount: this._eventCount, eventsOmitted: this._eventCount - this._events.length, milestonesOmitted: this._milestonesOmitted,
        truncated: this._eventCount > this._events.length || this._milestonesOmitted > 0, actorRecordLimitReached: this._records.length >= this.scenario.actorRecordLimit,
        physicalBatchComplete: !this._physicalEvidenceIncomplete, terminalRecordSchema: 1, pendingLifecycles: this._openRecords.size,
        resumeMethod: 'deterministic-restart-replay' } });
  }
  releaseStorage() {
    if (!this._disposed) throw new Error('Survey storage remains pinned by a live trial.');
    this.world = null; this._terrain = null;
    for (const record of this._records) record.actor = null;
    this._records.length = 0; this._activeRecords.clear(); this._byIdentity.clear(); this._openRecords.clear(); this._byActorIdentity.clear(); this._pendingFinalizations.length = 0;
    this._pendingAdmission = null; this._eventListener = null; this._batchListener = null; this._events.length = 0; this._milestones.length = 0;
    this._spawnOriginal = null; this._restartOriginal = null; this._setPixelOriginal = null;
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.world.soundEvents.onEvent.off(this._eventListener); this.world.soundEvents.onBatch.off(this._batchListener);
    this.world._spawn = this._spawnOriginal; this.world._restart = this._restartOriginal; this.world._setPixel = this._setPixelOriginal;
    this.world.dispose(); activeTerrainOwners.delete(this._terrain);
  }
}
const createSurveyTrial = options => new ProcgenSurveyTrial(options);
const createSurveyTrialId = (scenario, candidate) => surveyTrialIdentity(normalizeSurveyScenario(scenario), normalizeSurveyCandidate(candidate));
export { ProcgenSurveyTrial, createSurveyTrial, createSurveyTrialId, normalizeSurveyScenario, normalizeSurveyCandidate, MAX_MILESTONES, MAX_EVENTS };
