import assert from 'node:assert/strict';
import { expect } from 'chai';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { createSourceRegionLibrary, placeSourceRegion, sourceRegionPayloadBytes } from '../js/app/procgen/ProcgenSourceRegions.js';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { compileTerrainGroup, terrainStampAt, terrainStampColor } from '../js/app/procgen/ProcgenTerrainCompositing.js';

const args = { seed: 42, firstChunk: 8, code: 25, height: 144, occupied: [], surface: () => 120,
  solid: (x, y) => y >= 120, steel: () => false };

describe('complete supported source regions', function() {
  this.timeout(30000);
  let terrain, library, overhang;
  before(async () => {
    terrain = await loadProcgenTerrain('lemmings', 2);
    library = createSourceRegionLibrary(terrain.assemblyCatalog, terrain.pieces, terrain.objects, terrain.wordPlanner?.ids);
    overhang = library.find(group => group.entry.id === 'lemmings/2/a0c2b0ac0a99a380');
  });
  it('keeps an actual Marble roof, whole source support, underpass and exact ordered alpha without extrusion', () => {
    const result = placeSourceRegion({ ...args, library: [overhang] }), { region, placement } = result;
    expect(region.source.terrainIndices).to.deep.equal([7, 10, 15, 16, 17]);
    expect(region.touchedTiles).to.deep.equal([8, 9]); expect(region.crewStatus).to.equal('unqualified');
    expect(region.production).to.equal('source-overhang'); expect(region.protectedVoids).to.have.length(1);
    expect(region.protectedVoids[0]).to.deep.equal({ x1: 1121, x2: 1153, y1: 88, y2: 120, purpose: 'source-underpass' });
    expect(region.ports.map(port => [port.x, port.y, port.direction, port.qualified])).to.deep.equal([[1121, 120, 1, false], [1152, 120, -1, false]]);
    expect(region.supportContacts).to.have.length(32);
    const expected = compileTerrainGroup({ placements: region.sourcePlacements }, new Map(terrain.pieces.map(piece => [piece.id, piece])), placement.piece.width, placement.piece.height);
    for (let dy = 0; dy < placement.piece.height; dy++) for (let dx = 0; dx < placement.piece.width; dx++) {
      const at = dy * placement.piece.width + dx, x = placement.x + dx, y = placement.y + dy;
      const stamp = terrainStampAt(placement, x, y, true);
      assert.equal((stamp & 3) >= 2, !(expected.frame[at] & 128));
      assert.equal((stamp & 3) >= 2 ? terrainStampColor(placement, stamp) : 0, expected.rgba[at]);
    }
    for (const point of region.supportContacts) { expect(args.solid(point.x - 1024, point.y)).to.equal(true); expect(terrainStampAt(placement, point.x - 1024, point.y, true) & 3).not.to.equal(1); }
    expect(Object.isFrozen(region)).to.equal(true); expect(Object.isFrozen(region.sourcePlacements)).to.equal(true);
    expect(overhang.entry.placements).to.have.length(4); expect(region.sourcePlacements).to.have.length(5);
  });
  it('rejects missing foundation, steel, occupied geometry, short height and incomplete seam footprints', () => {
    expect(placeSourceRegion({ ...args, library: [overhang], solid: () => false })).to.equal(null);
    expect(placeSourceRegion({ ...args, library: [overhang], steel: () => true })).to.equal(null);
    expect(placeSourceRegion({ ...args, library: [overhang], occupied: [{ x: 40, y: 60, piece: { width: 64, height: 64 } }] })).to.equal(null);
    expect(placeSourceRegion({ ...args, library: [overhang], height: 64 })).to.equal(null);
    expect(placeSourceRegion({ ...args, library: [overhang], code: 0 })).to.equal(null);
  });
  it('naturally generates a whole two-tile source underpass with request-order parity and atomic activation', () => {
    terrain.configure(1, 16, { laneHeight: 144 }); terrain.reset();
    const beforeMemory = terrain.memoryMB;
    const right = terrain.describe(90, 13), left = terrain.describe(90, 12), region = left.region;
    expect(sourceRegionPayloadBytes(terrain.sourceRegions, terrain.descriptions)).to.equal(155520);
    expect(terrain.memoryMB - beforeMemory).to.equal(155520 / 1048576);
    expect(sourceRegionPayloadBytes(terrain.sourceRegions, new Map([[0, left], [1, right], [2, left]]))).to.equal(155520);
    expect(region).to.equal(right.region); expect(left.sharedSpan).to.equal(right.sharedSpan);
    expect(region.sourceAtom).to.equal('lemmings/2/a84da9d8743089ae');
    expect(region.source).to.deep.equal({ level: 'lemmings/LEVEL005.DAT#7', terrainIndices: [51, 52, 53] });
    expect(region.bounds).to.deep.equal({ x1: 1548, x2: 1692, y1: 30, y2: 120 });
    expect(region.protectedVoids.length).to.be.at.most(8); expect(region.ports.length).to.be.at.most(16);
    const base = { ...left, placements: left.placements.filter(placement => !placement.sharedSpan) };
    expect(terrain.solidSample(90, 12, 24, 107, base)).to.equal(true);
    expect(terrain.solidSample(90, 12, 24, 107, left)).to.equal(false);
    const growth = new ProcgenTerrainGrowth(1, 128), through = new Float64Array(1);
    const states = [12, 13].map(chunk => growth._prepare(0, chunk, (lane, at) => terrain.growthPlan(90, at)));
    const indices = states.map(state => state.plan.jobs.findIndex(job => job.sharedSpan));
    for (let part = 0; part < 2; part++) {
      const state = states[part];
      expect(state.plan.jobs.length).to.be.at.most(32);
      expect(state.plan.jobs[indices[part]].sourceIds).to.deep.equal([53]);
      for (let at = 0; at < indices[part]; at++) expect(growth._activate(state, at, through, () => {})).to.equal(true);
      if (!part) expect(growth._activate(state, indices[part], through, () => {})).to.equal(false);
    }
    expect(terrain.solidSample(90, 12, 24, 107, left, states[0])).to.equal(true);
    let callbacks = 0;
    expect(growth._activate(states[0], indices[0], through, () => {
      callbacks++; expect(states.every((state, part) => state.active[indices[part]])).to.equal(true);
    })).to.equal(true);
    expect(callbacks).to.equal(2); expect(growth.stats.revealed).to.equal(states.reduce((sum, state) => sum + state.plan.jobs.length, 0));
    expect(terrain.solidSample(90, 12, 24, 107, left, states[0])).to.equal(false);
    for (const port of region.ports) {
      const chunk = Math.floor(port.x / 128), descriptor = chunk === 12 ? left : right;
      expect(port.qualified).to.equal(false);
      expect(terrain.solidSample(90, chunk, port.x % 128, port.y, descriptor)).to.equal(true);
      for (let dy = 1; dy <= 12; dy++) expect(terrain.solidSample(90, chunk, port.x % 128, port.y - dy, descriptor)).to.equal(false);
    }
    const rasters = [12, 13].map(chunk => terrain.getChunk(90, chunk, true).pixels.slice());
    terrain.descriptionLimit = 2; terrain.describe(90, 100); terrain.describe(90, 102);
    expect(terrain.descriptions.has('90:12')).to.equal(false);
    expect(terrain.describe(90, 13).region).to.deep.equal(region);
    terrain.reset(); expect(terrain.describe(90, 12).region).to.deep.equal(region);
    expect(terrain.describe(90, 13).region).to.equal(terrain.describe(90, 12).region);
    for (let part = 0; part < 2; part++) expect(terrain.getChunk(90, 12 + part, true).pixels).to.deep.equal(rasters[part]);
    growth.dispose();
  });
  it('requires the selected whole support provenance and keeps the Dirt vocabulary gap suppressed', async () => {
    const stripped = { ...terrain.assemblyCatalog, entries: terrain.assemblyCatalog.entries.map(entry => ({ ...entry, sources: entry.sources.filter(source => source.level !== 'lemmings/LEVEL007.DAT#4') })) };
    // Keep each source entry valid while removing this particular cross-source support receipt.
    stripped.entries = stripped.entries.filter(entry => entry.sources.length);
    expect(createSourceRegionLibrary(stripped, terrain.pieces, terrain.objects).some(group => group.entry.id === overhang.entry.id && group.supportAnchors.some(anchor => anchor.source.level === 'lemmings/LEVEL007.DAT#4'))).to.equal(false);
    const dirt = await loadProcgenTerrain('lemmings', 0);
    expect(dirt.compiledAssemblies).to.have.length(8);
    expect(createSourceRegionLibrary(dirt.assemblyCatalog, dirt.pieces, dirt.objects, dirt.wordPlanner?.ids)).to.deep.equal([]);
  });
});
