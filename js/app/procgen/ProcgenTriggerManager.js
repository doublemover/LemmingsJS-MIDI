import { TriggerTypes as Types } from '../../level/TriggerTypes.js';
const CELL_WIDTH = 32, MAX_RECT_CELLS = 8;
const INDEX_BYTES_PER_ACTOR = 2 * 384 + 2 * MAX_RECT_CELLS * 96;
const INDEX_FIELDS = Object.freeze(['spatial', 'wide', 'triggerRecords', 'indexStats', 'retainedCells']);

// Source hazards retain their chunk owners; blockers use the actual actor as
// owner and only two small directional rectangles, never a dense world grid.
class ProcgenTriggerManager {
  constructor(world, hazards) {
    this.world = world; this.hazards = hazards;
    this.byOwner = new Map(); this.byLane = new Array(world.laneCount);
    this.spatial = new Array(world.laneCount); this.wide = new Array(world.laneCount); this.triggerRecords = new Map();
    this.nextOrder = 0; this.retainedCells = 0;
    this.indexStats = { blockerCandidates: 0, exactRectangleTests: 0, membershipMoves: 0, peakCells: 0, queryAllocations: 0 };
  }
  _index(trigger, lane, index) {
    if (!Number.isSafeInteger(trigger._procgenTriggerOrder) || trigger._procgenTriggerOrder < 0) trigger._procgenTriggerOrder = this.nextOrder++;
    this.nextOrder = Math.max(this.nextOrder, trigger._procgenTriggerOrder + 1);
    const record = { lane, index, cells: [], wide: false };
    const first = Math.floor(trigger.x1 / CELL_WIDTH), last = Math.ceil(trigger.x2 / CELL_WIDTH) - 1;
    if (!Number.isFinite(first) || !Number.isFinite(last) || last - first + 1 > MAX_RECT_CELLS) {
      (this.wide[lane] ||= new Set()).add(trigger); record.wide = true;
    } else for (let cell = first; cell <= last; cell++) {
      const row = this.spatial[lane] ||= new Map(); let bucket = row.get(cell);
      if (!bucket) { bucket = new Set(); row.set(cell, bucket); this.retainedCells++; }
      bucket.add(trigger); record.cells.push(cell);
    }
    this.triggerRecords.set(trigger, record); this.indexStats.membershipMoves++;
    this.indexStats.peakCells = Math.max(this.indexStats.peakCells, this.retainedCells);
  }
  _unindex(trigger) {
    const record = this.triggerRecords.get(trigger); if (!record) return;
    if (record.wide) this.wide[record.lane]?.delete(trigger);
    for (const cell of record.cells) {
      const row = this.spatial[record.lane], bucket = row?.get(cell); bucket?.delete(trigger);
      if (bucket?.size === 0) { row.delete(cell); this.retainedCells--; }
    }
    this.triggerRecords.delete(trigger);
  }
  _removeRow(trigger) {
    const record = this.triggerRecords.get(trigger); if (!record) return;
    const row = this.byLane[record.lane], moved = row.at(-1);
    row[record.index] = moved; row.pop();
    if (moved !== trigger) this.triggerRecords.get(moved).index = record.index;
    this._unindex(trigger);
  }
  getLaneTriggers(lane, observationLimit = 64) {
    const row = this.byLane[lane] || [];
    return row.length > observationLimit ? row : row.slice().sort((a, b) => a._procgenTriggerOrder - b._procgenTriggerOrder);
  }
  add(trigger) {
    const owner = trigger.owner, lane = owner?.laneIndex;
    if (![Types.BLOCKER_LEFT, Types.BLOCKER_RIGHT].includes(trigger.type) || !Number.isInteger(lane) || lane < 0 || lane >= this.byLane.length) return;
    let owned = this.byOwner.get(owner);
    if (!owned) { owned = []; this.byOwner.set(owner, owned); }
    if (owned.includes(trigger)) return;
    owned.lane = lane; owned.x = owner.x; owned.y = owner.y;
    trigger.runtime = this.world.runtime; owned.push(trigger);
    const row = this.byLane[lane] ||= []; row.push(trigger); this._index(trigger, lane, row.length - 1);
  }
  removeByOwner(owner) {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    this.byOwner.delete(owner);
    for (const trigger of owned) this._removeRow(trigger);
  }
  synchronize(owner) {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    if (owner.removed || owner.failureReason || owner.disabled || owner.terminalReason || owner.action?.actionName !== 'blocking' ||
        !Number.isInteger(owner.laneIndex) || owner.laneIndex < 0 || owner.laneIndex >= this.byLane.length) { this.removeByOwner(owner); return; }
    const dx = owner.x - owned.x, dy = owner.y - owned.y;
    const transferred = owned.lane !== owner.laneIndex;
    if (transferred || dx || dy) for (const trigger of owned) {
      const previousIndex = this.triggerRecords.get(trigger).index;
      if (transferred) this._removeRow(trigger); else this._unindex(trigger);
      trigger.x1 += dx; trigger.x2 += dx; trigger.y1 += dy; trigger.y2 += dy;
      const row = this.byLane[owner.laneIndex] ||= [];
      if (transferred) { trigger._procgenTriggerOrder = this.nextOrder++; row.push(trigger); }
      this._index(trigger, owner.laneIndex, transferred ? row.length - 1 : previousIndex);
    }
    owned.lane = owner.laneIndex;
    owned.x = owner.x; owned.y = owner.y;
  }
  _candidate(trigger, x, y, actor, winner) {
    this.indexStats.blockerCandidates++;
    const owner = trigger.owner;
    if (owner === actor || owner.removed || owner.disabled || owner.failureReason || owner.terminalReason || owner.action?.actionName !== 'blocking') return winner;
    this.indexStats.exactRectangleTests++;
    if (x < trigger.x1 || x >= trigger.x2 || y < trigger.y1 || y >= trigger.y2) return winner;
    return !winner || trigger._procgenTriggerOrder < winner._procgenTriggerOrder ? trigger : winner;
  }
  trigger(x, y, actor, tick) {
    const hazard = this.hazards.trigger(x, y, actor, tick);
    if (hazard !== Types.NO_TRIGGER) return hazard;
    for (let lane = Math.max(0, Math.floor(y / this.world.laneHeight) - 1); lane <= Math.min(this.byLane.length - 1, Math.floor(y / this.world.laneHeight) + 1); lane++) {
      const bucket = this.spatial[lane]?.get(Math.floor(x / CELL_WIDTH));
      let winner = null;
      if (bucket) for (const trigger of bucket) winner = this._candidate(trigger, x, y, actor, winner);
      if (this.wide[lane]) for (const trigger of this.wide[lane]) winner = this._candidate(trigger, x, y, actor, winner);
      if (winner) return winner.trigger(x, y, tick, actor);
    }
    return Types.NO_TRIGGER;
  }
  rebuildIndex() {
    if (!Number.isSafeInteger(this.nextOrder) || this.nextOrder < 0) throw new Error('Invalid blocker insertion order in checkpoint.');
    this.spatial.fill(null); this.wide.fill(null); this.triggerRecords.clear(); this.retainedCells = 0;
    const orders = new Set(); let ownedCount = 0;
    for (const owned of this.byOwner.values()) ownedCount += owned.length;
    for (let lane = 0; lane < this.byLane.length; lane++) for (let index = 0; index < (this.byLane[lane]?.length || 0); index++) {
      const trigger = this.byLane[lane][index];
      if (this.triggerRecords.has(trigger) || !this.byOwner.get(trigger.owner)?.includes(trigger) || trigger.owner.laneIndex !== lane)
        throw new Error('Invalid blocker ownership in checkpoint.');
      this._index(trigger, lane, index);
      if (orders.has(trigger._procgenTriggerOrder)) throw new Error('Duplicate blocker insertion order in checkpoint.');
      orders.add(trigger._procgenTriggerOrder);
    }
    if (this.triggerRecords.size !== ownedCount) throw new Error('Incomplete blocker ownership in checkpoint.');
  }
  snapshot() { return { owners: this.byOwner.size, directionalTriggers: this.triggerRecords.size, ...this.indexStats,
    retainedCells: this.retainedCells, estimatedIndexBytes: this.triggerRecords.size * 384 + this.retainedCells * 96 }; }
  reset() { this.byOwner.clear(); this.byLane.fill(null); this.spatial.fill(null); this.wide.fill(null); this.triggerRecords.clear(); this.retainedCells = 0; this.nextOrder = 0; this.hazards.reset(); }
  dispose() { this.reset(); this.hazards.dispose(); this.world = null; }
}
export { ProcgenTriggerManager, INDEX_FIELDS as PROCGEN_TRIGGER_INDEX_FIELDS, INDEX_BYTES_PER_ACTOR as PROCGEN_TRIGGER_INDEX_BYTES_PER_ACTOR };
