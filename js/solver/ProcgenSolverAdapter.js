import { ProcgenLaneWorld } from '../app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../lemmings/LemmingStateType.js';
import { assertSolverSnapshotSize } from './SolverState.js';
import { verifyActionReplay } from './SolverRunner.js';
import { createSolverResult } from './SolverTypes.js';

const SKILLS = Object.freeze({ builder: 'builders', basher: 'bashers', digger: 'diggers', miner: 'miners' });
const live = actor => !!actor && !actor.removed && !actor.failureReason && !actor.terminalReason && !actor.disabled;
const inside = (actor, rect) => Number.isFinite(actor.x) && Number.isFinite(actor.y) && actor.x >= rect.x && actor.x < rect.x + rect.width && actor.y >= rect.y && actor.y < rect.y + rect.height;
const rectangle = (value, name) => {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(value[key])) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1) throw new TypeError('Invalid ' + name);
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });
};

/** Real shared actions with a finite physical arrival goal; no automatic assistance or route hint. */
class ProcgenSolverAdapter {
  constructor({ createWorld, goal, bounds, skills = {}, id = 'procgen-physical-goal', maxSnapshotPixels } = {}) {
    this.goal = rectangle(goal, 'procgen goal'); this.bounds = rectangle(bounds, 'procgen snapshot bounds');
    assertSolverSnapshotSize(this.bounds.width, this.bounds.height, { maxSnapshotPixels });
    if (this.goal.x < this.bounds.x || this.goal.y < this.bounds.y || this.goal.x + this.goal.width > this.bounds.x + this.bounds.width || this.goal.y + this.goal.height > this.bounds.y + this.bounds.height) throw new RangeError('Procgen goal must fit snapshot bounds');
    if (typeof createWorld !== 'function') throw new TypeError('Procgen replay requires a fresh world factory');
    this.world = createWorld(); this.id = String(id); this.kind = 'procgen';
    if (!(this.world instanceof ProcgenLaneWorld) || this.world.assists !== false || this.world.tickIndex !== 0) { this.world?.dispose?.(); throw new TypeError('Independent procgen replay requires a real world with assistance disabled'); }
    this.initialActors = this.world.actors.filter(live);
    if (!this.initialActors.length || this.initialActors.length > 64 || this.initialActors.some(actor => actor.canClimb || actor.hasParachute || (!Number.isSafeInteger(actor.id) || actor.id < 0) || ![this.world.actions[State.WALKING], this.world.actions[State.FALLING]].includes(actor.action))) { this.world.dispose(); throw new RangeError('Procgen replay requires 1..64 ordinary actors with stable IDs'); }
    this.actorById = new Map(this.initialActors.map(actor => [actor.id, actor]));
    if (this.actorById.size !== this.initialActors.length || this.bounds.y + this.bounds.height > this.world.height || this.bounds.x + this.bounds.width > this.world.width || this.initialActors.some(actor => !inside(actor, this.bounds))) { this.world.dispose(); throw new RangeError('Invalid procgen replay actor identities or bounds'); }
    this.crewCount = this.initialActors.length; this.world.cohorts = false; this.world.admissionPaused = true; this.generation = this.world.generation; this.arrivals = new Set(); this.routeBoundsExceeded = false;
    this.goalDirection = this.goal.x + this.goal.width / 2 < this.initialActors.reduce((sum, actor) => sum + actor.x, 0) / this.crewCount ? -1 : 1;
    this.skills = Object.fromEntries(Object.keys(SKILLS).map(skill => [skill, 0]));
    for (const [skill, amount] of Object.entries(skills)) {
      if (!Object.hasOwn(SKILLS, skill) || !Number.isInteger(amount) || amount < 0 || amount > 64) { this.world.dispose(); throw new TypeError('Invalid joint procgen skill inventory'); }
      this.skills[skill] = amount;
    }
    this.isRuntimeAuthoritative = true; this._observeGoal();
  }
  get tick() { return this.world.tickIndex; }
  _observeGoal() {
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
    if (this.world.assists !== false || this.world.cohorts || !this.world.admissionPaused || this.world.generation !== this.generation || this.world.actors.length !== this.crewCount) throw new Error('Independent procgen replay cannot enable assistance, restart or add admissions');
    for (let step = 0; step < count; step++) { this.world.step(); this._observeGoal(); }
  }
  step(count = 1) { this._advanceWithoutSummary(count); return this.getFinalStateSummary(); }
  isTerminal() { return this.routeBoundsExceeded || this.getActiveLemmings().length < this.crewCount || this.getSavedCount() === this.crewCount; }
  getSavedCount() { return this.initialActors.filter(actor => live(actor) && this.arrivals.has(actor.id)).length; }
  getFinalStateSummary() {
    const savedCount = this.getSavedCount(), active = this.getActiveLemmings();
    return { id: this.id, tick: this.tick, goalKind: 'physical-region', exitRescues: false, goal: { ...this.goal },
      needCount: this.crewCount, releaseCount: this.crewCount, leftCount: 0, outCount: active.length, activeCount: active.length,
      savedCount, goalReachedCount: savedCount, deadCount: this.crewCount - active.length, skills: { ...this.skills },
      lemmings: this.initialActors.map(actor => ({ id: actor.id, x: actor.x, y: actor.y, lookRight: actor.lookRight,
        action: Object.keys(this.world.actions).find(key => this.world.actions[key] === actor.action) ?? null,
        dead: !live(actor), saved: live(actor) && this.arrivals.has(actor.id), removed: actor.removed, disabled: actor.disabled })),
      routeBoundsExceeded: this.routeBoundsExceeded, terrainRevision: this.world.terrainRevision, laneTransfers: this.world.stats.laneTransfers, hazardContacts: this.world.hazards.stats.contacts };
  }
  snapshot() {
    const { x, y, width, height } = this.bounds, groundMask = new Uint8Array(width * height), steelMask = new Uint8Array(width * height);
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const lane = Math.floor((py + y) / 96);
      if (this.world.terrainGrowth && px + x >= this.world.generatedThrough[lane]) throw new Error('Procgen snapshot includes unrevealed geometry');
      const at = py * width + px; groundMask[at] = Number(this.world.hasGroundAt(px + x, py + y)); steelMask[at] = Number(this.world.hasSteelAt(px + x, py + y));
    }
    const hazards = [];
    if (this.world.terrain?.objects?.length && this.world.terrain.describe) {
      const chunkWidth = this.world.terrain.chunkWidth;
      for (let lane = Math.floor(y / 96); lane <= Math.floor((y + height - 1) / 96); lane++) for (let chunk = Math.floor(x / chunkWidth); chunk <= Math.floor((x + width - 1) / chunkWidth); chunk++) {
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
    return { kind: 'procgen', id: this.id, width, height, groundMask, steelMask, hazards,
      source: { assetSha256: this.world.terrain?.recipe?.assetSha256 ?? null, sourceRevision: this.world.terrain?.sourceDescriptor?.sourceRevision ?? null, seed: this.world.seed, generation: this.world.generation, laneSeeds: Array.from(this.world.laneSeeds) }, workerLimits: { ...this.world.workerLimits }, skills: { ...this.skills },
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
  dispose() { this.world.dispose(); this.actorById.clear(); this.arrivals.clear(); this._protectedCells = null; }
}

const replayProcgenGoal = (factory, actions = [], options = {}) => {
  const adapter = factory();
  if (!(adapter instanceof ProcgenSolverAdapter)) throw new TypeError('Procgen goal replay requires the real adapter');
  try {
    adapter.snapshot();
    const replay = verifyActionReplay({ kind: 'procgen', adapter }, actions, { ...options, targetSaveCount: adapter.crewCount });
    const protectedTerrainUnchanged = adapter.protectedTerrainUnchanged(), guardsPassed = protectedTerrainUnchanged && !adapter.routeBoundsExceeded;
    return createSolverResult({ ...replay, resultType: guardsPassed ? replay.resultType : 'failed',
      summary: guardsPassed ? replay.summary : !protectedTerrainUnchanged ? 'Replay altered protected terrain' : 'Replay left declared route geometry',
      replaySummary: { ...replay.replaySummary, protectedTerrainUnchanged, verified: guardsPassed && replay.replaySummary.verified } });
  }
  finally { adapter.dispose(); }
};
export { ProcgenSolverAdapter, replayProcgenGoal };
