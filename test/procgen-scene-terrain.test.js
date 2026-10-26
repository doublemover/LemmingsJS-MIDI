import { expect } from 'chai';
import { compileSceneTerrainLayout, createSceneTerrainViews, verifyCompiledSceneTerrain, validateSceneTerrainLayout, sceneTerrainStorageShape } from '../js/app/procgen/SceneTerrainLayout.js';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { BACKGROUND_JOB_KINDS, BACKGROUND_WORKER_ONLY_JOB_KINDS } from '../js/app/resources/BackgroundJobKinds.js';

const rectangle = (kind, x1, x2, y1, y2, color = kind === 'air' ? 0 : 0xff526f74) => ({ kind, x1, x2, y1, y2, color });
const source = () => ({ schema: 'lemmings-scene-terrain/v1', id: 'score.workshop.geometry', revision: 1, width: 256, laneHeight: 96, lanes: [
  { laneId: 0, regions: [rectangle('solid', 0, 256, 88, 96), rectangle('steel', 64, 128, 80, 88), rectangle('air', 96, 112, 80, 96)] }, { laneId: 1, regions: [rectangle('solid', 0, 256, 72, 96)] }
] });
const bit = (mask, x, y) => mask[(y * 128 + x) >>> 5] >>> ((y * 128 + x) & 31) & 1;
const rejected = async (promise, text) => { let caught; try { await promise; } catch (error) { caught = error; } expect(caught?.message).to.include(text); };

describe('authored scene source geometry compiler (runtime/playability qualification deferred)', () => {
  it('shares exact solid/steel/raster/top-profile cells, ordered clears and chunk seams in one bounded owned buffer', async () => {
    const compiled = await compileSceneTerrainLayout(source()), views = await verifyCompiledSceneTerrain(compiled);
    expect(views.chunks).to.have.length(4); expect(views.storage.byteLength).to.equal(sceneTerrainStorageShape(compiled.layout).bytes);
    const first = views.chunks[0], second = views.chunks[1], lower = views.chunks[2];
    expect(bit(first.solid, 80, 80)).to.equal(1); expect(bit(first.steel, 80, 80)).to.equal(1); expect(first.topProfile[80]).to.equal(80);
    expect(bit(first.solid, 100, 90)).to.equal(0); expect(bit(first.steel, 100, 82)).to.equal(0); expect(first.pixels[90 * 128 + 100]).to.equal(0); expect(first.topProfile[100]).to.equal(-1);
    expect(bit(first.solid, 127, 88)).to.equal(1); expect(bit(second.solid, 0, 88)).to.equal(1); expect(second.origin).to.equal(128); expect(lower.topProfile[0]).to.equal(72);
    for (const chunk of views.chunks) for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) { const solid = bit(chunk.solid, x, y); expect(solid).to.equal(Number(chunk.pixels[y * 128 + x] !== 0)); if (bit(chunk.steel, x, y)) expect(solid).to.equal(1); }
    const buffers = new Set(views.chunks.flatMap(chunk => [chunk.solid.buffer, chunk.steel.buffer, chunk.pixels.buffer, chunk.topProfile.buffer])); expect(buffers.size).to.equal(1); expect(buffers.has(compiled.storage.buffer)).to.equal(true);
    expect(compiled.receipt.initialState).to.include('not-an-intervention');
  });
  it('is reproducible for an immutable source and changes its hashes for changed ordered source geometry', async () => {
    const raw = source(), a = await compileSceneTerrainLayout(raw), b = await compileSceneTerrainLayout(raw); expect(a.storage).to.deep.equal(b.storage); expect(a.layoutHash).to.equal(b.layoutHash); expect(a.storageHash).to.equal(b.storageHash);
    const changed = source(); changed.lanes[0].regions.reverse(); const c = await compileSceneTerrainLayout(changed); expect(c.layoutHash).not.to.equal(a.layoutHash); expect(c.storageHash).not.to.equal(a.storageHash); expect(raw).to.deep.equal(source());
  });
  it('rejects unknown fields, fractional/out-of-source regions, transparent solids and unsupported lane/dimension budgets', () => {
    for (const mutate of [value => { value.width = 129; }, value => { value.laneHeight = 512; }, value => { value.lanes[1].laneId = 0; }, value => { value.lanes[0].regions[0].x2 = 257; }, value => { value.lanes[0].regions[0].y1 = 0.5; }, value => { value.lanes[0].regions[0].color = 1; }, value => { value.lanes[0].regions[0].callback = 'onClock'; }, value => { value.lanes[0].regions = Array.from({ length: 65 }, () => rectangle('air', 0, 1, 0, 1)); }]) {
      const raw = source(); mutate(raw); expect(() => validateSceneTerrainLayout(raw)).to.throw();
    }
  });
  it('denies the full collision/raster/hash workspace before allocation and cancels between bounded chunk units', async () => {
    let units = 0; await rejected(compileSceneTerrainLayout(source(), { estimatedPeakBytes: 4096, onProgress: () => units++ }), 'must be admitted'); expect(units).to.equal(0);
    const controller = new AbortController(); await rejected(compileSceneTerrainLayout(source(), { signal: controller.signal, onProgress: () => { units++; controller.abort(new Error('canceled-source')); } }), 'canceled-source'); expect(units).to.equal(1);
    await rejected(compileSceneTerrainLayout(source(), { current: () => false }), 'source changed');
  });
  it('rejects corrupt storage, forged geometry identity, incompatible byte order and hidden backing buffers before adoption', async () => {
    const result = await compileSceneTerrainLayout(source()), storage = result.storage.slice(); storage[10] ^= 1; await rejected(verifyCompiledSceneTerrain({ ...result, storage }), 'integrity receipt');
    await rejected(verifyCompiledSceneTerrain({ ...result, layoutHash: '0'.repeat(64) }), 'canonical source'); expect(() => createSceneTerrainViews({ ...result, storageByteOrder: 'unknown' })).to.throw('identity');
    const larger = new Uint8Array(result.storage.byteLength + 4); larger.set(result.storage, 4); expect(() => createSceneTerrainViews({ ...result, storage: larger.subarray(4) })).to.throw('exact shape');
  });
  it('is registered as worker-only and retains its real typed output through the admitted kernel contract', async () => {
    expect(BACKGROUND_JOB_KINDS).to.include('compile-scene-terrain'); expect(BACKGROUND_WORKER_ONLY_JOB_KINDS).to.include('compile-scene-terrain');
    const result = await runBackgroundJobKernel('compile-scene-terrain', source(), { maxBytes: 131072, maxNodes: 16384, estimatedPeakBytes: 16 * 1048576, yieldControl: async () => {} });
    expect(result.retainedBytes).to.be.greaterThan(result.value.bytes); expect(result.retainedBytes).to.be.lessThan(16 * 1048576); expect((await verifyCompiledSceneTerrain(result.value)).chunks).to.have.length(4);
  });
});
