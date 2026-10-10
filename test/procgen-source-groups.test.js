import { expect } from 'chai';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceGroupLibrary, placeSourceGroups } from '../js/app/procgen/ProcgenTerrainGroups.js';
import { fingerprintTerrainImages } from '../js/app/procgen/ProcgenTerrainDescriptors.js';
import { loadProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { ProcgenRecipeTerrain } from '../js/app/procgen/ProcgenRecipeTerrain.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';

const piece = (id = 1, extra = {}) => ({ id, width: 4, height: 4, frame: Uint8Array.from({ length: 16 }, (_, i) => i + 1), image: { width: 4, height: 4, palette: { getColor: ci => ci + 0x102030 } }, ...extra });
const group = (role = 'route', placements = [{ id: 1, x: 0, y: 0, f: 0 }]) => ({ role, placements, count: 1, source: { level: 'lemmings/LEVEL000.DAT#0', terrainIndices: [0] } });
const place = (library, groups, extra = {}) => placeSourceGroups({ zone: { groups, sourceRevision: 'a'.repeat(64) }, library, code: 42, chunk: 1,
  baseSurface: () => 72, baseSolid: (x, y) => y >= 72, occupied: [], gapX: 88, gapWidth: 0, ...extra });
const provider = () => new NodeFileProvider(process.cwd());

describe('screened exact-source canonical terrain groups', function() {
  this.timeout(30000);
  it('uses the offline decoded art fingerprint and detects a changed source alpha/palette', async () => {
    const image = { width: 4, height: 4, frames: [Uint8Array.from([1, 128, 2, 3])], palette: { data: Uint32Array.of(1, 2, 3) } };
    const hash = createHash('sha256').update(Buffer.from([image.width, image.height])).update(Buffer.from(image.frames[0])).update(Buffer.from(image.palette.data.buffer)).digest('hex');
    expect(await fingerprintTerrainImages([image])).to.equal(hash);
    image.frames[0][1] = 4; expect(await fingerprintTerrainImages([image])).not.to.equal(hash);
  });
  it('preserves ordered source flip alpha and compiles measured roles while excluding missing and glyph art', () => {
    const safe = group('route', [{ id: 1, x: 0, y: 0, f: 10 }]), erase = group('route', [{ id: 1, x: 0, y: 0, f: 1 }]), overwrite = group('route', [{ id: 1, x: 0, y: 0, f: 16 }]);
    const conditional = group('route', [{ id: 1, x: 0, y: 0, f: 4 }]), other = group('join'), steel = group('route', [{ id: 2, x: 0, y: 0, f: 0 }]), glyph = group('decoration', [{ id: 3, x: 0, y: 0, f: 0 }]), missing = group('route', [{ id: 4, x: 0, y: 0, f: 0 }]);
    const library = createSourceGroupLibrary({ groups: [safe, erase, overwrite, conditional, other, steel, glyph, missing] }, [piece(), piece(2, { isSteel: true }), piece(3)], new Set([3]));
    expect(library.size).to.equal(6); expect(library.get(safe).piece.rgba[0]).to.equal((0xff102030 + 16) >>> 0);
    expect(library.get(safe).group).to.equal(safe);
  });
  it('roots route additions within two walkable pixels, protects chunk seams/gaps and requires actual support', () => {
    const route = group(), library = createSourceGroupLibrary({ groups: [route] }, [piece()]);
    const placements = place(library, [route]); expect(placements).to.have.length(1);
    const p = placements[0]; expect(p.y).to.equal(70); expect(p.x).to.be.at.least(8); expect(p.x + p.piece.width).to.be.at.most(120);
    expect(place(library, [route], { baseSolid: () => false })).to.have.length(0);
    expect(place(library, [route], { gapX: p.x, gapWidth: 6 })).to.have.length(0);
    expect(place(library, [route], { occupied: [{ ...p, decor: false }] })).to.have.length(0);
    expect(place(library, [route], { chunk: 0 })).to.have.length(0);
    expect(place(library, [route], { baseSurface: x => x === p.x ? -1 : 72 })).to.have.length(0);
  });
  it('grounds physical decoration components and rejects broken route columns', () => {
    const decoration = group('decoration'), art = piece(), library = createSourceGroupLibrary({ groups: [decoration] }, [art]);
    expect(place(library, [decoration])[0]).to.include({ decor: false, y: 68 });
    expect(place(library, [decoration], { baseSolid: () => false })).to.have.length(0);
    art.frame[4] = 128; expect(createSourceGroupLibrary({ groups: [group()] }, [art]).size).to.equal(0);
  });
  it('applies bounded real normal-pack groups with exact analytic color/collision, provenance and group-free seams', async () => {
    const p = provider(), book = await loadTerrainRecipeBook(p);
    const pack = await loadProcgenPackTerrain({ styleNames: ['pillar', 'squasher'], config: { path: 'lemmings' }, fileProvider: p, book });
    let applied = 0;
    for (const { terrain } of pack.themes) {
      expect(terrain.sourceDescriptor.pack).to.equal('lemmings'); expect(terrain.supportsFineGrowth).to.equal(true);
      for (const cx of [1, 3, 20, 100]) {
        const d = terrain.describe(42, cx), raster = terrain.getChunk(42, cx, true);
        // Complete shared source atoms may own seam pixels. Compare canonical
        // groups against the same descriptor with only those groups removed.
        const withoutGroups = { ...d, placements: d.placements.filter(placement => !placement.canonicalGroup) };
        for (const p of d.placements.filter(p => p.canonicalGroup)) {
          applied++; expect(terrain.sourceDescriptor.sourceLevelIds).to.include(p.canonicalGroup.source.level);
          expect(p.sourceRevision).to.equal(terrain.sourceDescriptor.sourceRevision); expect(p.canonicalGroup.placements.length).to.be.at.most(8);
          expect(p.x).to.be.at.least(8); expect(p.x + p.piece.width).to.be.at.most(120);
          expect(d.objects.some(o => p.x + p.piece.width > o.x - d.origin - 2 && p.x < o.x - d.origin + o.piece.image.width + 2 && p.y + p.piece.height > o.y - 2 && p.y < o.y + o.piece.image.height + 2)).to.equal(false);
        }
        for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
          const at = y * 128 + x, bit = 1 << (at & 31);
          assert.equal(terrain.rasterSample(42, cx, x, y, d), raster.pixels[at]);
          assert.equal(terrain.solidSample(42, cx, x, y, d), !!(raster.solid[at >>> 5] & bit));
          if (x < 8 || x >= 120) { assert.equal(raster.pixels[at], terrain.rasterSample(42, cx, x, y, withoutGroups)); assert.equal(!!(raster.solid[at >>> 5] & bit), terrain.solidSample(42, cx, x, y, withoutGroups)); }
        }
      }
      const first = terrain.getChunk(42, 3, true); terrain.reset(); expect(terrain.getChunk(42, 3, true).pixels).to.deep.equal(first.pixels);
    }
    expect(applied).to.be.greaterThan(0);
  });
  it('keeps changed or foreign source art on the baseline and keeps native word glyphs out of all eligible groups', async () => {
    const p = provider(), book = await loadTerrainRecipeBook(p), pack = await loadProcgenPackTerrain({ styleNames: ['fire'], config: { path: 'lemmings' }, fileProvider: p, book });
    const terrain = pack.themes[0].terrain;
    for (const group of terrain.sourceGroups.keys()) expect(group.placements.every(p => !terrain.wordPlanner.ids.has(p.id))).to.equal(true);
    const descriptor = { ...terrain.sourceDescriptor, assetSha256: '0'.repeat(64) };
    const unmatched = new ProcgenRecipeTerrain({ recipe: terrain.recipe, terrainPieces: terrain.pieces, sourceDescriptor: descriptor });
    expect(unmatched.sourceDescriptor).to.equal(null); expect(unmatched.supportsFineGrowth).to.equal(false);
    const foreign = new ProcgenRecipeTerrain({ recipe: terrain.recipe, terrainPieces: terrain.pieces, sourceDescriptor: { ...terrain.sourceDescriptor, pack: 'other-pack' } });
    expect(foreign.sourceDescriptor).to.equal(null);
  });
});
