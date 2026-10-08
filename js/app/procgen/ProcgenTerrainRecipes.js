import { validateTerrainDescriptors } from './ProcgenTerrainDescriptors.js';

const RECIPE_SCHEMA_VERSION = 1;
const ERASE = 1, FLIP_Y = 2, NO_OVERWRITE = 4, FLIP_X = 8, ONLY_OVERWRITE = 16;
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

const validateTerrainRecipeBook = book => {
  if (book?.schemaVersion !== RECIPE_SCHEMA_VERSION || !Array.isArray(book.themes)) throw new Error('Unsupported terrain recipe book');
  for (const theme of book.themes) {
    if (!theme.id || !Array.isArray(theme.sources) || !Array.isArray(theme.routes)) throw new Error('Invalid terrain theme recipe');
    for (const route of theme.routes) {
      if (!Number.isInteger(route.period) || route.period < 1 || route.period > 512 || !Number.isFinite(route.topOffset)
          || !route.placements?.length || !route.source) throw new Error(`Invalid route recipe: ${theme.id}`);
      for (const p of route.placements) {
        if (![p.id, p.x, p.y, p.f].every(Number.isInteger) || p.id < 0 || p.f < 0 || p.f > 31) throw new Error(`Invalid recipe placement: ${theme.id}`);
      }
    }
  }
  if (book.descriptors != null) validateTerrainDescriptors(book.descriptors);
  return book;
};

const loadTerrainRecipeBook = async fileProvider => {
  let book;
  if (fileProvider?.loadString) book = JSON.parse(await fileProvider.loadString('assets/procgen/terrain-recipes.json'));
  else {
    const response = await fetch(new URL('../../../assets/procgen/terrain-recipes.json', import.meta.url));
    if (!response.ok) throw new Error(`Terrain recipe request failed: ${response.status}`);
    book = await response.json();
  }
  return validateTerrainRecipeBook(book);
};

const selectThemeRecipe = (book, { packPath, groundSet } = {}) => {
  const pack = String(packPath || '').replace(/\\/g, '/').replace(/\/$/, '').split('/').pop();
  return book?.themes?.find(theme => theme.sources.some(source => source.pack === pack && source.groundSet === groundSet)) || null;
};

const pieceMap = terrainPieces => terrainPieces instanceof Map ? terrainPieces : new Map((terrainPieces || []).map((piece, index) => piece ? [piece.id ?? index, piece] : null).filter(Boolean));

// The same source-alpha stamp creates both collision and color, including ordered erasers.
const stampRecipePlacements = ({ placements, terrainPieces, width, height, pixels = new Uint32Array(width * height), mask = new Uint8Array(width * height), clipTop = 0 }) => {
  const pieces = pieceMap(terrainPieces);
  for (const placement of placements) {
    const piece = pieces.get(placement.id);
    const image = piece?.image || piece;
    const frame = piece?.frame || image?.frames?.[0];
    if (!frame || !image.width || !image.height) continue;
    const sw = image.width, sh = image.height, flags = placement.f || 0;
    const x0 = Math.max(0, -placement.x), x1 = Math.min(sw, width - placement.x);
    const y0 = Math.max(0, clipTop - placement.y), y1 = Math.min(sh, height - placement.y);
    const palette = image.palette;
    for (let y = y0; y < y1; y++) {
      const sy = flags & FLIP_Y ? sh - y - 1 : y;
      for (let x = x0; x < x1; x++) {
        const sx = flags & FLIP_X ? sw - x - 1 : x;
        const colorIndex = frame[sy * sw + sx];
        if (colorIndex & 0x80) continue;
        const index = (placement.y + y) * width + placement.x + x;
        if (flags & ERASE) { mask[index] = 0; pixels[index] = 0; }
        else if (!(flags & NO_OVERWRITE && mask[index]) && !(flags & ONLY_OVERWRITE && !mask[index])) {
          mask[index] = 1;
          pixels[index] = palette?.getColor(colorIndex) ?? 0;
        }
      }
    }
  }
  return { pixels, mask };
};

const getRecipeTopProfile = (mask, width, height) => {
  const top = new Int16Array(width);
  top.fill(-1);
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    if (mask[y * width + x]) { top[x] = y; break; }
  }
  return top;
};

const composeRecipeChunk = ({ recipe, terrainPieces, seed = 1, worldX = 0, width = 256, height = 96, surfaceY = 72, variant = 0, decoration = true, role = 'route' } = {}) => {
  if (!recipe?.routes?.length) throw new Error('No mined traversable terrain recipe is available for this theme');
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 4096)) throw new RangeError('Recipe chunk dimensions must be 1..4096');
  const pieces = pieceMap(terrainPieces);
  const routes = recipe.routes.filter(route => route.placements.every(p => pieces.has(p.id)));
  if (!routes.length) throw new Error(`Terrain art is missing for recipe ${recipe.id}`);
  const route = routes[mix((seed | 0) ^ Math.imul(variant + 1, 0x9e3779b1)) % routes.length];
  const placements = [];
  const y = Math.round(surfaceY - route.topOffset);
  let extent = route.period;
  for (const p of route.placements) extent = Math.max(extent, p.x + (pieces.get(p.id)?.width || pieces.get(p.id)?.image?.width || 0));
  if (role !== 'decoration') {
    const first = Math.floor((worldX - extent) / route.period);
    const last = Math.ceil((worldX + width) / route.period);
    for (let repeat = first; repeat <= last; repeat++) for (const p of route.placements) {
      placements.push({ ...p, x: repeat * route.period + p.x - worldX, y: p.y + y, role: 'ground' });
    }
  }
  const rendered = stampRecipePlacements({ placements, terrainPieces: pieces, width, height });
  const decor = recipe.motifs?.decoration || [];
  if (decoration && decor.length) {
    const motif = decor[mix((seed | 0) ^ Math.floor(worldX / width)) % decor.length];
    const decorPlacements = motif.placements.filter(p => pieces.has(p.id)).map(p => ({ ...p,
      x: p.x + Math.floor(width * 0.58), y: p.y + surfaceY + 10, role: 'decoration' }));
    stampRecipePlacements({ placements: decorPlacements, terrainPieces: pieces, width, height, ...rendered, clipTop: surfaceY + 10 });
    placements.push(...decorPlacements);
  }
  return { ...rendered, width, height, topProfile: getRecipeTopProfile(rendered.mask, width, height), placements,
    recipeId: recipe.id, routeId: route.id, source: route.source, period: route.period, worldX };
};

export { RECIPE_SCHEMA_VERSION, ERASE, FLIP_Y, NO_OVERWRITE, FLIP_X, ONLY_OVERWRITE, validateTerrainRecipeBook,
  loadTerrainRecipeBook, selectThemeRecipe, stampRecipePlacements, getRecipeTopProfile, composeRecipeChunk };
