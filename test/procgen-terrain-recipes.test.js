import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { GroundReader, loadSteelSprites } from '../js/level/GroundReader.js';
import { GroundRenderer } from '../js/render/GroundRenderer.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { mineTerrainRecipes } from '../tools/mineTerrainRecipes.js';
import { composeRecipeChunk, loadTerrainRecipeBook, selectThemeRecipe, stampRecipePlacements,
  validateTerrainRecipeBook, ERASE, FLIP_Y, NO_OVERWRITE, FLIP_X, ONLY_OVERWRITE } from '../js/app/procgen/ProcgenTerrainRecipes.js';

const provider = new NodeFileProvider(fileURLToPath(new URL('../', import.meta.url)));
const loadPieces = async ({ pack, groundSet }) => {
  const ground = await provider.loadBinary(pack, `GROUND${groundSet}O.DAT`);
  const vga = new FileContainer(await provider.loadBinary(pack, `VGAGR${groundSet}.DAT`));
  return new GroundReader(ground, vga.getPart(0), vga.getPart(1)).getTerrainImages().map((image, id) => ({ ...image, id }));
};

describe('mined terrain assembly recipes', function () {
  this.timeout(15000);
  let book;
  before(async () => { await loadSteelSprites(); book = await loadTerrainRecipeBook(provider); });

  it('covers physical classic parts, aliases, special bitmaps and distinguishes original-art examples from mined source art', () => {
    assert.equal(book.inventory.configuredAliases, 324);
    assert.equal(book.inventory.physicalClassicLevels, 298);
    assert.equal(book.inventory.tileAssemblyLevels, 296);
    assert.equal(book.inventory.specialBitmaps.length, 4);
    assert.equal(book.inventory.nonclassicLevels, 4);
    assert.equal(book.inventory.failures.length, 0);
    assert.equal(book.corpus.length, 296);
    assert.equal(new Set(book.corpus.map(level => level.id)).size, 296);
    assert.equal(book.inventory.packs.filter(pack => pack.unconfiguredPhysicalLevels === 7).length, 2);
    assert.equal(book.inventory.nonclassic.filter(level => level.status === 'analyzed').length, 2);
    assert.deepEqual(book.inventory.nonclassic.filter(level => level.status === 'excluded').map(level => level.source), ['examples/neon-cabaret/grand-revue.nxlv', 'examples/neon-cabaret/opening-night.nxlv']);
    assert.ok(book.themes.every(theme => theme.routes.length > 0 && theme.counts.erasers > 0));
    assert.ok(book.themes.some(theme => theme.routes.some(route => new Set(route.placements.map(p => p.id)).size > 1)));
    assert.ok(book.themes.every(theme => theme.motifs.repeatingGroups.length > 0));
    for (const theme of book.themes) for (const route of theme.routes) assert.ok(book.corpus.some(level => level.id === route.source.level));
  });

  it('regenerates the checked-in book byte-for-byte from all available source data', async () => {
    assert.deepEqual(await mineTerrainRecipes(), book);
  });

  it('selects by pack-local graphic set and never silently switches to unrelated artwork', () => {
    const brick = selectThemeRecipe(book, { packPath: 'lemmings_ohNo', groundSet: 0 });
    const dirt = selectThemeRecipe(book, { packPath: 'lemmings', groundSet: 0 });
    assert.equal(brick.family, 'brick'); assert.equal(dirt.family, 'dirt');
    assert.notEqual(brick.id, dirt.id);
    assert.equal(selectThemeRecipe(book, { packPath: 'missing', groundSet: 0 }), null);
    assert.equal(selectThemeRecipe(book, { packPath: 'C:\\game\\lemmings_ohNo\\', groundSet: 0 }), brick);
    assert.equal(selectThemeRecipe(book, { packPath: 'holiday93', groundSet: 1 }).family, 'rock');
  });

  it('composes every retained route from real alpha and joins neighboring chunks exactly', async () => {
    for (const theme of book.themes) {
      const terrainPieces = await loadPieces(theme.sources[0]);
      for (const route of theme.routes) {
        const recipe = { ...theme, routes: [route] };
        const options = { recipe, terrainPieces, seed: 42, decoration: false };
        const whole = composeRecipeChunk({ ...options, width: 512 });
        const a = composeRecipeChunk(options), b = composeRecipeChunk({ ...options, worldX: 256 });
        for (let y = 0; y < whole.height; y++) {
          assert.deepEqual(whole.mask.slice(y * 512, y * 512 + 256), a.mask.slice(y * 256, (y + 1) * 256), route.id);
          assert.deepEqual(whole.pixels.slice(y * 512 + 256, (y + 1) * 512), b.pixels.slice(y * 256, (y + 1) * 256), route.id);
        }
        for (let x = 0; x < whole.width; x++) {
          assert.ok(whole.topProfile[x] >= 62 && whole.topProfile[x] <= 72, route.id);
          if (x) assert.ok(Math.abs(whole.topProfile[x] - whole.topProfile[x - 1]) <= 5, route.id);
        }
        for (let p = 0; p < whole.mask.length; p++) assert.equal(whole.pixels[p] >>> 24, whole.mask[p] ? 255 : 0, route.id);
      }
    }
  });

  it('keeps deterministic source clusters safely below the traversal profile', async () => {
    const recipe = selectThemeRecipe(book, { packPath: 'lemmings', groundSet: 0 });
    const terrainPieces = await loadPieces(recipe.sources[0]);
    const base = composeRecipeChunk({ recipe, terrainPieces, decoration: false, seed: 9 });
    const decorated = composeRecipeChunk({ recipe, terrainPieces, decoration: true, seed: 9 });
    assert.deepEqual(decorated.topProfile, base.topProfile);
    assert.ok(decorated.placements.some(p => p.role === 'decoration'));
    assert.deepEqual(composeRecipeChunk({ recipe, terrainPieces, seed: 9 }), decorated);
    assert.ok(decorated.placements.every(p => Number.isInteger(p.id)));
  });

  it('matches the game renderer for source alpha, flips, erasers and overwrite masks', () => {
    const palette = new ColorPalette();
    palette.setColorRGB(1, 80, 120, 160); palette.setColorRGB(2, 180, 20, 90);
    const terrainPieces = [{ id: 0, width: 3, height: 2, frames: [Uint8Array.of(1, 128, 2, 2, 1, 1)], palette }];
    const placements = [{ id: 0, x: -1, y: 1, f: 0 }, { id: 0, x: 1, y: 2, f: FLIP_Y | FLIP_X },
      { id: 0, x: 0, y: 0, f: NO_OVERWRITE }, { id: 0, x: 2, y: 0, f: ONLY_OVERWRITE }, { id: 0, x: 2, y: 2, f: ERASE }];
    const renderer = new GroundRenderer();
    renderer.createGroundMap({ levelWidth: 6, levelHeight: 5, terrains: placements.map(p => ({ ...p,
      drawProperties: { isErase: !!(p.f & ERASE), isUpsideDown: !!(p.f & FLIP_Y), isFlippedHorizontally: !!(p.f & FLIP_X),
        noOverwrite: !!(p.f & NO_OVERWRITE), onlyOverwrite: !!(p.f & ONLY_OVERWRITE) } })) }, terrainPieces);
    const result = stampRecipePlacements({ placements, terrainPieces, width: 6, height: 5 });
    assert.deepEqual(result.mask, renderer.img.getMask());
    const expected = renderer.img.getBuffer();
    for (let i = 0; i < result.mask.length; i++) if (result.mask[i]) assert.equal(result.pixels[i], expected[i]);
  });

  it('rejects unsupported schemas, invalid recipes and missing source art', async () => {
    assert.throws(() => validateTerrainRecipeBook({ schemaVersion: 9, themes: [] }));
    assert.throws(() => validateTerrainRecipeBook({ schemaVersion: 1, themes: [{ id: 'broken', sources: [], routes: [{ period: 0 }] }] }));
    assert.throws(() => composeRecipeChunk({ recipe: book.themes[0], terrainPieces: [] }), /missing/);
    assert.throws(() => composeRecipeChunk({ recipe: { routes: [] } }), /No mined/);
    const json = await fs.readFile(new URL('../assets/procgen/terrain-recipes.json', import.meta.url), 'utf8');
    const { assemblies, ...existingRecipes } = book;
    assert.ok(Buffer.byteLength(JSON.stringify(existingRecipes)) < 450000);
    assert.ok(Buffer.byteLength(JSON.stringify(assemblies || [])) < 3000000);
  });
});
