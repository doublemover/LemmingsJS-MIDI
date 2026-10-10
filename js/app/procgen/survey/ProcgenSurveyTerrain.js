class ProcgenSurveyTerrain {
  constructor(geometry) { this.geometry = geometry; this.chunkWidth = 128; this.height = 96; this.collision = new Map(); this.lanes = new Map(); this.objects = []; }
  configure(_lanes, _actors, { laneHeight }) { this.height = laneHeight; }
  registerLanes(seeds) { this.lanes = new Map(Array.from(seeds, (seed, lane) => [seed, lane])); }
  surface() { return this.height - 24; }
  describe() { return { objects: [] }; }
  getChunk(seed, chunk) {
    const key = `${seed}:${chunk}`;
    if (this.collision.has(key)) return this.collision.get(key);
    const lane = this.lanes.get(seed) ?? 0, solid = new Uint32Array(Math.ceil(this.chunkWidth * this.height / 32)), steel = new Uint32Array(solid.length);
    const contains = (rect, x, y) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.chunkWidth; x++) {
      const wx = chunk * this.chunkWidth + x, wy = lane * this.height + y, at = y * this.chunkWidth + x, bit = 1 << (at & 31);
      if (this.geometry.solid.some(rect => contains(rect, wx, wy)) || this.geometry.steel.some(rect => contains(rect, wx, wy))) solid[at >>> 5] |= bit;
      if (this.geometry.steel.some(rect => contains(rect, wx, wy))) steel[at >>> 5] |= bit;
    }
    const result = { solid, steel, topProfile: new Uint8Array(this.chunkWidth), gapWidth: 0, barrierWidth: 0 }; this.collision.set(key, result); return result;
  }
  reset() { this.collision.clear(); }
}
export { ProcgenSurveyTerrain };
