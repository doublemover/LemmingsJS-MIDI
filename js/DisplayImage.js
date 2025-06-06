/* -------------------- DisplayImage.js -------------------- */
import './LogHandler.js';
import { Lemmings } from './LemmingsNamespace.js';
import { scaleImage } from './xbrz/xbrz.js';

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

class DisplayImage extends Lemmings.BaseLogger {
  constructor(stage) {
    super();
    this.stage = stage;
    this.onMouseUp = new Lemmings.EventHandler();
    this.onMouseDown = new Lemmings.EventHandler();
    this.onMouseRightDown = new Lemmings.EventHandler();
    this.onMouseRightUp = new Lemmings.EventHandler();
    this.onMouseMove = new Lemmings.EventHandler();
    this.onDoubleClick = new Lemmings.EventHandler();
    // 32‑bit view reused everywhere; set by initSize()
    this.buffer32 = null;
    // this.onMouseDown.on(e => {
    //     // this.setDebugPixel(e.x, e.y);
    // });
    this.imgData = null;
  }

  /* ---------- image helpers ---------- */
  getWidth()  { return this.imgData?.width  ?? 0; }
  getHeight() { return this.imgData?.height ?? 0; }

  /** (Re)allocate the backing ImageData + uint32 view. */
  initSize(width, height) {
    if (!this.imgData || this.imgData.width !== width || this.imgData.height !== height) {
      this.imgData  = this.stage.createImage(this, width, height);
      // Single 32‑bit view that aliases the same buffer – no copying.
      this.buffer32 = new Uint32Array(this.imgData.data.buffer);
      this.clear();
    }
  }

  /** Fast clear using .fill() on the uint32 view (default: ARGB 0xFF00FF00). */
  clear(color = 0xFF00FF00) {
    this.buffer32?.fill(color);
  }

  /** Bulk background copy – copy 32‑bit words where possible. */
  setBackground(groundImage, groundMask = null) {
    if (groundImage instanceof Uint8ClampedArray) {
      // Uint8 – copy bytes directly.
      this.imgData.data.set(groundImage);
    } else if (groundImage instanceof Uint32Array) {
      // Faster 32‑bit path.
      this.buffer32.set(groundImage);
    } else {
      // Fallback (ArrayLike)
      this.log.log('error: setBackground fallback');
      // this.imgData.data.set(groundImage);
    }
    this.groundMask = groundMask;
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

  drawDashedRect(x, y, width, height, r, g, b, dashLen = 2) {
    const x2 = x + width;
    const y2 = y + height;
    const step = dashLen * 2;
    for (let dx = x; dx <= x2; dx += step) {
      this.drawHorizontalLine(dx, y, Math.min(dx + dashLen - 1, x2), r, g, b);
      this.drawHorizontalLine(dx, y2, Math.min(dx + dashLen - 1, x2), r, g, b);
    }
    for (let dy = y; dy <= y2; dy += step) {
      this.drawVerticalLine(x, dy, Math.min(dy + dashLen - 1, y2), r, g, b);
      this.drawVerticalLine(x2, dy, Math.min(dy + dashLen - 1, y2), r, g, b);
    }
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
  }

  /** Draw rectangle outline with a dashed pattern. */
  drawDashedRect(
    x,
    y,
    width,
    height,
    dashLen = 3,
    offset = 0,
    color1 = 0xFFFFFFFF,
    color2 = 0xFF000000
  ) {
    drawDashedRect(
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
  }

  /** Draw filled corner squares around a rectangle. */
  drawCornerRect(x, y, size, r, g, b, cornerSize = 2) {
    const w = typeof size === 'object' ? size.width : size;
    const h = typeof size === 'object' ? size.height : size;
    const x2 = x + w - cornerSize;
    const y2 = y + h - cornerSize;
    this.drawRect(x, y, cornerSize, cornerSize, r, g, b, true);
    this.drawRect(x2, y, cornerSize, cornerSize, r, g, b, true);
    this.drawRect(x, y2, cornerSize, cornerSize, r, g, b, true);
    this.drawRect(x2, y2, cornerSize, cornerSize, r, g, b, true);
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

    if (!isScaled) {
      for (let sy = 0; sy < srcH; sy++) {
        const sourceY = upsideDown ? srcH - sy - 1 : sy;
        const outY = sy + baseY;
        if (outY < 0 || outY >= destH) continue;
        let srcRow  = sourceY * srcW;
        let destRow = outY * destW + baseX;
        for (let sx = 0; sx < srcW; sx++, srcRow++, destRow++) {
          if (!srcMask[srcRow]) {
            if (nullColor32 !== null) dest32[destRow] = nullColor32; // covered variant
            continue;
          }
          const outX = sx + baseX;
          if (outX < 0 || outX >= destW) continue;
          if (checkGround) {
            const hasGround = groundMask?.hasGroundAt(outX, outY);
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

  setScreenPosition(x, y) { this.stage.setGameViewPointPosition(x, y); }
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
    this.imgData = null;
    this.stage = null;
  }
}
Lemmings.DisplayImage = DisplayImage;

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

  const srcBuf = frame.getBuffer();
  const srcMask = frame.getMask();
  const temp = new Uint32Array(srcBuf.length);
  for (let i = 0; i < srcBuf.length; i++) {
    temp[i] = srcMask[i] ? srcBuf[i] : 0;
  }

  const scaled = new Uint32Array(dstWidth * dstHeight);
  scaleImage(scale, temp, scaled, srcW, srcH, 0, srcH);

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
  // Placeholder HQX implementation using xBRZ scaler
  const { width: srcW, height: srcH } = frame;
  const scale = Math.round(dstWidth / srcW);
  if (scale < 2 || scale > 3 || dstWidth !== srcW * scale || dstHeight !== srcH * scale) {
    scaleNearest(frame, dstWidth, dstHeight, opts);
    return;
  }
  scaleXbrz(frame, dstWidth, dstHeight, opts);
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
  const { width: w } = display.imgData;
  const pattern = dashLen * 2;
  let pos = ((offset % pattern) + pattern) % pattern;
  const set = (px, py) => {
    const useFirst = Math.floor(pos / dashLen) % 2 === 0;
    display.buffer32[py * w + px] = useFirst ? color1 : color2;
    pos = (pos + 1) % pattern;
  };

  for (let dx = 0; dx <= width; dx++) set(x + dx, y);
  for (let dy = 1; dy <= height; dy++) set(x + width, y + dy);
  for (let dx = 1; dx <= width; dx++) set(x + width - dx, y + height);
  for (let dy = 1; dy < height; dy++) set(x, y + height - dy);
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

Lemmings.drawMarchingAntRect = drawMarchingAntRect;
Lemmings.drawDashedRect = drawDashedRect;
Lemmings.scaleXbrz = scaleXbrz;
Lemmings.scaleHqx = scaleHqx;
export { DisplayImage, drawMarchingAntRect, drawDashedRect, scaleXbrz, scaleHqx };
