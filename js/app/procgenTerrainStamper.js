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
  }

  stamp(piece, x, y, drawProperties = {}) {
    const level = this.level;
    if (!level || !piece?.image || !piece?.frame) return;
    const img = piece.image;
    const width = img.width | 0;
    const height = img.height | 0;
    if (width <= 0 || height <= 0) return;

    const dest32 = new Uint32Array(level.groundImage.buffer);
    const mask = level.groundMask.mask;
    const levelW = level.width | 0;
    const levelH = level.height | 0;

    const palLookup = getPaletteLookup(img.palette);
    if (!palLookup) return;

    const isUpsideDown = !!drawProperties.isUpsideDown;
    const noOverwrite = !!drawProperties.noOverwrite;
    const onlyOverwrite = !!drawProperties.onlyOverwrite;
    const isErase = !!drawProperties.isErase;

    for (let dy = 0; dy < height; dy++) {
      const srcY = isUpsideDown ? (height - 1 - dy) : dy;
      const outY = y + dy;
      if (outY < 0 || outY >= levelH) continue;
      const srcRow = srcY * width;
      const destRow = outY * levelW;
      for (let dx = 0; dx < width; dx++) {
        const outX = x + dx;
        if (outX < 0 || outX >= levelW) continue;
        const ci = piece.frame[srcRow + dx];
        if (ci & 0x80) continue;
        const idx = destRow + outX;
        if (isErase) {
          mask[idx] = 0;
          dest32[idx] = ColorPalette.black;
          continue;
        }
        if (noOverwrite && mask[idx]) continue;
        if (onlyOverwrite && !mask[idx]) continue;
        mask[idx] = 1;
        dest32[idx] = palLookup[ci];
      }
    }
  }
}

export { ProcgenTerrainStamper };
