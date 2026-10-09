import { ProcgenTerrainEdits, ProcgenTerrainRevisions } from './ProcgenTerrainRetention.js';
import { ProcgenLanePolicy } from './ProcgenLanePolicy.js';
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
import { ProcgenHazardPlanner } from './ProcgenHazardPlanner.js';
import { ProcgenTriggerManager } from './ProcgenTriggerManager.js';
import { MAX_PROCGEN_WORKERS, normalizeWorkerLimits } from './ProcgenWorkerLimits.js';
import { ActionBlockerSystem } from '../../actions/ActionBlockerSystem.js';
import { ActionDiggSystem } from '../../actions/ActionDiggSystem.js';
import { ActionMineSystem } from '../../actions/ActionMineSystem.js';
import { ProcgenTerrainGrowth } from './ProcgenTerrainGrowth.js';
import { ProcgenPopulationPolicy, DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy } from './ProcgenPopulationPolicy.js';
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
import { normalizeSeed } from '../../core/seededRandom.js';

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
  constructor({ laneCount = 1, laneHeight = 96, seed = 1, sprites = null, masks, assists = true, speed = 3, cohorts = false, spawnSpreadTicks = null, maxActors = 16384, stallPolicy = {}, populationPolicy = {}, previousDistances = [], workerLimits = {}, particleTable = null, terrain = null } = {}) {
    this.laneCount = normalizeLaneCount(laneCount);
    this.laneHeight = normalizeLaneHeight(laneHeight);
    this.seed = normalizeSeed(seed);
    this.width = 0x3fffffff;
    this.height = this.laneCount * this.laneHeight;
    this.tickIndex = 0;
    this.assists = assists;
    this.accessTasks = new Array(this.laneCount).fill(null);
    this.workerLimits = normalizeWorkerLimits(workerLimits); this.edgeBlockers = new Array(this.laneCount).fill(null);
    this._edgeWallCache = new Array(this.laneCount); this._edgeWallRevisions = new Float64Array(this.laneCount); this._edgeWallHazards = [];
    this.leftEdgeX = PROCGEN_LEFT_EDGE; this._processingLane = null;
    this.sprites = sprites;
    this._assistedColumn = { valid: false, x: 0, y: 0, height: 0, revision: 0, value: 0 };
    this.terrain = terrain;
    terrain?.configure?.(this.laneCount, maxActors, { laneHeight: this.laneHeight });
    this.terrainRevision = 0; this.frontierRevision = 0; this.terrainTileRevisions = new ProcgenTerrainRevisions(this.laneCount, Math.max(128, this.laneCount * 16));
    this.frontiers = new Float64Array(this.laneCount); this.frontiers.fill(36);
    this.generatedThrough = new Float64Array(this.laneCount); this.generatedThrough.fill(terrain?.chunkWidth || CHUNK_WIDTH);
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
    this.spawnSpreadTicks = normalizePopulationPolicy({ spawnSpreadTicks: spawnSpreadTicks ?? populationPolicy.spawnSpreadTicks }).spawnSpreadTicks;
    this.maxActors = Math.max(this.laneCount, maxActors);
    this.admissionPaused = false; this._manualNukeLanes = new Uint8Array(this.laneCount);
    this.nextActorId = 0;
    this.generation = 1;
    this.generationStartTick = 0;
    this.spawnedTotal = 0; this.activeCount = 0;
    this.population = new ProcgenPopulationPolicy(this.laneCount, stallPolicy.releaseIntervalTicks ?? DEFAULT_STALL_POLICY.releaseIntervalTicks, populationPolicy, Object.hasOwn(stallPolicy, 'releaseIntervalTicks'));
    this.population.settings.spawnSpreadTicks = this.spawnSpreadTicks;
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
    this.terrainGrowth = terrain?.supportsFineGrowth ? new ProcgenTerrainGrowth(this.laneCount, terrain.chunkWidth) : null;
    this.terrainGrowth?.reset(this.generatedThrough, this.frontiers);
    this._prepareGrowthChunk = (lane, chunk) => this.terrain.growthPlan?.(this.laneSeeds[lane], chunk);
    this._revealGrowth = (lane, previous, next, chunk, job) => {
      this.terrainRevision++; this.frontierRevision++;
      if (job?.kind === 'foundation' || job?.kind === 'terrain') this.terrainActivityTicks[lane] = this.tickIndex;
      this.terrainTileRevisions.set(lane * 0x800000 + chunk, this.terrainRevision);
      if (chunk === 0) this._edgeWallRevisions[lane]++;
    };
    this.eventTimeMs = 0;
    this.timer = { speedFactor: speed, onGameTick: new EventHandler(), getGameTicks: () => this.tickIndex,
      TIME_PER_FRAME_MS: 60,
      get frameTime() { return 60 / Math.max(0.001, this.speedFactor); },
      get tps() { return Math.min(Number.MAX_VALUE, 1000 / this.frameTime); }, getEventTimeMs: () => this.eventTimeMs };
    this.soundEvents = new ProcgenSoundEventBus(this.timer, this.laneCount, this.laneHeight);
    this.soundEvents._queueLimit = 0;
    this.soundEvents.laneCount = this.laneCount;
    this.soundEvents.laneIndex = 0;
    const runtime = { soundEvents: this.soundEvents };
    this.runtime = runtime;
    this.characterParticles = sprites ? new CharacterParticles() : null;
    this.hazards = new ProcgenHazards(this); this.triggerManager = new ProcgenTriggerManager(this, this.hazards);
    this.hazardPlanner = new ProcgenHazardPlanner(this);
    this.lanePolicy = new ProcgenLanePolicy(this);
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
    this.actors = [];
    this._musicActorPositions = new Map(); this._musicCompletedSlot = 0; this._musicCompletedTick = this.tickIndex;
    if (!cohorts) for (let lane = 0; lane < this.laneCount; lane++) this._spawn(lane, false);
    this.stats = { builds: 0, bashes: 0, digs: 0, mines: 0, blockers: 0, turns: 0, failures: 0, groundQueries: 0, removedPixels: 0, laneTransfers: 0 };
  }


  _spawn(lane, emit = true) {
    this.soundEvents.laneIndex = lane;
    const actor = new Lemming(36, lane * this.laneHeight + this.laneHeight - LANE_HEIGHT + 42, this.nextActorId++, this.runtime);
    actor.appearanceIndex = lane; actor._musicPositionId = actor.id;
    actor.laneIndex = lane; actor.spawnLaneIndex = lane;
    actor.spawnTick = this.tickIndex;
    actor.spawnOrdinal = this.stall.lanes[lane].spawned;
    actor.scoutAbilities = this.population.scoutAbilities(this.laneSeeds[lane], actor.spawnOrdinal); actor.scout = !!actor.scoutAbilities;
    actor.spawnPhaseTicks = this._spawnPhaseForLane(lane);
    actor.lastProgressTick = this.tickIndex;
    actor.furthestX = actor.x;
    actor.assists = 0;
    actor.failureReason = null;
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
    const order = Array.from({ length: this.laneCount }, (_, lane) => lane); let state = mix(this.seed ^ this.generation);
    for (let at = order.length - 1; at > 0; at--) { state = mix(state ^ at); const other = state % (at + 1); [order[at], order[other]] = [order[other], order[at]]; }
    for (let rank = 0; rank < order.length; rank++) this._spawnPhaseRanks[order[rank]] = rank;
    this._laneAdmissionCohorts.fill(-Infinity); this._spawnPhaseCohortTick = -Infinity; this._computeSpawnPhases();
  }
  _computeSpawnPhases() {
    const spread = Math.min(this.spawnSpreadTicks, this.population.intervalTicks - 1), quarterBeat = this.population.settings.spawnBeatTicks / 4;
    for (let lane = 0; lane < this.laneCount; lane++) {
      const offset = this._spawnPhaseRanks[lane] * spread / this.laneCount;
      this._spawnPhases[lane] = quarterBeat > 0 ? Math.min(spread, Math.round(Math.round(offset / quarterBeat) * quarterBeat)) : Math.floor(offset);
    }
  }
  _spawnPhaseForLane(lane) { return this._spawnPhases[lane]; }
  setPopulationPolicy(next = {}) {
    const settings = this.population.setSettings(next);
    this.spawnSpreadTicks = settings.spawnSpreadTicks;
    return { ...settings };
  }
  _spawnCohort() {
    if (!this.cohorts || this.stall.phase !== 'running') return;
    const phase = this.population.phaseAt(this.tickIndex, this.activeCount);
    if (this._spawnPhaseCohortTick !== this.population.cohortStartTick) { this._computeSpawnPhases(); this._spawnPhaseCohortTick = this.population.cohortStartTick; }
    this.admissionPaused = this.activeCount >= this.maxActors;
    for (let lane = 0; lane < this.laneCount; lane++) {
      if (this._spawnPhaseForLane(lane) !== phase || this._laneAdmissionCohorts[lane] === this.population.cohortStartTick) continue;
      const state = this.stall.lanes[lane];
      const stalledLongEnough = this.tickIndex - state.lastProgressTick >= this.stall.settings.secondsWithoutProgress * this.stall.settings.ticksPerSecond;
      const reservedProbe = stalledLongEnough && state.spawnsSinceProgress < this.stall.allowance(state);
      if (this.activeCount >= this.maxActors && !reservedProbe) { this.admissionPaused = true; continue; }
      this._spawn(lane); this._laneAdmissionCohorts[lane] = this.population.cohortStartTick;
    }
  }
  _restart(previousDistances) {
    this.characterParticles?.clear(); this.triggerManager.reset(); this.hazardPlanner.reset(); this.edgeBlockers.fill(null); this._processingLane = null;
    this._assistedColumn.valid = false; this.accessTasks.fill(null); this._edgeWallCache.fill(null); this._edgeWallRevisions.fill(0); this._edgeWallHazards.length = 0;
    this._musicActorPositions.clear(); this._musicCompletedSlot = 0; this._musicCompletedTick = this.tickIndex;
    for (const actor of this.actors) { this._clearConstructionCrew(actor); actor._laneRouteAttempt = null; }
    this.actors.length = 0; this.activeCount = 0; this.admissionPaused = false; this._manualNukeLanes.fill(0); this.editChunks.clear(); this.terrainTileRevisions.clear(); this.challengeCache.clear(); this.terrain?.reset?.();
    this._laneChunk.fill(null); this._laneChunkIndex.fill(-1); this._collisionSlots.fill(null); this._collisionIndices.fill(-1); this._laneEdits.fill(null); this._laneEditIndex.fill(-1); this._editCache.fill(null); this._editIndices.fill(-1); this.frontiers.fill(36);
    this.generatedThrough.fill(this.terrain?.chunkWidth || CHUNK_WIDTH); this.terrainRevision++; this.frontierRevision++; this.generation++; this.generationStartTick = this.tickIndex;
    for (let lane = 0; lane < this.laneCount; lane++) this.laneSeeds[lane] = mix(this.seed ^ Math.imul(lane + 1, 0x9e3779b1) ^ Math.imul(this.generation - 1, 0x85ebca6b));
    this.terrain?.registerLanes?.(this.laneSeeds, this.seed, this.generation);
    this.population.reset(this.generationStartTick); this._resetSpawnPhases(); this.lanePolicy.reset(); this.terrainActivityTicks.fill(-Infinity); this.pendingTerrainWork.fill(0); this._effectiveTerrainWork.fill(0); this.terrainGrowth?.reset(this.generatedThrough, this.frontiers);
    this.stall = new ProcgenStallPolicy(this.laneCount, this.stall.settings, previousDistances, { laneHeight: this.laneHeight });
    for (const lane of this.stall.lanes) lane.lastProgressTick = this.tickIndex;
    this.onRestart?.();
  }

  // Requests enter the existing simulation pass; pause never advances OHNO.
  nukeLane(lane) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= this.laneCount) return false;
    this._manualNukeLanes[lane] = 1; return true;
  }
  nukeAll() { this._manualNukeLanes.fill(1); return this.laneCount; }
  _applyManualNukes() {
    if (!this._manualNukeLanes.some(Boolean)) return;
    for (const actor of this.actors) {
      if (!this._manualNukeLanes[actor.laneIndex] || actor.failureReason || actor.removed || actor.terminalReason ||
          actor.action === this.actions[State.OHNO] || actor.action === this.actions[State.EXPLODING]) continue;
      actor.countdown = 0; actor.countdownAction = null;
      actor.setAction(this.actions[State.OHNO]); this._syncTriggerOwner(actor);
      this.soundEvents.emitSfx(SoundEventTypes.LEMMING_OHNO, SoundEffectIds.OHNO,
        { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: this.laneCount, x: actor.x, y: actor.y });
    }
    this._manualNukeLanes.fill(0);
  }

  setPendingTerrainWork(lane, count = 0) {
    if (Number.isInteger(lane) && lane >= 0 && lane < this.laneCount) this.pendingTerrainWork[lane] = Math.max(0, Math.min(65535, Math.trunc(count) || 0));
  }

  getLanePolicySignals(lane) { return this.lanePolicy.signals(lane); }
  getLaneMusicSignals(lane) { return this.stall.lanes[lane] || null; }
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
    return state ? this.terrain.rasterSample(this.laneSeeds[lane], chunk, x % this.terrain.chunkWidth, y % this.laneHeight, state.plan?.descriptor, state) : this.terrain.sample(this.laneSeeds[lane], x, y % this.laneHeight);
  }
  baseGroundAt(x, y) {
    if (this.terrain) {
      const lane = Math.floor(y / this.laneHeight);
      if (lane < 0 || lane >= this.laneCount || x < this.leftEdgeX || this.terrainGrowth && x >= this.generatedThrough[lane]) return 0;
      const chunk = Math.floor(x / this.terrain.chunkWidth), state = this.terrainGrowth?.stateFor(lane, chunk);
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
    if (state) return this.terrain.solidSample(this.laneSeeds[lane], chunk, x % this.terrain.chunkWidth, localY, state.plan?.descriptor, state) ? 1 : 0;
    const p = this._terrainChunk(lane, x), index = localY * this.terrain.chunkWidth + x % this.terrain.chunkWidth;
    return p.solid[index >>> 5] & (1 << (index & 31)) ? 1 : 0;
  }
  groundPixelAt(x, y) {
    const color = this.groundColorAt(x, y);
    return color === 3 ? 0xff86cbea : color ? this.basePixelAt(x, y) : 0;
  }
  hasGroundAt(x, y) { this.stats.groundQueries++; return this.groundColorAt(x, y) > 0; }
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
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
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
      chunk[index] = color + 1; this.terrainRevision++;
      if (x >= this.leftEdgeX && x <= this.leftEdgeX + 12) this._edgeWallRevisions[Math.floor(y / this.laneHeight)]++;
      this.terrainActivityTicks[Math.floor(y / this.laneHeight)] = this.tickIndex;
      const width = this.terrain?.chunkWidth || CHUNK_WIDTH;
      this.terrainTileRevisions.set(Math.floor(y / this.laneHeight) * 0x800000 + Math.floor(x / width), this.terrainRevision);
    }
  }
  setGroundAt(x, y) { this._setPixel(x, y, 3); }
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
  _claimAccess(actor, action, targetX, footprint = null) {
    const kind = this._workerKind(action);
    if (!kind || !this.workerLimits[kind]) return false;
    const tasks = this._accessTaskRecords(actor.laneIndex);
    if (kind === 'builders' && !footprint) footprint = { x1: actor.x + (actor.lookRight ? 0 : -26), x2: actor.x + (actor.lookRight ? 28 : 2), y1: actor.y - 12, y2: actor.y + 1 };
    let active = 0;
    for (const task of tasks) {
      if (task.owner && this._workerKind(task.action) === kind) active++;
      const sameFootprint = task.action === action && Math.abs(task.targetX - targetX) < 12 && Math.abs(task.targetY - actor.y) < 8;
      if (sameFootprint && (task.owner || this.tickIndex < task.retryAt)) return false;
      // Concurrent independent jobs remain legal; claimed physical footprints
      // cannot be excavated twice or cut through another active construction.
      if (task.owner && footprint && task.footprint && footprint.x1 < task.footprint.x2 && footprint.x2 > task.footprint.x1 && footprint.y1 < task.footprint.y2 && footprint.y2 > task.footprint.y1) return false;
    }
    if (active >= this.workerLimits[kind]) return false;
    tasks.push({ owner: actor, action, targetX, targetY: actor.y, footprint, direction: actor.lookRight, startX: actor.x, startY: actor.y, startLane: actor.laneIndex, startTick: this.tickIndex });
    while (tasks.length > MAX_PROCGEN_WORKERS * 3 + 8) {
      const index = tasks.findIndex(task => !task.owner);
      if (index < 0) break;
      tasks.splice(index, 1);
    }
    return true;
  }
  assignWorker(actor, kind, targetX = actor?.x, footprint = null) {
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
    if (!this._claimAccess(actor, action, targetX, footprint)) return false;
    if (!action.triggerLemAction(actor)) return false;
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
    if (task.blocker === actor) task.blocker = null;
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
  _assistConstructionCrew(actor) {
    const held = actor.assistConstructionTask;
    if (held && actor.action === this.actions[State.BLOCKING]) {
      if (this._constructionPassage(held) !== false && this._emptyBashMasks(actor)) this.assignWorker(actor, 'bashers');
      return true;
    }
    if (actor.action !== this.actions[State.WALKING] || !actor.lookRight || actor.scout || actor.canClimb || actor.hasParachute || !this.workerLimits.bashers) return false;
    const tasks = this.accessTasks[actor.laneIndex];
    if (!tasks) return false;
    for (const task of tasks) {
      const owner = task.owner;
      if (task.blocker || !owner || owner.removed || owner.failureReason || owner.terminalReason || owner.action !== this.actions[State.BUILDING] ||
          !task.direction || task.startLane !== actor.laneIndex || actor.x < task.startX - 16 || actor.x > task.startX - 8 ||
          Math.abs(actor.y - task.startY) > 3 || !this.hasGroundAt(actor.x, actor.y + 1) || this._constructionPassage(task) !== false || !this._emptyBashMasks(actor)) continue;
      actor.setAction(this.actions[State.BLOCKING]); actor.assistConstructionTask = task; task.blocker = actor;
      this.stats.blockers++; actor.assists++; return true;
    }
    return false;
  }
  _assist(actor) {
    if (!this.assists) return;
    if (this._assistConstructionCrew(actor)) return;
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
    this.tickIndex++;
    const nextMusicSlot = 1 - this._musicCompletedSlot;
    this.eventTimeMs = Number.isFinite(eventTimeMs) ? eventTimeMs : this.eventTimeMs + this.timer.frameTime;
    this.characterParticles?.tick();
    this._spawnCohort();
    let activeCount = 0;
    for (const lane of this.stall.lanes) { lane.alive = 0; lane.lowestSurvivingActorId = null; lane.buildingCount = 0; lane.bashingCount = 0; lane.floatingCount = 0; lane.diggingCount = 0; lane.miningCount = 0; lane.blockingCount = 0; }
    for (const actor of this.actors) {
      if (actor.failureReason || actor.removed) { this._musicActorPositions.delete(actor._musicPositionId); this._syncTriggerOwner(actor); continue; }
      this.soundEvents.laneIndex = actor.laneIndex;
      this._synchronizeLane(actor);
      this.soundEvents.laneIndex = actor.laneIndex;
      this._prepareActorTerrain(actor);
      if (!this.cohorts && this.tickIndex === 1) this.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN,
        { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: this.laneCount, x: actor.x, y: actor.y, spawnTick: actor.spawnTick, spawnPhaseTicks: actor.spawnPhaseTicks, presentationPhase: actor.laneIndex / this.laneCount });
      this._assistedColumn.valid = false;
      if (this.stall.phase === 'running') this._assist(actor);
      const previousX = actor.x, previousAction = actor.action; this._processingLane = actor.laneIndex;
      const next = actor.process(this);
      this._synchronizeLane(actor);
      this.soundEvents.laneIndex = actor.laneIndex;
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

      this.lanePolicy.observe(actor, previousAction, previousX);
      this._syncTriggerOwner(actor);
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
    this._processingLane = null; this.activeCount = activeCount;
    this.terrainGrowth?.update({ through: this.generatedThrough, frontiers: this.frontiers, lanes: this.stall.lanes, prepare: this._prepareGrowthChunk, reveal: this._revealGrowth });
    for (let laneIndex = 0; laneIndex < this.laneCount; laneIndex++) {
      const lane = this.stall.lanes[laneIndex]; lane.peakAlive = Math.max(lane.peakAlive, lane.alive);
      lane.populationPeak = Math.max(lane.populationPeak || 0, lane.alive);
      lane.admitted = Math.max(0, lane.spawned + (lane.transferredIn || 0) - (lane.transferredOut || 0));
      this._effectiveTerrainWork[laneIndex] = Math.min(65535, this.pendingTerrainWork[laneIndex] + (this.terrainGrowth?.pending[laneIndex] || 0));
      lane.lastTerrainActivityTick = this.terrainActivityTicks[laneIndex];
      if (!this.cohorts) lane.pendingTerrainWork = this._effectiveTerrainWork[laneIndex];
      if (!this.cohorts && this.frontiers[laneIndex] > lane.maxX) { lane.maxX = this.frontiers[laneIndex]; lane.lastProgressTick = this.tickIndex; }
    }
    this._applyManualNukes();
    if (this.cohorts) {
      this.stall.update(this.actors, this.tickIndex, this._stallWork);
      const dueIds = this.stall.takeDue(this.tickIndex);
      const due = dueIds.length ? new Set(dueIds) : null;
      if (due) for (const actor of this.actors) if (due.has(actor.id) && !actor.failureReason && !actor.terminalReason) {
        actor.setAction(this.actions[State.OHNO]);
        this.soundEvents.emitSfx(SoundEventTypes.LEMMING_OHNO, SoundEffectIds.OHNO, { lemmingId: actor.id, laneIndex: actor.laneIndex, laneCount: this.laneCount, x: actor.x, y: actor.y });
      }
      const previous = this.stall.consumeRestart();
      if (previous) this._restart(previous);
      else if (this.tickIndex % 54 === 0) this.actors = this.actors.filter(actor => !actor.failureReason && !actor.removed);
    }
    if (this.tickIndex % 32 === 0) this.hazards.prune(this.tickIndex);
    if (this.tickIndex % 128 === 0) this._pruneEdits();
    this._musicCompletedSlot = nextMusicSlot; this._musicCompletedTick = this.tickIndex;
    this.soundEvents.laneIndex = 0;
    this.timer.onGameTick.trigger(this.tickIndex);
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
      terrainGrowth: this.terrainGrowth?.snapshot() || null, generatedHazards: this.hazards.snapshot(), routePlanner: { ...this.hazardPlanner.stats, tunnels: { ...this.hazardPlanner.tunnels.stats }, descents: { ...this.hazardPlanner.descents.stats } },
      terrainGeneration: this.terrain?.getDebugState?.() || null, collisionResidentSlots: this._collisionSlots.length, residentCollisionMB: residentCollisionBytes / 1048576,
      frontierMargins: Array.from(this.generatedThrough, (x, lane) => x - this.frontiers[lane]),
      laneThemes: this.terrain?.laneThemes || null,
      terrainRecipe: this.terrain?.recipe.id || null, recipeMemoryMB: this.terrain?.memoryMB || 0,
      laneHeight: this.laneHeight, cachedChallenges: this.challengeCache.size, terrainEdits: this.editChunks.size,
      terrainEditStorage: this.editChunks.snapshot(), terrainRevisionStorage: this.terrainTileRevisions.snapshot(),
      terrainMemoryMB: this.editChunks.snapshot().totalBytes / 1048576,
      ...this.stats };
  }
  dispose() { this._manualNukeLanes.fill(0); for (const actor of this.actors) this._clearConstructionCrew(actor); this._musicActorPositions.clear(); this.triggerManager.dispose(); this.hazardPlanner.dispose(); this.lanePolicy.dispose(); this.terrainGrowth?.dispose(); this.edgeBlockers.fill(null); this.accessTasks.fill(null); this._edgeWallCache.fill(null); this._edgeWallHazards.length = 0; this.onRestart = null; this.onLaneTransfer = null; this.characterParticles?.clear(); this.timer.onGameTick.dispose(); this.soundEvents.onEvent.dispose(); this.editChunks.clear(); this.terrainTileRevisions.clear(); this.challengeCache.clear(); this._laneChunk.fill(null); this._collisionSlots.fill(null); this._laneEdits.fill(null); this._editCache.fill(null); this.terrain?.reset?.(); }
}

export { ProcgenLaneWorld, MAX_PROCGEN_LANES, LANE_HEIGHT, CHUNK_WIDTH, PROCGEN_LEFT_EDGE, normalizeLaneCount, DEFAULT_LANE_HEIGHT, MAX_LANE_HEIGHT, normalizeLaneHeight, DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy };
