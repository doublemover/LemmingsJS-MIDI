/* -------------------- DisplayImage.js -------------------- */
import { BaseLogger } from '../util/LogHandler.js';
import { EventHandler } from '../util/EventHandler.js';
import { scaleImage } from '../xbrz/xbrz.js';
import { hqxScale, initHqx } from '../vendor/hqx/index.js';
initHqx();

// a simple but high quality 53-bit hash
const cyrb53 = (str, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for(let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const scaledFrameCache = new WeakMap();
const frameOpaqueCache = new WeakMap();
const MAX_SCALED_VARIANTS_PER_FRAME = 8;
const marchingAntPerimeterCache = new Map();
const marchingAntPatternCache = new Map();
const MAX_MARCHING_ANT_CACHE_ENTRIES = 256;
const MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES = 1024;
const MAX_MARCHING_ANT_FAST_PERIMETER = 2048;
const DIRTY_RECT_MERGE_PAD = 1;
const DIRTY_RECT_FULL_LIMIT = 96;
const EMPTY_DIRTY_RECTS = Object.freeze([]);

const toUint32Source = (source) => {
  if (source instanceof Uint32Array) return source;
  if (source instanceof Uint8ClampedArray || source instanceof Uint8Array) {
    return new Uint32Array(source.buffer, source.byteOffset, source.byteLength >>> 2);
  }
  return null;
};

const getMarchingAntPerimeterOffsets = (stride, width, height) => {
  const key = (stride * 8192) + (width * 128) + height;
  const cached = marchingAntPerimeterCache.get(key);
  if (cached) return cached;

  const total = (width + 1) + height + width + Math.max(0, height - 1);
  const offsets = new Int32Array(total);
  let i = 0;

  for (let dx = 0; dx <= width; dx += 1) {
    offsets[i++] = dx;
  }
  for (let dy = 1; dy <= height; dy += 1) {
    offsets[i++] = (dy * stride) + width;
  }
  for (let dx = 1; dx <= width; dx += 1) {
    offsets[i++] = (height * stride) + width - dx;
  }
  for (let dy = 1; dy < height; dy += 1) {
    offsets[i++] = ((height - dy) * stride);
  }

  if (marchingAntPerimeterCache.size >= MAX_MARCHING_ANT_CACHE_ENTRIES) {
    marchingAntPerimeterCache.clear();
  }
  marchingAntPerimeterCache.set(key, offsets);
  return offsets;
};

const getMarchingAntPaintPattern = (perimeterLen, dashLen, offset) => {
  const pattern = dashLen * 2;
  const phase = ((offset % pattern) + pattern) % pattern;
  const key = (perimeterLen * 131072) + (dashLen * 512) + phase;
  const cached = marchingAntPatternCache.get(key);
  if (cached) return cached;

  const first = [];
  const second = [];
  for (let i = 0; i < perimeterLen; i += 1) {
    const pos = (phase + i) % pattern;
    if (pos < dashLen) first.push(i);
    else second.push(i);
  }

  const result = {
    first: Int32Array.from(first),
    second: Int32Array.from(second)
  };

  if (marchingAntPatternCache.size >= MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES) {
    marchingAntPatternCache.clear();
  }
  marchingAntPatternCache.set(key, result);
  return result;
};

const isFrameFullyOpaque = (frame) => {
  if (!frame) return false;
  const version = Number.isFinite(frame._version) ? frame._version : 0;
  const cached = frameOpaqueCache.get(frame);
  if (cached && cached.version === version) {
    return cached.opaque === true;
  }
  const mask = frame.getMask();
  let opaque = true;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) {
      opaque = false;
      break;
    }
  }
  frameOpaqueCache.set(frame, { version, opaque });
  return opaque;
};

function getScaledFrameVariant(frame, dstWidth, dstHeight, mode) {
  if (!frame) return null;
  const srcW = frame.width | 0;
  const srcH = frame.height | 0;
  if (!srcW || !srcH || !dstWidth || !dstHeight) return null;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 4 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    return null;
  }

  const version = Number.isFinite(frame._version) ? frame._version : 0;
  const key = `${mode}:${dstWidth}x${dstHeight}:v${version}`;
  let variants = scaledFrameCache.get(frame);
  if (!variants) {
    variants = new Map();
    scaledFrameCache.set(frame, variants);
  } else if (variants.has(key)) {
    const cached = variants.get(key);
    // True LRU: reads promote the entry so hot scale variants stay resident.
    variants.delete(key);
    variants.set(key, cached);
    return cached;
  }

  const srcBuf = frame.getBuffer();
  const srcMask = frame.getMask();
  const maskLen = srcMask.length;
  const opaqueSrc = new Uint32Array(maskLen);
  for (let i = 0; i < maskLen; i++) {
    opaqueSrc[i] = srcMask[i] ? srcBuf[i] : 0;
  }

  const scaledMask = new Uint8Array(dstWidth * dstHeight);
  for (let dy = 0; dy < dstHeight; dy++) {
    const sy = Math.floor(dy / scale);
    const srcRow = sy * srcW;
    const dstRow = dy * dstWidth;
    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = Math.floor(dx / scale);
      scaledMask[dstRow + dx] = srcMask[srcRow + sx];
    }
  }

  const scaled = mode === 'hqx'
    ? hqxScale(opaqueSrc, srcW, srcH, scale)
    : (() => {
      const out = new Uint32Array(dstWidth * dstHeight);
      scaleImage(scale, opaqueSrc, out, srcW, srcH, 0, srcH);
      return out;
    })();

  const variant = { scaled, scaledMask };
  if (!variants.has(key) && variants.size >= MAX_SCALED_VARIANTS_PER_FRAME) {
    const firstKey = variants.keys().next().value;
    variants.delete(firstKey);
  }
  variants.set(key, variant);
  return variant;
}

class DisplayImage extends BaseLogger {
  constructor(stage) {
    super();
    this.stage = stage;
    this.onMouseUp = new EventHandler();
    this.onMouseDown = new EventHandler();
    this.onMouseRightDown = new EventHandler();
    this.onMouseRightUp = new EventHandler();
    this.onMouseMove = new EventHandler();
    this.onDoubleClick = new EventHandler();
    // 32‑bit view reused everywhere; set by initSize()
    this.buffer32 = null;
    this.background32 = null;
    this._hasBackground = false;
    this._dirtyFull = true;
    this._dirtyRects = [];
    this._dirtyRectListPool = [];
    this._dynamicDirtyFull = false;
    this._dynamicDirtyRects = [];
    this._restoreFull = false;
    this._restoreRects = [];
    // this.onMouseDown.on(e => {
    //     // this.setDebugPixel(e.x, e.y);
    // });
    this.imgData = null;
  }

  /* ---------- image helpers ---------- */
  getWidth()  { return this.imgData?.width  ?? 0; }
  getHeight() { return this.imgData?.height ?? 0; }

  /** Size of the ImageData backing this DisplayImage. */
  get worldDataSize() {
    return { width: this.getWidth(), height: this.getHeight() };
  }

  set worldDataSize({ width, height }) {
    this.initSize(width, height);
  }

  /** (Re)allocate the backing ImageData + uint32 view. */
  initSize(width, height) {
    if (!this.imgData || this.imgData.width !== width || this.imgData.height !== height) {
      this.imgData  = this.stage.createImage(this, width, height);
      // Single 32‑bit view that aliases the same buffer – no copying.
      this.buffer32 = new Uint32Array(this.imgData.data.buffer);
      this.background32 = new Uint32Array(width * height);
      this._hasBackground = false;
      this._restoreFull = false;
      this._restoreRects.length = 0;
      this._dirtyRectListPool.length = 0;
      this._dynamicDirtyFull = false;
      this._dynamicDirtyRects.length = 0;
      this.clear();
    }
  }

  /** Fast clear using .fill() on the uint32 view (default: ARGB 0xFF00FF00). */
  clear(color = 0xFF00FF00) {
    this.buffer32?.fill(color);
    this.markDirtyAll();
  }

  /** Bulk background copy – copy 32‑bit words where possible. */
  setBackground(groundImage, groundMask = null) {
    this.syncBackground(groundImage, groundMask, null);
  }

  hasBackground() {
    return this._hasBackground === true;
  }

  syncBackground(groundImage, groundMask = null, dirtyRects = null) {
    const source32 = toUint32Source(groundImage);
    if (!source32) {
      this.log.log('error: setBackground fallback');
      this.groundMask = groundMask;
      this.markDirtyAll({ captureDynamic: false });
      return;
    }
    if (!this.buffer32) return;
    if (!this.background32 || this.background32.length !== this.buffer32.length) {
      this.background32 = new Uint32Array(this.buffer32.length);
      this._hasBackground = false;
    }
    const applyFull = dirtyRects === null || !this._hasBackground;
    if (applyFull) {
      this.background32.set(source32);
      this.buffer32.set(source32);
      this.groundMask = groundMask;
      this._hasBackground = true;
      this._restoreFull = false;
      this._restoreRects.length = 0;
      this.markDirtyAll({ captureDynamic: false });
      return;
    }
    if (!Array.isArray(dirtyRects) || dirtyRects.length < 1) {
      this.groundMask = groundMask;
      return;
    }
    for (let i = 0; i < dirtyRects.length; i += 1) {
      const rect = this._normalizeRect(
        dirtyRects[i]?.x,
        dirtyRects[i]?.y,
        dirtyRects[i]?.width,
        dirtyRects[i]?.height
      );
      if (!rect) continue;
      this._copyRect(this.background32, source32, rect);
      this._copyRect(this.buffer32, this.background32, rect);
      this.markPresentDirtyRect(rect.x, rect.y, rect.width, rect.height);
    }
    this.groundMask = groundMask;
    this._hasBackground = true;
  }

  restoreBackground() {
    if (!this._hasBackground || !this.buffer32 || !this.background32) return;
    if (this._restoreFull) {
      this.buffer32.set(this.background32);
      this._restoreFull = false;
      this._restoreRects.length = 0;
      this.markDirtyAll({ captureDynamic: false });
      return;
    }
    if (!this._restoreRects.length) return;
    for (let i = 0; i < this._restoreRects.length; i += 1) {
      const rect = this._restoreRects[i];
      this._copyRect(this.buffer32, this.background32, rect);
      this.markPresentDirtyRect(rect.x, rect.y, rect.width, rect.height);
    }
    this._restoreRects.length = 0;
  }

  commitFrameForBackgroundRestore() {
    if (!this._hasBackground) {
      this._dynamicDirtyFull = false;
      this._dynamicDirtyRects.length = 0;
      return;
    }
    this._restoreFull = this._dynamicDirtyFull === true;
    if (this._restoreFull) {
      this._restoreRects.length = 0;
    } else {
      const previousRestoreRects = this._restoreRects;
      this._restoreRects = this._dynamicDirtyRects;
      this._dynamicDirtyRects = previousRestoreRects;
      this._dynamicDirtyRects.length = 0;
    }
    this._dynamicDirtyFull = false;
    if (this._restoreFull) {
      this._dynamicDirtyRects.length = 0;
    }
  }

  _acquireRectList() {
    if (this._dirtyRectListPool.length > 0) {
      const rects = this._dirtyRectListPool.pop();
      rects.length = 0;
      return rects;
    }
    return [];
  }

  markDirtyAll({ captureDynamic = true } = {}) {
    this._dirtyFull = true;
    this._dirtyRects.length = 0;
    if (captureDynamic) {
      this._dynamicDirtyFull = true;
      this._dynamicDirtyRects.length = 0;
    }
  }

  _normalizeRect(x, y, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    if (width <= 0 || height <= 0) return null;
    const w = this.getWidth();
    const h = this.getHeight();
    if (!w || !h) return null;
    const x1 = Math.max(0, Math.floor(x));
    const y1 = Math.max(0, Math.floor(y));
    const x2 = Math.min(w, Math.ceil(x + width));
    const y2 = Math.min(h, Math.ceil(y + height));
    if (x2 <= x1 || y2 <= y1) return null;
    return {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1
    };
  }

  _copyRect(dest32, source32, rect) {
    if (!dest32 || !source32 || !rect) return;
    const w = this.getWidth();
    for (let row = 0; row < rect.height; row += 1) {
      const offset = (rect.y + row) * w + rect.x;
      const end = offset + rect.width;
      dest32.set(source32.subarray(offset, end), offset);
    }
  }

  _mergeDirtyRect(rect, fullProp, rectsProp) {
    if (!rect) return;
    if (this[fullProp]) return;
    const w = this.getWidth();
    const h = this.getHeight();
    let mergedX1 = rect.x;
    let mergedY1 = rect.y;
    let mergedX2 = rect.x + rect.width;
    let mergedY2 = rect.y + rect.height;
    const rects = this[rectsProp];
    for (let i = 0; i < rects.length;) {
      const rect = rects[i];
      const rectX1 = rect.x;
      const rectY1 = rect.y;
      const rectX2 = rect.x + rect.width;
      const rectY2 = rect.y + rect.height;
      const overlapsOrTouches =
        mergedX1 <= (rectX2 + DIRTY_RECT_MERGE_PAD) &&
        mergedX2 >= (rectX1 - DIRTY_RECT_MERGE_PAD) &&
        mergedY1 <= (rectY2 + DIRTY_RECT_MERGE_PAD) &&
        mergedY2 >= (rectY1 - DIRTY_RECT_MERGE_PAD);
      if (!overlapsOrTouches) {
        i += 1;
        continue;
      }
      mergedX1 = Math.min(mergedX1, rectX1);
      mergedY1 = Math.min(mergedY1, rectY1);
      mergedX2 = Math.max(mergedX2, rectX2);
      mergedY2 = Math.max(mergedY2, rectY2);
      const last = rects.length - 1;
      rects[i] = rects[last];
      rects.length = last;
    }
    if (mergedX1 === 0 && mergedY1 === 0 && mergedX2 === w && mergedY2 === h) {
      this[fullProp] = true;
      rects.length = 0;
      return;
    }
    rects.push({
      x: mergedX1,
      y: mergedY1,
      width: mergedX2 - mergedX1,
      height: mergedY2 - mergedY1
    });
    if (rects.length > DIRTY_RECT_FULL_LIMIT) {
      this[fullProp] = true;
      rects.length = 0;
    }
  }

  markPresentDirtyRect(x, y, width, height) {
    const rect = this._normalizeRect(x, y, width, height);
    this._mergeDirtyRect(rect, '_dirtyFull', '_dirtyRects');
  }

  markDirtyRect(x, y, width, height) {
    const rect = this._normalizeRect(x, y, width, height);
    if (!rect) {
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        this.markDirtyAll();
      }
      return;
    }
    this._mergeDirtyRect(rect, '_dirtyFull', '_dirtyRects');
    this._mergeDirtyRect(rect, '_dynamicDirtyFull', '_dynamicDirtyRects');
  }

  consumeDirtyRects() {
    if (this._dirtyFull || !this.imgData) {
      this._dirtyFull = false;
      this._dirtyRects.length = 0;
      return null;
    }
    if (!this._dirtyRects.length) return EMPTY_DIRTY_RECTS;
    const rects = this._dirtyRects;
    this._dirtyRects = this._acquireRectList();
    return rects;
  }

  releaseConsumedDirtyRects(rects) {
    if (!Array.isArray(rects) || rects === EMPTY_DIRTY_RECTS || rects === this._dirtyRects) {
      return;
    }
    rects.length = 0;
    if (this._dirtyRectListPool.length < 4) {
      this._dirtyRectListPool.push(rects);
    }
  }

  hasPendingDirty() {
    if (!this.imgData) return false;
    return this._dirtyFull || this._dirtyRects.length > 0;
  }
    
  /* ---------- primitive drawing ---------- */
  /** Draw rectangle outline */
  drawRect(x, y, width, height, r, g, b, filled = false) {
    const x2 = x + width;
    const y2 = y + height;
    this.drawHorizontalLine(x, y,  x2, r, g, b);

    if (filled) {
      for (let i = y; i <= y+height; i++) {
        this.drawHorizontalLine(x, i, x2, r, g, b);
      }
    }

    this.drawHorizontalLine(x, y2, x2, r, g, b);
    this.drawVerticalLine(  x,  y,  y2, r, g, b);
    this.drawVerticalLine( x2,  y,  y2, r, g, b);
  }

  /** Vertical 1‑px line (uses uint32 writes) */
  drawVerticalLine(x, y1, y2, r, g, b) {
    if (!this.buffer32) return;
    const { width: w, height: h } = this.imgData;
    x  = Math.min(Math.max(x,  0), w - 1);
    y1 = Math.min(Math.max(y1, 0), h - 1);
    y2 = Math.min(Math.max(y2, 0), h - 1);
    if (y2 < y1) [y1, y2] = [y2, y1];
    const color32 = 0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF);
    let idx = y1 * w + x;
    for (let y = y1; y <= y2; y++, idx += w) this.buffer32[idx] = color32;
    this.markDirtyRect(x, y1, 1, (y2 - y1) + 1);
  }

  /** Horizontal 1‑px line (uint32 writes) */
  drawHorizontalLine(x1, y, x2, r, g, b) {
    if (!this.buffer32) return;
    const { width: w, height: h } = this.imgData;
    y  = Math.min(Math.max(y,  0), h - 1);
    x1 = Math.min(Math.max(x1, 0), w - 1);
    x2 = Math.min(Math.max(x2, 0), w - 1);
    if (x2 < x1) [x1, x2] = [x2, x1];
    const color32 = 0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF);
    let idx = y * w + x1;
    for (let x = x1; x <= x2; x++, idx++) this.buffer32[idx] = color32;
    this.markDirtyRect(x1, y, (x2 - x1) + 1, 1);
  }

  /**
     * Draw rectangle outline using a "marching ants" effect.
     * @param {number} x      Top left x position
     * @param {number} y      Top left y position
     * @param {number} width  Rectangle width
     * @param {number} height Rectangle height
     * @param {number} dashLen Length of each dash segment (in pixels)
     * @param {number} offset  Offset of the dash pattern
     */
  drawMarchingAntRect(
    x,
    y,
    width,
    height,
    dashLen = 3,
    offset = 0,
    color1 = 0xFFFFFFFF,
    color2 = 0xFF000000
  ) {
    drawMarchingAntRect(
      this,
      x,
      y,
      width,
      height,
      dashLen,
      offset,
      color1,
      color2
    );
    this.markDirtyRect(x, y, width + 1, height + 1);
  }

  /** Draw rectangle outline with a dashed pattern. */
  drawDashedRect(
    x,
    y,
    width,
    height,
    dashLenOrR = 3,
    offsetOrG = 0,
    color1OrB = 0xFFFFFFFF,
    color2OrDashLen = 0xFF000000
  ) {
    const isRgbSignature = arguments.length >= 7 &&
      Number.isFinite(dashLenOrR) &&
      Number.isFinite(offsetOrG) &&
      Number.isFinite(color1OrB) &&
      dashLenOrR >= 0 && dashLenOrR <= 255 &&
      offsetOrG >= 0 && offsetOrG <= 255 &&
      color1OrB >= 0 && color1OrB <= 255;

    if (isRgbSignature) {
      const r = dashLenOrR;
      const g = offsetOrG;
      const b = color1OrB;
      const dashLen = Number.isFinite(color2OrDashLen) ? color2OrDashLen : 2;
      const color = 0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF);
      drawDashedRect(
        this,
        x,
        y,
        width,
        height,
        dashLen,
        0,
        color,
        0x00000000
      );
      this.markDirtyRect(x, y, width + 1, height + 1);
      return;
    }

    drawDashedRect(
      this,
      x,
      y,
      width,
      height,
      dashLenOrR,
      offsetOrG,
      color1OrB,
      color2OrDashLen
    );
    this.markDirtyRect(x, y, width + 1, height + 1);
  }

  /** Draw a stippled rectangle fill (simple checkerboard pattern). */
  drawStippleRect(x, y, width, height, r = 128, g = 128, b = 128) {
    if (!this.buffer32) return;
    const { width: w } = this.imgData;
    const color32 = 0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF);
    for (let dy = 0; dy <= height; dy++) {
      let idx = (y + dy) * w + x;
      for (let dx = 0; dx <= width; dx++, idx++) {
        if (((dx + dy) & 1) === 0) this.buffer32[idx] = color32;
      }
    }
    this.markDirtyRect(x, y, width + 1, height + 1);
  }

  /**
     * Draw L‑shaped corners around a rectangle.
     * @param {number} x        Top-left x position
     * @param {number} y        Top-left y position
     * @param {number|Object} size  Width/height or { width, height }
     * @param {number} r        Red component
     * @param {number} g        Green component
     * @param {number} b        Blue component
     * @param {number} length   Length of the corner arms
     * @param {boolean} midLine Draw centered lines on each edge
     * @param {number} midLen   Length of the centered lines
     */
  drawCornerRect(x, y, size, r, g, b, length = 1, midLine = false, midLen = 0) {
    const w = typeof size === 'object' ? size.width : size;
    const h = typeof size === 'object' ? size.height : size;
    const x2 = x + w - 1;
    const y2 = y + h - 1;

    const len = Math.max(1, length);

    // top-left
    this.drawHorizontalLine(x, y, Math.min(x + len, x2), r, g, b);
    this.drawVerticalLine(x, y, Math.min(y + len, y2), r, g, b);
    // top-right
    this.drawHorizontalLine(Math.max(x2 - len, x), y, x2, r, g, b);
    this.drawVerticalLine(x2, y, Math.min(y + len, y2), r, g, b);
    // bottom-left
    this.drawHorizontalLine(x, y2, Math.min(x + len, x2), r, g, b);
    this.drawVerticalLine(x, Math.max(y2 - len, y), y2, r, g, b);
    // bottom-right
    this.drawHorizontalLine(Math.max(x2 - len, x), y2, x2, r, g, b);
    this.drawVerticalLine(x2, Math.max(y2 - len, y), y2, r, g, b);

    if (midLine && midLen > 0) {
      const hx1 = Math.max(x + Math.floor((w - midLen) / 2), x);
      const hx2 = Math.min(hx1 + midLen - 1, x2);
      const hy1 = Math.max(y + Math.floor((h - midLen) / 2), y);
      const hy2 = Math.min(hy1 + midLen - 1, y2);
      this.drawHorizontalLine(hx1, y, hx2, r, g, b);
      this.drawHorizontalLine(hx1, y2, hx2, r, g, b);
      this.drawVerticalLine(x, hy1, hy2, r, g, b);
      this.drawVerticalLine(x2, hy1, hy2, r, g, b);
    }
  }

  /* ---------- blitting helpers ---------- */
  /** Write sprite mask (white) */
  drawMask(mask, posX, posY) {
    if (!this.buffer32) return;
    const srcW = mask.width, srcH = mask.height,
      srcMask = mask.getMask(),
      destW = this.imgData.width, destH = this.imgData.height,
      baseX = posX + mask.offsetX, baseY = posY + mask.offsetY,
      WHITE = 0xFFFFFFFF;
    for (let srcY = 0; srcY < srcH; srcY++) {
      const outY = srcY + baseY;
      if (outY < 0 || outY >= destH) continue;
      let srcRow = srcY * srcW, destRow = outY * destW + baseX;
      for (let srcX = 0; srcX < srcW; srcX++, srcRow++, destRow++) {
        if (!srcMask[srcRow]) continue;
        const outX = srcX + baseX;
        if (outX < 0 || outX >= destW) continue; // x‑clip
        this.buffer32[destRow] = WHITE;
      }
    }
    this.markDirtyRect(baseX, baseY, srcW, srcH);
  }

  /**
     * Generic blitter helper used by drawFrame & drawFrameCovered
     * Now accepts optional `size: {width, height}` in opts to scale the sprite.
     * Scaling uses nearest‑neighbour for speed.
     */
  _blit(frame, posX, posY, opts) {
    const { width: srcW, height: srcH } = frame,
      srcBuf  = frame.getBuffer(),
      srcMask = frame.getMask(),
      destW   = this.imgData.width, destH = this.imgData.height,
      baseX   = posX + frame.offsetX, baseY = posY + frame.offsetY,
      dest32  = this.buffer32;

    const {
      nullColor32   = null,
      checkGround   = false,
      onlyOverwrite = false,
      noOverwrite   = false,
      upsideDown    = false,
      groundMask    = null,
      size          = null, // { width, height }
      scaleMode     = 'nearest'
    } = opts ?? {};

    // If no scaling requested or size matches source → fall back to original fast path
    const dstW = size?.width  ?? srcW;
    const dstH = size?.height ?? srcH;
    const isScaled = (dstW !== srcW) || (dstH !== srcH);
    this.markDirtyRect(baseX, baseY, dstW, dstH);

    if (!isScaled) {
      const spanCache = frame.getSpanCache?.();
      if (spanCache && nullColor32 === null) {
        const { rows, bounds } = spanCache;
        const minY = bounds ? bounds.minY : 0;
        const maxY = bounds ? bounds.maxY : -1;
        for (let sy = 0; sy < srcH; sy++) {
          const sourceY = upsideDown ? srcH - sy - 1 : sy;
          if (sourceY < minY || sourceY > maxY) continue;
          const spans = rows[sourceY];
          if (!spans) continue;
          const outY = sy + baseY;
          if (outY < 0 || outY >= destH) continue;
          const srcRow = sourceY * srcW;
          const destRow = outY * destW + baseX;
          for (let i = 0; i < spans.length; i += 2) {
            let start = spans[i];
            let end = spans[i + 1];
            if (baseX + start < 0) start = -baseX;
            if (baseX + end > destW) end = destW - baseX;
            if (end <= start) continue;
            let srcIdx = srcRow + start;
            let destIdx = destRow + start;
            if (!checkGround) {
              for (let sx = start; sx < end; sx++, srcIdx++, destIdx++) {
                dest32[destIdx] = srcBuf[srcIdx];
              }
            } else {
              for (let sx = start; sx < end; sx++, srcIdx++, destIdx++) {
                const outX = baseX + sx;
                const hasGround = groundMask?.hasGroundAt(outX, outY);
                if (noOverwrite && hasGround)    continue;
                if (onlyOverwrite && !hasGround) continue;
                dest32[destIdx] = srcBuf[srcIdx];
              }
            }
          }
        }
        return;
      }

      const fullyInBounds =
        !checkGround &&
        nullColor32 === null &&
        baseX >= 0 &&
        baseY >= 0 &&
        (baseX + srcW) <= destW &&
        (baseY + srcH) <= destH;
      if (fullyInBounds) {
        if (isFrameFullyOpaque(frame)) {
          for (let sy = 0; sy < srcH; sy += 1) {
            const sourceY = upsideDown ? srcH - sy - 1 : sy;
            const srcStart = sourceY * srcW;
            const destStart = (sy + baseY) * destW + baseX;
            dest32.set(srcBuf.subarray(srcStart, srcStart + srcW), destStart);
          }
          return;
        }
        for (let sy = 0; sy < srcH; sy += 1) {
          const sourceY = upsideDown ? srcH - sy - 1 : sy;
          let srcRow = sourceY * srcW;
          let destRow = (sy + baseY) * destW + baseX;
          for (let sx = 0; sx < srcW; sx += 1, srcRow += 1, destRow += 1) {
            if (!srcMask[srcRow]) continue;
            dest32[destRow] = srcBuf[srcRow];
          }
        }
        return;
      }

      let srcXStart = 0;
      if (baseX < 0) srcXStart = -baseX;
      let srcXEnd = srcW;
      const maxRight = destW - baseX;
      if (srcXEnd > maxRight) srcXEnd = maxRight;
      if (srcXEnd <= srcXStart) return;

      for (let sy = 0; sy < srcH; sy++) {
        const sourceY = upsideDown ? srcH - sy - 1 : sy;
        const outY = sy + baseY;
        if (outY < 0 || outY >= destH) continue;
        let srcRow  = (sourceY * srcW) + srcXStart;
        let destRow = outY * destW + baseX + srcXStart;
        for (let sx = srcXStart; sx < srcXEnd; sx++, srcRow++, destRow++) {
          if (!srcMask[srcRow]) {
            if (nullColor32 !== null) dest32[destRow] = nullColor32; // covered variant
            continue;
          }
          if (checkGround) {
            const hasGround = groundMask?.hasGroundAt(baseX + sx, outY);
            if (noOverwrite && hasGround)    continue;
            if (onlyOverwrite && !hasGround) continue;
          }
          dest32[destRow] = srcBuf[srcRow];
        }
      }
      return;
    }

    // Scaled path – choose algorithm
    const scaleOpts = {
      dest32,
      destW,
      destH,
      baseX,
      baseY,
      nullColor32,
      checkGround,
      onlyOverwrite,
      noOverwrite,
      upsideDown,
      groundMask
    };

    if (scaleMode === 'xbrz') {
      scaleXbrz(frame, dstW, dstH, scaleOpts);
    } else if (scaleMode === 'hqx') {
      scaleHqx(frame, dstW, dstH, scaleOpts);
    } else {
      scaleNearest(frame, dstW, dstH, scaleOpts);
    }
  }

  drawFrame(frame, x, y,) {
    this._blit(frame, x, y);
  }

  drawFrameCovered(frame, x, y, r, g, b) {
    const nullColor32 = 0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF);
    this._blit(frame, x, y, { nullColor32 });
  }

  drawFrameFlags(frame, x, y, cfg) {
    this._blit(frame, x, y, {
      checkGround:   true,
      onlyOverwrite: cfg.onlyOverwrite,
      noOverwrite:   cfg.noOverwrite,
      upsideDown:    cfg.isUpsideDown,
      groundMask:    this.groundMask
    });
  }
  drawFrameResized(frame, x, y, w, h) {
    this._blit(frame, x, y, {
      size: {width: w, height: h}
    });
  }

  /* ---------- misc utilities ---------- */
  setDebugPixel(x, y) { if (this.buffer32) this.buffer32[y * this.imgData.width + x] = 0xFF0000FF; }

  setPixel(x,y,r,g,b) {
    if (!this.buffer32) return;
    this.buffer32[y * this.imgData.width + x] = 0xFF000000 | (b&0xFF)<<16 | (g&0xFF)<<8 | (r&0xFF);
  }

  setScreenPosition(x, y, options) {
    this.stage.setGameViewPointPosition(x, y, options);
  }
  getImageData()         { return this.imgData;  }
  redraw()               { this.stage.redraw();   }

  dispose() {
    this.onMouseUp.dispose();
    this.onMouseDown.dispose();
    this.onMouseRightDown.dispose();
    this.onMouseRightUp.dispose();
    this.onMouseMove.dispose();
    this.onDoubleClick.dispose();
    this.buffer32 = null;
    this.background32 = null;
    this.imgData = null;
    this.stage = null;
    this._hasBackground = false;
    this._restoreFull = false;
    this._restoreRects.length = 0;
    this._dirtyRectListPool.length = 0;
    this._dynamicDirtyFull = false;
    this._dynamicDirtyRects.length = 0;
  }
}

function scaleNearest(
  frame,
  dstWidth,
  dstHeight,
  opts = {}
) {
  const {
    dest32,
    destW,
    destH,
    baseX,
    baseY,
    nullColor32 = null,
    checkGround = false,
    onlyOverwrite = false,
    noOverwrite = false,
    upsideDown = false,
    groundMask = null
  } = opts;

  if (!dest32) return;

  const { width: srcW, height: srcH } = frame;
  const srcBuf = frame.getBuffer();
  const srcMask = frame.getMask();

  const scaleX = srcW / dstWidth;
  const scaleY = srcH / dstHeight;

  for (let dy = 0; dy < dstHeight; dy++) {
    let srcY = Math.floor(dy * scaleY);
    if (upsideDown) srcY = srcH - 1 - srcY;
    const outY = dy + baseY;
    if (outY < 0 || outY >= destH) continue;

    const srcYBase = srcY * srcW;
    const destYBase = outY * destW;

    for (let dx = 0; dx < dstWidth; dx++) {
      const outX = dx + baseX;
      if (outX < 0 || outX >= destW) continue;

      const srcX = Math.floor(dx * scaleX);
      const srcIdx = srcYBase + srcX;
      const destIdx = destYBase + outX;

      if (!srcMask[srcIdx]) {
        if (nullColor32 !== null) dest32[destIdx] = nullColor32;
        continue;
      }

      if (checkGround) {
        const hasGround = groundMask?.hasGroundAt(outX, outY);
        if (noOverwrite && hasGround) continue;
        if (onlyOverwrite && !hasGround) continue;
      }

      dest32[destIdx] = srcBuf[srcIdx];
    }
  }
}

function scaleXbrz(
  frame,
  dstWidth,
  dstHeight,
  opts = {}
) {
  const {
    dest32,
    destW,
    destH,
    baseX,
    baseY,
    nullColor32 = null,
    checkGround = false,
    onlyOverwrite = false,
    noOverwrite = false,
    upsideDown = false,
    groundMask = null
  } = opts;

  if (!dest32) return;

  const { width: srcW, height: srcH } = frame;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 4 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }

  const variant = getScaledFrameVariant(frame, dstWidth, dstHeight, 'xbrz');
  if (!variant) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }
  const { scaled, scaledMask } = variant;

  for (let dy = 0; dy < dstHeight; dy++) {
    const srcY = upsideDown ? dstHeight - 1 - dy : dy;
    const outY = dy + baseY;
    if (outY < 0 || outY >= destH) continue;

    let srcRow = srcY * dstWidth;
    let destRow = outY * destW + baseX;

    for (let dx = 0; dx < dstWidth; dx++, srcRow++, destRow++) {
      const outX = dx + baseX;
      if (outX < 0 || outX >= destW) continue;

      if (!scaledMask[srcRow]) {
        if (nullColor32 !== null) dest32[destRow] = nullColor32;
        continue;
      }

      if (checkGround) {
        const hasGround = groundMask?.hasGroundAt(outX, outY);
        if (noOverwrite && hasGround) continue;
        if (onlyOverwrite && !hasGround) continue;
      }

      dest32[destRow] = scaled[srcRow];
    }
  }
}

function scaleHqx(
  frame,
  dstWidth,
  dstHeight,
  opts = {}
) {
  const {
    dest32,
    destW,
    destH,
    baseX,
    baseY,
    nullColor32 = null,
    checkGround = false,
    onlyOverwrite = false,
    noOverwrite = false,
    upsideDown = false,
    groundMask = null
  } = opts;

  if (!dest32) return;

  const { width: srcW, height: srcH } = frame;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 4 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }

  const variant = getScaledFrameVariant(frame, dstWidth, dstHeight, 'hqx');
  if (!variant) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }
  const { scaled, scaledMask } = variant;

  for (let dy = 0; dy < dstHeight; dy++) {
    const srcY = upsideDown ? dstHeight - 1 - dy : dy;
    const outY = dy + baseY;
    if (outY < 0 || outY >= destH) continue;

    let srcRow = srcY * dstWidth;
    let destRow = outY * destW + baseX;

    for (let dx = 0; dx < dstWidth; dx++, srcRow++, destRow++) {
      const outX = dx + baseX;
      if (outX < 0 || outX >= destW) continue;

      if (!scaledMask[srcRow]) {
        if (nullColor32 !== null) dest32[destRow] = nullColor32;
        continue;
      }

      if (checkGround) {
        const hasGround = groundMask?.hasGroundAt(outX, outY);
        if (noOverwrite && hasGround) continue;
        if (onlyOverwrite && !hasGround) continue;
      }

      dest32[destRow] = scaled[srcRow];
    }
  }
}

function drawMarchingAntRect(
  display,
  x,
  y,
  width,
  height,
  dashLen = 3,
  offset = 0,
  color1 = 0xFFFFFFFF,
  color2 = 0xFF000000
) {
  if (!display?.buffer32) return;
  x = Math.trunc(x);
  y = Math.trunc(y);
  width = Math.trunc(width);
  height = Math.trunc(height);
  if (width < 0 || height < 0) return;
  if (dashLen <= 0) dashLen = 1;
  const { width: w, height: h } = display.imgData;
  if (!w || !h) return;
  const buffer32 = display.buffer32;
  const pattern = dashLen * 2;
  const writeColor1 = (color1 >>> 24) !== 0;
  const writeColor2 = (color2 >>> 24) !== 0;
  if (!writeColor1 && !writeColor2) return;
  const perimeter = (width + 1) + height + width + Math.max(0, height - 1);
  const x2 = x + width;
  const y2 = y + height;
  const fullyInBounds = x >= 0 && y >= 0 && x2 < w && y2 < h;

  if (fullyInBounds && perimeter <= MAX_MARCHING_ANT_FAST_PERIMETER) {
    const baseIndex = (y * w) + x;
    const offsets = getMarchingAntPerimeterOffsets(w, width, height);
    const paintPattern = getMarchingAntPaintPattern(offsets.length, dashLen, offset);
    if (writeColor1) {
      const first = paintPattern.first;
      for (let i = 0; i < first.length; i += 1) {
        buffer32[baseIndex + offsets[first[i]]] = color1;
      }
    }
    if (writeColor2) {
      const second = paintPattern.second;
      for (let i = 0; i < second.length; i += 1) {
        buffer32[baseIndex + offsets[second[i]]] = color2;
      }
    }
    return;
  }

  let pos = ((offset % pattern) + pattern) % pattern;
  const writeAtIndex = (idx) => {
    if (writeColor1 && writeColor2) {
      buffer32[idx] = pos < dashLen ? color1 : color2;
      return;
    }
    if (writeColor1) {
      if (pos < dashLen) buffer32[idx] = color1;
      return;
    }
    if (pos >= dashLen) {
      buffer32[idx] = color2;
    }
  };
  const advancePattern = () => {
    pos += 1;
    if (pos === pattern) pos = 0;
  };

  if (fullyInBounds) {
    let idx = y * w + x;
    for (let dx = 0; dx <= width; dx += 1, idx += 1) {
      writeAtIndex(idx);
      advancePattern();
    }
    idx = (y + 1) * w + x + width;
    for (let dy = 1; dy <= height; dy += 1, idx += w) {
      writeAtIndex(idx);
      advancePattern();
    }
    idx = (y + height) * w + x + width - 1;
    for (let dx = 1; dx <= width; dx += 1, idx -= 1) {
      writeAtIndex(idx);
      advancePattern();
    }
    idx = (y + height - 1) * w + x;
    for (let dy = 1; dy < height; dy += 1, idx -= w) {
      writeAtIndex(idx);
      advancePattern();
    }
    return;
  }

  for (let dx = 0; dx <= width; dx += 1) {
    const xx = x + dx;
    if (y >= 0 && y < h && xx >= 0 && xx < w) {
      writeAtIndex((y * w) + xx);
    }
    advancePattern();
  }
  for (let dy = 1; dy <= height; dy += 1) {
    const yy = y + dy;
    if (yy >= 0 && yy < h && x2 >= 0 && x2 < w) {
      writeAtIndex((yy * w) + x2);
    }
    advancePattern();
  }
  for (let dx = 1; dx <= width; dx += 1) {
    const xx = x2 - dx;
    if (y2 >= 0 && y2 < h && xx >= 0 && xx < w) {
      writeAtIndex((y2 * w) + xx);
    }
    advancePattern();
  }
  for (let dy = 1; dy < height; dy += 1) {
    const yy = y2 - dy;
    if (yy >= 0 && yy < h && x >= 0 && x < w) {
      writeAtIndex((yy * w) + x);
    }
    advancePattern();
  }
}

function drawDashedRect(
  display,
  x,
  y,
  width,
  height,
  dashLen = 3,
  offset = 0,
  color1 = 0xFFFFFFFF,
  color2 = 0xFF000000
) {
  drawMarchingAntRect(
    display,
    x,
    y,
    width,
    height,
    dashLen,
    offset,
    color1,
    color2
  );
}

const __test__ = {
  cyrb53,
  getScaledFrameVariant,
  _scaledFrameCache: scaledFrameCache
};

export {
  DisplayImage,
  drawMarchingAntRect,
  drawDashedRect,
  scaleNearest,
  scaleXbrz,
  scaleHqx,
  __test__
};
