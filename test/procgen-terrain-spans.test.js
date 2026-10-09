import { expect } from 'chai';
import assert from 'node:assert/strict';
import { loadProcgenTerrain, loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { placeTerrainSpan } from '../js/app/procgen/ProcgenTerrainSpans.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 256, height: 144, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const syntheticPlan = (chunk, shared = true) => ({ jobs: [
  { index: 0, kind: 'foundation', x1: 0, x2: 128, dependencies: [] },
  ...(shared ? [{ index: 1, kind: 'terrain', x1: chunk % 2 ? 0 : 48, x2: chunk % 2 ? 84 : 128, dependencies: [0],
    sharedSpan: { id: 'whole-source', firstChunk: 8, lastChunk: 9, cost: 2 } }] : [])
], objectJobs: [] });

// These exact receipts are selected once, not searched by the test. No source
// geometry, assembly, hazard or alpha is flattened/removed to admit the words.
describe('whole exact-source paired terrain spans', function() {
  this.timeout(30000);
  let terrain, masks;
  before(async () => { terrain = await loadProcgenTerrain('lemmings', 1); masks = await loadProcgenMasks(); });
  beforeEach(() => { terrain.configure(1, 16, { laneHeight: 144, sharedSpanBudget: 2 }); terrain.reset(); });
  for (const [seed, chunk, text] of [[2280, 18, 'HYDRO'], [14663, 16, 'SNEAKY']]) {
    it(`naturally admits complete ${text} at seed ${seed}, chunks ${chunk}/${chunk + 1}, with exact source support and request-order identity`, () => {
      const right = terrain.describe(seed, chunk + 1), left = terrain.describe(seed, chunk), shared = left.sharedSpan;
      expect(shared).to.equal(right.sharedSpan); expect(shared.word).to.equal(text); expect(shared.cost).to.equal(2);
      expect(left.word.width).to.equal(161); expect(right.word.width).to.equal(161);
      expect(left.origin).to.be.at.least(1024); expect(terrain.descriptions.size).to.equal(2);
      const all = [left, right];
      for (let part = 0; part < 2; part++) for (const p of all[part].word.placements) {
        const glyph = terrain.wordPlanner.glyphs.get(p.letter); expect(p.piece).to.equal(glyph.piece);
        expect(p.piece.width).to.equal(32); expect(p.piece.height).to.equal(38); expect(p.decor).to.equal(false);
        expect(p.sharedSpan).to.equal(shared);
        for (const feet of glyph.components) {
          const worldX = p.x + part * 128;
          expect(feet.some(([dx, dy]) => {
            const x = worldX + dx, sibling = Math.floor(x / 128), descriptor = all[sibling];
            if (!descriptor) return false;
            const base = { ...descriptor, placements: descriptor.placements.filter(member => !member.sharedSpan) };
            return terrain.solidSample(seed, chunk + sibling, x % 128, p.y + dy, base);
          })).to.equal(true);
        }
      }
      const first = all.map(d => terrain.getChunk(seed, d.origin / 128, true).pixels.slice());
      terrain.reset(); const rebuilt = terrain.describe(seed, chunk);
      expect(rebuilt.sharedSpan).to.deep.equal(shared);
      expect(terrain.describe(seed, chunk + 1).sharedSpan).to.equal(rebuilt.sharedSpan);
      for (let part = 0; part < 2; part++) expect(terrain.getChunk(seed, chunk + part, true).pixels).to.deep.equal(first[part]);
    });
  }
  it('materializes both real word tiles atomically after every local prerequisite, with exact collision/color/steel and renderer parity', () => {
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 2280, laneHeight: 144, assists: false }); world.laneSeeds[0] = 2280;
    const chunk = 18, origin = chunk * 128, growth = world.terrainGrowth, states = [chunk, chunk + 1].map(c => growth._prepare(0, c, world._prepareGrowthChunk));
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.scale = 1; renderer.cameraX = origin;
    const sharedIndices = states.map(state => state.plan.jobs.findIndex(job => job.sharedSpan));
    expect(states.every(state => state.plan.jobs.length <= 32)).to.equal(true);
    let sharedCallbacks = 0;
    const reveal = (...args) => {
      if (args[4].sharedSpan) { sharedCallbacks++; expect(states.every((state, part) => !!state.active[sharedIndices[part]])).to.equal(true); }
      world._revealGrowth(...args);
    };
    for (let part = 0; part < 2; part++) {
      const state = states[part];
      for (let index = 0; index < sharedIndices[part]; index++) {
        expect(growth._activate(state, index, world.generatedThrough, reveal)).to.equal(true);
        renderer.render();
        for (let sibling = 0; sibling < 2; sibling++) for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) {
          const current = states[sibling], d = current.plan.descriptor, globalX = origin + sibling * 128 + x;
          const visible = globalX < world.generatedThrough[0], raster = visible ? terrain.rasterSample(2280, chunk + sibling, x, y, d, current) : 0;
          assert.equal(world.basePixelAt(globalX, y), raster);
          assert.equal(world.baseGroundAt(globalX, y), visible && terrain.solidSample(2280, chunk + sibling, x, y, d, current) ? 1 : 0);
          assert.equal(world.hasSteelAt(globalX, y), visible && terrain.steelSample(2280, chunk + sibling, x, y, d, current));
          assert.equal(renderer.pixels[y * 256 + sibling * 128 + x], raster || 0xff0e0807);
        }
      }
      if (!part) expect(growth._activate(state, sharedIndices[0], world.generatedThrough, reveal)).to.equal(false);
    }
    const before = growth.stats.revealed;
    expect(growth._activate(states[0], sharedIndices[0], world.generatedThrough, reveal)).to.equal(true);
    expect(growth.stats.revealed - before).to.equal(2); expect(sharedCallbacks).to.equal(2);
    renderer.render();
    for (let part = 0; part < 2; part++) {
      expect(states[part].complete).to.equal(true);
      const full = terrain.getChunk(2280, chunk + part, true);
      for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) {
        const at = y * 128 + x, px = origin + part * 128 + x;
        assert.equal(world.basePixelAt(px, y), full.pixels[at]);
        assert.equal(world.baseGroundAt(px, y), full.solid[at >>> 5] & 1 << (at & 31) ? 1 : 0);
        assert.equal(world.hasSteelAt(px, y), !!(full.steel[at >>> 5] & 1 << (at & 31)));
        assert.equal(renderer.pixels[y * 256 + part * 128 + x], full.pixels[at] || 0xff0e0807);
      }
    }
    const revision = states.map(state => state.revision); renderer.render(); expect(states.map(state => state.revision)).to.deep.equal(revision);
    renderer.dispose(); world.dispose();
  });
  it('preserves complete measured repeat members/flags and rejects unsupported, steel, occupied and gap spans', () => {
    const group = [...terrain.wideSourceGroups.values()].find(candidate => candidate.group.role === 'repeat');
    expect(group.piece.width).to.equal(157); expect(group.group.placements).to.have.length(6);
    expect(terrain.sourceDescriptor.sourceLevelIds).to.include(group.group.source.level);
    const descriptors = () => [0, 1].map(part => ({ origin: 1024 + part * 128, gapWidth: 0, placements: [], assemblies: [], objects: [] }));
    const args = { seed: 42, firstChunk: 8, code: 0, height: 144, groupLibrary: terrain.wideSourceGroups,
      zone: { groups: [group.group], sourceRevision: terrain.sourceDescriptor.sourceRevision }, surface: () => 120,
      solid: (x, y) => y >= 120, steel: () => false, color: () => 0xff111111, sourceRevision: terrain.sourceDescriptor.sourceRevision };
    const pair = descriptors(), result = placeTerrainSpan({ ...args, descriptors: pair }); expect(result).to.exist;
    expect(pair[0].placements[0].canonicalGroup).to.equal(group.group); expect(pair[1].placements[0].piece).to.equal(group.piece);
    expect(pair[0].placements[0].x + 128).to.equal(pair[1].placements[0].x + 256);
    expect(placeTerrainSpan({ ...args, descriptors: descriptors(), solid: () => false })).to.equal(null);
    expect(placeTerrainSpan({ ...args, descriptors: descriptors(), steel: () => true })).to.equal(null);
    const gap = descriptors(); gap[1].gapWidth = 8; expect(placeTerrainSpan({ ...args, descriptors: gap })).to.equal(null);
    const occupied = descriptors(); occupied[0].placements.push({ x: 60, y: 118, piece: { width: 40, height: 8 } });
    expect(placeTerrainSpan({ ...args, descriptors: occupied })).to.equal(null);
  });
  it('charges both tiles and defers a ready whole job when only one normal-budget slot remains', () => {
    const growth = new ProcgenTerrainGrowth(2, 128); growth.revealBudget = 2;
    const through = new Float64Array(2), frontiers = Float64Array.of(1024, 1024), lanes = [{ alive: 1 }, { alive: 1 }];
    const a = growth._prepare(0, 8, () => syntheticPlan(8)), b = growth._prepare(0, 9, () => syntheticPlan(9));
    growth._activate(a, 0, through, () => {}); growth._activate(b, 0, through, () => {});
    growth._prepare(1, 7, () => syntheticPlan(7, false)); growth.preparedThrough.fill(4096);
    growth.update({ through, frontiers, lanes, prepare() { throw Error('unexpected preparation'); }, reveal() {} });
    expect(growth.stats.lastRevealed).to.equal(1); expect(a.active[1]).to.equal(0); expect(b.active[1]).to.equal(0);
    growth.update({ through, frontiers, lanes, prepare() { throw Error('unexpected preparation'); }, reveal() {} });
    expect(growth.stats.lastRevealed).to.equal(2); expect(a.active[1]).to.equal(1); expect(b.active[1]).to.equal(1);
  });
  it('prepares actual single-tile fallback with capacity one and rejects external paired plans before queue admission', () => {
    terrain.configure(1, 16, { laneHeight: 144, sharedSpanBudget: 1 });
    const growth = new ProcgenTerrainGrowth(1, 128); growth.revealBudget = 1;
    const state = growth._prepare(0, 18, (lane, chunk, options) => terrain.growthPlan(2280, chunk, options));
    expect(state.plan.descriptor.sharedSpan).to.equal(undefined); expect(state.plan.jobs.some(job => job.sharedSpan)).to.equal(false);
    const through = new Float64Array(1); for (let index = 0; index < state.active.length; index++) expect(growth._activate(state, index, through, () => {})).to.equal(true);
    expect(state.complete).to.equal(true);
    const external = new ProcgenTerrainGrowth(1, 128); external.revealBudget = 1;
    expect(() => external._prepare(0, 8, () => syntheticPlan(8))).to.throw('two-tile'); expect(external.stats.prepared).to.equal(0); expect(external.states.size).to.equal(0);
    terrain.configure(1, 16, { laneHeight: 144, sharedSpanBudget: 2 });
    expect(() => external._prepare(0, 18, (lane, chunk, options) => terrain.growthPlan(2280, chunk, options))).to.throw('capacity');
    expect(external.queues[0]).to.have.length(0);
  });
  it('forces only the bounded adjacent partner on real local arrival, counts all actual work and deduplicates repeat requests', () => {
    const growth = new ProcgenTerrainGrowth(1, 128), through = new Float64Array(1), frontiers = Float64Array.of(36); growth.reset(through, frontiers);
    const options = { through, frontiers, prepare: (lane, chunk, capacity) => terrain.growthPlan(2280, chunk, capacity), reveal() {} };
    growth.ensureLocal(0, 18 * 128 + 48, options);
    const states = [18, 19].map(chunk => growth.states.get(growth._key(0, chunk)));
    expect(states.every(state => state.complete)).to.equal(true); expect(growth.stats.forcedPrepared).to.equal(2);
    expect(growth.stats.forced).to.equal(states.reduce((n, state) => n + state.plan.jobs.length, 0));
    const counts = [growth.stats.prepared, growth.stats.revealed]; growth.ensureLocal(0, 18 * 128 + 48, options);
    expect([growth.stats.prepared, growth.stats.revealed]).to.deep.equal(counts); expect(growth.stats.deduplicated).to.equal(1);
    growth.update({ ...options, lanes: [{ alive: 0 }] }); expect(growth.stats.lastTotalPrepared).to.equal(2); expect(growth.stats.lastTotalRevealed).to.equal(counts[1]);
    growth.reset(through, frontiers); expect(growth.states.size).to.equal(0); expect(growth.localCoverage[0]).to.have.length(0); growth.dispose();
  });
});
