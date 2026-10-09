import { expect } from 'chai';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { placeSourceColumn, MAX_COLUMN_PIECES } from '../js/app/procgen/ProcgenTerrainColumns.js';

describe('complete supported source column silhouettes', function() {
  this.timeout(30000);
  it('stacks unchanged actual dirt art bottom-up with a complete base/cap, no clipped wedges and matching growth channels', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0); terrain.configure(1, 16, { laneHeight: 144 });
    expect(terrain.columnLibrary.length).to.be.greaterThan(0);
    const descriptor = { code: 3, origin: 2048, phaseCode: 0, progression: { difficulty: 1 }, left: 120, middle: 120, right: 120, gapX: 2140, gapWidth: 0, objects: [], assemblies: [], placements: [] };
    const members = placeSourceColumn({ library: terrain.columnLibrary, code: 3, origin: 2048, height: 144, surface: () => 120,
      solid: (_x, y) => y >= 120, steel: () => false, occupied: [], gapX: 92, gapWidth: 0, sourceRevision: terrain.recipe.assetSha256 });
    expect(members.length).to.be.within(2, MAX_COLUMN_PIECES); expect(members.at(-1).y).to.equal(0);
    const column = members[0].sourcedColumn, piece = members[0].piece;
    expect(members.every(p => p.piece === piece && p.f === column.sourceFlags && p.x === column.x && p.y >= 0 && p.y + piece.height <= 120)).to.equal(true);
    expect(column.sourceRevision).to.equal(terrain.recipe.assetSha256); expect(column.provenance).to.exist;
    descriptor.placements.push(...members); terrain.descriptions.set('42:16', descriptor);
    const final = terrain.getChunk(42, 16, true), plan = terrain.growthPlan(42, 16), active = new Uint8Array(plan.jobs.length), state = { plan, active, complete: false };
    expect(plan.jobs.length).to.be.at.most(32);
    for (const job of plan.jobs) if (job.kind === 'foundation') active[job.index] = 1;
    let prior = null;
    for (const member of members) {
      const at = plan.placementJobs[descriptor.placements.indexOf(member)], job = plan.jobs[at];
      if (prior != null) expect(job.dependencies).to.include(prior);
      for (const dependency of job.dependencies) active[dependency] = 1; active[at] = 1; prior = at;
    }
    for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) {
      const index = y * 128 + x, bit = 1 << (index & 31);
      expect(terrain.solidSample(42, 16, x, y, descriptor, state)).to.equal(!!(final.solid[index >>> 5] & bit));
      expect(terrain.rasterSample(42, 16, x, y, descriptor, state)).to.equal(final.pixels[index]);
      expect(terrain.steelSample(42, 16, x, y, descriptor, state)).to.equal(!!(final.steel[index >>> 5] & bit));
    }
    expect(Array.from({ length: piece.width }, (_, x) => x).some(x => Array.from({ length: 120 }, (_, y) => y).every(y => terrain.solidSample(42, 16, column.x + x, y, descriptor)))).to.equal(true);
  });
  it('suppresses early, unsupported, occupied, steel and gap footprints as whole complete motifs', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0), defaults = { library: terrain.columnLibrary, code: 3, origin: 2048, height: 144,
      surface: () => 120, solid: (_x, y) => y >= 120, steel: () => false, occupied: [], gapX: 92, gapWidth: 0, sourceRevision: terrain.recipe.assetSha256 };
    expect(placeSourceColumn(defaults).length).to.be.greaterThan(0);
    for (const changed of [{ origin: 512 }, { solid: () => false }, { steel: () => true }, { surface: x => x % 2 ? 120 : 119 }, { gapX: 50, gapWidth: 4 }, { occupied: [{ x: 48, piece: { width: 32 } }] }]) expect(placeSourceColumn({ ...defaults, ...changed })).to.deep.equal([]);
  });
});
