import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionClimbSystem } from '../../actions/ActionClimbSystem.js';
import { ActionHoistSystem } from '../../actions/ActionHoistSystem.js';
import { ActionOhNoSystem } from '../../actions/ActionOhNoSystem.js';
import { ActionExplodingSystem } from '../../actions/ActionExplodingSystem.js';
import { ProcgenStallPolicy, DEFAULT_STALL_POLICY } from './ProcgenStallPolicy.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { SoundEventBus, SoundEventTypes, SoundEffectIds } from '../../game/SoundEvents.js';
import { EventHandler } from '../../util/EventHandler.js';
import { normalizeSeed } from '../../core/seededRandom.js';

const MAX_PROCGEN_LANES = 1024;
const LANE_HEIGHT = 96;
const CHUNK_WIDTH = 256;
const EDIT_CHUNK_WIDTH = 32;
const normalizeLaneCount = value => Math.max(1, Math.min(MAX_PROCGEN_LANES, Math.trunc(Number(value)) || 1));
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

// Terrain is queried in one shared coordinate system. No world-sized bitmap,
// per-lane Game, or rendering dependency is needed by the real action systems.
class ProcgenLaneWorld {
  constructor({ laneCount = 1, seed = 1, sprites = null, masks, assists = true, speed = 3, cohorts = false, spawnSpreadTicks = 0, maxActors = 16384, stallPolicy = {}, previousDistances = [], particleTable = null, terrain = null } = {}) {
    this.laneCount = normalizeLaneCount(laneCount);
    this.seed = normalizeSeed(seed);
    this.width = 0x3fffffff;
    this.height = this.laneCount * LANE_HEIGHT;
    this.tickIndex = 0;
    this.assists = assists;
    this.terrain = terrain;
    this.cohorts = cohorts;
    this.spawnSpreadTicks = Math.max(0, Math.min(53, Math.trunc(spawnSpreadTicks)));
    this.maxActors = Math.max(this.laneCount, maxActors);
    this.admissionPaused = false;
    this.nextActorId = 0;
    this.generation = 1;
    this.generationStartTick = 0;
    this.spawnedTotal = 0;
    this.stall = new ProcgenStallPolicy(this.laneCount, stallPolicy, previousDistances);
    this.failureReasons = {};
    this.editChunks = new Map();
    this.challengeCache = new Map();
    this.challengeCacheLimit = Math.max(128, this.laneCount * 8);
    this.laneSeeds = Uint32Array.from({ length: this.laneCount }, (_, lane) => mix(this.seed ^ Math.imul(lane + 1, 0x9e3779b1)));
    this.timer = { frameTime: 60, speedFactor: speed, onGameTick: new EventHandler(), getGameTicks: () => this.tickIndex };
    this.soundEvents = new SoundEventBus(this.timer);
    this.soundEvents._queueLimit = 0;
    const runtime = { soundEvents: this.soundEvents };
    this.runtime = runtime;
    this.actions = {
      [State.WALKING]: new ActionWalkSystem(sprites), [State.FALLING]: new ActionFallSystem(sprites),
      [State.JUMPING]: new ActionJumpSystem(sprites), [State.BUILDING]: new ActionBuildSystem(sprites),
      [State.BASHING]: new ActionBashSystem(sprites, masks), [State.SHRUG]: new ActionShrugSystem(sprites),
      [State.CLIMBING]: new ActionClimbSystem(sprites), [State.HOISTING]: new ActionHoistSystem(sprites),
      [State.OHNO]: new ActionOhNoSystem(sprites),
      [State.EXPLODING]: new ActionExplodingSystem(sprites, masks, { removeByOwner() {} }, particleTable)
    };
    for (const action of Object.values(this.actions)) action.setRuntime(runtime);
    this.actors = [];
    if (!cohorts) for (let lane = 0; lane < this.laneCount; lane++) this._spawn(lane, false);
    this.stats = { builds: 0, bashes: 0, turns: 0, failures: 0, groundQueries: 0, removedPixels: 0 };
  }


  _spawn(lane, emit = true) {
    const actor = new Lemming(36, lane * LANE_HEIGHT + 42, this.nextActorId++, this.runtime);
    actor.appearanceIndex = lane;
    actor.laneIndex = lane;
    actor.lastProgressTick = this.tickIndex;
    actor.furthestX = actor.x;
    actor.assists = 0;
    actor.failureReason = null;
    actor.setAction(this.actions[State.FALLING]);
    this.actors.push(actor);
    this.stall.spawn(lane); this.spawnedTotal++;
    if (emit) this.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN,
      { lemmingId: actor.id, x: actor.x, y: actor.y, presentationPhase: lane / this.laneCount });
    return actor;
  }
  _spawnCohort() {
    if (!this.cohorts || this.stall.phase !== 'running') return;
    const age = this.tickIndex - this.generationStartTick - 1;
    const interval = this.stall.settings.releaseIntervalTicks || DEFAULT_STALL_POLICY.releaseIntervalTicks;
    const phase = age % interval;
    this.admissionPaused = this.actors.length >= this.maxActors;
    for (let lane = 0; lane < this.laneCount; lane++) {
      if (Math.floor(lane * this.spawnSpreadTicks / this.laneCount) !== phase) continue;
      const state = this.stall.lanes[lane];
      const stalledLongEnough = this.tickIndex - state.lastProgressTick >= this.stall.settings.secondsWithoutProgress * this.stall.settings.ticksPerSecond;
      const reservedProbe = stalledLongEnough && state.spawnsSinceProgress < this.stall.allowance(state);
      if (this.actors.length >= this.maxActors && !reservedProbe) { this.admissionPaused = true; continue; }
      this._spawn(lane);
    }
  }
  _restart(previousDistances) {
    this.actors.length = 0; this.editChunks.clear(); this.challengeCache.clear(); this.generation++; this.generationStartTick = this.tickIndex;
    for (let lane = 0; lane < this.laneCount; lane++) this.laneSeeds[lane] = mix(this.seed ^ Math.imul(lane + 1, 0x9e3779b1) ^ Math.imul(this.generation - 1, 0x85ebca6b));
    this.stall = new ProcgenStallPolicy(this.laneCount, this.stall.settings, previousDistances);
    for (const lane of this.stall.lanes) lane.lastProgressTick = this.tickIndex;
  }

  getGameTimer() { return this.timer; }
  getGroundMaskLayer() { return this; }
  getLemmingManager() { return { lemmings: this.actors, activeLemmings: this.actors }; }
  get level() { return this; }

  chunkCode(lane, chunk) { return mix(this.laneSeeds[lane] ^ Math.imul(chunk + 1, 0x85ebca6b)); }
  surfaceAt(lane, x) {
    if (this.terrain) return lane * LANE_HEIGHT + this.terrain.surface(this.laneSeeds[lane], x);
    const p = ((x % CHUNK_WIDTH) + CHUNK_WIDTH) % CHUNK_WIDTH;
    const code = this.chunkCode(lane, Math.floor(x / CHUNK_WIDTH));
    const rise = Math.max(0, Math.min(Math.floor((p - 40) / 4), Math.floor((116 - p) / 4), 6 + code % 5));
    return lane * LANE_HEIGHT + 72 - rise;
  }
  challengeAt(lane, x) {
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
  basePixelAt(x, y) {
    const lane = Math.floor(y / LANE_HEIGHT);
    if (!this.terrain || lane < 0 || lane >= this.laneCount || x < 0) return 0;
    const challenge = this.challengeAt(lane, x);
    if (x >= challenge.gapX && x < challenge.gapX + challenge.gapWidth) return 0;
    const localY = y % LANE_HEIGHT, seed = this.laneSeeds[lane];
    const wall = challenge.barrierWidth ? this.terrain.barrier(seed, x, localY, challenge.barrierX, this.terrain.surface(seed, challenge.barrierX)) : 0;
    return wall || this.terrain.sample(seed, x, localY);
  }
  baseGroundAt(x, y) {
    if (this.terrain) return this.basePixelAt(x, y) ? 1 : 0;
    const lane = Math.floor(y / LANE_HEIGHT);
    if (lane < 0 || lane >= this.laneCount || x < 0) return 0;
    const p = x % CHUNK_WIDTH, code = this.chunkCode(lane, Math.floor(x / CHUNK_WIDTH));
    const gapX = 210 + (code >>> 8) % 5;
    if (p >= gapX && p < gapX + 4 + (code >>> 12) % 3) return 0;
    const surface = this.surfaceAt(lane, x);
    if (y >= surface && y < lane * LANE_HEIGHT + 84) return 1;
    const barrierX = 142 + code % 9;
    return p >= barrierX && p < barrierX + 8 + (code >>> 4) % 9 && y >= surface - 13 && y < surface ? 2 : 0;
  }
  _editKey(x, y) { return Math.floor(y / LANE_HEIGHT) * 0x2000000 + Math.floor(x / EDIT_CHUNK_WIDTH); }
  groundColorAt(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    const edits = this.editChunks.get(this._editKey(x, y));
    const index = (y % LANE_HEIGHT) * EDIT_CHUNK_WIDTH + x % EDIT_CHUNK_WIDTH;
    return edits && edits[index] ? Math.max(0, edits[index] - 1) : this.baseGroundAt(x, y);
  }
  groundPixelAt(x, y) {
    const color = this.groundColorAt(x, y);
    return color === 3 ? 0xff86cbea : color ? this.basePixelAt(x, y) : 0;
  }
  hasGroundAt(x, y) { this.stats.groundQueries++; return this.groundColorAt(x, y) > 0; }
  getColumnStepHeight(x, yTop, height) {
    for (let i = 0; i < height; i++) if (!this.hasGroundAt(x, yTop + height - 1 - i)) return i;
    return height;
  }
  getColumnGapDepth(x, yTop, height) {
    for (let i = 0; i < height; i++) if (this.hasGroundAt(x, yTop + i)) return i + 1;
    return height + 1;
  }
  _setPixel(x, y, color) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const key = this._editKey(x, y);
    let chunk = this.editChunks.get(key);
    if (!chunk) { chunk = new Uint8Array(EDIT_CHUNK_WIDTH * LANE_HEIGHT); this.editChunks.set(key, chunk); }
    chunk[(y % LANE_HEIGHT) * EDIT_CHUNK_WIDTH + x % EDIT_CHUNK_WIDTH] = color + 1;
  }
  setGroundAt(x, y) { this._setPixel(x, y, 3); }
  isArrowAt() { return false; }
  hasSteelUnderMask() { return false; }
  hasArrowUnderMask() { return false; }
  clearGroundWithMaskCount(mask, x, y) {
    let removed = 0;
    for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) {
      const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy;
      if (!mask.at(dx, dy) && this.hasGroundAt(px, py)) { this._setPixel(px, py, 0); removed++; }
    }
    this.stats.removedPixels += removed;
    return removed;
  }
  clearGroundWithMask(mask, x, y) { this.clearGroundWithMaskCount(mask, x, y); }

  _assist(actor) {
    if (!this.assists || (actor.action !== this.actions[State.WALKING] && actor.action !== this.actions[State.BASHING])) return;
    const x = actor.x, y = actor.y;
    const gap = this.challengeAt(actor.laneIndex, x);
    if (gap.gapWidth > 0 && x >= gap.gapX - 5 && x < gap.gapX && y >= this.surfaceAt(actor.laneIndex, x) - 2 && !this.hasGroundAt(x + 5, y + 1)) {
      actor.lookRight = true;
      actor.setAction(this.actions[State.BUILDING]); this.stats.builds++; actor.assists++;
      return;
    }
    if (actor.action !== this.actions[State.WALKING]) return;
    if (!actor.lookRight) { actor.lookRight = true; this.stats.turns++; }
    if (this.getColumnStepHeight(x + 1, y - 7, 8) === 8) {
      if (this.terrain && (!gap.barrierWidth || x < gap.barrierX - 2 || x > gap.barrierX + 32)) {
        if (!actor.canClimb) { actor.canClimb = true; actor.assists++; }
      } else { actor.setAction(this.actions[State.BASHING]); this.stats.bashes++; actor.assists++; }
    }
  }
  step() {
    this.tickIndex++;
    this._spawnCohort();
    for (const actor of this.actors) {
      if (actor.failureReason) continue;
      if (!this.cohorts && this.tickIndex === 1) this.soundEvents.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN,
        { lemmingId: actor.id, x: actor.x, y: actor.y, presentationPhase: actor.laneIndex / this.laneCount });
      if (this.stall.phase === 'running') this._assist(actor);
      const next = actor.process(this);
      if (next !== State.NO_STATE_TYPE && next !== State.JUMPING) {
        if (this.actions[next]) actor.setAction(this.actions[next]);
        else { actor.failureReason = next === State.SPLATTING ? 'unsafe-fall' : actor.action === this.actions[State.EXPLODING] ? 'cascade-complete' : 'out-of-world'; this.stats.failures++; this.failureReasons[actor.failureReason] = (this.failureReasons[actor.failureReason] || 0) + 1; }
      } else if (next === State.JUMPING && actor.action !== this.actions[next]) actor.setAction(this.actions[next]);
      if (actor.y >= (actor.laneIndex + 1) * LANE_HEIGHT) actor.leftIndependentRoute = true;
      if (actor.x > actor.furthestX) { actor.furthestX = actor.x; actor.lastProgressTick = this.tickIndex; }
    }
    if (this.cohorts) {
      this.stall.update(this.actors, this.tickIndex);
      const dueIds = this.stall.takeDue(this.tickIndex);
      const due = dueIds.length ? new Set(dueIds) : null;
      if (due) for (const actor of this.actors) if (due.has(actor.id) && !actor.failureReason) {
        actor.setAction(this.actions[State.OHNO]);
        this.soundEvents.emitSfx(SoundEventTypes.LEMMING_OHNO, SoundEffectIds.OHNO, { lemmingId: actor.id, x: actor.x, y: actor.y });
      }
      const previous = this.stall.consumeRestart();
      if (previous) this._restart(previous);
      else if (this.tickIndex % 54 === 0) this.actors = this.actors.filter(actor => !actor.failureReason);
    }
    if (this.tickIndex % 128 === 0) this._pruneEdits();
    this.timer.onGameTick.trigger(this.tickIndex);
  }
  _pruneEdits() {
    const minimums = new Float64Array(this.laneCount); minimums.fill(Infinity);
    for (const actor of this.actors) if (!actor.failureReason) minimums[actor.laneIndex] = Math.min(minimums[actor.laneIndex], actor.x);
    for (const key of this.editChunks.keys()) {
      const lane = Math.floor(key / 0x2000000), chunkX = (key % 0x2000000) * EDIT_CHUNK_WIDTH;
      if (chunkX + EDIT_CHUNK_WIDTH < minimums[lane] - 128) this.editChunks.delete(key);
    }
  }
  getDebugState() {
    let minDistance = Infinity, maxDistance = 0, distance = 0, stalled = 0, alive = 0;
    const failureReasons = {};
    for (const actor of this.actors) {
      const d = Math.max(0, actor.furthestX - 36);
      minDistance = Math.min(minDistance, d); maxDistance = Math.max(maxDistance, d); distance += d;
      if (!actor.failureReason) alive++;
      else failureReasons[actor.failureReason] = (failureReasons[actor.failureReason] || 0) + 1;
      if (!actor.failureReason && this.tickIndex - actor.lastProgressTick > 240) stalled++;
    }
    return { mode: 'shared-lanes', seed: this.seed, lanes: this.laneCount, tick: this.tickIndex,
      alive, survival: alive / Math.max(1, this.spawnedTotal), stalled, failureReasons: this.cohorts ? { ...this.failureReasons } : failureReasons,
      generation: this.generation, spawnedTotal: this.spawnedTotal, admissionPaused: this.admissionPaused, maxActors: this.maxActors,
      stall: this.cohorts ? this.stall.snapshot(this.tickIndex) : null,
      distance: { min: Number.isFinite(minDistance) ? minDistance : 0, max: maxDistance, mean: distance / Math.max(1, this.actors.length) },
      terrainRecipe: this.terrain?.recipe.id || null, recipeMemoryMB: this.terrain?.memoryMB || 0,
      cachedChallenges: this.challengeCache.size, terrainEdits: this.editChunks.size, terrainMemoryMB: this.editChunks.size * EDIT_CHUNK_WIDTH * LANE_HEIGHT / 1048576,
      ...this.stats };
  }
  dispose() { this.timer.onGameTick.dispose(); this.soundEvents.onEvent.dispose(); this.editChunks.clear(); this.challengeCache.clear(); }
}

export { ProcgenLaneWorld, MAX_PROCGEN_LANES, LANE_HEIGHT, CHUNK_WIDTH, normalizeLaneCount };
