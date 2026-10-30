import { expect } from 'chai';
import { ProcgenTerrainEdits } from '../js/app/procgen/ProcgenTerrainRetention.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { createProcgenLaneObserver } from '../js/app/procgen/workstation/ProcgenLaneObservation.js';

describe('non-materializing physical contact observations', function() {
  this.timeout(15000);
  it('reads resident, sparse cold, raw cold and absent edits without restoration or LRU changes', () => {
    const store = new ProcgenTerrainEdits(128, 3), sparse = new Uint8Array(128), raw = Uint8Array.from({ length: 128 }, (_, index) => index % 4 + 1);
    sparse.fill(3, 8, 14); sparse[100] = 4; store.set(1, sparse); store.set(2, raw); store.set(3, sparse.slice()); store._pack(1); store._pack(2);
    const before = store.snapshot(), resident = [...Map.prototype.keys.call(store)], cold = [...store.cold], last = [store._lastKey, store._lastChunk];
    store.get = () => { throw new Error('Cold observation restored a chunk'); };
    for (let index = 0; index < 128; index++) {
      expect(store.peekValue(1, index)).to.equal(sparse[index]); expect(store.peekValue(2, index)).to.equal(raw[index]);
      expect(store.peekValue(3, index)).to.equal(sparse[index]); expect(store.peekValue(999, index)).to.equal(0);
    }
    for (const index of [-1, 128, 0.5, NaN]) expect(store.peekValue(1, index)).to.equal(undefined);
    expect(store.snapshot()).to.deep.equal(before); expect([...Map.prototype.keys.call(store)]).to.deep.equal(resident);
    expect([...store.cold]).to.deep.equal(cold); expect([store._lastKey, store._lastChunk]).to.deep.equal(last);
  });
  it('matches sourced solid/steel for cached, descriptor-only and active-growth reads without source generation', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0), seed = 42, chunk = 8, points = [];
    terrain.configure(1, 128, { laneHeight: 144 });
    for (let x = 0; x < 128; x += 7) for (let y = 0; y < 144; y += 7) points.push([x, y]);
    const expected = points.map(([x, y]) => [terrain.collisionAt(seed, chunk * 128 + x, y), terrain.collisionAt(seed, chunk * 128 + x, y, true)]);
    const plan = terrain.growthPlan(seed, chunk), state = { plan, complete: false, active: new Uint8Array(plan.jobs.length) }; state.active[0] = 1;
    const partial = points.map(([x, y]) => [terrain.solidSample(seed, chunk, x, y, plan.descriptor, state), terrain.steelSample(seed, chunk, x, y, plan.descriptor, state)]);
    const assertPoints = (values, active = null) => points.forEach(([x, y], index) => expect([terrain.peekCollisionAt(seed, chunk * 128 + x, y, false, active), terrain.peekCollisionAt(seed, chunk * 128 + x, y, true, active)]).to.deep.equal(values[index]));
    const before = { stats: { ...terrain.stats }, descriptors: [...terrain.descriptions.keys()], residency: { ...terrain.descriptorResidency.stats } };
    terrain.getChunk = terrain.describe = terrain.growthPlan = () => { throw new Error('Observation generated source terrain'); };
    assertPoints(expected); terrain.collision.clear(); assertPoints(expected); assertPoints(partial, state);
    expect(terrain.stats).to.deep.equal(before.stats); expect([...terrain.descriptions.keys()]).to.deep.equal(before.descriptors); expect(terrain.descriptorResidency.stats).to.deep.equal(before.residency);
    expect(terrain.peekCollisionAt(seed, 90000, 72)).to.equal(null); expect(terrain.peekCollisionAt(seed, 1024, 72, false, { complete: false })).to.equal(null);
    expect(terrain.peekCollisionAt(seed, -1, 72)).to.equal(false); expect(terrain.peekCollisionAt(seed, 1024, -1)).to.equal(false);
    terrain.dispose?.();
  });
  it('preserves world edit/source ownership while observing actual pack terrain and reports cold unknowns honestly', async () => {
    const [masks, source] = await Promise.all([loadProcgenMasks(), loadProcgenTerrain('lemmings', 0)]), terrain = new ProcgenPackTerrain([{ styleName: 'dirt', terrain: source }]);
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2, seed: 42, assists: false });
    try {
      world.setGroundAt(40, 60); world.setGroundAt(50, 61);
      const points = [[36, 72], [40, 60], [50, 61], [40, 72], [40, 168], [60, 80]], expected = points.map(([x, y]) => [world.hasGroundAt(x, y), world.hasSteelAt(x, y)]);
      world.editChunks.compactExcept(new Set());
      const before = { edits: world.editChunks.snapshot(), generated: source.stats.generated, descriptors: [...source.descriptions.keys()], queries: world.stats.groundQueries,
        laneChunk: [...world._laneChunkIndex], editIndex: [...world._laneEditIndex], through: [...world.generatedThrough], growth: { ...world.terrainGrowth.stats } };
      world._terrainChunk = world._editsAt = world.hasGroundAt = world.hasSteelAt = terrain.getChunk = source.getChunk = source.describe = () => { throw new Error('Observer materialized world state'); };
      for (let index = 0; index < points.length; index++) { const [x, y] = points[index]; expect([world.peekGroundAt(x, y), world.peekSteelAt(x, y)]).to.deep.equal(expected[index]); }
      const observe = createProcgenLaneObserver(world); expect(observe(0).action).not.to.equal('');
      expect(world.editChunks.snapshot()).to.deep.equal(before.edits); expect(source.stats.generated).to.equal(before.generated);
      expect([...source.descriptions.keys()]).to.deep.equal(before.descriptors); expect(world.stats.groundQueries).to.equal(before.queries);
      expect([...world._laneChunkIndex]).to.deep.equal(before.laneChunk); expect([...world._laneEditIndex]).to.deep.equal(before.editIndex);
      expect([...world.generatedThrough]).to.deep.equal(before.through); expect(world.terrainGrowth.stats).to.deep.equal(before.growth);
      source.collision.clear(); source.descriptions.clear(); world.tickIndex++;
      expect(observe(0).terrainCoverage).to.equal('partial'); expect(observe(0).terrain).not.to.include('gap');
      expect(world.peekGroundAt(world.generatedThrough[0] + 100, 72)).to.equal(null); expect(world.peekSteelAt(world.generatedThrough[0] + 100, 72)).to.equal(null);
      expect(world.peekGroundAt(-1, 0)).to.equal(false); expect(world.peekSteelAt(1, world.height)).to.equal(false);
    } finally { await world.dispose()?.completion; }
  });
  it('keeps analytic terrain and edited holes exact without a source cache', () => {
    const world = new ProcgenLaneWorld({ laneCount: 1, assists: false });
    try {
      world._setPixel(36, 72, 0); const before = world.editChunks.snapshot();
      for (let x = 0; x < 256; x += 7) for (let y = 0; y < 96; y += 7) expect(world.peekGroundAt(x, y)).to.equal(world.hasGroundAt(x, y));
      expect(world.peekGroundAt(36, 72)).to.equal(false); expect(world.peekSteelAt(36, 72)).to.equal(false); expect(world.editChunks.snapshot()).to.deep.equal(before);
    } finally { world.dispose(); }
  });
});
