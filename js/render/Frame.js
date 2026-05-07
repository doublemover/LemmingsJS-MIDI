// ------------------------------------------------------------
//  Frame.js
// ------------------------------------------------------------
import { ColorPalette } from './ColorPalette.js';

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
    this.data = new Uint32Array(pixCount);   // RGBA 32-bit
    this.mask = new Uint8Array(pixCount);    // 0/1 occupancy
    this._data8 = null;
    this._spanCacheEnabled = false;
    this._spanRows = null;
    this._spanBounds = null;
    this._version = 0;
    this._spanBatchDepth = 0;
    this._spanInvalidationPending = false;

    this.clear();
  }

  // accessors ----------------------------------------------------------------
  getData   () {
    if (!this._data8) this._data8 = new Uint8ClampedArray(this.data.buffer);
    return this._data8;
  }
  getBuffer () { return this.data; }
  getMask   () { return this.mask; }
  getSpanCache () {
    if (!this._spanCacheEnabled) return null;
    if (!this._spanRows) this.#buildSpanCache();
    return { rows: this._spanRows, bounds: this._spanBounds };
  }

  enableSpanCache () {
    this._spanCacheEnabled = true;
    if (!this._spanRows) this.#buildSpanCache();
  }

  /** Fills entire frame black (mask = 0). */
  clear () {
    this.data.fill(ColorPalette.black);
    this.mask.fill(0);
    this.#invalidateSpanCache();
  }

  /** Fills entire frame with an RGB colour (mask = 1). */
  fill (r, g, b) {
    this.data.fill(ColorPalette.colorFromRGB(r, g, b));
    this.mask.fill(1);
    this.#invalidateSpanCache();
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
    this.#invalidateSpanCache();
  }

  // misc helpers -------------------------------------------------------------
  drawRect (x, y, w, h, color, noOverwrite = false, onlyOverwrite = false) {
    this.#beginSpanBatch();
    try {
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
    } finally {
      this.#endSpanBatch();
    }
  }

  drawMarchingAntRect(
    x,
    y,
    width,
    height,
    dashLen = 1,
    offset = 0,
    color1 = 0xFFFFFFFF,
    color2 = 0xFF000000
  ) {
    const pattern = dashLen * 2;
    let pos = ((offset % pattern) + pattern) % pattern;
    const set = (px, py) => {
      const useFirst = Math.floor(pos / dashLen) % 2 === 0;
      const color = useFirst ? color1 : color2;
      if ((color >>> 24) !== 0) {
        this.setPixel(px, py, color);
      }
      pos = (pos + 1) % pattern;
    };

    this.#beginSpanBatch();
    try {
      for (let dx = 0; dx <= width; dx++) set(x + dx, y);
      for (let dy = 1; dy <= height; dy++) set(x + width, y + dy);
      for (let dx = 1; dx <= width; dx++) set(x + width - dx, y + height);
      for (let dy = 1; dy < height; dy++) set(x, y + height - dy);
    } finally {
      this.#endSpanBatch();
    }
  }

  /** Draw a stippled rectangle fill (simple checkerboard pattern). */
  drawStippleRect(x, y, width, height, r = 128, g = 128, b = 128) {
    const color32 = ColorPalette.colorFromRGB(r, g, b);
    this.#beginSpanBatch();
    try {
      for (let dy = 0; dy <= height; dy++) {
        for (let dx = 0; dx <= width; dx++) {
          if (((dx + dy) & 1) !== 0) continue;
          this.setPixel(x + dx, y + dy, color32);
        }
      }
    } finally {
      this.#endSpanBatch();
    }
  }

  setPixel (x, y, color, noOverwrite = false, onlyOverwrite = false) {
    if ((x >>> 0) >= this.width || (y >>> 0) >= this.height) return;
    const idx = (y * this.width + x) >>> 0;
    if ((noOverwrite && this.mask[idx]) || (onlyOverwrite && !this.mask[idx])) return;
    this.data[idx] = color;
    this.mask[idx] = 1;
    this.#markSpanCacheDirty();
  }

  clearPixel (x, y) {
    if ((x >>> 0) >= this.width || (y >>> 0) >= this.height) return;
    const idx = (y * this.width + x) >>> 0;
    this.data[idx] = ColorPalette.black;
    this.mask[idx] = 0;
    this.#markSpanCacheDirty();
  }

  #beginSpanBatch () {
    this._spanBatchDepth += 1;
  }

  #endSpanBatch () {
    if (this._spanBatchDepth > 0) this._spanBatchDepth -= 1;
    if (this._spanBatchDepth === 0 && this._spanInvalidationPending) {
      this._spanInvalidationPending = false;
      this.#invalidateSpanCache();
    }
  }

  #markSpanCacheDirty () {
    if (this._spanBatchDepth > 0) {
      this._spanInvalidationPending = true;
      return;
    }
    this.#invalidateSpanCache();
  }

  #invalidateSpanCache () {
    this._version += 1;
    if (!this._spanCacheEnabled) return;
    this._spanRows = null;
    this._spanBounds = null;
  }

  #buildSpanCache () {
    const w = this.width;
    const h = this.height;
    const mask = this.mask;
    const rows = new Array(h);
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      let x = 0;
      let spans = null;
      while (x < w) {
        while (x < w && !mask[rowBase + x]) x++;
        if (x >= w) break;
        const start = x;
        if (start < minX) minX = start;
        if (y < minY) minY = y;
        while (x < w && mask[rowBase + x]) x++;
        const end = x;
        if (end - 1 > maxX) maxX = end - 1;
        if (y > maxY) maxY = y;
        if (!spans) spans = [];
        spans.push(start, end);
      }
      rows[y] = spans;
    }

    this._spanRows = rows;
    if (maxX >= minX && maxY >= minY) {
      this._spanBounds = { minX, minY, maxX, maxY };
    } else {
      this._spanBounds = null;
    }
  }
}
export { Frame };
