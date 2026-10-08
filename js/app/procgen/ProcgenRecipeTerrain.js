import { composeRecipeChunk } from './ProcgenTerrainRecipes.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { createProcgenWordPlanner } from './ProcgenWords.js';

const TERRAIN_CHUNK_WIDTH = 128;
const TERRAIN_HEIGHT = 96;
const PHASE_CHUNKS = 4;
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const keyFor = (seed, chunk) => `${seed}:${chunk}`;
const opaque = value => (value | 0xff000000) >>> 0;

// Source motifs are ingredients, not an endless repeating track. Only requested
// frontier chunks are composed; collision and display have separate bounded caches.
class ProcgenRecipeTerrain {
  constructor({ recipe, terrainPieces, objectPieces = [] }) {
    if (!recipe?.routes?.length) throw new Error('The selected theme has no sourced terrain recipes');
    this.recipe = recipe;
    this.pieces = terrainPieces.filter(p => p?.frame?.length && p.width && p.height);
    this.wordPlanner = createProcgenWordPlanner(recipe, this.pieces);
    this.ingredients = this.wordPlanner ? this.pieces.filter(piece => !this.wordPlanner.ids.has(piece.id)) : this.pieces;
    this.objects = objectPieces.filter(p => p?.image?.frames?.[0]?.length && p.image.width && p.image.height);
    this.patterns = recipe.routes.map((route, index) => composeRecipeChunk({ recipe: { ...recipe, routes: [route] }, terrainPieces,
      seed: index + 1, width: route.period * Math.ceil(TERRAIN_CHUNK_WIDTH / route.period), height: TERRAIN_HEIGHT, surfaceY: 72, decoration: false }));
    for (const pattern of this.patterns) {
      pattern.columnColors = new Uint32Array(pattern.width * TERRAIN_HEIGHT);
      for (let x = 0; x < pattern.width; x++) {
        const top = pattern.topProfile[x]; if (top < 0) continue;
        let color = opaque(pattern.pixels[top * pattern.width + x]);
        for (let dy = 0; dy < TERRAIN_HEIGHT; dy++) {
          const y = top + dy % (TERRAIN_HEIGHT - top);
          if (pattern.mask[y * pattern.width + x]) color = opaque(pattern.pixels[y * pattern.width + x]);
          pattern.columnColors[x * TERRAIN_HEIGHT + dy] = color;
        }
      }
    }
    this.chunkWidth = TERRAIN_CHUNK_WIDTH;
    this.collision = new Map();
    this.rasters = new Map();
    this.collisionLimit = 256;
    this.rasterLimit = 96;
    this.stats = { generated: 0, rasterized: 0, evicted: 0, generationMs: 0, maxGenerationMs: 0, groundPlacements: 0, decorPlacements: 0, objectPlacements: 0 };
    this.generationSamples = new Float32Array(1024); this.generationSampleCount = 0;
    this.selectedTerrainIds = new Set();
    this.selectedObjectIds = new Set();
    this._lastKey = null; this._lastChunk = null;
  }
  configure(laneCount, maxActors = 16384) { this.collisionLimit = Math.max(256, Math.min(32768, maxActors + laneCount * 2)); }
  reset() { this.collision.clear(); this.rasters.clear(); this._lastKey = null; this._lastChunk = null; }
  get memoryMB() {
    let bytes = this.patterns.reduce((n, p) => n + p.pixels.byteLength + p.mask.byteLength + p.topProfile.byteLength + p.columnColors.byteLength, 0);
    for (const p of this.collision.values()) bytes += p.solid.byteLength + p.steel.byteLength + p.topProfile.byteLength;
    for (const p of this.rasters.values()) bytes += p.byteLength;
    return bytes / 1048576;
  }
  _code(seed, chunk) { return mix(seed ^ Math.imul(chunk + 1, 0x85ebca6b)); }
  describe(seed, chunk) {
    const code = this._code(seed, chunk), phase = Math.floor(chunk / PHASE_CHUNKS), phaseCode = this._code(seed ^ 0x51ed270b, phase);
    const origin = chunk * TERRAIN_CHUNK_WIDTH;
    const gap = chunk > 0 && (code & 3) === 0;
    const placements = [];
    const count = 3 + phaseCode % 5;
    for (let i = 0; i < count; i++) {
      // Every source piece is eligible. A rotating phase window changes the pool
      // without the old size/solidity filters silently excluding pack artwork.
      const piece = this.ingredients[(phaseCode % this.ingredients.length + (chunk % PHASE_CHUNKS) * count + i) % this.ingredients.length];
      const h = mix(code ^ Math.imul(i + 1, 0x9e3779b1));
      const decor = i !== 0 || chunk === 0;
      placements.push({ piece, x: 8 + h % Math.max(1, TERRAIN_CHUNK_WIDTH - Math.min(piece.width, 100) - 8),
        y: decor ? 3 + (h >>> 8) % 72 : 44 + (h >>> 8) % 22, flip: !!(h & 0x8000), decor });
    }
    const descriptor = { code, phase, phaseCode, origin, placements,
      left: this._elevation(seed, chunk), right: this._elevation(seed, chunk + 1), middle: 28 + (phaseCode >>> 9) % 47,
      gapX: origin + 88 + (code >>> 5) % 8, gapWidth: gap ? 5 + (code >>> 10) % 8 : 0,
      barrierX: origin + (placements[0]?.x || 0), barrierWidth: chunk ? (placements[0]?.piece.width || 0) : 0 };
    descriptor.word = this.wordPlanner?.plan(seed, chunk, TERRAIN_CHUNK_WIDTH, x => {
      if (x + origin >= descriptor.gapX && x + origin < descriptor.gapX + descriptor.gapWidth) return 0;
      let surface = this._surface(seed, chunk, x, descriptor);
      for (const placement of placements) if (!placement.decor && x >= placement.x && x < placement.x + placement.piece.width) surface = Math.min(surface, placement.y);
      return surface;
    }) || null;
    if (descriptor.word) {
      const word = descriptor.word;
      descriptor.placements = placements.filter(p => !p.decor || p.x + p.piece.width <= word.x - 2 || p.x >= word.x + word.width + 2 || p.y + p.piece.height <= word.y - 2 || p.y >= word.baseline + 2);
      descriptor.placements.push(...word.placements);
    }
    descriptor.objects = this._placeObjects(seed, chunk, descriptor);
    return descriptor;
  }
  objectsAt(seed, chunk) { return this.describe(seed, chunk).objects; }
  _placeObjects(seed, chunk, descriptor) {
    const { origin, code, phaseCode } = descriptor, objects = [];
    const objectCount = this.objects.length ? 1 + (phaseCode >>> 8) % 2 : 0;
    for (let i = 0; i < objectCount; i++) {
      const piece = this.objects[(chunk * 2 + i + seed % this.objects.length) % this.objects.length], image = piece.image;
      if (image.width > TERRAIN_CHUNK_WIDTH - 16 || image.height > TERRAIN_HEIGHT - 2) continue;
      const x = origin + 8 + ((code >>> (i * 3)) % Math.max(1, TERRAIN_CHUNK_WIDTH - image.width - 8));
      const trigger = image.trigger_effect_id;
      const role = trigger === TriggerTypes.ONEWAY_LEFT || trigger === TriggerTypes.ONEWAY_RIGHT ? 'terrain-overlay' :
        trigger === TriggerTypes.DROWN ? 'liquid' : trigger === TriggerTypes.TRAP ? 'trap' :
          trigger === TriggerTypes.KILL || trigger === TriggerTypes.FRYING ? 'hazard' :
            trigger === TriggerTypes.EXIT_LEVEL || image.animationLoop === false ? 'structure' : 'ambient';
      let floor = 0, supported = true;
      if (role !== 'ambient') for (let dx = -1; dx <= image.width; dx++) {
        const localX = x - origin + dx;
        if (localX + origin >= descriptor.gapX && localX + origin < descriptor.gapX + descriptor.gapWidth) { supported = false; break; }
        const pattern = this.patterns[mix(phaseCode ^ code) % this.patterns.length];
        if (pattern.topProfile[(localX + origin) % pattern.width] < 0) { supported = false; break; }
        floor = Math.max(floor, this._surface(seed, chunk, localX, descriptor));
      }
      if (!supported) continue;
      const y = role === 'terrain-overlay' ? Math.min(TERRAIN_HEIGHT - image.height, floor + 4) :
        role === 'liquid' ? Math.min(TERRAIN_HEIGHT - image.height - 2, floor - 4) :
          role === 'ambient' ? 2 + (code >>> 12) % 18 : floor - image.height;
      if (y < 0) continue;
      const word = descriptor.word;
      if (word && x + image.width > origin + word.x - 2 && x < origin + word.x + word.width + 2 && y + image.height > word.y - 2 && y < word.baseline + 2) continue;
      objects.push({ piece, x, y, role, phase: code % image.frames.length, interactive: false,
        animation: trigger === TriggerTypes.TRAP || image.animationLoop === false ? 'idle' : 'loop',
        clipToTerrain: role === 'terrain-overlay', supportY: role === 'ambient' || role === 'terrain-overlay' ? null : y + image.height });
    }
    return objects;
  }
  solidSample(seed, chunk, x, y, descriptor = this.describe(seed, chunk)) {
    if (x < 0 || x >= TERRAIN_CHUNK_WIDTH || y < 0 || y >= TERRAIN_HEIGHT) return false;
    const pattern = this.patterns[mix(descriptor.phaseCode ^ descriptor.code) % this.patterns.length];
    let solid = pattern.topProfile[(x + descriptor.origin) % pattern.width] >= 0 && y >= this._surface(seed, chunk, x, descriptor);
    for (const placement of descriptor.placements) if (!placement.decor) {
      const { piece } = placement, dx = x - placement.x, dy = y - placement.y;
      if (dx >= 0 && dx < piece.width && dy >= 0 && dy < piece.height && !(piece.frame[dy * piece.width + (placement.flip ? piece.width - 1 - dx : dx)] & 128)) solid = true;
    }
    if (x + descriptor.origin >= descriptor.gapX && x + descriptor.origin < descriptor.gapX + descriptor.gapWidth) solid = false;
    for (const object of descriptor.objects) if (object.role === 'liquid') {
      const dx = x + descriptor.origin - object.x, bottom = object.y + object.piece.image.height;
      if (dx >= 0 && dx < object.piece.image.width && y >= object.y) solid = y >= bottom;
      else if ((dx === -1 || dx === object.piece.image.width) && y >= object.y) solid = true;
    }
    return solid;
  }
  _elevation(seed, node) { return node === 0 ? 72 : 40 + this._code(seed ^ 0xc2b2ae35, node) % 39; }
  _surface(seed, chunk, x, descriptor) {
    if (chunk === 0 && x < 64) return 72;
    const { left, right, middle } = descriptor;
    // Flat shelves, abrupt climbable faces and gentle connecting slopes all
    // share exact boundary elevations, including transitions between phases.
    if (x < 24) return left;
    if (x < 48) return descriptor.code & 4 ? middle : Math.round(left + (middle - left) * (x - 24) / 24);
    if (x < 88) return middle;
    if (x < 112) return descriptor.code & 8 ? right : Math.round(middle + (right - middle) * (x - 88) / 24);
    return right;
  }
  _compose(seed, chunk, raster) {
    const start = globalThis.performance?.now?.() || 0;
    const d = this.describe(seed, chunk), width = TERRAIN_CHUNK_WIDTH, height = TERRAIN_HEIGHT;
    const pattern = this.patterns[mix(d.phaseCode ^ d.code) % this.patterns.length];
    const solid = new Uint32Array(width * height / 32), steel = new Uint32Array(solid.length);
    const pixels = raster ? new Uint32Array(width * height) : null;
    const topProfile = new Int16Array(width); topProfile.fill(-1);
    const stamp = ({ piece, x: ox, y: oy, flip, decor }) => {
      const image = piece.image, source = piece.frame || image.frames[0], sw = image.width, sh = image.height;
      for (let y = Math.max(0, -oy); y < Math.min(sh, height - oy); y++) for (let x = Math.max(0, -ox); x < Math.min(sw, width - ox); x++) {
        const ci = source[y * sw + (flip ? sw - 1 - x : x)];
        if (ci & 128) continue;
        const index = (y + oy) * width + x + ox, bit = 1 << (index & 31), at = index >>> 5;
        if (decor) { if (pixels && !(solid[at] & bit)) pixels[index] = opaque(image.palette.getColor(ci)); }
        else {
          solid[at] |= bit;
          if (piece.isSteel) steel[at] |= bit;
          if (pixels) pixels[index] = opaque(image.palette.getColor(ci));
        }
      }
    };
    // Column-shift an independently selected source motif onto this chunk's
    // elevation profile, extending its opaque columns into connected foundations.
    for (let x = 0; x < width; x++) {
      const px = (x + d.origin) % pattern.width, top = pattern.topProfile[px];
      if (top < 0) continue;
      const surface = this._surface(seed, chunk, x, d);
      for (let y = surface; y < height; y++) {
        const index = y * width + x;
        solid[index >>> 5] |= 1 << (index & 31);
        if (pixels) pixels[index] = pattern.columnColors[px * height + y - surface];
      }
    }
    for (const placement of d.placements) if (!placement.decor) stamp(placement);
    if (d.gapWidth) for (let x = d.gapX - d.origin; x < d.gapX - d.origin + d.gapWidth; x++) for (let y = 0; y < height; y++) {
      const index = y * width + x;
      solid[index >>> 5] &= ~(1 << (index & 31)); steel[index >>> 5] &= ~(1 << (index & 31));
      if (pixels) pixels[index] = 0;
    }
    for (const object of d.objects) if (object.role === 'liquid') {
      const left = object.x - d.origin, right = left + object.piece.image.width, bottom = object.y + object.piece.image.height;
      for (let x = left - 1; x <= right; x++) for (let y = object.y; y < height; y++) {
        const index = y * width + x, bit = 1 << (index & 31), at = index >>> 5;
        if (x >= left && x < right && y < bottom) { solid[at] &= ~bit; steel[at] &= ~bit; if (pixels) pixels[index] = 0; }
        else { solid[at] |= bit; if (pixels) pixels[index] = pattern.columnColors[((x + d.origin) % pattern.width) * height + Math.max(0, y - this._surface(seed, chunk, x, d))]; }
      }
    }
    if (pixels) for (const placement of d.placements) if (placement.decor) stamp(placement);
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (solid[index >>> 5] & (1 << (index & 31))) { topProfile[x] = y; break; }
    }
    const result = { ...d, solid, steel, topProfile, pixels };
    const ms = (globalThis.performance?.now?.() || start) - start;
    this.generationSamples[this.generationSampleCount++ % this.generationSamples.length] = ms;
    this.stats.generationMs += ms; this.stats.maxGenerationMs = Math.max(this.stats.maxGenerationMs, ms);
    return result;
  }
  rasterSample(seed, chunk, x, y, descriptor = this.describe(seed, chunk)) {
    const pattern = this.patterns[mix(descriptor.phaseCode ^ descriptor.code) % this.patterns.length];
    const px = (x + descriptor.origin) % pattern.width, surface = this._surface(seed, chunk, x, descriptor);
    let solid = pattern.topProfile[px] >= 0 && y >= surface;
    let color = solid ? pattern.columnColors[px * TERRAIN_HEIGHT + y - surface] : 0;
    const pieceColor = placement => {
      const piece = placement.piece, dx = x - placement.x, dy = y - placement.y;
      if (dx < 0 || dx >= piece.width || dy < 0 || dy >= piece.height) return 0;
      const ci = piece.frame[dy * piece.width + (placement.flip ? piece.width - 1 - dx : dx)];
      return ci & 128 ? 0 : opaque(piece.image.palette.getColor(ci));
    };
    for (const placement of descriptor.placements) if (!placement.decor) {
      const stamped = pieceColor(placement); if (stamped) { color = stamped; solid = true; }
    }
    if (x + descriptor.origin >= descriptor.gapX && x + descriptor.origin < descriptor.gapX + descriptor.gapWidth) { color = 0; solid = false; }
    for (const object of descriptor.objects) if (object.role === 'liquid') {
      const dx = x + descriptor.origin - object.x, bottom = object.y + object.piece.image.height;
      if (y >= object.y && dx >= -1 && dx <= object.piece.image.width) {
        solid = dx < 0 || dx === object.piece.image.width || y >= bottom;
        color = solid ? pattern.columnColors[px * TERRAIN_HEIGHT + Math.max(0, y - surface)] : 0;
      }
    }
    if (!solid) for (const placement of descriptor.placements) if (placement.decor) color = pieceColor(placement) || color;
    return color;
  }
  getChunk(seed, chunk, raster = false) {
    const key = keyFor(seed, chunk);
    let result = key === this._lastKey ? this._lastChunk : this.collision.get(key);
    let pixels = raster && this.rasters.get(key);
    if (!result || raster && !pixels) {
      const composed = this._compose(seed, chunk, raster), composedPixels = composed.pixels;
      if (!result) {
        result = composed; result.pixels = null;
        while (this.collision.size >= this.collisionLimit) { this.collision.delete(this.collision.keys().next().value); this.stats.evicted++; }
        this.collision.set(key, result); this.stats.generated++;
        for (const p of result.placements) { this.selectedTerrainIds.add(p.piece.id); this.stats[p.decor ? 'decorPlacements' : 'groundPlacements']++; }
        for (const p of result.objects) { this.selectedObjectIds.add(p.piece.id); this.stats.objectPlacements++; }
      }
      if (raster) {
        pixels = composedPixels;
        while (this.rasters.size >= this.rasterLimit) this.rasters.delete(this.rasters.keys().next().value);
        this.rasters.set(key, pixels); this.stats.rasterized++;
      }
    }
    this._lastKey = key; this._lastChunk = result;
    return raster ? { ...result, pixels } : result;
  }
  collisionAt(seed, x, y, steel = false) {
    if (x < 0 || y < 0 || y >= TERRAIN_HEIGHT) return false;
    const p = this.getChunk(seed, Math.floor(x / TERRAIN_CHUNK_WIDTH));
    const index = y * TERRAIN_CHUNK_WIDTH + x % TERRAIN_CHUNK_WIDTH;
    return !!((steel ? p.steel : p.solid)[index >>> 5] & (1 << (index & 31)));
  }
  surface(seed, x) { return this.getChunk(seed, Math.floor(x / TERRAIN_CHUNK_WIDTH)).topProfile[x % TERRAIN_CHUNK_WIDTH]; }
  isFlat(seed, x) { const y = this.surface(seed, x); return y >= 0 && this.surface(seed, x + 8) === y; }
  sample(seed, x, y) {
    if (x < 0 || y < 0 || y >= TERRAIN_HEIGHT) return 0;
    const p = this.getChunk(seed, Math.floor(x / TERRAIN_CHUNK_WIDTH), true);
    return p.pixels[y * TERRAIN_CHUNK_WIDTH + x % TERRAIN_CHUNK_WIDTH];
  }
  barrier() { return 0; }
  getDebugState() {
    const samples = this.generationSamples.slice(0, Math.min(this.generationSampleCount, this.generationSamples.length)).sort();
    const percentile = fraction => samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))] || 0;
    return { ...this.stats, chunkMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }, cachedCollisionChunks: this.collision.size, cachedRasterChunks: this.rasters.size,
      collisionLimit: this.collisionLimit, rasterLimit: this.rasterLimit, memoryMB: this.memoryMB,
      terrainVocabularyUsed: this.selectedTerrainIds.size, terrainVocabularyAvailable: this.pieces.length,
      wordGlyphsAvailable: this.wordPlanner?.glyphs.size || 0, wordChoicesAvailable: this.wordPlanner?.choices.length || 0,
      objectVocabularyUsed: this.selectedObjectIds.size, objectVocabularyAvailable: this.objects.length, phaseChunks: PHASE_CHUNKS }; }
}
export { ProcgenRecipeTerrain, TERRAIN_CHUNK_WIDTH, TERRAIN_HEIGHT };
