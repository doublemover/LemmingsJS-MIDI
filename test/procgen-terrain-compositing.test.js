import { expect } from 'chai';
import assert from 'node:assert/strict';
import { ERASE, FLIP_X, FLIP_Y, NO_OVERWRITE, ONLY_OVERWRITE, stampRecipePlacements } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { compileTerrainGroup, stampTerrainPlacement } from '../js/app/procgen/ProcgenTerrainCompositing.js';
import { createSourceGroupLibrary, placeSourceGroups } from '../js/app/procgen/ProcgenTerrainGroups.js';
import { ProcgenRecipeTerrain } from '../js/app/procgen/ProcgenRecipeTerrain.js';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const art = (id, extra = {}) => ({ id, width: 4, height: 4, frame: Uint8Array.from({ length: 16 }, (_, at) => at % 5 ? at + 1 : 128),
  image: { width: 4, height: 4, palette: { getColor: ci => (0xff102030 + ci) >>> 0 } }, ...extra });
const observed = (role, placements) => ({ role, placements, count: 1, source: { level: 'lemmings/LEVEL000.DAT#0', terrainIndices: placements.map((_, at) => at) } });
const bitmap = (width, height, mask, pixels) => {
  const solid = new Uint32Array(Math.ceil(width * height / 32)), steel = new Uint32Array(solid.length);
  for (let at = 0; at < mask.length; at++) if (mask[at]) solid[at >>> 5] |= 1 << (at & 31);
  return { solid, steel, pixels: pixels.slice() };
};
const parity = (group, pieces, width, height) => {
  const composite = compileTerrainGroup(group, pieces, width, height);
  for (const occupancy of ['empty', 'solid', 'mixed']) {
    const mask = Uint8Array.from({ length: width * height }, (_, at) => occupancy === 'solid' || occupancy === 'mixed' && at % 3 === 0 ? 1 : 0);
    const pixels = Uint32Array.from(mask, filled => filled ? 0xff789abc : 0);
    const expected = stampRecipePlacements({ placements: group.placements, terrainPieces: pieces, width, height, mask: mask.slice(), pixels: pixels.slice() });
    const actual = bitmap(width, height, mask, pixels);
    stampTerrainPlacement({ piece: { width, height, composite }, x: 0, y: 0 }, width, height, actual.solid, actual.steel, actual.pixels);
    for (let at = 0; at < mask.length; at++) {
      assert.equal(!!(actual.solid[at >>> 5] & (1 << (at & 31))), !!expected.mask[at]);
      assert.equal(actual.pixels[at], expected.mask[at] ? (expected.pixels[at] | 0xff000000) >>> 0 : 0);
    }
  }
};
const place = (library, groups, extra = {}) => placeSourceGroups({ zone: { groups, sourceRevision: 'a'.repeat(64) }, library, code: 42, chunk: 3,
  baseSurface: () => 72, baseSolid: (_x, y) => y >= 72, occupied: [], gapX: 88, gapWidth: 0, ...extra });

describe('foundation-aware observed terrain compositing', function() {
  this.timeout(30000);
  let pillar, marble;
  before(async () => { pillar = await loadProcgenTerrain('lemmings', 1); marble = await loadProcgenTerrain('lemmings', 2); });
  it('stores bounded cold route proposals without inferring verification or changing source geometry', () => {
    const rect = (x, width) => ({ x, y: 72, width, height: 16 });
    const record = { schemaVersion: 1, id: 'cold-proposal', version: 1, source: { kind: 'repo-fixture', reference: 'test/procgen-terrain-compositing.test.js', engine: 'LemmingsJS', port: 'current' },
      geometry: { bounds: { x: 0, y: 0, width: 128, height: 96 }, entry: rect(8, 8), exit: rect(112, 8), containment: [] },
      inventory: { builder: 0, basher: 0, digger: 0, miner: 0 }, crew: { min: 1, max: 8, direction: 1 }, actionRules: [],
      guards: ['ordinary-whole-crew', 'zero-loss', 'protected-terrain', 'revealed-geometry'], failureCases: ['Unqualified until an actual independent whole-crew replay succeeds'] };
    const proposals = [record], args = { recipe: pillar.recipe, terrainPieces: pillar.pieces, objectPieces: pillar.objects, sourceDescriptor: pillar.sourceDescriptor, assemblyCatalog: pillar.assemblyCatalog };
    const candidate = new ProcgenRecipeTerrain({ ...args, routeContracts: proposals }), baseline = new ProcgenRecipeTerrain(args); proposals.length = 0;
    expect(candidate.routeContracts).to.have.length(1); expect(Object.isFrozen(candidate.routeContracts)).to.equal(true);
    expect(candidate.getDebugState().proposedRouteContracts).to.equal(1); expect(candidate.routeContracts[0]).not.to.have.property('verified');
    expect(candidate.getChunk(42, 11, true).pixels).to.deep.equal(baseline.getChunk(42, 11, true).pixels);
    expect(() => new ProcgenRecipeTerrain({ ...args, routeContracts: Array(65).fill(record) })).to.throw(TypeError);
  });
  it('matches ordered shared stamps for empty/solid/mixed foundations and all conditional/erase/flip flags', () => {
    const pieces = new Map([[1, art(1)], [2, art(2)]]);
    for (const flags of [0, ERASE, NO_OVERWRITE, ONLY_OVERWRITE, FLIP_X | FLIP_Y, NO_OVERWRITE | FLIP_Y, ONLY_OVERWRITE | FLIP_X, ERASE | NO_OVERWRITE | ONLY_OVERWRITE]) {
      const group = observed('overlap', [{ id: 1, x: 0, y: 0, f: NO_OVERWRITE }, { id: 2, x: 2, y: 1, f: flags }]);
      parity(group, pieces, 6, 5);
    }
  });
  it('keeps regular source stamp flags, clipping and predecoded RGBA compatible with the shared stamper', () => {
    const piece = art(1); piece.rgba = Uint32Array.from(piece.frame, ci => ci & 128 ? 0 : piece.image.palette.getColor(ci));
    for (const flags of [0, ERASE, NO_OVERWRITE, ONLY_OVERWRITE, FLIP_X, FLIP_Y, FLIP_X | FLIP_Y]) {
      const placement = { id: 1, x: -1, y: 1, f: flags }, mask = Uint8Array.from({ length: 16 }, (_, at) => at % 2), pixels = Uint32Array.from(mask, filled => filled ? 0xffabcdef : 0);
      const expected = stampRecipePlacements({ placements: [placement], terrainPieces: [piece], width: 4, height: 4, mask: mask.slice(), pixels: pixels.slice() }), actual = bitmap(4, 4, mask, pixels);
      stampTerrainPlacement({ ...placement, piece }, 4, 4, actual.solid, actual.steel, actual.pixels);
      for (let at = 0; at < mask.length; at++) { assert.equal(!!(actual.solid[0] & (1 << at)), !!expected.mask[at]); assert.equal(actual.pixels[at], expected.pixels[at]); }
    }
  });
  it('preserves retained color/steel with no-overwrite, removes both on erase, and replaces only occupied pixels', () => {
    const pieces = new Map([[1, art(1, { frame: new Uint8Array(16), isSteel: true })], [2, art(2, { frame: new Uint8Array(16) })]]);
    const compose = flags => {
      const group = observed('overlap', [{ id: 1, x: 0, y: 0, f: 0 }, { id: 2, x: 2, y: 0, f: flags }]);
      const result = bitmap(6, 4, new Uint8Array(24), new Uint32Array(24));
      stampTerrainPlacement({ piece: { width: 6, height: 4, composite: compileTerrainGroup(group, pieces, 6, 4) }, x: 0, y: 0 }, 6, 4, result.solid, result.steel, result.pixels);
      return result;
    };
    const no = compose(NO_OVERWRITE), clear = compose(ERASE), only = compose(ONLY_OVERWRITE);
    const retained = bitmap(4, 4, new Uint8Array(16).fill(1), new Uint32Array(16).fill(0xff998877)); retained.steel[0] = 0xffff;
    const noGroup = observed('overlap', [{ id: 2, x: 0, y: 0, f: NO_OVERWRITE }]);
    stampTerrainPlacement({ piece: { width: 4, height: 4, composite: compileTerrainGroup(noGroup, pieces, 4, 4) }, x: 0, y: 0 }, 4, 4, retained.solid, retained.steel, retained.pixels);
    expect(retained.steel[0]).to.equal(0xffff); expect([...retained.pixels].every(color => color === 0xff998877)).to.equal(true);
    expect(!!(no.steel[0] & (1 << 2))).to.equal(true); expect(!!(no.solid[0] & (1 << 5))).to.equal(true);
    expect(!!(clear.steel[0] & (1 << 2))).to.equal(false); expect(!!(clear.solid[0] & (1 << 2))).to.equal(false); expect(clear.pixels[2]).to.equal(0);
    expect(!!(only.solid[0] & (1 << 5))).to.equal(false); expect(!!(only.steel[0] & (1 << 2))).to.equal(false);
  });
  it('admits harmless deep erasure but protects walking support, retained steel, gaps, seams and occupied words/attachments', () => {
    const erase = observed('erase', [{ id: 1, x: 0, y: 0, f: ERASE }]), piece = art(1, { frame: new Uint8Array(16) });
    const library = createSourceGroupLibrary({ groups: [erase] }, [piece]), p = place(library, [erase])[0];
    expect(p).to.include({ y: 80, decor: false }); expect(p.canonicalGroup).to.equal(erase);
    expect(place(library, [erase], { baseSteel: () => true })).to.have.length(0);
    expect(place(library, [erase], { gapX: p.x, gapWidth: 4 })).to.have.length(0);
    expect(place(library, [erase], { occupied: [{ x: p.x, y: 60, piece: { width: 4, height: 12 }, decor: true }] })).to.have.length(0);
    expect(place(library, [erase], { validate: () => false })).to.have.length(0);
    const oversized = observed('erase', [{ id: 1, x: 109, y: 0, f: ERASE }]);
    expect(createSourceGroupLibrary({ groups: [oversized] }, [piece]).size).to.equal(0);
    const supportCut = observed('erase', [{ id: 1, x: 0, y: 0, f: 0 }, { id: 1, x: 0, y: 4, f: ERASE }]);
    expect(place(createSourceGroupLibrary({ groups: [supportCut] }, [piece]), [supportCut])).to.have.length(0);
    const low = art(1, { width: 4, height: 20, frame: new Uint8Array(80), image: { width: 4, height: 20 } });
    expect(place(createSourceGroupLibrary({ groups: [erase] }, [low]), [erase])).to.have.length(0);
  });
  it('uses previous admitted stamps as conditional inputs and rejects an otherwise redundant no-overwrite group', () => {
    const one = observed('join', [{ id: 1, x: 0, y: 0, f: 0 }]), two = observed('overlap', [{ id: 2, x: 0, y: 0, f: NO_OVERWRITE }]);
    const pieces = [art(1, { frame: new Uint8Array(16) }), art(2, { frame: new Uint8Array(16) })];
    const library = createSourceGroupLibrary({ groups: [one, two] }, pieces);
    expect(place(library, [two], { code: 0 })).to.have.length(1);
    const p = place(library, [one, two], { code: 0 }); expect(p).to.have.length(1); expect(p[0].canonicalGroup).to.equal(one);
    expect(p[0].canonicalGroup.placements).to.equal(one.placements); expect(library.get(two).group.placements).to.equal(two.placements);
  });
  it('gives decorative terrain real collision and conservatively suppresses tall unsupported intro additions', () => {
    const group = observed('decoration', [{ id: 1, x: 0, y: 0, f: 0 }]), piece = art(1, { frame: new Uint8Array(16) });
    const library = createSourceGroupLibrary({ groups: [group] }, [piece]);
    expect(place(library, [group])[0]).to.include({ decor: false, y: 68 });
    expect(place(library, [group], { progression: { safeIntro: true } })).to.have.length(0);
    expect(place(library, [group], { baseSolid: () => false })).to.have.length(0);
  });
  it('uses real sourced joins/repeats/overlaps and conditional/eraser alpha, transforms, palettes and provenance', () => {
    for (const terrain of [pillar, marble]) {
      const pieces = new Map(terrain.pieces.map(p => [p.id, p]));
      for (const compiled of terrain.sourceGroups.values()) {
        const p = compiled.piece; parity(compiled.group, pieces, p.width, p.height);
        expect(terrain.sourceDescriptor.sourceLevelIds).to.include(compiled.group.source.level);
        expect(terrain.recipe.assetSha256).to.equal(terrain.sourceDescriptor.assetSha256);
      }
    }
    expect([...pillar.sourceGroups.keys()].some(g => g.placements.some(p => p.f & NO_OVERWRITE))).to.equal(true);
    expect([...marble.sourceGroups.keys()].some(g => g.role === 'erase')).to.equal(true);
  });
  it('materializes actual sourced erasure/repeat/conditional groups atomically after foundation/prior groups with collision/color/steel parity', () => {
    for (const [terrain, chunk, role] of [[marble, 11, 'erase'], [marble, 12, 'repeat'], [pillar, 2, 'decoration']]) {
      const d = terrain.describe(42, chunk), plan = terrain.growthPlan(42, chunk), group = d.placements.find(p => p.canonicalGroup?.role === role);
      expect(group).to.exist; expect(group.decor).to.equal(false); expect(plan.jobs.length).to.be.at.most(32);
      const index = d.placements.indexOf(group), job = plan.jobs[plan.placementJobs[index]];
      expect(job.sourceGroup).to.equal(group.canonicalGroup); expect(job.orderedSource).to.equal(true); expect(job.dependencies.length).to.be.greaterThan(0);
      const state = { plan, active: new Uint8Array(plan.jobs.length), complete: false }, before = new Uint32Array(128 * 96);
      for (const next of plan.jobs) {
        if (next.index === job.index) for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) before[y * 128 + x] = terrain.rasterSample(42, chunk, x, y, d, state);
        expect(next.dependencies.every(dependency => state.active[dependency])).to.equal(true); state.active[next.index] = 1;
        const plain = { ...d, placements: d.placements.map(p => !p.canonicalGroup ? p : { ...p, piece: { ...p.piece, composite: null, frame: new Uint8Array(p.piece.width * p.piece.height).fill(128) } }) };
        const expectedMask = new Uint8Array(128 * 96), expectedPixels = new Uint32Array(expectedMask.length);
        for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
          expectedMask[y * 128 + x] = terrain.solidSample(42, chunk, x, y, plain, state) ? 1 : 0;
          expectedPixels[y * 128 + x] = terrain.rasterSample(42, chunk, x, y, plain, state);
        }
        for (let at = 0; at < d.placements.length; at++) {
          const p = d.placements[at]; if (!p.canonicalGroup || !state.active[plan.placementJobs[at]]) continue;
          stampRecipePlacements({ placements: p.canonicalGroup.placements.map(member => ({ ...member, x: p.x + member.x, y: p.y + member.y })), terrainPieces: terrain.pieces,
            width: 128, height: 96, mask: expectedMask, pixels: expectedPixels });
        }
        for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
          const at = y * 128 + x; assert.equal(terrain.solidSample(42, chunk, x, y, d, state), !!expectedMask[at]);
          assert.equal(terrain.rasterSample(42, chunk, x, y, d, state), expectedMask[at] ? (expectedPixels[at] | 0xff000000) >>> 0 : expectedPixels[at]);
        }
        if (next.index === job.index) {
          let changed = 0;
          for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) if (terrain.rasterSample(42, chunk, x, y, d, state) !== before[y * 128 + x]) {
            changed++; expect(x >= group.x && x < group.x + group.piece.width && y >= group.y && y < group.y + group.piece.height).to.equal(true);
          }
          expect(changed).to.be.greaterThan(0);
        }
      }
      const final = terrain.getChunk(42, chunk, true);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
        const at = y * 128 + x, bit = 1 << (at & 31);
        assert.equal(terrain.rasterSample(42, chunk, x, y, d, state), final.pixels[at]);
        assert.equal(terrain.solidSample(42, chunk, x, y, d, state), !!(final.solid[at >>> 5] & bit));
        assert.equal(terrain.steelSample(42, chunk, x, y, d, state), !!(final.steel[at >>> 5] & bit));
      }
      for (let at = 0; at < index; at++) if (d.placements[at].canonicalGroup) expect(job.dependencies).to.include(plan.placementJobs[at]);
    }
  });
});
