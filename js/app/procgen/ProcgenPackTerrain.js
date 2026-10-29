import { selectProcgenRouteContracts } from './ProcgenRouteContracts.js';
import { ProcgenAssetManager } from '../procgenAssetManager.js';
import { ProcgenRecipeTerrain } from './ProcgenRecipeTerrain.js';
import { fingerprintTerrainImages, getPackTerrainWidthLimit, selectTerrainDescriptor } from './ProcgenTerrainDescriptors.js';
import { fingerprintObjectImages, selectAuthoredAssemblyCatalog } from './ProcgenAuthoredAssemblies.js';
import { selectThemeRecipe } from './ProcgenTerrainRecipes.js';
import { prepareAssetCollections } from '../../data/file-provider/AssetPreparationScope.js';
import { ResourceLoadError } from '../../data/file-provider/ResourceLoadError.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';

const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const procgenThemeOrder = (count, seed) => {
  const order = Array.from({ length: count }, (_, index) => index); let state = mix(seed);
  for (let at = count - 1; at > 0; at--) { state = mix(state ^ at); const other = state % (at + 1); [order[at], order[other]] = [order[other], order[at]]; }
  return order;
};
const PROCGEN_THEME_FAMILIES = Object.freeze([
  ['crystal', 'lemmings', 4], ['bubble', 'lemmings_ohNo', 3], ['dirt', 'lemmings', 0],
  ['rock', 'lemmings_ohNo', 1], ['fire', 'lemmings', 1], ['brick', 'lemmings_ohNo', 0],
  ['snow', 'lemmings_ohNo', 2], ['pillar', 'lemmings', 3], ['squasher', 'lemmings', 2],
  ['holiday-snow', 'holiday94', 2]
].map(([id, pack, groundSet]) => Object.freeze({ id, pack, groundSet, styleName: id === 'holiday-snow' ? 'snow' : id })));
const DEFAULT_PROCGEN_LANE_THEMES = Object.freeze(PROCGEN_THEME_FAMILIES.slice(0, 8).map(theme => theme.id));

class ProcgenPackTerrain {
  constructor(themes) {
    if (!themes.length) throw new Error('The selected pack has no available terrain themes');
    this.themes = themes; this.chunkWidth = themes[0].terrain.chunkWidth;
    if (themes.some(theme => theme.terrain.chunkWidth !== this.chunkWidth)) throw new Error('Pack themes require a shared collision chunk width');
    this.supportsFineGrowth = themes.some(theme => theme.terrain.supportsFineGrowth);
    this.recipe = { id: `pack:${themes.map(theme => theme.terrain.recipe.id).join(',')}` };
    this.objects = themes.flatMap(theme => theme.terrain.objects); this.pieces = themes.flatMap(theme => theme.terrain.pieces);
    this.assignments = new Map(); this.laneThemes = [];
    this.retirement = createProcgenRetirementScope();
    const owner = this;
    this.collision = { *values() { for (const theme of owner.themes) yield* theme.terrain.collision.values(); } };
  }
  registerLanes(seeds, runSeed, generation = 1) {
    this.assignments.clear(); this.laneThemes.length = seeds.length;
    const order = procgenThemeOrder(this.themes.length, runSeed), offset = (generation - 1) % order.length;
    for (let lane = 0; lane < seeds.length; lane++) {
      const requested = this.laneAssignments?.[lane % this.laneAssignments.length];
      const selected = this.themes.findIndex(theme => (theme.familyId || theme.styleName) === requested);
      const index = selected >= 0 ? selected : order[(lane + offset) % order.length];
      this.assignments.set(seeds[lane], index); this.laneThemes[lane] = this.themes[index].styleName;
    }
  }
  setLaneAssignments(assignments) {
    if (!Array.isArray(assignments) || !assignments.length || assignments.some(id => !this.themes.some(theme => (theme.familyId || theme.styleName) === id))) throw new Error('Unavailable lane theme assignment');
    this.laneAssignments = assignments.slice();
  }
  exportAssignments() { return { laneAssignments: this.laneAssignments?.slice() || null, assignments: [...this.assignments], laneThemes: this.laneThemes.slice() }; }
  restoreAssignments(data) {
    if (data.laneAssignments) this.setLaneAssignments(data.laneAssignments);
    this.assignments = new Map(data.assignments); this.laneThemes = data.laneThemes.slice();
  }
  forSeed(seed) { return this.themes[this.assignments.get(seed) ?? mix(seed) % this.themes.length].terrain; }
  configure(lanes, maxActors = 16384, options = {}) { for (const theme of this.themes) theme.terrain.configure(lanes, Math.ceil(maxActors / this.themes.length), options); this.height = this.themes[0].terrain.height; }
  reset() { for (const theme of this.themes) theme.terrain.reset(); this.assignments.clear(); }
  dispose() {
    return this.retirement.retire(this.themes.flatMap((theme, index) => [
      { name: 'terrain-' + index, run: () => theme.terrain.reset() },
      { name: 'terrain-assets-' + index, run: () => theme.releaseAssets?.() }
    ]).concat([{ name: 'terrain-references', run: () => { this.assignments.clear(); this.laneThemes.length = 0; this.objects = []; this.pieces = []; this.themes = []; } }]));
  }
  retainDescriptors(interests) {
    const grouped = new Map(this.themes.map(theme => [theme.terrain, new Map()]));
    for (const [seed, chunks] of interests) grouped.get(this.forSeed(seed)).set(seed, chunks);
    for (const [terrain, regions] of grouped) terrain.retainDescriptors(regions);
  }
  growthPlan(seed, chunk, options) { return this.forSeed(seed).growthPlan(seed, chunk, options); }
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
  peekCollisionAt(seed, x, y, steel = false, state = null) { return this.forSeed(seed).peekCollisionAt?.(seed, x, y, steel, state) ?? null; }
  get memoryMB() { return this.themes.reduce((total, theme) => total + theme.terrain.memoryMB, 0); }
  getDebugState() {
    const sources = this.themes.map(theme => ({ styleName: theme.styleName, ...theme.terrain.getDebugState() }));
    const totals = {};
    for (const key of ['descriptorCalls', 'descriptorHits', 'descriptorMisses', 'descriptorRebuilds', 'descriptorEvictions', 'growthPlanHits', 'growthPlanMisses', 'pinnedDescriptorPairs', 'descriptionLimit', 'cachedDescriptions', 'cachedGrowthPlans', 'descriptorTypedPayloadBytes', 'descriptorEstimatedMetadataBytes', 'generated', 'rasterized', 'evicted', 'generationMs', 'groundPlacements', 'decorPlacements', 'objectPlacements', 'canonicalGroups', 'canonicalSourcePlacements', 'cachedCollisionChunks', 'cachedRasterChunks', 'collisionLimit', 'rasterLimit', 'terrainVocabularyUsed', 'terrainVocabularyAvailable', 'objectVocabularyUsed', 'objectVocabularyAvailable']) totals[key] = sources.reduce((sum, theme) => sum + (theme[key] || 0), 0);
    return { ...totals, maxGenerationMs: Math.max(...sources.map(theme => theme.maxGenerationMs)), memoryMB: this.memoryMB,
      availableThemes: this.themes.map(theme => theme.styleName), laneThemes: this.laneThemes.slice(), themes: sources };
  }
}

const assertPreparationLive = (signal, id) => {
  if (signal?.aborted) throw new ResourceLoadError('cancelled', id);
};

const loadProcgenPackTerrain = async ({ styleNames, config, fileProvider, book, initialAssets = null, random = Math.random,
  signal, onProgress, maxConcurrentCollections = 3, operationId = null } = {}) => {
  if (!Array.isArray(styleNames) || !styleNames.length || styleNames.length > 16) throw new TypeError('Expected 1 to 16 terrain styles');
  const names = [...new Set(styleNames)];
  const results = await prepareAssetCollections(names.map(styleName => ({ id: styleName, prepare: async ({ signal, registerCleanup }) => {
    const assets = initialAssets?.styleName === styleName ? initialAssets : new ProcgenAssetManager({ styleName, config, fileProvider, random });
    if (assets !== initialAssets) { registerCleanup(() => assets.dispose()); await assets.load({ signal, operationId }); }
    assertPreparationLive(signal, styleName);
    const recipe = selectThemeRecipe(book, { packPath: config.path, groundSet: assets.groundSet });
    if (!recipe) throw new Error(`No source recipe for ${styleName}`);
    const assetSha256 = assets.assets.assetSha256 || await fingerprintTerrainImages(assets.assets.terrainImages);
    assertPreparationLive(signal, styleName);
    const sourceDescriptor = selectTerrainDescriptor(book, { packPath: config.path, groundSet: assets.groundSet, assetSha256 });
    const routeContracts = selectProcgenRouteContracts(book, { packPath: config.path, groundSet: assets.groundSet, assetSha256 });
    const objectSha256 = assets.assets.objectSha256 || await fingerprintObjectImages(assets.assets.gadgetImages);
    assertPreparationLive(signal, styleName);
    const assemblyCatalog = selectAuthoredAssemblyCatalog(book, { packPath: config.path, groundSet: assets.groundSet, assetSha256, objectSha256 });
    const objectPieces = (assets.assets?.gadgetImages || []).map((image, id) => ({ ...assets.assets.gadgets[id], id, image }));
    const terrain = new ProcgenRecipeTerrain({ recipe, terrainPieces: assets.terrainPieces, objectPieces, sourceDescriptor, assemblyCatalog, routeContracts, packWidthLimit: getPackTerrainWidthLimit(book, config.path) });
    registerCleanup(() => terrain.reset());
    return { styleName, terrain, releaseAssets: assets !== initialAssets ? () => assets.dispose() : null };
  } })), { signal, onProgress, concurrency: maxConcurrentCollections, operationId });
  const terrain = new ProcgenPackTerrain(results.map(result => result.value));
  terrain.unavailableThemes = [];
  return terrain;
};
const loadProcgenMixedTerrain = async (options = {}) => {
  const { configs, fileProvider, book, laneAssignments = DEFAULT_PROCGEN_LANE_THEMES, random = Math.random,
    signal, onProgress, maxConcurrentCollections = 3, operationId = null, requiredFamilies = null, prepareAll = false } = options;
  if (!Array.isArray(laneAssignments) || !laneAssignments.length || laneAssignments.length > 1024 || laneAssignments.some(id => !PROCGEN_THEME_FAMILIES.some(family => family.id === id))) {
    throw new TypeError('Unavailable required lane theme assignment');
  }
  if (requiredFamilies != null && (!Array.isArray(requiredFamilies) || !requiredFamilies.length || requiredFamilies.length > PROCGEN_THEME_FAMILIES.length ||
      new Set(requiredFamilies).size !== requiredFamilies.length || requiredFamilies.some(id => !PROCGEN_THEME_FAMILIES.some(family => family.id === id)) ||
      laneAssignments.some(id => !requiredFamilies.includes(id)))) throw new TypeError('Checkpoint required terrain families do not cover the lane assignments');
  const required = new Set(requiredFamilies || laneAssignments);
  const all = prepareAll || !Object.hasOwn(options, 'laneAssignments') && requiredFamilies == null;
  const selected = requiredFamilies ? requiredFamilies.map(id => PROCGEN_THEME_FAMILIES.find(family => family.id === id))
    : PROCGEN_THEME_FAMILIES.filter(family => all || required.has(family.id));
  const available = configs instanceof Map ? [...configs.values()] : Array.isArray(configs) ? configs : Object.values(configs || {});
  const results = await prepareAssetCollections(selected.map(family => ({ id: family.id, required: required.has(family.id), prepare: async ({ signal, registerCleanup }) => {
    const config = available.find(config => String(config.path).replace(/\\/g, '/').split('/').filter(Boolean).at(-1) === family.pack);
    if (!config) throw new ResourceLoadError('not-found', family.pack);
    const assets = new ProcgenAssetManager({ styleName: family.styleName, groundSet: family.groundSet, config, fileProvider, random });
    registerCleanup(() => assets.dispose());
    await assets.load({ signal, operationId });
    assertPreparationLive(signal, family.id);
    const loaded = await loadProcgenPackTerrain({ styleNames: [family.styleName], config, fileProvider, book, random, initialAssets: assets, signal, operationId });
    registerCleanup(() => loaded.dispose());
    const theme = loaded.themes[0];
    return { ...theme, releaseAssets: () => assets.dispose(), familyId: family.id, styleName: family.id, provenance: Object.freeze({ pack: family.pack, groundSet: family.groundSet,
      recipeId: theme.terrain.recipe.id, assetSha256: theme.terrain.recipe.assetSha256, resourceSources: assets.assets.resourceSources }) };
  } })), { signal, onProgress, concurrency: maxConcurrentCollections, operationId });
  const terrain = new ProcgenPackTerrain(results.filter(result => result.status === 'fulfilled').map(result => result.value));
  terrain.unavailableThemes = results.flatMap((result, index) => result.status === 'rejected' ? [selected[index].id] : []);
  terrain.unpreparedThemes = PROCGEN_THEME_FAMILIES.filter(family => !selected.includes(family)).map(family => family.id);
  terrain.setLaneAssignments(laneAssignments);
  return terrain;
};

export { ProcgenPackTerrain, procgenThemeOrder, loadProcgenPackTerrain, loadProcgenMixedTerrain, PROCGEN_THEME_FAMILIES, DEFAULT_PROCGEN_LANE_THEMES };
