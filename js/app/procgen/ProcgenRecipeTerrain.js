import { composeRecipeChunk } from './ProcgenTerrainRecipes.js';
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

// Intern a small set of source-derived repeating spans, shared by every lane.
// Even 1024 lanes need no additional full-width terrain image allocations.
class ProcgenRecipeTerrain {
  constructor({ recipe, terrainPieces }) {
    if (!recipe?.routes?.length) throw new Error('The selected theme has no sourced terrain recipes');
    this.recipe = recipe;
    this.pieces = terrainPieces;
    this.patterns = recipe.routes.map((route, index) => {
      const width = route.period * Math.ceil(256 / route.period);
      const pattern = composeRecipeChunk({ recipe: { ...recipe, routes: [route] }, terrainPieces, seed: index + 1,
        width, height: 96, surfaceY: 72, decoration: true });
      pattern.flat = new Uint8Array(width);
      for (let x = 0; x < width; x++) {
        let low = 96, high = 0;
        for (let dx = -8; dx < 40; dx++) { const y = pattern.topProfile[(x + dx + width) % width]; low = Math.min(low, y); high = Math.max(high, y); }
        pattern.flat[x] = high - low <= 2 ? 1 : 0;
      }
      return pattern;
    });
    this.barriers = terrainPieces.filter(piece => piece.height >= 8 && piece.height <= 24 && piece.width <= 32 && piece.solidRatio > 0.4 && !piece.isSteel);
    this.memoryMB = this.patterns.reduce((sum, pattern) => sum + pattern.pixels.byteLength + pattern.mask.byteLength + pattern.topProfile.byteLength, 0) / 1048576;
  }
  pattern(seed) { return this.patterns[mix(seed) % this.patterns.length]; }
  isFlat(seed, x) { const p = this.pattern(seed, x); return !!p.flat[x % p.width]; }
  surface(seed, x) { const p = this.pattern(seed, x); return p.topProfile[x % p.width]; }
  sample(seed, x, y) {
    const p = this.pattern(seed, x), index = y * p.width + x % p.width;
    return p.mask[index] ? p.pixels[index] : 0;
  }
  barrier(seed, x, y, originX, baseline) {
    if (!this.barriers.length) return 0;
    const piece = this.barriers[mix(seed ^ Math.floor(originX / 256)) % this.barriers.length];
    const dx = x - originX, dy = y - baseline + piece.height;
    if (dx < 0 || dx >= piece.width || dy < 0 || dy >= piece.height) return 0;
    const ci = piece.frame[dy * piece.width + dx];
    return ci & 128 ? 0 : piece.image.palette.getColor(ci);
  }
}
export { ProcgenRecipeTerrain };
