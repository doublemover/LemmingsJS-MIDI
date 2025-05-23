import { Lemmings } from './LemmingsNamespace.js';

class GroundRenderer {
  constructor () {}

  /** VGA‑spec levels reuse the pre‑decoded frame */
  createVgaspecMap (levelReader, vgaRenderer) {
    this.img = vgaRenderer.img;
  }

  /** Build ground bitmap once per level */
  createGroundMap (levelReader, terrainImages) {
    const { levelWidth, levelHeight, terrains } = levelReader;
    this.img = new Lemmings.Frame(levelWidth, levelHeight);

    for (let i = 0, len = terrains.length; i < len; ++i) {
      const tObj = terrains[i];
      this._blit(terrainImages[tObj.id], tObj);
    }
  }

  _blit (srcImg, cfg, frameIdx = 0) {
    if (!srcImg) return;

    const pix  = srcImg.frames[frameIdx];
    const w    = srcImg.width | 0;
    const h    = srcImg.height | 0;
    const pal  = srcImg.palette;

    const destX = cfg.x | 0;
    const destY = cfg.y | 0;

    const { isUpsideDown, noOverwrite, isErase, onlyOverwrite } = cfg.drawProperties;
    const img = this.img;

    // Up–down variant chosen once, so the inner loop has zero branches
    if (isUpsideDown) {
      for (let y = 0; y < h; ++y) {
        const srcRow = (h - 1 - y) * w;
        const dy = y + destY;
        for (let x = 0; x < w; ++x) {
          const ci = pix[srcRow + x];
          if (ci & 0x80) continue;             // transparent
          if (isErase) {
            img.clearPixel(x + destX, dy);
          } else {
            img.setPixel(x + destX, dy, pal.getColor(ci), noOverwrite, onlyOverwrite);
          }
        }
      }
    } else {
      for (let y = 0; y < h; ++y) {
        const srcRow = y * w;
        const dy = y + destY;
        for (let x = 0; x < w; ++x) {
          const ci = pix[srcRow + x];
          if (ci & 0x80) continue;
          if (isErase) {
            img.clearPixel(x + destX, dy);
          } else {
            img.setPixel(x + destX, dy, pal.getColor(ci), noOverwrite, onlyOverwrite);
          }
        }
      }
    }
  }
}

Lemmings.GroundRenderer = GroundRenderer;
export { GroundRenderer };
