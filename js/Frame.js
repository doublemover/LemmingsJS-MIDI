// ------------------------------------------------------------
//  Frame.js
// ------------------------------------------------------------
import { Lemmings } from './LemmingsNamespace.js';

/**
 * RGBA frame buffer + 1‑bit occupancy mask.
 *
 *  — Eliminate duplicated assignments & branchy offset logic.
 *  — Flatten nested loops in drawPaletteImage to a single index loop
 *  — Hoist frequently‑used values / functions out of inner loops.
 */
class Frame {
  constructor (width, height, offsetX = 0, offsetY = 0) {
    this.width   = width   | 0;
    this.height  = height  | 0;
    this.offsetX = offsetX | 0;
    this.offsetY = offsetY | 0;

    const pixCount = this.width * this.height;
    this.data = new Uint32Array(pixCount);   // RGBA 32‑bit
    this.mask = new Uint8Array(pixCount);    // 0/1 occupancy

    this.clear();
  }

  // accessors ----------------------------------------------------------------
  getData   () { return new Uint8ClampedArray(this.data.buffer); }
  getBuffer () { return this.data; }
  getMask   () { return this.mask; }

  /** Fills entire frame black (mask = 0). */
  clear () {
    this.data.fill(Lemmings.ColorPalette.black);
    this.mask.fill(0);
  }

  /** Fills entire frame with an RGB colour (mask = 1). */
  fill (r, g, b) {
    this.data.fill(Lemmings.ColorPalette.colorFromRGB(r, g, b));
    this.mask.fill(1);
  }

  /**
   * Blit an 8‑bit indexed image into this frame at (left, top).
   * Transparent pixels carry bit 7 set (same as original engine).
   */
  drawPaletteImage (srcImg, srcWidth, srcHeight, palette, left = 0, top = 0) {
    const dest      = this.data;
    const dMask     = this.mask;
    const palLookup = palette._rgbaCache ||= /* build once */
      Uint32Array.from({ length: 128 }, (_, i) => palette.getColor(i));

    const dstStride = this.width;
    const baseX     = left  | 0;
    const baseY     = top   | 0;

    let srcIdx = 0;
    let dstIdx = (baseY * dstStride + baseX) | 0;

    for (let y = 0; y < srcHeight; ++y) {
      let lineDstIdx = dstIdx;
      for (let x = 0; x < srcWidth; ++x) {
        const colorIndex = srcImg[srcIdx++];
        if (!(colorIndex & 0x80)) {           // not transparent
          dest[lineDstIdx] = palLookup[colorIndex];
          dMask[lineDstIdx] = 1;
        }
        ++lineDstIdx;
      }
      dstIdx += dstStride;
    }
  }

  // misc helpers -------------------------------------------------------------
  drawRect (x, y, w, h, color, noOverwrite = false, onlyOverwrite = false) {
    const x2 = x + w;
    const y2 = y + h;
    for (let xx = x; xx <= x2; ++xx) {
      this.setPixel(xx, y,  color, noOverwrite, onlyOverwrite);
      this.setPixel(xx, y2, color, noOverwrite, onlyOverwrite);
    }
    for (let yy = y + 1; yy < y2; ++yy) {
      this.setPixel(x,  yy, color, noOverwrite, onlyOverwrite);
      this.setPixel(x2, yy, color, noOverwrite, onlyOverwrite);
    }
  }

  setPixel (x, y, color, noOverwrite = false, onlyOverwrite = false) {
    if ((x >>> 0) >= this.width || (y >>> 0) >= this.height) return;
    const idx = (y * this.width + x) >>> 0;
    if ((noOverwrite && this.mask[idx]) || (onlyOverwrite && !this.mask[idx])) return;
    this.data[idx] = color;
    this.mask[idx] = 1;
  }

  clearPixel (x, y) {
    if ((x >>> 0) >= this.width || (y >>> 0) >= this.height) return;
    const idx = (y * this.width + x) >>> 0;
    this.data[idx] = Lemmings.ColorPalette.black;
    this.mask[idx] = 0;
  }
}
Lemmings.Frame = Frame;
export { Frame };
