import { ProcgenLaneWorld } from '../app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../lemmings/LemmingStateType.js';
import { assertSolverSnapshotSize } from './SolverState.js';
import { verifyActionReplay } from './SolverRunner.js';
import { createSolverResult } from './SolverTypes.js';
import { Trigger } from '../level/Trigger.js';
import { TriggerTypes as Types } from '../level/TriggerTypes.js';

const MAX_ENVIRONMENT_BLOCKERS = 8;
const SKILLS = Object.freeze({ builder: 'builders', basher: 'bashers', digger: 'diggers', miner: 'miners' });
const live = actor => !!actor && !actor.removed && !actor.failureReason && !actor.terminalReason && !actor.disabled;
const inside = (actor, rect) => Number.isFinite(actor.x) && Number.isFinite(actor.y) && actor.x >= rect.x && actor.x < rect.x + rect.width && actor.y >= rect.y && actor.y < rect.y + rect.height;
const rectangle = (value, name) => {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(value[key])) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1) throw new TypeError('Invalid ' + name);
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });
};

/** Real shared actions with a finite physical arrival goal; no automatic assistance or route hint. */
class ProcgenSolverAdapter {
  constructor({ createWorld, goal, bounds, skills = {}, environmentalBlockers = [], id = 'procgen-physical-goal', maxSnapshotPixels } = {}) {
    this.goal = rectangle(goal, 'procgen goal'); this.bounds = rectangle(bounds, 'procgen snapshot bounds');
    assertSolverSnapshotSize(this.bounds.width, this.bounds.height, { maxSnapshotPixels });
    if (this.goal.x < this.bounds.x || this.goal.y < this.bounds.y || this.goal.x + this.goal.width > this.bounds.x + this.bounds.width || this.goal.y + this.goal.height > this.bounds.y + this.bounds.height) throw new RangeError('Procgen goal must fit snapshot bounds');
    if (typeof createWorld !== 'function') throw new TypeError('Procgen replay requires a fresh world factory');
    this.world = createWorld(); this.id = String(id); this.kind = 'procgen';
    if (!(this.world instanceof ProcgenLaneWorld) || this.world.assists !== false || this.world.tickIndex !== 0) { this.world?.dispose?.(); throw new TypeError('Independent procgen replay requires a real world with assistance disabled'); }
    if (!Array.isArray(environmentalBlockers) || environmentalBlockers.length > MAX_ENVIRONMENT_BLOCKERS || new Set(environmentalBlockers).size !== environmentalBlockers.length || environmentalBlockers.some(id => !Number.isSafeInteger(id) || id < 0)) { this.world.dispose(); throw new RangeError('Invalid bounded environmental blocker ownership'); }
    this.environmentalBlockers = []; this.environmentalBlockersChanged = false;
    this._environmentSource = { terrain: this.world.terrain, runtime: this.world.runtime, triggerManager: this.world.triggerManager, blocking: this.world.actions[State.BLOCKING] };
    try {
      for (const id of environmentalBlockers) this._registerEnvironmentalBlocker(id);
    } catch (error) { this.world.dispose(); throw error; }
    this._environmentLaneTriggers = new Map();
    for (const record of this.environmentalBlockers) {
      const triggers = this._environmentLaneTriggers.get(record.lane) || []; triggers.push(...record.owned); this._environmentLaneTriggers.set(record.lane, triggers);
    }
    const environmentalIds = new Set(environmentalBlockers);
    this.initialActors = this.world.actors.filter(actor => !environmentalIds.has(actor.id) && live(actor));
    if (!this.initialActors.length || this.initialActors.length > 64 || this.initialActors.some(actor => actor.canClimb || actor.hasParachute || (!Number.isSafeInteger(actor.id) || actor.id < 0) || ![this.world.actions[State.WALKING], this.world.actions[State.FALLING]].includes(actor.action))) { this.world.dispose(); throw new RangeError('Procgen replay requires 1..64 ordinary actors with stable IDs'); }
    this.actorById = new Map(this.initialActors.map(actor => [actor.id, actor]));
    if (this.actorById.size !== this.initialActors.length || this.bounds.y + this.bounds.height > this.world.height || this.bounds.x + this.bounds.width > this.world.width || this.initialActors.some(actor => !inside(actor, this.bounds))) { this.world.dispose(); throw new RangeError('Invalid procgen replay actor identities or bounds'); }
    this.worldActors = [...this.world.actors];
    if (this.worldActors.length !== this.initialActors.length + this.environmentalBlockers.length) { this.world.dispose(); throw new RangeError('Procgen replay cannot omit initial goal actors'); }
    this.crewCount = this.initialActors.length; this.world.cohorts = false; this.world.admissionPaused = true; this.generation = this.world.generation; this.arrivals = new Set(); this.routeBoundsExceeded = false;
    this.goalDirection = this.goal.x + this.goal.width / 2 < this.initialActors.reduce((sum, actor) => sum + actor.x, 0) / this.crewCount ? -1 : 1;
    this.skills = Object.fromEntries(Object.keys(SKILLS).map(skill => [skill, 0]));
    for (const [skill, amount] of Object.entries(skills)) {
      if (!Object.hasOwn(SKILLS, skill) || !Number.isInteger(amount) || amount < 0 || amount > 64) { this.world.dispose(); throw new TypeError('Invalid joint procgen skill inventory'); }
      this.skills[skill] = amount;
    }
    this._lastObservedTick = this.tick; this.isRuntimeAuthoritative = true; this._observeGoal();
  }
  _registerEnvironmentalBlocker(id) {
    const matches = this.world.actors.filter(actor => actor.id === id), actor = matches[0], action = this.world.actions[State.BLOCKING];
    if (matches.length !== 1 || !live(actor) || actor.action !== action || actor.canClimb || actor.hasParachute || actor.countdown || actor.countdownAction || !Number.isSafeInteger(actor.x) || !Number.isSafeInteger(actor.y) || actor.laneIndex !== Math.floor(actor.y / this.world.laneHeight) || !inside(actor, this.bounds) || !this.world.hasGroundAt(actor.x, actor.y + 1)) throw new RangeError('Environmental blocker requires a live supported real BLOCKING owner');
    if (actor.state === 0) {
      if (this.world.triggerManager.byOwner.has(actor) || action.process(this.world, actor) !== State.NO_STATE_TYPE) throw new Error('Invalid environmental blocker registration');
    }
    const owned = this.world.triggerManager.byOwner.get(actor), expected = [
      [Types.BLOCKER_LEFT, actor.x - 6, actor.y - 10, actor.x - 3, actor.y + 4],
      [Types.BLOCKER_RIGHT, actor.x + 4, actor.y - 10, actor.x + 7, actor.y + 4]
    ];
    if (actor.state !== 1 || !owned || owned.length !== 2 || expected.some((rect, index) => {
      const trigger = owned[index]; return !(trigger instanceof Trigger) || trigger.owner !== actor || trigger.runtime !== this.world.runtime || trigger.disableTicksCount !== 0 || trigger.soundIndex !== 0 || trigger.disabledUntilTick > this.tick || rect[1] < this.bounds.x || rect[2] < this.bounds.y || rect[3] > this.bounds.x + this.bounds.width || rect[4] > this.bounds.y + this.bounds.height || rect.some((value, field) => trigger[['type', 'x1', 'y1', 'x2', 'y2'][field]] !== value);
    })) throw new Error('Environmental blocker requires exact shared directional triggers');
    this.environmentalBlockers.push({ actor, id: actor.id, owned, index: this.world.actors.indexOf(actor), x: actor.x, y: actor.y, lane: actor.laneIndex, direction: actor.lookRight,
      triggers: owned.map(trigger => ({ trigger, type: trigger.type, x1: trigger.x1, y1: trigger.y1, x2: trigger.x2, y2: trigger.y2 })) });
  }
  _observeEnvironment() {
    const source = this._environmentSource;
    if (this.world.actors.length !== this.worldActors.length || this.world.actors.some((actor, index) => actor !== this.worldActors[index])) this.environmentalBlockersChanged = true;
    if (this.environmentalBlockers.length && (this.world.terrain !== source.terrain || this.world.runtime !== source.runtime || this.world.triggerManager !== source.triggerManager || this.world.actions[State.BLOCKING] !== source.blocking)) { this.environmentalBlockersChanged = true; return; }
    if (this.world.triggerManager.byOwner.size !== this.environmentalBlockers.length) this.environmentalBlockersChanged = true;
    for (const [lane, triggers] of this._environmentLaneTriggers) {
      const bucket = this.world.triggerManager.byLane[lane];
      if (!bucket || bucket.length !== triggers.length || bucket.some((trigger, index) => trigger !== triggers[index])) this.environmentalBlockersChanged = true;
    }
    for (const record of this.environmentalBlockers) {
      const { actor, owned } = record;
      if (this.world.actors[record.index] !== actor || actor.id !== record.id || actor.runtime !== source.runtime || !live(actor) || actor.action !== this.world.actions[State.BLOCKING] || actor.state !== 1 || actor.x !== record.x || actor.y !== record.y || actor.laneIndex !== record.lane || actor.lookRight !== record.direction || actor.canClimb || actor.hasParachute || actor.countdown || actor.countdownAction || !this.world.hasGroundAt(actor.x, actor.y + 1) || this.world.triggerManager.byOwner.get(actor) !== owned || owned.length !== 2 || owned.lane !== record.lane || owned.x !== record.x || owned.y !== record.y || record.triggers.some(rect => {
        const trigger = rect.trigger;
        return owned.indexOf(trigger) < 0 || trigger.owner !== actor || trigger.runtime !== this.world.runtime || trigger.disableTicksCount !== 0 || trigger.soundIndex !== 0 || trigger.disabledUntilTick > this.tick || ['type', 'x1', 'y1', 'x2', 'y2'].some(field => trigger[field] !== rect[field]) || !this.world.triggerManager.byLane[record.lane]?.includes(trigger);
      })) this.environmentalBlockersChanged = true;
    }
  }
  _environmentSummary() {
    return this.environmentalBlockers.map(({ actor }) => ({ id: actor.id, kind: 'stationary-blocker', lookRight: actor.lookRight, x: actor.x, y: actor.y, lane: actor.laneIndex, dead: !live(actor),
      blocking: actor.action === this.world.actions[State.BLOCKING], triggers: (this.world.triggerManager?.byOwner?.get(actor) || []).map(trigger => ({ type: trigger.type, x1: trigger.x1, y1: trigger.y1, x2: trigger.x2, y2: trigger.y2 })) }));
  }
  getEnvironmentalBlockerRects() {
    this._observeEnvironment();
    return this.environmentalBlockersChanged ? [] : this.environmentalBlockers.flatMap(record => record.triggers.map(({ type, x1, y1, x2, y2 }) => ({ ownerId: record.actor.id, type, x1, y1, x2, y2 })));
  }
  get tick() { return this.world.tickIndex; }
  _observeGoal() {
    this._observeEnvironment();
    const goal = this.goal;
    for (const actor of this.initialActors) if (live(actor)) {
      if (!inside(actor, this.bounds)) this.routeBoundsExceeded = true;
      if (inside(actor, goal)) this.arrivals.add(actor.id);
    }
  }
  getActiveLemmings() { return this.initialActors.filter(live); }
  getSkillCount(skill) { return this.skills[skill] || 0; }
  selectLemming(target) {
    if (target && typeof target === 'object') target = target.id ?? target.role;
    if (target == null || ['first', 'lead', 'frontier'].includes(target)) return this.getActiveLemmings().sort((a, b) => this.goalDirection * (b.x - a.x) || a.id - b.id)[0] || null;
    const actor = this.actorById.get(Number(target)); return live(actor) ? actor : null;
  }
  applyAction(action = {}) {
    const skill = action.skillType ?? action.skill, actor = this.selectLemming(action.target ?? action.lemmingId);
    if (!actor || !Object.hasOwn(SKILLS, skill) || !this.skills[skill]) return { ok: false, applied: false, detail: 'unavailable-actor-or-skill' };
    const accepted = this.world.assignWorker(actor, SKILLS[skill]);
    if (accepted) this.skills[skill]--;
    return { ok: accepted, applied: accepted, skillType: skill, lemmingId: actor.id, detail: accepted ? null : 'shared-action-rejected' };
  }
  _advanceWithoutSummary(count = 1) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw new RangeError('Procgen replay step count must be 1..4096');
    if (this.world.assists !== false || this.world.cohorts || !this.world.admissionPaused || this.world.generation !== this.generation || this.world.actors.length !== this.worldActors.length || this.world.actors.some((actor, index) => actor !== this.worldActors[index]) || this.tick !== this._lastObservedTick) throw new Error('Independent procgen replay cannot enable assistance, restart or add admissions');
    for (let step = 0; step < count; step++) {
      this.world.step();
      if (this.tick !== this._lastObservedTick + 1) throw new Error('Independent procgen replay cannot reset ticks');
      this._lastObservedTick = this.tick; this._observeGoal();
    }
  }
  step(count = 1) { this._advanceWithoutSummary(count); return this.getFinalStateSummary(); }
  isTerminal() { this._observeEnvironment(); return this.environmentalBlockersChanged || this.routeBoundsExceeded || this.getActiveLemmings().length < this.crewCount || this.getSavedCount() === this.crewCount; }
  getSavedCount() { return this.initialActors.filter(actor => live(actor) && this.arrivals.has(actor.id)).length; }
  getFinalStateSummary() {
    this._observeEnvironment();
    const savedCount = this.getSavedCount(), active = this.getActiveLemmings();
    return { id: this.id, tick: this.tick, goalKind: 'physical-region', exitRescues: false, goal: { ...this.goal },
      needCount: this.crewCount, releaseCount: this.crewCount, leftCount: 0, outCount: active.length, activeCount: active.length,
      savedCount, goalReachedCount: savedCount, deadCount: this.crewCount - active.length, skills: { ...this.skills },
      lemmings: this.initialActors.map(actor => ({ id: actor.id, x: actor.x, y: actor.y, lookRight: actor.lookRight,
        action: Object.keys(this.world.actions).find(key => this.world.actions[key] === actor.action) ?? null,
        dead: !live(actor), saved: live(actor) && this.arrivals.has(actor.id), removed: actor.removed, disabled: actor.disabled })),
      environmentalBlockerCount: this.environmentalBlockers.length, environmentalBlockers: this._environmentSummary(), environmentalBlockersChanged: this.environmentalBlockersChanged, totalActorCount: this.world.actors.length,
      routeBoundsExceeded: this.routeBoundsExceeded, terrainRevision: this.world.terrainRevision, laneTransfers: this.world.stats.laneTransfers, hazardContacts: this.world.hazards.stats.contacts };
  }
  snapshot() {
    const { x, y, width, height } = this.bounds, groundMask = new Uint8Array(width * height), steelMask = new Uint8Array(width * height);
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const lane = Math.floor((py + y) / this.world.laneHeight);
      if (this.world.terrainGrowth && px + x >= this.world.generatedThrough[lane]) throw new Error('Procgen snapshot includes unrevealed geometry');
      const at = py * width + px; groundMask[at] = Number(this.world.hasGroundAt(px + x, py + y)); steelMask[at] = Number(this.world.hasSteelAt(px + x, py + y));
    }
    const hazards = [];
    if (this.world.terrain?.objects?.length && this.world.terrain.describe) {
      const chunkWidth = this.world.terrain.chunkWidth;
      for (let lane = Math.floor(y / this.world.laneHeight); lane <= Math.floor((y + height - 1) / this.world.laneHeight); lane++) for (let chunk = Math.floor(x / chunkWidth); chunk <= Math.floor((x + width - 1) / chunkWidth); chunk++) {
        for (const object of this.world.terrain.describe(this.world.laneSeeds[lane], chunk).objects) {
          if (hazards.length >= 512) throw new RangeError('Procgen snapshot source-object budget exceeded');
          const image = object.piece.image;
          hazards.push({ lane, chunk, id: object.piece.id, x: object.x, y: object.y, role: object.role, supportY: object.supportY,
            trigger: [image.trigger_effect_id, image.trigger_left, image.trigger_top, image.trigger_width, image.trigger_height, image.frameCount] });
        }
      }
    }
    if (!this._protectedCells) {
      let count = 0; for (const bit of steelMask) count += bit;
      this._protectedCells = new Uint32Array(count);
      for (let at = 0, next = 0; at < steelMask.length; at++) if (steelMask[at]) this._protectedCells[next++] = at * 2 + groundMask[at];
    }
    return { kind: 'procgen', id: this.id, width, height, groundMask, steelMask, hazards, environmentalBlockers: this._environmentSummary(),
      source: { assetSha256: this.world.terrain?.recipe?.assetSha256 ?? null, sourceRevision: this.world.terrain?.sourceDescriptor?.sourceRevision ?? null, seed: this.world.seed, generation: this.world.generation, laneHeight: this.world.laneHeight, laneSeeds: Array.from(this.world.laneSeeds) }, workerLimits: { ...this.world.workerLimits }, skills: { ...this.skills },
      lemmings: this.getFinalStateSummary().lemmings.map(actor => ({ ...actor, x: actor.x - x, y: actor.y - y })),
      exits: [{ ...this.goal, x: this.goal.x - x, y: this.goal.y - y, kind: 'physical-region' }], needCount: this.crewCount,
      timer: { tick: this.tick }, sourceOffset: { x, y }, goalKind: 'physical-region' };
  }
  protectedTerrainUnchanged() {
    if (!this._protectedCells) throw new Error('Protected terrain must be captured before replay');
    const { x, y, width } = this.bounds;
    for (const cell of this._protectedCells) {
      const at = Math.floor(cell / 2), px = x + at % width, py = y + Math.floor(at / width);
      if (!this.world.hasSteelAt(px, py) || Number(this.world.hasGroundAt(px, py)) !== (cell & 1)) return false;
    }
    return true;
  }
  dispose() { this.world.dispose(); this.actorById.clear(); this.arrivals.clear(); this._protectedCells = null; this.environmentalBlockers.length = 0; this._environmentLaneTriggers.clear(); this.worldActors.length = 0; }
}

const replayProcgenGoal = (factory, actions = [], options = {}) => {
  const adapter = factory();
  if (!(adapter instanceof ProcgenSolverAdapter)) throw new TypeError('Procgen goal replay requires the real adapter');
  try {
    adapter.snapshot();
    const replay = verifyActionReplay({ kind: 'procgen', adapter }, actions, { ...options, targetSaveCount: adapter.crewCount });
    const protectedTerrainUnchanged = adapter.protectedTerrainUnchanged(), guardsPassed = protectedTerrainUnchanged && !adapter.routeBoundsExceeded && !adapter.environmentalBlockersChanged;
    return createSolverResult({ ...replay, resultType: guardsPassed ? replay.resultType : 'failed',
      summary: guardsPassed ? replay.summary : !protectedTerrainUnchanged ? 'Replay altered protected terrain' : adapter.environmentalBlockersChanged ? 'Replay changed its environmental blocker ownership' : 'Replay left declared route geometry',
      replaySummary: { ...replay.replaySummary, protectedTerrainUnchanged, verified: guardsPassed && replay.replaySummary.verified } });
  }
  finally { adapter.dispose(); }
};
export { MAX_ENVIRONMENT_BLOCKERS, ProcgenSolverAdapter, replayProcgenGoal };
