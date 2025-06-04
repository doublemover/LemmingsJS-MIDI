import { Lemmings } from './LemmingsNamespace.js';

class GroundRenderer {
  constructor () {
    this.img = null;
    this.steelImg = null;
  }

  /** VGA‑spec levels reuse the pre‑decoded frame */
  createVgaspecMap (levelReader, vgaRenderer) {
    this.img = vgaRenderer.img;
  }

  /** Build ground bitmap once per level */
  createGroundMap (levelReader, terrainImages) {
    const { levelWidth, levelHeight, terrains } = levelReader;

    // Final combined image (steel beneath normal ground)
    this.img = new Lemmings.Frame(levelWidth, levelHeight);
    // Steel-only layer to reveal when terrain above is removed
    this.steelImg = new Lemmings.Frame(levelWidth, levelHeight);

    // Pass 1: draw all steel pieces into both the steel layer and the
    //         final image so the occupancy mask contains steel areas.
    for (let i = 0, len = terrains.length; i < len; ++i) {
      const tObj = terrains[i];
      const img = terrainImages[tObj.id];
      if (!img) continue;
      if (img.isSteel) {
        this._blit(img, tObj, 0, this.steelImg);
        this._blit(img, tObj, 0, this.img);
      }
    }

    // Pass 2: draw normal terrain over the steel layer
    for (let i = 0, len = terrains.length; i < len; ++i) {
      const tObj = terrains[i];
      const img = terrainImages[tObj.id];
      if (!img || img.isSteel) continue;
      this._blit(img, tObj, 0, this.img);
    }
  }

  _blit (srcImg, cfg, frameIdx = 0, destFrame = this.img) {
    if (!srcImg || !destFrame) return;

    const pix  = srcImg.frames[frameIdx];
    const w    = srcImg.width | 0;
    const h    = srcImg.height | 0;
    const pal  = srcImg.palette;

    const destX = cfg.x | 0;
    const destY = cfg.y | 0;

    const { isUpsideDown, noOverwrite, isErase, onlyOverwrite } = cfg.drawProperties;
    const img = destFrame;

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
