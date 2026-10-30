import { hashSurveyValue } from './ProcgenSurveyCanonical.js';

const preparedChunks = new WeakMap(), terrainOwners = new WeakMap();
const sourceScope = terrain => ({ geometryHash: hashSurveyValue(terrain.geometry), height: terrain.height, chunkWidth: terrain.chunkWidth });
export function captureControlledSurveyTerrain(terrain) {
  const scope = sourceScope(terrain), overrides = [];
  for (const [key, value] of Map.prototype.entries.call(terrain.collision)) {
    const proof = preparedChunks.get(value);
    if (!proof || proof.owner !== terrainOwners.get(terrain) || proof.key !== key) throw Object.assign(new Error('Controlled survey collision cache lacks its owned source proof.'), { name: 'SurveyStateProjectionError', code: 'unverified-controlled-collision' });
    const hash = hashSurveyValue(value), lane = Map.prototype.get.call(terrain.lanes, proof.seed) ?? 0;
    if (hash !== proof.hash || lane !== proof.lane || scope.geometryHash !== proof.geometryHash || scope.height !== proof.height || scope.chunkWidth !== proof.chunkWidth) overrides.push({ key, hash });
  }
  overrides.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return { kind: 'controlled-geometry-v1', geometry: terrain.geometry, height: terrain.height, chunkWidth: terrain.chunkWidth, lanes: terrain.lanes, overrides };
}

export function verifyControlledSurveyChunkBinding(terrain, seed, chunk, value) {
  const key = `${seed}:${chunk}`, proof = value && preparedChunks.get(value), lane = Map.prototype.get.call(terrain.lanes, seed) ?? 0;
  if (!proof || proof.owner !== terrainOwners.get(terrain) || proof.key !== key || proof.seed !== seed || proof.lane !== lane)
    throw Object.assign(new Error('Controlled survey chunk alias does not match its owned lane/source.'), { code: 'unverified-controlled-collision' });
  const current = Map.prototype.get.call(terrain.collision, key);
  if (current !== value) {
    const scope = sourceScope(terrain);
    if (proof.hash !== hashSurveyValue(value) || current && hashSurveyValue(current) !== proof.hash || proof.geometryHash !== scope.geometryHash || proof.height !== scope.height || proof.chunkWidth !== scope.chunkWidth)
      throw Object.assign(new Error('Retained controlled chunk is no longer verified by its current source.'), { code: 'unverified-controlled-collision' });
  }
}

class ProcgenSurveyTerrain {
  constructor(geometry) { this.geometry = geometry; this.chunkWidth = 128; this.height = 96; this.collision = new Map(); this.lanes = new Map(); this.objects = []; terrainOwners.set(this, {}); }
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
    const result = { solid, steel, topProfile: new Uint8Array(this.chunkWidth), gapWidth: 0, barrierWidth: 0 };
    preparedChunks.set(result, { owner: terrainOwners.get(this), key, seed, lane, ...sourceScope(this), hash: hashSurveyValue(result) }); this.collision.set(key, result); return result;
  }
  reset() { this.collision.clear(); }
}
export { ProcgenSurveyTerrain };
