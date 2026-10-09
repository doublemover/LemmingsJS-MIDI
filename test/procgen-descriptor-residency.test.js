import assert from 'node:assert/strict';
import { expect } from 'chai';
import { ProcgenDescriptorResidency } from '../js/app/procgen/ProcgenDescriptorResidency.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const addPair = (cache, seed, chunk) => {
  cache.trim(8, 2);
  for (const at of [chunk, chunk + 1]) {
    cache.descriptions.set(`${seed}:${at}`, { origin: at * 128 });
    cache.plans.set(`${seed}:${at}`, { active: new Uint8Array(8) });
  }
};
describe('active-region source descriptor residency', function() {
  this.timeout(30000);
  it('keeps aligned live pairs under cold request pressure and releases retired plan owners', () => {
    const descriptions = new Map(), plans = new Map(), cache = new ProcgenDescriptorResidency(descriptions, plans);
    cache.retain(new Map([[1, [18, 19]], [2, [4]]]));
    addPair(cache, 1, 18); addPair(cache, 2, 4);
    const live = descriptions.get('1:18'), plan = plans.get('1:18');
    for (let at = 0; at < 24; at += 2) addPair(cache, 3, at);
    expect(descriptions.get('1:18')).to.equal(live); expect(plans.get('1:18')).to.equal(plan);
    expect(descriptions.has('2:4')).to.equal(true); expect(descriptions.size).to.equal(8);
    expect([...plans.keys()].sort()).to.deep.equal([...descriptions.keys()].sort());
    expect(cache.read('1:19')).to.equal(descriptions.get('1:19'));
    const snapshot = cache.snapshot(); expect(snapshot.descriptorTypedPayloadBytes).to.equal(64);
    expect(snapshot.descriptorEstimatedMetadataBytes).to.be.greaterThan(0);
    cache.retain(new Map([[3, [22]]])); cache.trim(2);
    expect(descriptions.has('1:18')).to.equal(false); expect(plans.has('1:19')).to.equal(false);
    expect(cache.read('1:18')).to.equal(null); expect(cache.stats.descriptorRebuilds).to.equal(1);
    cache.clear(); expect(cache.pins.size).to.equal(0); expect(cache.recentEvictions.size).to.equal(0);
  });
  it('allocates bounded residence round-robin across seeds and bounds recent rebuild evidence', () => {
    const cache = new ProcgenDescriptorResidency(new Map(), new Map()); cache.pinLimit = 4;
    expect(cache.retain(new Map([[1, [0, 2, 4, 6, 8]], [2, [0, 2]], [3, [0, 2]]]))).to.equal(264);
    expect([...cache.pins]).to.deep.equal(['1:0', '2:0', '3:0', '1:2']);
    cache.retain(new Map());
    for (let chunk = 0; chunk < 300; chunk += 2) { addPair(cache, 1, chunk); cache.trim(2); }
    expect(cache.recentEvictions.size).to.equal(128); expect(cache.plans.size).to.equal(2);
  });
  it('retains real complete source spans and rebuilds identical pixels and growth after cold eviction', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1); terrain.configure(1, 16, { laneHeight: 144 });
    terrain.retainDescriptors(new Map([[2280, [18, 19]]]));
    const left = terrain.describe(2280, 18), right = terrain.describe(2280, 19), plan = terrain.growthPlan(2280, 18);
    expect(left.sharedSpan).to.equal(right.sharedSpan);
    const pixels = [18, 19].map(chunk => terrain.getChunk(2280, chunk, true).pixels.slice());
    terrain.descriptionLimit = 4;
    for (let chunk = 0; chunk < 8; chunk += 2) terrain.describe(100, chunk);
    expect(terrain.describe(2280, 18)).to.equal(left); expect(terrain.growthPlan(2280, 18)).to.equal(plan);
    terrain.retainDescriptors(new Map()); terrain.descriptionLimit = 2; terrain.describe(100, 10);
    expect(terrain.growthPlans.has('2280:18')).to.equal(false);
    terrain.collision.clear(); terrain.rasters.clear(); terrain._lastKey = null;
    for (let part = 0; part < 2; part++) assert.deepEqual(terrain.getChunk(2280, 18 + part, true).pixels, pixels[part]);
    const rebuilt = terrain.growthPlan(2280, 18); expect(rebuilt).not.to.equal(plan);
    expect(rebuilt.jobs.map(job => [job.kind, job.x1, job.x2, job.dependencies])).to.deep.equal(plan.jobs.map(job => [job.kind, job.x1, job.x2, job.dependencies]));
    expect(terrain.getDebugState().descriptorRebuilds).to.be.greaterThan(0);
    terrain.reset(); expect(terrain.descriptionLimit).to.equal(256); expect(terrain.descriptorResidency.pins.size).to.equal(0);
  });
  it('derives residence from actual living rear actors and materialization without retaining the entire journey', async () => {
    const [terrain, masks] = await Promise.all([loadProcgenTerrain('lemmings', 0), loadProcgenMasks()]);
    const world = new ProcgenLaneWorld({ terrain, masks, laneCount: 2, assists: false, laneHeight: 144 });
    world.frontiers.fill(6000); world.actors[0].x = 1800; world.actors[1].x = 5200;
    world._retainTerrainDescriptors();
    const pins = terrain.descriptorResidency.pins;
    expect(pins.has(`${world.laneSeeds[0]}:14`)).to.equal(true);
    expect(pins.has(`${world.laneSeeds[0]}:28`)).to.equal(false);
    world.actors[0].removed = true; world._retainTerrainDescriptors();
    expect(pins.has(`${world.laneSeeds[0]}:14`)).to.equal(false);
    world.dispose(); expect(pins.size).to.equal(0);
  });
});
