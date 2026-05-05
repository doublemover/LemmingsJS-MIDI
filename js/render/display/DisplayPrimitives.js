import {
  BaseLogger,
  DIRTY_RECT_FULL_LIMIT,
  DIRTY_RECT_MERGE_PAD,
  DIRTY_TILE_FULL_LIMIT,
  EMPTY_DIRTY_RECTS,
  EventHandler,
  MAX_MARCHING_ANT_CACHE_ENTRIES,
  MAX_MARCHING_ANT_FAST_PERIMETER,
  MAX_MARCHING_ANT_PATTERN_CACHE_ENTRIES,
  MAX_NEAREST_COORD_CACHE_ENTRIES,
  MAX_SCALED_VARIANTS_PER_FRAME,
  __test__,
  cyrb53,
  drawDashedRect,
  drawMarchingAntRect,
  frameOpaqueCache,
  getClippedDestinationSpan,
  getMarchingAntPaintPattern,
  getMarchingAntPerimeterOffsets,
  getNearestCoordinateMap,
  getScaledFrameVariant,
  hqxScale,
  initHqx,
  isFrameFullyOpaque,
  marchingAntPatternCache,
  marchingAntPerimeterCache,
  nearestCoordinateCache,
  scaleHqx,
  scaleImage,
  scaleNearest,
  scaleXbrz,
  scaledFrameCache,
  toUint32Source
} from './DisplayImageShared.js';
const displayPrimitivesMethods = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  drawMask(mask, posX, posY) {
    if (!this.buffer32) return;
    const maskOffsetX = Number.isFinite(mask?.offsetX) ? mask.offsetX : 0;
    const maskOffsetY = Number.isFinite(mask?.offsetY) ? mask.offsetY : 0;
    const srcW = mask.width, srcH = mask.height,
      srcMask = mask.getMask(),
      destW = this.imgData.width, destH = this.imgData.height,
      baseX = posX + maskOffsetX, baseY = posY + maskOffsetY,
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
};
export { displayPrimitivesMethods };