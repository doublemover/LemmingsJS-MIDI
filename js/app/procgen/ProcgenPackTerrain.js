import { ProcgenAssetManager } from '../procgenAssetManager.js';
import { ProcgenRecipeTerrain } from './ProcgenRecipeTerrain.js';
import { fingerprintTerrainImages, getPackTerrainWidthLimit, selectTerrainDescriptor } from './ProcgenTerrainDescriptors.js';
import { fingerprintObjectImages, selectAuthoredAssemblyCatalog } from './ProcgenAuthoredAssemblies.js';
import { selectThemeRecipe } from './ProcgenTerrainRecipes.js';

const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const procgenThemeOrder = (count, seed) => {
  const order = Array.from({ length: count }, (_, index) => index); let state = mix(seed);
  for (let at = count - 1; at > 0; at--) { state = mix(state ^ at); const other = state % (at + 1); [order[at], order[other]] = [order[other], order[at]]; }
  return order;
};

class ProcgenPackTerrain {
  constructor(themes) {
    if (!themes.length) throw new Error('The selected pack has no available terrain themes');
    this.themes = themes; this.chunkWidth = themes[0].terrain.chunkWidth;
    if (themes.some(theme => theme.terrain.chunkWidth !== this.chunkWidth)) throw new Error('Pack themes require a shared collision chunk width');
    this.supportsFineGrowth = themes.some(theme => theme.terrain.supportsFineGrowth);
    this.recipe = { id: `pack:${themes.map(theme => theme.terrain.recipe.id).join(',')}` };
    this.objects = themes.flatMap(theme => theme.terrain.objects); this.pieces = themes.flatMap(theme => theme.terrain.pieces);
    this.assignments = new Map(); this.laneThemes = [];
    const owner = this;
    this.collision = { *values() { for (const theme of owner.themes) yield* theme.terrain.collision.values(); } };
  }
  registerLanes(seeds, runSeed, generation = 1) {
    this.assignments.clear(); this.laneThemes.length = seeds.length;
    const order = procgenThemeOrder(this.themes.length, runSeed), offset = (generation - 1) % order.length;
    for (let lane = 0; lane < seeds.length; lane++) {
      const index = order[(lane + offset) % order.length];
      this.assignments.set(seeds[lane], index); this.laneThemes[lane] = this.themes[index].styleName;
    }
  }
  forSeed(seed) { return this.themes[this.assignments.get(seed) ?? mix(seed) % this.themes.length].terrain; }
  configure(lanes, maxActors) { for (const theme of this.themes) theme.terrain.configure(lanes, Math.ceil(maxActors / this.themes.length)); }
  reset() { for (const theme of this.themes) theme.terrain.reset(); this.assignments.clear(); }
  growthPlan(seed, chunk) { return this.forSeed(seed).growthPlan(seed, chunk); }
  describe(seed, chunk) { const terrain = this.forSeed(seed); return { ...terrain.describe(seed, chunk), themeId: terrain.recipe.id }; }
  objectsAt(seed, chunk) { return this.forSeed(seed).objectsAt(seed, chunk); }
  getChunk(seed, chunk, raster = false) { return this.forSeed(seed).getChunk(seed, chunk, raster); }
  solidSample(seed, chunk, x, y, descriptor, state) { return this.forSeed(seed).solidSample(seed, chunk, x, y, descriptor, state); }
  rasterSample(seed, chunk, x, y, descriptor, state) { return this.forSeed(seed).rasterSample(seed, chunk, x, y, descriptor, state); }
  steelSample(seed, chunk, x, y, descriptor, state) { return this.forSeed(seed).steelSample(seed, chunk, x, y, descriptor, state); }
  surface(seed, x) { return this.forSeed(seed).surface(seed, x); }
  isFlat(seed, x) { return this.forSeed(seed).isFlat(seed, x); }
  sample(seed, x, y) { return this.forSeed(seed).sample(seed, x, y); }
  collisionAt(seed, x, y, steel = false) { return this.forSeed(seed).collisionAt(seed, x, y, steel); }
  get memoryMB() { return this.themes.reduce((total, theme) => total + theme.terrain.memoryMB, 0); }
  getDebugState() {
    const sources = this.themes.map(theme => ({ styleName: theme.styleName, ...theme.terrain.getDebugState() }));
    const totals = {};
    for (const key of ['generated', 'rasterized', 'evicted', 'generationMs', 'groundPlacements', 'decorPlacements', 'objectPlacements', 'canonicalGroups', 'canonicalSourcePlacements', 'cachedCollisionChunks', 'cachedRasterChunks', 'collisionLimit', 'rasterLimit', 'terrainVocabularyUsed', 'terrainVocabularyAvailable', 'objectVocabularyUsed', 'objectVocabularyAvailable']) totals[key] = sources.reduce((sum, theme) => sum + (theme[key] || 0), 0);
    return { ...totals, maxGenerationMs: Math.max(...sources.map(theme => theme.maxGenerationMs)), memoryMB: this.memoryMB,
      availableThemes: this.themes.map(theme => theme.styleName), laneThemes: this.laneThemes.slice(), themes: sources };
  }
}

const loadProcgenPackTerrain = async ({ styleNames, config, fileProvider, book, initialAssets = null, random = Math.random } = {}) => {
  const names = [...new Set(styleNames)].slice(0, 16);
  const results = await Promise.allSettled(names.map(async styleName => {
    const assets = initialAssets?.styleName === styleName ? initialAssets : new ProcgenAssetManager({ styleName, config, fileProvider, random });
    if (assets !== initialAssets) await assets.load();
    const recipe = selectThemeRecipe(book, { packPath: config.path, groundSet: assets.groundSet });
    if (!recipe) throw new Error(`No source recipe for ${styleName}`);
    const assetSha256 = await fingerprintTerrainImages(assets.assets.terrainImages);
    const sourceDescriptor = selectTerrainDescriptor(book, { packPath: config.path, groundSet: assets.groundSet, assetSha256 });
    const objectSha256 = await fingerprintObjectImages(assets.assets.gadgetImages);
    const assemblyCatalog = selectAuthoredAssemblyCatalog(book, { packPath: config.path, groundSet: assets.groundSet, assetSha256, objectSha256 });
    const objectPieces = (assets.assets?.gadgetImages || []).map((image, id) => ({ ...assets.assets.gadgets[id], id, image }));
    return { styleName, terrain: new ProcgenRecipeTerrain({ recipe, terrainPieces: assets.terrainPieces, objectPieces, sourceDescriptor, assemblyCatalog, packWidthLimit: getPackTerrainWidthLimit(book, config.path) }) };
  }));
  const themes = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const terrain = new ProcgenPackTerrain(themes);
  terrain.unavailableThemes = results.flatMap((result, index) => result.status === 'rejected' ? [names[index]] : []);
  return terrain;
};
export { ProcgenPackTerrain, procgenThemeOrder, loadProcgenPackTerrain };
