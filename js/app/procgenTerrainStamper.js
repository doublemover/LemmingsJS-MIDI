import { ColorPalette } from '../render/ColorPalette.js';

const paletteLookupCache = new WeakMap();

const getPaletteLookup = (palette) => {
  if (!palette) return null;
  let lookup = paletteLookupCache.get(palette);
  if (!lookup) {
    lookup = new Uint32Array(128);
    for (let i = 0; i < 16; i++) {
      lookup[i] = palette.getColor(i);
    }
    paletteLookupCache.set(palette, lookup);
  }
  return lookup;
};

class ProcgenTerrainStamper {
  constructor(level) {
    this.level = level || null;
    this._dest32 = null;
    this._destBuffer = null;
    this._mask = null;
    this._levelWidth = 0;
    this._levelHeight = 0;
  }

  stamp(piece, x, y, drawProperties = {}) {
    const level = this.level;
    if (!level || !piece?.image || !piece?.frame) return;
    const img = piece.image;
    const width = img.width | 0;
    const height = img.height | 0;
    if (width <= 0 || height <= 0) return;

    this._ensureLevelViews(level);
    const dest32 = this._dest32;
    const mask = this._mask;
    const levelW = this._levelWidth;
    const levelH = this._levelHeight;
    if (!dest32 || !mask || levelW <= 0 || levelH <= 0) return;

    const palLookup = getPaletteLookup(img.palette);
    if (!palLookup) return;

    const xOffset = x | 0;
    const yOffset = y | 0;
    const srcX0 = Math.max(0, -xOffset);
    const srcY0 = Math.max(0, -yOffset);
    const srcX1 = Math.min(width, levelW - xOffset);
    const srcY1 = Math.min(height, levelH - yOffset);
    if (srcX0 >= srcX1 || srcY0 >= srcY1) return;

    const isUpsideDown = !!drawProperties.isUpsideDown;
    const noOverwrite = !!drawProperties.noOverwrite;
    const onlyOverwrite = !!drawProperties.onlyOverwrite;
    const isErase = !!drawProperties.isErase;
    const black = ColorPalette.black;
    let minX = levelW;
    let minY = levelH;
    let maxX = -1;
    let maxY = -1;

    for (let dy = srcY0; dy < srcY1; dy++) {
      const srcY = isUpsideDown ? (height - 1 - dy) : dy;
      const outY = yOffset + dy;
      const srcRow = srcY * width;
      const destRow = outY * levelW;
      for (let dx = srcX0; dx < srcX1; dx++) {
        const outX = xOffset + dx;
        const ci = piece.frame[srcRow + dx];
        if (ci & 0x80) continue;
        const idx = destRow + outX;
        if (isErase) {
          if (mask[idx] === 0 && dest32[idx] === black) continue;
          mask[idx] = 0;
          dest32[idx] = black;
          if (outX < minX) minX = outX;
          if (outY < minY) minY = outY;
          if (outX > maxX) maxX = outX;
          if (outY > maxY) maxY = outY;
          continue;
        }
        if (noOverwrite && mask[idx]) continue;
        if (onlyOverwrite && !mask[idx]) continue;
        const next = palLookup[ci];
        if (mask[idx] === 1 && dest32[idx] === next) continue;
        mask[idx] = 1;
        dest32[idx] = next;
        if (outX < minX) minX = outX;
        if (outY < minY) minY = outY;
        if (outX > maxX) maxX = outX;
        if (outY > maxY) maxY = outY;
      }
    }
    if (maxX >= minX && maxY >= minY) {
      level.applyGroundBulkChange?.(minX, minY, (maxX - minX) + 1, (maxY - minY) + 1, {
        invalidateMiniMap: true
      });
    }
  }

  /**
   * Cache typed-array views for the current level buffer so repeated stamps
   * avoid recreating `Uint32Array` wrappers in hot terrain generation paths.
   */
  _ensureLevelViews(level) {
    const image = level?.groundImage;
    const mask = level?.groundMask?.mask;
    const buffer = image?.buffer ?? null;
    if (!buffer || !mask) {
      this._dest32 = null;
      this._destBuffer = null;
      this._mask = null;
      this._levelWidth = 0;
      this._levelHeight = 0;
      return;
    }
    if (this._destBuffer !== buffer || !this._dest32) {
      this._destBuffer = buffer;
      this._dest32 = new Uint32Array(buffer);
    }
    this._mask = mask;
    this._levelWidth = level.width | 0;
    this._levelHeight = level.height | 0;
  }
}

export { ProcgenTerrainStamper };
