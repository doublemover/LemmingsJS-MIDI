const TILE_LANE_STRIDE = 0x800000;
const RECENT_TILES_PER_LANE = 16;

// Cold patches are authoritative changes, not a reconstruction of an intended
// route. Their total size may grow while historical terrain remains revisitable.
class ProcgenTerrainEdits extends Map {
  constructor(chunkLength, maxResidentChunks, onCompact = null) {
    super(); this.chunkLength = chunkLength; this.maxResidentChunks = Math.max(1, maxResidentChunks);
    this.cold = new Map(); this.coldBytes = 0; this.onCompact = onCompact; this._lastKey = undefined; this._lastChunk = undefined;
    this.stats = { packed: 0, restored: 0 };
  }
  get size() { return super.size + this.cold.size; }
  has(key) { return super.has(key) || this.cold.has(key); }
  get(key) {
    if (key === this._lastKey) return this._lastChunk;
    let chunk = super.get(key);
    if (chunk) { super.delete(key); super.set(key, chunk); this._lastKey = key; this._lastChunk = chunk; return chunk; }
    const record = this.cold.get(key); if (!record) { this._lastKey = key; this._lastChunk = undefined; return undefined; }
    this.cold.delete(key); this.coldBytes -= record.bytes;
    if (record.raw) chunk = record.raw;
    else {
      chunk = new Uint8Array(this.chunkLength);
      for (let index = 0; index < record.values.length; index++) chunk.fill(record.values[index], record.runs[index * 2], record.runs[index * 2] + record.runs[index * 2 + 1]);
    }
    super.set(key, chunk); this.stats.restored++; this._limit(); this._lastKey = key; this._lastChunk = chunk; return chunk;
  }
  set(key, chunk) {
    if (!(chunk instanceof Uint8Array) || chunk.length !== this.chunkLength) throw new Error('Invalid procgen edit patch');
    const previous = this.cold.get(key);
    if (previous) { this.cold.delete(key); this.coldBytes -= previous.bytes; }
    super.delete(key); super.set(key, chunk); this._limit(); this._lastKey = key; this._lastChunk = chunk; return this;
  }
  _pack(key) {
    const chunk = super.get(key); if (!chunk) return;
    const runs = [], values = [];
    for (let start = 0; start < chunk.length;) {
      const value = chunk[start]; if (!value) { start++; continue; }
      let end = start + 1; while (end < chunk.length && chunk[end] === value) end++;
      runs.push(start, end - start); values.push(value); start = end;
    }
    const record = values.length * 5 < chunk.byteLength ? { runs: Uint16Array.from(runs), values: Uint8Array.from(values), bytes: values.length * 5 } : { raw: chunk, bytes: chunk.byteLength };
    super.delete(key); if (key === this._lastKey) { this._lastKey = undefined; this._lastChunk = undefined; } this.cold.set(key, record); this.coldBytes += record.bytes; this.stats.packed++;
    this.onCompact?.(key);
  }
  _limit() { while (super.size > this.maxResidentChunks) this._pack(super.keys().next().value); }
  compactExcept(interests, maxResidentChunks = this.maxResidentChunks) {
    this.maxResidentChunks = Math.max(1, maxResidentChunks);
    for (const key of super.keys()) if (!interests.has(key)) this._pack(key);
    this._limit();
  }
  delete(key) {
    if (key === this._lastKey) { this._lastKey = undefined; this._lastChunk = undefined; }
    const record = this.cold.get(key);
    if (record) { this.cold.delete(key); this.coldBytes -= record.bytes; return true; }
    const removed = super.delete(key); if (removed) this.onCompact?.(key); return removed;
  }
  clear() { super.clear(); this.cold.clear(); this.coldBytes = 0; this._lastKey = undefined; this._lastChunk = undefined; }
  *keys() { yield* [...this.cold.keys(), ...super.keys()]; }
  *values() { for (const key of this.keys()) yield this.get(key); }
  *entries() { for (const key of this.keys()) yield [key, this.get(key)]; }
  [Symbol.iterator]() { return this.entries(); }
  forEach(callback, thisArg) { for (const [key, value] of this) callback.call(thisArg, value, key, this); }
  snapshot() {
    const residentBytes = super.size * this.chunkLength;
    return { ...this.stats, residentChunks: super.size, coldChunks: this.cold.size, retainedChunks: this.size,
      maxResidentChunks: this.maxResidentChunks, residentBytes, coldBytes: this.coldBytes, totalBytes: residentBytes + this.coldBytes };
  }
}

// Explicit versions survive for actual interests and recent observations. Every
// retirement advances its lane's fallback identity, so a forgotten key cannot
// accidentally match an older cached zero/version when that tile is revisited.
class ProcgenTerrainRevisions extends Map {
  constructor(laneCount, maxEntries) {
    super(); this.epochs = new Float64Array(laneCount); this.maxEntries = Math.max(1, maxEntries); this.interests = new Set();
    this.stats = { retired: 0 };
  }
  _retire(key) { if (super.delete(key)) { this.epochs[Math.floor(key / TILE_LANE_STRIDE)]++; this.stats.retired++; } }
  _limit() {
    for (const key of super.keys()) { if (super.size <= this.maxEntries) break; if (!this.interests.has(key)) this._retire(key); }
  }
  set(key, revision) { super.delete(key); super.set(key, revision); this._limit(); return this; }
  read(key) {
    const revision = super.has(key) ? super.get(key) : -(this.epochs[Math.floor(key / TILE_LANE_STRIDE)] || 0);
    this.set(key, revision); return revision;
  }
  retain(interests) {
    this.interests = interests;
    // Pin unchanged initial tiles before advancing other tiles' fallback epoch.
    for (const key of interests) if (!super.has(key)) super.set(key, -(this.epochs[Math.floor(key / TILE_LANE_STRIDE)] || 0));
    const recent = new Uint8Array(this.epochs.length), keep = new Set(interests);
    for (const key of [...super.keys()].reverse()) {
      const lane = Math.floor(key / TILE_LANE_STRIDE);
      if (recent[lane] < RECENT_TILES_PER_LANE) { keep.add(key); recent[lane]++; }
    }
    for (const key of super.keys()) if (!keep.has(key)) this._retire(key);
    this.maxEntries = Math.max(128, interests.size + this.epochs.length * RECENT_TILES_PER_LANE);
    this._limit();
  }
  clear() { super.clear(); this.epochs.fill(0); this.interests.clear(); }
  snapshot() { return { ...this.stats, entries: this.size, maxEntries: this.maxEntries, interests: this.interests.size, recentTilesPerLane: RECENT_TILES_PER_LANE }; }
}
const procgenTileRevision = (world, key) => world.getTerrainTileRevision?.(key) ?? world.terrainTileRevisions?.get(key) ?? 0;
export { ProcgenTerrainEdits, ProcgenTerrainRevisions, procgenTileRevision, RECENT_TILES_PER_LANE };
