import { expect } from 'chai';
import { ProcgenTerrainGrowth, MAX_LOCAL_COVERAGE_RANGES } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const fixture = (count = 1) => {
  const growth = new ProcgenTerrainGrowth(count, 128), through = new Float64Array(count), frontiers = new Float64Array(count);
  frontiers.fill(36); growth.reset(through, frontiers);
  const preparations = [], activations = [];
  const prepare = (lane, chunk) => {
    preparations.push([lane, chunk]);
    return { jobs: [
      ...Array.from({ length: 4 }, (_, index) => ({ kind: 'foundation', x1: index * 32, x2: (index + 1) * 32, dependencies: [] })),
      { kind: 'terrain', x1: 80, x2: 96, dependencies: [2] },
      { kind: 'object', x1: 112, x2: 128, dependencies: [4] }
    ], objectJobs: [5] };
  };
  const reveal = (lane, before, after, chunk, job) => { activations.push([lane, chunk, job]); };
  return { growth, through, frontiers, preparations, activations, prepare, reveal, lanes: Array.from({ length: count }, () => ({ alive: 1 })) };
};

describe('actual normal and actor-local terrain work accounting', function() {
  this.timeout(30000);
  it('counts each actual plan and activation once across repeated arrivals and normal completion', () => {
    const f = fixture(), { growth } = f;
    growth.ensureLocal(0, 300, f);
    const state = growth.stateFor(0, 2);
    expect([...state.active]).to.deep.equal([1, 1, 1, 1, 1, 0]);
    expect(growth.objectReady(0, 2, 0)).to.equal(false);
    const stateFor = growth.stateFor.bind(growth); let checks = 0;
    growth.stateFor = (...args) => { checks++; return stateFor(...args); };
    for (let actor = 0; actor < 100; actor++) growth.ensureLocal(0, 300, f);
    expect(checks).to.equal(0); expect(f.preparations).to.deep.equal([[0, 2]]);
    expect(f.activations).to.have.length(5);
    expect(growth.snapshot()).to.include({ prepared: 1, revealed: 5, forcedPrepared: 1, forced: 5,
      localRequests: 101, deduplicated: 100, pendingForcedPrepared: 1, pendingForcedRevealed: 5 });
    growth.update(f);
    expect(growth.objectReady(0, 2, 0)).to.equal(true);
    expect(growth.snapshot()).to.include({ prepared: 2, revealed: 6, normalPrepared: 1, normalRevealed: 1,
      lastPrepared: 1, lastRevealed: 1, lastForcedPrepared: 1, lastForced: 5, lastTotalPrepared: 2, lastTotalRevealed: 6,
      pendingForcedPrepared: 0, pendingForcedRevealed: 0 });
    expect(growth.stats.prepared).to.equal(f.preparations.length);
    expect(growth.stats.revealed).to.equal(f.activations.length);
    expect(new Set(f.activations.map(([lane, chunk, job]) => `${lane}:${chunk}:${job.kind}:${job.x1}`)).size).to.equal(f.activations.length);
  });
  it('bounds normal attempts when previously prepared chunks are revisited and reports no fake preparation', () => {
    const f = fixture(64), { growth } = f;
    for (let lane = 0; lane < 64; lane++) growth.ensureLocal(lane, 300, f);
    growth.preparedThrough.fill(256);
    growth.update(f);
    expect(growth.stats.lastPreparationAttempts).to.equal(growth.preparationBudget);
    expect(growth.stats.lastPrepared).to.equal(0);
    expect(growth.stats.prepared).to.equal(64);
    expect(growth.stats.lastRevealed).to.equal(64);
    expect(growth.stats.lastTotalRevealed).to.equal(64 * 6);
    expect(growth.stats.lastTotalPrepared).to.equal(64);
    expect(growth.stats.lastRevealed).to.be.at.most(growth.revealBudget);
  });
  it('keeps only four reset-aware memos without forgetting geometry or composing distant history', () => {
    const f = fixture(2), { growth } = f;
    for (const x of [300, 1000, 2000, 3000, 4000]) growth.ensureLocal(0, x, f);
    expect(growth.localCoverage[0]).to.have.length(MAX_LOCAL_COVERAGE_RANGES);
    expect(f.preparations.every(([, chunk]) => [2, 7, 8, 15, 16, 23, 24, 31].includes(chunk))).to.equal(true);
    const prepared = growth.stats.prepared, revealed = growth.stats.revealed;
    growth.ensureLocal(0, 300, f);
    expect(growth.stats.prepared).to.equal(prepared); expect(growth.stats.revealed).to.equal(revealed);
    growth.ensureLocal(1, 300, f);
    expect(growth.stateFor(1, 2).active[4]).to.equal(1);
    expect(growth.stateFor(0, 10).active).to.have.length(0);
    f.frontiers.fill(36); growth.reset(f.through, f.frontiers);
    expect(growth.localCoverage.every(ranges => ranges.length === 0)).to.equal(true);
    expect(growth.snapshot()).to.include({ pendingForcedPrepared: 0, pendingForcedRevealed: 0, lastTotalPrepared: 0, lastTotalRevealed: 0 });
    growth.ensureLocal(0, 300, f);
    expect(growth.stats.prepared).to.equal(prepared + 2);
    expect([...growth.stateFor(0, 2).active]).to.deep.equal([1, 1, 1, 1, 1, 0]);
    growth.ensureLocal(-1, 300, f); growth.ensureLocal(0.5, 300, f); growth.ensureLocal(0, NaN, f);
    growth.dispose(); expect(growth.localCoverage.every(ranges => ranges.length === 0)).to.equal(true);
    expect(growth.states.size).to.equal(0);
  });
  it('preserves actual source collision, color and steel for repeated adjacent-stripe arrival footprints', async () => {
    const masks = await loadProcgenMasks(), terrain = await loadProcgenTerrain('lemmings', 0);
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2, laneHeight: 144, seed: 42, assists: false });
    const growth = world.terrainGrowth, input = { through: world.generatedThrough, frontiers: world.frontiers,
      prepare: world._prepareGrowth, reveal: world._revealGrowth };
    // Match the real World callbacks; no fabricated collision or scaled source pixels.
    input.prepare = (lane, chunk) => world.terrain.growthPlan(world.laneSeeds[lane], chunk);
    const before = growth.snapshot();
    for (const lane of [0, 1]) for (let actor = 0; actor < 16; actor++) growth.ensureLocal(lane, 500, input);
    const after = growth.snapshot();
    expect(after.prepared - before.prepared).to.be.at.most(4);
    expect(after.revealed - before.revealed).to.equal(after.forced - before.forced);
    expect(after.deduplicated - before.deduplicated).to.equal(30);
    for (const lane of [0, 1]) {
      const seed = world.laneSeeds[lane];
      for (let x = 484; x < 564; x++) for (let y = 0; y < world.laneHeight; y++) {
        const chunk = Math.floor(x / terrain.chunkWidth), descriptor = terrain.describe(seed, chunk), state = growth.stateFor(lane, chunk);
        const localX = x % terrain.chunkWidth, globalY = lane * world.laneHeight + y;
        expect(world.baseGroundAt(x, globalY)).to.equal(terrain.solidSample(seed, chunk, localX, y, descriptor, state) ? 1 : 0);
        expect(world.basePixelAt(x, globalY)).to.equal(terrain.rasterSample(seed, chunk, localX, y, descriptor, state));
        expect(world.hasSteelAt(x, globalY)).to.equal(!!terrain.steelSample(seed, chunk, localX, y, descriptor, state));
      }
    }
    world.dispose();
  });
});
