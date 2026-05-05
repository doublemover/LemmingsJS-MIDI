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
const displayBlitMethods = {
  _blit(frame, posX, posY, opts) {
    const frameOffsetX = Number.isFinite(frame?.offsetX) ? frame.offsetX : 0;
    const frameOffsetY = Number.isFinite(frame?.offsetY) ? frame.offsetY : 0;
    const { width: srcW, height: srcH } = frame,
      srcBuf  = frame.getBuffer(),
      srcMask = frame.getMask(),
      destW   = this.imgData.width, destH = this.imgData.height,
      baseX   = posX + frameOffsetX, baseY = posY + frameOffsetY,
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
  },

  drawFrame(frame, x, y,) {
    this._blit(frame, x, y);
  },

  drawFrameCovered(frame, x, y, r, g, b) {
    const nullColor32 = 0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF);
    this._blit(frame, x, y, { nullColor32 });
  },

  drawFrameFlags(frame, x, y, cfg) {
    this._blit(frame, x, y, {
      checkGround:   true,
      onlyOverwrite: cfg.onlyOverwrite,
      noOverwrite:   cfg.noOverwrite,
      upsideDown:    cfg.isUpsideDown,
      groundMask:    this.groundMask
    });
  },

  drawFrameResized(frame, x, y, w, h) {
    this._blit(frame, x, y, {
      size: {width: w, height: h}
    });
  },

  setDebugPixel(x, y) { if (this.buffer32) this.buffer32[y * this.imgData.width + x] = 0xFF0000FF; },

  setPixel(x,y,r,g,b) {
    if (!this.buffer32) return;
    this.buffer32[y * this.imgData.width + x] = 0xFF000000 | (b&0xFF)<<16 | (g&0xFF)<<8 | (r&0xFF);
  },

  setScreenPosition(x, y, options) {
    this.stage.setGameViewPointPosition(x, y, options);
  },

  getImageData()         { return this.imgData;  },

  redraw()               { this.stage.redraw();   },

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
};
export { displayBlitMethods };