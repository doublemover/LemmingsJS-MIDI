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
const displayDirtyTrackingMethods = {
  getWidth()  { return this.imgData?.width  ?? 0; },

  getHeight() { return this.imgData?.height ?? 0; },

  get worldDataSize() {
    return { width: this.getWidth(), height: this.getHeight() };
  },

  set worldDataSize({ width, height }) {
    this.initSize(width, height);
  },

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
      this._dirtyTileListPool.length = 0;
      this._dirtyTiles.clear();
      this._dirtyTileColumns = this._dirtyTileSize
        ? Math.ceil(width / this._dirtyTileSize)
        : 0;
      this._dirtyTileRows = this._dirtyTileSize
        ? Math.ceil(height / this._dirtyTileSize)
        : 0;
      this._dirtyTileFull = true;
      this._dynamicDirtyFull = false;
      this._dynamicDirtyRects.length = 0;
      this.clear();
    }
  },

  clear(color = 0xFF00FF00) {
    this.buffer32?.fill(color);
    this.markDirtyAll();
  },

  setBackground(groundImage, groundMask = null) {
    this.syncBackground(groundImage, groundMask, null);
  },

  hasBackground() {
    return this._hasBackground === true;
  },

  setDirtyTileSize(tileSize) {
    const next = Number.isFinite(tileSize) && tileSize > 0
      ? Math.max(1, Math.trunc(tileSize))
      : 0;
    if (next === this._dirtyTileSize) return;
    this._dirtyTileSize = next;
    const width = this.getWidth();
    const height = this.getHeight();
    this._dirtyTileColumns = next ? Math.ceil(width / next) : 0;
    this._dirtyTileRows = next ? Math.ceil(height / next) : 0;
    this._dirtyTiles.clear();
    this._dirtyTileListPool.length = 0;
    this._dirtyTileFull = this._dirtyFull || this._dirtyRects.length > 0;
  },

  syncBackground(groundImage, groundMask = null, dirtyRects = null, tileSize = undefined) {
    if (tileSize !== undefined) {
      this.setDirtyTileSize(tileSize);
    }
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
  },

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
  },

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
  },

  _acquireRectList() {
    if (this._dirtyRectListPool.length > 0) {
      const rects = this._dirtyRectListPool.pop();
      rects.length = 0;
      this._allocationStats.rectListReused += 1;
      return rects;
    }
    this._allocationStats.rectListCreated += 1;
    return [];
  },

  _acquireTileList() {
    if (this._dirtyTileListPool.length > 0) {
      const tiles = this._dirtyTileListPool.pop();
      tiles.length = 0;
      this._allocationStats.tileListReused += 1;
      return tiles;
    }
    this._allocationStats.tileListCreated += 1;
    return [];
  },

  _markTileDirtyRect(rect) {
    if (!rect || !this._dirtyTileSize || this._dirtyTileFull) return;
    const cols = this._dirtyTileColumns;
    const rows = this._dirtyTileRows;
    if (!cols || !rows) return;
    const tileSize = this._dirtyTileSize;
    const tx1 = Math.max(0, Math.floor(rect.x / tileSize));
    const ty1 = Math.max(0, Math.floor(rect.y / tileSize));
    const tx2 = Math.min(cols - 1, Math.floor((rect.x + rect.width - 1) / tileSize));
    const ty2 = Math.min(rows - 1, Math.floor((rect.y + rect.height - 1) / tileSize));
    for (let ty = ty1; ty <= ty2; ty += 1) {
      const row = ty * cols;
      for (let tx = tx1; tx <= tx2; tx += 1) {
        this._dirtyTiles.add(row + tx);
      }
    }
    if (this._dirtyTiles.size >= (cols * rows) || this._dirtyTiles.size > DIRTY_TILE_FULL_LIMIT) {
      this._dirtyTiles.clear();
      this._dirtyTileFull = true;
    }
  },

  markDirtyAll({ captureDynamic = true } = {}) {
    this._dirtyFull = true;
    this._dirtyRects.length = 0;
    this._dirtyTileFull = true;
    this._dirtyTiles.clear();
    if (captureDynamic) {
      this._dynamicDirtyFull = true;
      this._dynamicDirtyRects.length = 0;
    }
  },

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
  },

  _copyRect(dest32, source32, rect) {
    if (!dest32 || !source32 || !rect) return;
    const w = this.getWidth();
    for (let row = 0; row < rect.height; row += 1) {
      const offset = (rect.y + row) * w + rect.x;
      const end = offset + rect.width;
      dest32.set(source32.subarray(offset, end), offset);
    }
  },

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
  },

  markPresentDirtyRect(x, y, width, height) {
    const rect = this._normalizeRect(x, y, width, height);
    this._markTileDirtyRect(rect);
    this._mergeDirtyRect(rect, '_dirtyFull', '_dirtyRects');
  },

  markDirtyRect(x, y, width, height) {
    const rect = this._normalizeRect(x, y, width, height);
    if (!rect) {
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        this.markDirtyAll();
      }
      return;
    }
    this._markTileDirtyRect(rect);
    this._mergeDirtyRect(rect, '_dirtyFull', '_dirtyRects');
    this._mergeDirtyRect(rect, '_dynamicDirtyFull', '_dynamicDirtyRects');
  },

  consumeDirtyTiles() {
    if (!this._dirtyTileSize || !this.imgData) return undefined;
    if (this._dirtyTileFull) {
      this._dirtyTileFull = false;
      this._dirtyTiles.clear();
      return null;
    }
    if (!this._dirtyTiles.size) return EMPTY_DIRTY_RECTS;
    const cols = this._dirtyTileColumns;
    const tileSize = this._dirtyTileSize;
    const width = this.getWidth();
    const height = this.getHeight();
    const tiles = this._acquireTileList();
    for (const index of this._dirtyTiles) {
      const tx = index % cols;
      const ty = Math.floor(index / cols);
      const x = tx * tileSize;
      const y = ty * tileSize;
      tiles.push({
        x,
        y,
        width: Math.min(tileSize, width - x),
        height: Math.min(tileSize, height - y)
      });
    }
    this._dirtyTiles.clear();
    return tiles;
  },

  releaseConsumedDirtyTiles(tiles) {
    if (!Array.isArray(tiles) || tiles === EMPTY_DIRTY_RECTS || tiles === this._dirtyRects) {
      return;
    }
    tiles.length = 0;
    if (this._dirtyTileListPool.length < 4) {
      this._dirtyTileListPool.push(tiles);
    }
  },

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
  },

  releaseConsumedDirtyRects(rects) {
    if (!Array.isArray(rects) || rects === EMPTY_DIRTY_RECTS || rects === this._dirtyRects) {
      return;
    }
    rects.length = 0;
    if (this._dirtyRectListPool.length < 4) {
      this._dirtyRectListPool.push(rects);
    }
  },

  hasPendingDirty() {
    if (!this.imgData) return false;
    return this._dirtyFull || this._dirtyRects.length > 0;
  },

  consumeAllocationStats(reset = false) {
    const stats = { ...this._allocationStats };
    if (reset) {
      this._allocationStats.rectListCreated = 0;
      this._allocationStats.rectListReused = 0;
      this._allocationStats.tileListCreated = 0;
      this._allocationStats.tileListReused = 0;
    }
    return stats;
  }
};
export { displayDirtyTrackingMethods };