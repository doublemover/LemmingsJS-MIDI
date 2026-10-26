import { cloneData, freezeData, canonicalDataText } from '../../core/CanonicalData.js';

const STORAGE_BYTE_ORDER = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4 ? 'little-endian' : 'big-endian';
export const SCENE_TERRAIN_REVISION = 'original-ordered-rectangle-terrain-v1';
export const SCENE_TERRAIN_LIMITS = Object.freeze({ lanes: 8, regionsPerLane: 64, chunkWidth: 128, maximumWidth: 1024, maximumHeight: 128, maximumBytes: 8 * 1048576 });
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new TypeError('Scene terrain: ' + message); };

export function validateSceneTerrainLayout(raw) {
  const value = cloneData(raw, { maxBytes: 131072, maxNodes: 16384, domain: 'Authored scene terrain' });
  if (!keys(value, ['schema', 'id', 'revision', 'width', 'laneHeight', 'lanes']) || value.schema !== 'lemmings-scene-terrain/v1' || typeof value.id !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(value.id) || !integer(value.revision, 1, 2147483647) || !integer(value.width, 128, 1024) || value.width % 128 || !integer(value.laneHeight, 64, 128) || !Array.isArray(value.lanes) || !value.lanes.length || value.lanes.length > 8) fail('Use a versioned bounded initial score, 128-pixel chunks and 1–8 ordered lanes.');
  for (let lane = 0; lane < value.lanes.length; lane++) {
    const entry = value.lanes[lane];
    if (!keys(entry, ['laneId', 'regions']) || entry.laneId !== lane || !Array.isArray(entry.regions) || entry.regions.length > 64) fail('Each physical lane needs at most 64 explicitly ordered primitive regions.');
    for (const region of entry.regions) {
      if (!keys(region, ['kind', 'x1', 'x2', 'y1', 'y2', 'color']) || !['solid', 'air', 'steel'].includes(region.kind) || !integer(region.x1, 0, value.width - 1) || !integer(region.x2, region.x1 + 1, value.width) || !integer(region.y1, 0, value.laneHeight - 1) || !integer(region.y2, region.y1 + 1, value.laneHeight) || !integer(region.color, 0, 0xffffffff) || (region.kind === 'air' ? region.color !== 0 : region.color >>> 24 !== 255)) fail('Regions require finite half-open pixel bounds and explicit opaque packed color, or zero for air.');
    }
  }
  return freezeData(value);
}

export function sceneTerrainStorageShape(layout) {
  if (!integer(layout?.width, 128, 1024) || layout.width % 128 || !integer(layout?.laneHeight, 64, 128) || !Array.isArray(layout.lanes) || !integer(layout.lanes.length, 1, 8)) fail('Invalid bounded storage dimensions.');
  const chunksPerLane = layout.width / 128, cells = 128 * layout.laneHeight, maskBytes = cells / 8, chunkBytes = maskBytes * 2 + cells * 4 + 128 * 2, chunks = chunksPerLane * layout.lanes.length;
  return Object.freeze({ chunksPerLane, cells, maskBytes, chunkBytes, chunks, bytes: chunkBytes * chunks });
}

const chunkViews = (storage, layout, shape, laneId, chunk) => {
  const offset = storage.byteOffset + (laneId * shape.chunksPerLane + chunk) * shape.chunkBytes, buffer = storage.buffer;
  return Object.freeze({ laneId, chunk, origin: chunk * 128, width: 128, height: layout.laneHeight,
    solid: new Uint32Array(buffer, offset, shape.maskBytes / 4), steel: new Uint32Array(buffer, offset + shape.maskBytes, shape.maskBytes / 4),
    pixels: new Uint32Array(buffer, offset + shape.maskBytes * 2, shape.cells), topProfile: new Int16Array(buffer, offset + shape.maskBytes * 2 + shape.cells * 4, 128) });
};

export function createSceneTerrainViews(result) {
  if (result?.schema !== 'lemmings-compiled-scene-terrain/v1' || result.algorithmRevision !== SCENE_TERRAIN_REVISION || result.storageByteOrder !== STORAGE_BYTE_ORDER || !/^[a-f0-9]{64}$/.test(result.layoutHash) || !/^[a-f0-9]{64}$/.test(result.storageHash)) fail('The compiled source identity is unavailable.');
  const layout = validateSceneTerrainLayout(result.layout), shape = sceneTerrainStorageShape(layout), storage = result.storage;
  if (!(storage instanceof Uint8Array) || !(storage.buffer instanceof ArrayBuffer) || storage.byteOffset !== 0 || storage.buffer.byteLength !== storage.byteLength || storage.byteLength !== shape.bytes || shape.bytes > SCENE_TERRAIN_LIMITS.maximumBytes || result.bytes !== shape.bytes) fail('Compiled collision/raster storage differs from the declared exact shape.');
  const chunks = Array.from({ length: shape.chunks }, (_, index) => chunkViews(storage, layout, shape, Math.floor(index / shape.chunksPerLane), index % shape.chunksPerLane));
  return Object.freeze({ layout, shape, storage, chunks: Object.freeze(chunks), layoutHash: result.layoutHash, storageHash: result.storageHash });
}

export async function compileSceneTerrainLayout(raw, { signal, current = () => true, estimatedPeakBytes = 16 * 1048576, crypto = globalThis.crypto, yieldControl = async () => {}, onProgress = () => {} } = {}) {
  const guard = () => { signal?.throwIfAborted(); if (!current()) throw new Error('Scene terrain source changed during compilation.'); };
  guard(); const layout = validateSceneTerrainLayout(raw), shape = sceneTerrainStorageShape(layout), metadata = canonicalDataText(layout, { maxBytes: 131072, maxNodes: 16384 });
  const requiredPeakBytes = shape.bytes * 2 + metadata.bytes.length * 32 + shape.cells + 262144;
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < requiredPeakBytes || shape.bytes > SCENE_TERRAIN_LIMITS.maximumBytes || !crypto?.subtle?.digest) fail('The complete source/raster/hash workspace and SHA-256 capability must be admitted before allocation.');
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const layoutHash = await digest(metadata.bytes); guard(); const storage = new Uint8Array(shape.bytes), steelScratch = new Uint8Array(shape.cells);
  for (let lane = 0; lane < layout.lanes.length; lane++) for (let chunk = 0; chunk < shape.chunksPerLane; chunk++) {
    guard(); const view = chunkViews(storage, layout, shape, lane, chunk); steelScratch.fill(0); view.topProfile.fill(-1);
    for (const region of layout.lanes[lane].regions) {
      const from = Math.max(view.origin, region.x1) - view.origin, to = Math.min(view.origin + 128, region.x2) - view.origin; if (to <= from) continue;
      for (let y = region.y1; y < region.y2; y++) { view.pixels.fill(region.color, y * 128 + from, y * 128 + to); steelScratch.fill(region.kind === 'steel' ? 1 : 0, y * 128 + from, y * 128 + to); }
    }
    for (let at = 0; at < shape.cells; at++) {
      if (!view.pixels[at]) continue; view.solid[at >>> 5] |= 1 << (at & 31); if (steelScratch[at]) view.steel[at >>> 5] |= 1 << (at & 31);
      const x = at % 128; if (view.topProfile[x] === -1) view.topProfile[x] = Math.floor(at / 128);
    }
    onProgress({ phase: 'compiling-authored-scene-terrain', completedUnits: lane * shape.chunksPerLane + chunk + 1, totalUnits: shape.chunks }); await yieldControl();
  }
  guard(); const storageHash = await digest(storage); guard();
  return Object.freeze({ schema: 'lemmings-compiled-scene-terrain/v1', algorithmRevision: SCENE_TERRAIN_REVISION, storageByteOrder: STORAGE_BYTE_ORDER, layout, layoutHash, storageHash, storage, bytes: shape.bytes,
    receipt: Object.freeze({ source: 'original-explicit-ordered-pixel-geometry', extent: [0, layout.width], coordinates: 'world-x;lane-local-y;half-open-pixel-cells', maximumChunks: shape.chunks, requiredPeakBytes, outputBytes: shape.bytes,
      physics: 'packed-solid-and-steel-share-exact-raster-cells', objectPolicy: 'no-generated-objects-inside-authored-extent', initialState: 'source-geometry;not-an-intervention-or-simulated-user-action', qualification: 'collision-render-and-playability-fixtures-await-runtime-validation' }) });
}

export async function verifyCompiledSceneTerrain(result, { signal, current = () => true, crypto = globalThis.crypto } = {}) {
  signal?.throwIfAborted(); if (!current() || !crypto?.subtle?.digest) fail('The source lease or integrity capability is unavailable.');
  const views = createSceneTerrainViews(result), metadata = canonicalDataText(views.layout, { maxBytes: 131072, maxNodes: 16384 }), digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (await digest(metadata.bytes) !== result.layoutHash) fail('Compiled geometry does not match its canonical source identity.');
  signal?.throwIfAborted(); if (!current()) fail('The scene source changed before storage verification.');
  if (await digest(views.storage) !== result.storageHash) fail('Compiled collision/raster storage does not match its integrity receipt.');
  signal?.throwIfAborted(); if (!current()) fail('The scene source changed before adoption.');
  return views;
}
