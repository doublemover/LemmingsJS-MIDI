import { Frame } from './Frame.js';

const paletteLookupCache = new WeakMap();

function getPaletteLookup(palette) {
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
}

class GroundRenderer {
  constructor () {}

  /** VGA‑spec levels reuse the pre‑decoded frame */
  createVgaspecMap (levelReader, vgaRenderer) {
    this.img = vgaRenderer.img;
  }

  /** Build ground bitmap once per level */
  createGroundMap (levelReader, terrainImages) {
    const { levelWidth, levelHeight, terrains } = levelReader;
    this.img = new Frame(levelWidth, levelHeight);

    for (let i = 0, len = terrains.length; i < len; ++i) {
      const tObj = terrains[i];
      this._blit(terrainImages[tObj.id], tObj);
    }
  }

  _blit (srcImg, cfg, frameIdx = 0) {
    if (!srcImg) return;

    const pix = srcImg.frames?.[frameIdx];
    if (!pix) return;

    // Optional sourceScale allows high-resolution asset sources to render in
    // classic world-space coordinates (for example 2x source pixels -> 1 world pixel).
    const srcScaleX = Math.max(1, (srcImg.sourceScaleX | 0) || 1);
    const srcScaleY = Math.max(1, (srcImg.sourceScaleY | 0) || 1);
    let srcWidth = srcImg.width | 0;
    let srcHeight = srcImg.height | 0;
    let readColor = null;
    let isOpaque = null;

    if (pix instanceof Frame) {
      srcWidth = pix.width | 0;
      srcHeight = pix.height | 0;
      const srcBuf = pix.getBuffer();
      const srcMask = pix.getMask();
      readColor = (idx) => srcBuf[idx];
      isOpaque = (idx) => srcMask[idx] !== 0;
    } else {
      const palLookup = getPaletteLookup(srcImg.palette);
      if (!palLookup) return;
      readColor = (idx) => palLookup[pix[idx]];
      isOpaque = (idx) => (pix[idx] & 0x80) === 0;
    }
    if (srcWidth <= 0 || srcHeight <= 0) return;
    const w = Math.max(1, Math.floor(srcWidth / srcScaleX));
    const h = Math.max(1, Math.floor(srcHeight / srcScaleY));

    const destX = cfg.x | 0;
    const destY = cfg.y | 0;

    const { isUpsideDown, noOverwrite, isErase, onlyOverwrite } = cfg.drawProperties;
    const img = this.img;
    const sample = (x, y) => (y * srcWidth) + x;

    // Up–down variant chosen once, so the inner loop has zero branches
    if (isUpsideDown) {
      for (let y = 0; y < h; ++y) {
        const srcY = (h - 1 - y) * srcScaleY;
        const dy = y + destY;
        for (let x = 0; x < w; ++x) {
          const idx = sample(x * srcScaleX, srcY);
          if (!isOpaque(idx)) continue;
          if (isErase) {
            img.clearPixel(x + destX, dy);
          } else {
            img.setPixel(x + destX, dy, readColor(idx), noOverwrite, onlyOverwrite);
          }
        }
      }
    } else {
      for (let y = 0; y < h; ++y) {
        const srcY = y * srcScaleY;
        const dy = y + destY;
        for (let x = 0; x < w; ++x) {
          const idx = sample(x * srcScaleX, srcY);
          if (!isOpaque(idx)) continue;
          if (isErase) {
            img.clearPixel(x + destX, dy);
          } else {
            img.setPixel(x + destX, dy, readColor(idx), noOverwrite, onlyOverwrite);
          }
        }
      }
    }
  }
}

export { GroundRenderer };
