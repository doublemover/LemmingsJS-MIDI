import assert from 'node:assert/strict';
import { expect } from 'chai';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { createSourceRegionLibrary, placeSourceRegion, sourceRegionPayloadBytes, sourceRegionCandidates } from '../js/app/procgen/ProcgenSourceRegions.js';
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
  it('measures complete native alpha/support and diversifies four real atoms while keeping the seeded first choice', () => {
    const shape = overhang.supportAnchors[0].sourceShape;
    expect(shape).to.include({ width: 96, height: 64, opaquePixels: 5120, emptyPixels: 1024, roofEmptyPixels: 1024,
      clearanceColumns: 32, supportColumns: 32, supportSpan: 32, stratum: 'narrow/clearance/strip' });
    expect(Object.isFrozen(shape)).to.equal(true);
    const candidates = sourceRegionCandidates(library, 0);
    expect(candidates).to.have.length(4); expect(candidates[0]).to.equal(library[0]);
    expect(new Set(candidates.map(group => group.sourceStrata.join(','))).size).to.equal(4);
    for (const code of [25, 0xffffffff]) expect(sourceRegionCandidates(library, code)[0]).to.equal(library[(code >>> 0) % library.length]);
    expect(sourceRegionCandidates([], 0)).to.deep.equal([]);
    expect(sourceRegionCandidates([overhang], 25)).to.deep.equal([overhang]);
  });
  it('admits a complete real alternative after three seam rejections, where sequential ornaments exhausted the same budget', () => {
    let admission, callbacks = 0;
    const sequential = library.map(group => ({ ...group, sourceStrata: ['same'] }));
    expect(placeSourceRegion({ ...args, library: sequential })).to.equal(null);
    const result = placeSourceRegion({ ...args, library, onAdmission: receipt => { admission = receipt; callbacks++; } });
    expect(callbacks).to.equal(1); expect(admission).to.equal(result.admission);
    expect(admission.status).to.equal('admitted'); expect(admission.attemptLimit).to.equal(4);
    expect(admission.attempts).to.have.length(4);
    expect(admission.attempts.slice(0, 3).map(attempt => attempt.reason)).to.deep.equal(Array(3).fill('complete-region-span'));
    expect(result.region.sourceAtom).to.equal('lemmings/2/e7175f40c3f68ef6');
    expect(result.region.sourceShape).to.include({ width: 128, height: 32, supportColumns: 32, opaquePixels: 4096 });
    expect(result.region.supportContacts).to.have.length(32);
    expect(Object.isFrozen(admission)).to.equal(true); expect(Object.isFrozen(admission.attempts)).to.equal(true);
    expect(admission.attempts.every(Object.isFrozen)).to.equal(true);
    const expected = compileTerrainGroup({ placements: result.region.sourcePlacements }, new Map(terrain.pieces.map(piece => [piece.id, piece])), 128, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
      const stamp = terrainStampAt(result.placement, result.placement.x + x, result.placement.y + y, true);
      assert.equal(terrainStampColor(result.placement, stamp), expected.rgba[y * 128 + x]);
    }
    const reference = placeSourceRegion({ ...args, library: [overhang] }), unsampled = reference.region.supportContacts[1];
    let unsupported;
    expect(placeSourceRegion({ ...args, library: [overhang], solid: (x, y) => y >= 120 && !(x === unsampled.x - 1024 && y === unsampled.y),
      onAdmission: receipt => { unsupported = receipt; } })).to.equal(null);
    expect(unsupported.attempts[0].reason).to.equal('complete-source-support');
    let rejected, unavailable;
    expect(placeSourceRegion({ ...args, library: [overhang], steel: () => true, onAdmission: receipt => { rejected = receipt; } })).to.equal(null);
    expect(rejected.attempts[0].reason).to.equal('protected-steel');
    expect(placeSourceRegion({ ...args, library: [], onAdmission: receipt => { unavailable = receipt; } })).to.equal(null);
    expect(unavailable.status).to.equal('unavailable'); expect(unavailable.attempts).to.deep.equal([]);
  });
  it('retains bounded rejected pair receipts on actual fallback without replacing the known Crystal source shoulder or basin', async () => {
    const crystal = await loadProcgenTerrain('lemmings', 4); crystal.configure(1, 16, { laneHeight: 144 });
    const left = crystal.describe(8, 10), right = crystal.describe(8, 11), receipt = left.sourceRegionAdmission;
    expect(receipt).to.equal(right.sourceRegionAdmission); expect(receipt.status).to.equal('rejected');
    expect(receipt.attempts).to.have.length(4); expect(left.sharedSpan).to.equal(undefined); expect(right.sharedSpan).to.equal(undefined);
    expect(receipt.attempts[0].id).to.equal('lemmings/4/f11cb727f7c674e7');
    expect(right.assemblies.map(assembly => assembly.id)).to.deep.equal(['lemmings/4/2a9029a0955fcf7f']);
    expect(right.placements.map(placement => [placement.piece.id, 1408 + placement.x, placement.y])).to.deep.equal([[11, 1421, 60], [11, 1437, 68], [11, 1453, 76]]);
    for (const [x, top] of [[1420, 109], [1421, 103], [1422, 97], [1423, 91], [1424, 85], [1425, 79]]) {
      expect(crystal.solidSample(8, 11, x % 128, top, right)).to.equal(true);
      expect(crystal.solidSample(8, 11, x % 128, top - 1, right)).to.equal(false);
    }
    const wall = crystal.describe(8, 13);
    expect(wall.assemblies[0].bounds).to.deep.equal({ x1: 1672, x2: 1768, y1: 49, y2: 132 });
    expect(crystal.solidSample(8, 13, 1693 % 128, 110, wall)).to.equal(true);
    const basin = crystal.describe(8, 15).objects.find(object => object.basin).basin;
    expect(basin.object).to.include({ id: 6, x: 1947, y: 124, width: 64, height: 16 });
    const sequential = await loadProcgenTerrain('lemmings', 4); sequential.configure(1, 16, { laneHeight: 144 });
    sequential.sourceRegions = sequential.sourceRegions.map(group => ({ ...group, sourceStrata: ['sequential'] }));
    for (let chunk = 0; chunk < 16; chunk++) {
      const current = crystal.getChunk(8, chunk, true), before = sequential.getChunk(8, chunk, true);
      for (const field of ['pixels', 'solid', 'steel']) expect(current[field]).to.deep.equal(before[field]);
    }
    crystal.descriptionLimit = 2; crystal.describe(8, 100);
    expect(crystal.describe(8, 11).sourceRegionAdmission).to.deep.equal(receipt);
    expect(Object.isFrozen(receipt.attempts[0].shapes)).to.equal(true);
  });
  it('keeps the real Pillar seam source continuous with exact whole native alpha, color and full support provenance', async () => {
    const pillar = await loadProcgenTerrain('lemmings', 3), left = pillar.describe(42, 20), right = pillar.describe(42, 21), region = left.region;
    expect(region.sourceAtom).to.equal('lemmings/3/64398f3a82bf1074');
    expect(right.region).to.equal(region); expect(region.supportContacts).to.have.length(42);
    const placement = left.placements.find(member => member.sourceRegion === region), expected = compileTerrainGroup({ placements: region.sourcePlacements },
      new Map(pillar.pieces.map(piece => [piece.id, piece])), placement.piece.width, placement.piece.height);
    for (let x = 120; x < 136; x++) for (let dy = 0; dy < placement.piece.height; dy++) {
      const chunk = x < 128 ? 20 : 21, descriptor = x < 128 ? left : right, local = x % 128;
      const at = dy * placement.piece.width + x - placement.x, y = placement.y + dy;
      assert.equal(pillar.solidSample(42, chunk, local, y, descriptor), !(expected.frame[at] & 128));
      assert.equal(pillar.rasterSample(42, chunk, local, y, descriptor), expected.rgba[at]);
      assert.equal(pillar.steelSample(42, chunk, local, y, descriptor), false);
    }
    expect(pillar.rasterSample(42, 20, 120, 20, left)).to.equal(4284543216);
    expect(left.sourceRegionAdmission.status).to.equal('admitted');
    expect(left.sourceRegionAdmission).to.equal(right.sourceRegionAdmission);
  });

});
