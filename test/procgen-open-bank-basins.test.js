import assert from 'node:assert/strict';
import { expect } from 'chai';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { planOpenBankBasin, basinVoidAt } from '../js/app/procgen/ProcgenOpenBankBasins.js';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { placeTerrainSpan } from '../js/app/procgen/ProcgenTerrainSpans.js';

describe('whole source liquid open-bank production', function() {
  this.timeout(30000);
  let terrain, descriptor, object, basin, args;
  before(async () => {
    terrain = await loadProcgenTerrain('lemmings', 4); terrain.configure(1, 16, { laneHeight: 144 });
    descriptor = terrain.describe(8, 15); object = descriptor.objects.find(o => o.basin); basin = object.basin;
    const base = { ...descriptor, objects: [] };
    args = { object, descriptor: base, route: terrain.routes.find(route => route.id === basin.foundation.motif), height: 144,
      sourceRevision: terrain.recipe.assetSha256,
      solid: (x, y) => terrain.solidSample(8, 15, x, y, base), steel: (x, y) => terrain.steelSample(8, 15, x, y, base) };
  });
  it('naturally reserves a full unchanged liquid and sourced foundation with explicit unqualified shores', () => {
    expect(basin.production).to.equal('source-foundation-open-bank'); expect(basin.crewStatus).to.equal('unqualified');
    expect(basin.object).to.deep.equal({ id: 6, x: 1947, y: 124, width: 64, height: 16, transformed: false });
    expect(basin.trigger).to.deep.equal({ x1: 1947, x2: 2011, y1: 128, y2: 136 });
    expect(basin.floor).to.deep.equal({ x1: 1947, x2: 2011, y: 140, supportColumns: 64 });
    expect(basin.shores.map(shore => [shore.x1, shore.x2, shore.y, shore.qualified])).to.deep.equal([[1923, 1947, 124, false], [2011, 2035, 124, false]]);
    expect(basin.foundation.kind).to.equal('source-motif-column-foundation');
    expect(basin.foundation.source.terrainIndices).to.deep.equal([92, 91, 93]);
    expect(basin.foundation.sourcePlacements).to.deep.equal([{ id: 27, x: 0, y: 0, f: 4 }]);
    expect(basin.removedFoundationPixels).to.equal(2006); expect(basin.touchedTiles).to.deep.equal([15]);
    expect(object.piece).to.equal(terrain.objects.find(piece => piece.id === 6));
    expect(object.piece.image.frames.every(frame => frame.length === 64 * 16)).to.equal(true);
    expect(descriptor.placements).to.have.length(0); expect(descriptor.assemblies).to.have.length(0); expect(descriptor.word).to.equal(null);
    expect(Object.isFrozen(basin)).to.equal(true); expect(Object.isFrozen(basin.foundation.sourcePlacements)).to.equal(true);
    expect(planOpenBankBasin(args)).to.deep.equal(basin);
  });
  it('owns the complete opening and liquid in one job after exact bank/floor prerequisites, with all sample channels matching', () => {
    const plan = terrain.growthPlan(8, 15), index = descriptor.objects.indexOf(object), jobIndex = plan.objectJobs[index], job = plan.jobs[jobIndex];
    expect(job).to.include({ kind: 'object', x1: 3, x2: 115, y1: 0, y2: 140, basin });
    expect(job.sourceIds).to.deep.equal([6]); expect(job.foundationSourceIds).to.deep.equal([27]);
    const growth = new ProcgenTerrainGrowth(1, 128), state = growth._prepare(0, 15, () => plan), through = new Float64Array(1);
    const base = { ...descriptor, objects: [] }, full = terrain.getChunk(8, 15, true);
    expect(growth._activate(state, jobIndex, through, () => {})).to.equal(false);
    for (const section of plan.foundationSections) expect(growth._activate(state, section.index, through, () => {})).to.equal(true);
    expect(growth.objectReady(0, 15, index)).to.equal(false);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) {
      assert.equal(terrain.solidSample(8, 15, x, y, descriptor, state), terrain.solidSample(8, 15, x, y, base));
      assert.equal(terrain.rasterSample(8, 15, x, y, descriptor, state), terrain.rasterSample(8, 15, x, y, base));
      assert.equal(terrain.steelSample(8, 15, x, y, descriptor, state), terrain.steelSample(8, 15, x, y, base));
    }
    let revealed = 0;
    expect(growth._activate(state, jobIndex, through, () => { revealed++; expect(growth.objectReady(0, 15, index)).to.equal(true); })).to.equal(true);
    expect(revealed).to.equal(1);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) {
      const at = y * 128 + x, isVoid = basinVoidAt(basin, x + descriptor.origin, y);
      const sourceColor = terrain.rasterSample(8, 15, x, y, base);
      assert.equal(terrain.solidSample(8, 15, x, y, descriptor, state), !!(full.solid[at >>> 5] & (1 << (at & 31))));
      assert.equal(terrain.rasterSample(8, 15, x, y, descriptor, state), full.pixels[at]);
      assert.equal(full.pixels[at], isVoid ? 0 : sourceColor);
      assert.equal(terrain.steelSample(8, 15, x, y, descriptor, state), !!(full.steel[at >>> 5] & (1 << (at & 31))));
      if (isVoid) assert.equal(terrain.solidSample(8, 15, x, y, descriptor, state), false);
    }
    for (const shore of basin.shores) for (let x = shore.x1; x < shore.x2; x++) assert.equal(terrain.solidSample(8, 15, x - descriptor.origin, shore.y, descriptor), true);
    for (let x = basin.floor.x1; x < basin.floor.x2; x++) assert.equal(terrain.solidSample(8, 15, x - descriptor.origin, basin.floor.y, descriptor), true);
    growth.dispose();
  });
  it('vetoes source art/support, words, other hazards, steel, missing bank/floor, gaps and incomplete bounds', () => {
    const source = terrain.describe(4157451727, 8);
    expect(source.objects[0].basin).to.equal(undefined); expect(source.assemblies).to.have.length(1);
    expect(terrain.solidSample(4157451727, 8, 36, 111, source)).to.equal(true);
    const modified = fields => ({ ...args, descriptor: { ...args.descriptor, ...fields } });
    expect(planOpenBankBasin(modified({ placements: [{ x: 32, y: 100, piece: { width: 32, height: 2 } }] }))).to.equal(null);
    expect(planOpenBankBasin(modified({ assemblies: [{ bounds: { x1: 1922, x2: 1940, y1: 100, y2: 120 } }] }))).to.equal(null);
    expect(planOpenBankBasin(modified({ word: { x: 10, y: 90, width: 32, baseline: 124 } }))).to.equal(null);
    expect(planOpenBankBasin(modified({ objects: [{ ...object, x: 1910 }] }))).to.equal(null);
    expect(planOpenBankBasin({ ...args, steel: (x, y) => x === 3 && y === 130 })).to.equal(null);
    expect(planOpenBankBasin({ ...args, solid: (x, y) => !(x === 3 && y === 124) && args.solid(x, y) })).to.equal(null);
    expect(planOpenBankBasin({ ...args, solid: (x, y) => !(x === 27 && y === 140) && args.solid(x, y) })).to.equal(null);
    expect(planOpenBankBasin(modified({ gapX: 1940, gapWidth: 3 }))).to.equal(null);
    expect(planOpenBankBasin({ ...args, object: { ...object, x: 1920 } })).to.equal(null);
    expect(planOpenBankBasin({ ...args, height: 140 })).to.equal(null);
  });
  it('protects the full opening from later shared words and rebuilds identically in either descriptor request order', () => {
    const left = terrain.describe(8, 14), descriptors = [left, descriptor];
    const wideWord = { x: 100, width: 144, y: 80, baseline: 125 };
    expect(placeTerrainSpan({ seed: 8, firstChunk: 14, code: 1, descriptors, height: 144, groupLibrary: new Map(),
      wordPlanner: { planWide: (code, width, surface, solid, occupied, qualify) => qualify(wideWord) ? wideWord : null },
      surface: () => 124, solid: () => true, steel: () => false, color: () => 1 })).to.equal(null);
    const raster = terrain.getChunk(8, 15, true).pixels.slice(); terrain.reset();
    terrain.describe(8, 14); expect(terrain.describe(8, 15).objects[0].basin).to.deep.equal(basin);
    expect(terrain.getChunk(8, 15, true).pixels).to.deep.equal(raster);
  });
});
