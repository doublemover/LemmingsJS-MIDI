import {
  Animation,
  BaseLogger,
  ColorPalette,
  FIRE_INDICES,
  Frame,
  ICE_COLORS,
  MapObject,
  Range,
  SET_MAP_OBJECTS_MEASURE_DETAIL,
  SET_STEEL_MEASURE_DETAIL,
  SkillTypes,
  SolidLayer,
  Trigger,
  canMeasurePerformance,
  getAppContext,
  getMaskTransparentSpans,
  getRuntimeApp,
  getRuntimeHistory,
  getRuntimeMiniMap,
  getRuntimePerformanceContext,
  recordPerformanceMeasure
} from './LevelShared.js';
const levelGroundMutationMethods = {
  setRuntime(runtime = null) {
    this.runtime = runtime;
    for (const obj of this.objects || []) {
      obj?.setRuntime?.(runtime);
    }
    for (const trigger of this.triggers || []) {
      trigger.runtime = runtime;
    }
    for (const trigger of this.arrowTriggers || []) {
      trigger.runtime = runtime;
    }
  },

  setMapObjects(objects, objectImg) {
    const app = getRuntimeApp(this.runtime);
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      this.objects.length = 0;
      this.entrances.length = 0;
      this.triggers.length = 0;
      this.arrowTriggers.length = 0;
      let arrowRects = [];
      for (const ob of objects) {
        let objectInfo = objectImg[ob.id];
        if (objectInfo == null) continue;
  
        // // Ice palette swap for fire shooter traps
        // if (ob.id === 8 || ob.id === 10) {
        //   const pal = new ColorPalette();
        //   for (let i = 0; i < 16; ++i) {
        //     pal.setColorInt(i, objectInfo.palette.getColor(i));
        //   }
        //   for (let i = 0; i < FIRE_INDICES.length; ++i) {
        //     pal.setColorInt(FIRE_INDICES[i], ICE_COLORS[i]);
        //   }
  
        //   const clone = new ObjectImageInfo();
        //   Object.assign(clone, objectInfo);
        //   clone.palette = pal;
        //   objectInfo = clone;
        // }
        let tfxID = objectInfo.trigger_effect_id;
  
        if (tfxID === 6 && (ob.id === 7 || ob.id === 8 || ob.id === 10)) {
          tfxID = 12;
        }
  
        const mapOb = new MapObject(ob, objectInfo, new Animation(), tfxID, this.runtime);
        this.objects.push(mapOb);
        if (ob.id === 1) this.entrances.push(ob);
  
        if (tfxID !== 0) {
          const x1 = ob.x + objectInfo.trigger_left;
          const y1 = ob.y + objectInfo.trigger_top;
          const x2 = x1 + objectInfo.trigger_width;
          const y2 = y1 + objectInfo.trigger_height;
          let repeatDelay = 0;
          if (tfxID != 1) {
            if (tfxID != 5 && tfxID != 6 && tfxID != 7 && tfxID != 8 && tfxID != 12) {
              repeatDelay = objectInfo.frameCount;
            }
          }
  
          let trigger = new Trigger(tfxID, x1, y1, x2, y2, repeatDelay, objectInfo.trap_sound_effect_id, mapOb);
          trigger.runtime = this.runtime;
  
          if (mapOb.triggerType == 7 || mapOb.triggerType == 8) {
            const newRange = new Range();
            newRange.x = ob.x + objectInfo.trigger_left;
            newRange.y = ob.y + objectInfo.trigger_top;
            newRange.width = objectInfo.trigger_width;
            newRange.height = objectInfo.trigger_height;
            newRange.direction = mapOb.triggerType == 8 ? 1 : 0;
            arrowRects.push(newRange);
            this.arrowTriggers.push(trigger);
          }
  
          this.triggers.push(trigger);
        }
      }
      if (arrowRects.length > 0) {
        this.setArrowAreas(arrowRects);
      } else {
        this.arrowRanges = new Int32Array(0);
      }
      this._debugFrame = null; // invalidate cached debug overlay
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('setMapObjects', {
          start: perfStart,
          detail: SET_MAP_OBJECTS_MEASURE_DETAIL
        });
      }
    }
  },

  getGroundMaskLayer() { return this.groundMask; },

  setGroundMaskLayer(solidLayer) { this.groundMask = solidLayer; },

  _markGroundDirtyAll() {
    this._groundDirtyFull = true;
    this._groundDirtyTiles.clear();
    this._groundDirtyRects.length = 0;
  },

  _markGroundDirtyTilesForRect(x1, y1, x2, y2) {
    if (this._groundDirtyFull) return;
    const tileSize = this._groundTileSize;
    const cols = this._groundTileColumns;
    const rows = this._groundTileRows;
    if (!tileSize || !cols || !rows) return;
    const tx1 = Math.max(0, Math.floor(x1 / tileSize));
    const ty1 = Math.max(0, Math.floor(y1 / tileSize));
    const tx2 = Math.min(cols - 1, Math.floor((x2 - 1) / tileSize));
    const ty2 = Math.min(rows - 1, Math.floor((y2 - 1) / tileSize));
    for (let ty = ty1; ty <= ty2; ty += 1) {
      const row = ty * cols;
      for (let tx = tx1; tx <= tx2; tx += 1) {
        this._groundDirtyTiles.add(row + tx);
      }
    }
    const tileCount = cols * rows;
    if (this._groundDirtyTiles.size >= tileCount || this._groundDirtyTiles.size > 1024) {
      this._markGroundDirtyAll();
    }
  },

  _consumeGroundDirtyTileRects() {
    if (this._groundDirtyFull || !this._groundDirtyTiles.size) return [];
    const rects = [];
    const tileSize = this._groundTileSize;
    const cols = this._groundTileColumns;
    for (const index of this._groundDirtyTiles) {
      const tx = index % cols;
      const ty = Math.floor(index / cols);
      const x = tx * tileSize;
      const y = ty * tileSize;
      rects.push({
        x,
        y,
        width: Math.min(tileSize, this.width - x),
        height: Math.min(tileSize, this.height - y)
      });
    }
    this._groundDirtyTiles.clear();
    return rects;
  },

  _markGroundDirtyRect(x, y, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      this._markGroundDirtyAll();
      return;
    }
    if (width <= 0 || height <= 0) return;
    if (this._groundDirtyFull) return;
    const x1 = Math.max(0, Math.floor(x));
    const y1 = Math.max(0, Math.floor(y));
    const x2 = Math.min(this.width, Math.ceil(x + width));
    const y2 = Math.min(this.height, Math.ceil(y + height));
    if (x2 <= x1 || y2 <= y1) return;
    this._markGroundDirtyTilesForRect(x1, y1, x2, y2);
    this._groundDirtyRects.push({
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1
    });
    if (this._groundDirtyRects.length > 128) {
      this._markGroundDirtyAll();
    }
  },

  isOutOfLevel(y) { return y < 0 || y >= this.height; },

  _clearGroundWithMaskInternal(mask, x, y, opts = null) {
    let changed = false;
    let removed = 0;
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    const revealSteel = opts?.revealSteel === true;
    const history = getRuntimeHistory(this.runtime);
    const gm = this.groundMask;
    const gmMask = gm.mask;
    const img = this.groundImage;
    const w = this.width;
    const { offsetX, offsetY, width: mw, height: mh } = mask;
    const spans = getMaskTransparentSpans(mask);
    const clearPixel = (dx, dy) => {
      const px = x + offsetX + dx;
      const py = y + offsetY + dy;
      if (px < 0 || px >= this.width || py < 0 || py >= this.height) return;
      const isSteel = this.isSteelAt(px, py);
      if (isSteel && !revealSteel) return;
      const maskIdx = py * w + px;
      const imgIdx = maskIdx * 4;
      const prevMask = gmMask[maskIdx];
      const prevR = img[imgIdx];
      const prevG = img[imgIdx + 1];
      const prevB = img[imgIdx + 2];
      const nextMask = isSteel ? prevMask : 0;
      if (prevMask || prevR || prevG || prevB) {
        history?.recordGroundChange?.(
          maskIdx,
          prevMask,
          prevR,
          prevG,
          prevB,
          nextMask,
          0,
          0,
          0
        );
      }
      const pixelChanged = (prevMask && !isSteel) || !!(prevR || prevG || prevB);
      if (prevMask && !isSteel) {
        changed = true;
        gmMask[maskIdx] = 0;
      }
      if (prevR || prevG || prevB) {
        removed += 1;
        changed = true;
      }
      if (pixelChanged) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      img[imgIdx] = img[imgIdx + 1] = img[imgIdx + 2] = 0;
    };
    if (spans?.rows?.length) {
      const rows = spans.rows;
      const starts = spans.starts;
      const lengths = spans.lengths;
      for (let i = 0; i < rows.length; i += 1) {
        const dy = rows[i];
        const py = y + offsetY + dy;
        if (py < 0 || py >= this.height) continue;
        const startDx = starts[i];
        const endDx = startDx + lengths[i];
        const clippedStart = Math.max(startDx, -x - offsetX);
        const clippedEnd = Math.min(endDx, this.width - x - offsetX);
        for (let dx = clippedStart; dx < clippedEnd; dx += 1) {
          const px = x + offsetX + dx;
          const isSteel = this.isSteelAt(px, py);
          if (isSteel && !revealSteel) continue;
          const maskIdx = py * w + px;
          const imgIdx = maskIdx * 4;
          const prevMask = gmMask[maskIdx];
          const prevR = img[imgIdx];
          const prevG = img[imgIdx + 1];
          const prevB = img[imgIdx + 2];
          const nextMask = isSteel ? prevMask : 0;
          if (prevMask || prevR || prevG || prevB) {
            history?.recordGroundChange?.(
              maskIdx,
              prevMask,
              prevR,
              prevG,
              prevB,
              nextMask,
              0,
              0,
              0
            );
          }
          const pixelChanged = (prevMask && !isSteel) || !!(prevR || prevG || prevB);
          if (prevMask && !isSteel) {
            changed = true;
            gmMask[maskIdx] = 0;
          }
          if (prevR || prevG || prevB) {
            removed += 1;
            changed = true;
          }
          if (pixelChanged) {
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
          img[imgIdx] = img[imgIdx + 1] = img[imgIdx + 2] = 0;
        }
      }
    } else {
      for (let dy = 0; dy < mh; ++dy) {
        for (let dx = 0; dx < mw; ++dx) {
          if (mask.at(dx, dy)) continue; // Only erase where mask is TRANSPARENT
          clearPixel(dx, dy);
        }
      }
    }
    if (changed && maxX >= minX && maxY >= minY) {
      const width = (maxX - minX) + 1;
      const height = (maxY - minY) + 1;
      this._markGroundDirtyRect(minX, minY, width, height);
      getRuntimeMiniMap(this.runtime)?.invalidateRegion?.(minX, minY, width, height);
    }
    return { changed, removed };
  },

  clearGroundWithMask(mask, x, y, opts = null) {
    return this._clearGroundWithMaskInternal(mask, x, y, opts).changed;
  },

  clearGroundWithMaskCount(mask, x, y, opts = null) {
    return this._clearGroundWithMaskInternal(mask, x, y, opts).removed;
  },

  applyGroundBulkChange(x, y, width, height, { invalidateMiniMap = true } = {}) {
    this._markGroundDirtyRect(x, y, width, height);
    if (invalidateMiniMap) {
      getRuntimeMiniMap(this.runtime)?.invalidateRegion?.(x, y, width, height);
    }
  },

  setGroundRect(x, y, width, height, paletteIndex, {
    recordHistory = false,
    invalidateMiniMap = true
  } = {}) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + width));
    const y1 = Math.min(this.height, Math.ceil(y + height));
    if (x1 <= x0 || y1 <= y0) return 0;
    const mask = this.groundMask?.mask;
    const gp = this.groundImage;
    if (!mask || !gp) return 0;
    const history = recordHistory ? getRuntimeHistory(this.runtime) : null;
    const nextR = this.colorPalette.getR(paletteIndex);
    const nextG = this.colorPalette.getG(paletteIndex);
    const nextB = this.colorPalette.getB(paletteIndex);
    let changed = 0;
    for (let yy = y0; yy < y1; yy += 1) {
      const row = yy * this.width;
      for (let xx = x0; xx < x1; xx += 1) {
        const maskIdx = row + xx;
        const imgIdx = maskIdx * 4;
        const prevMask = mask[maskIdx];
        const prevR = gp[imgIdx];
        const prevG = gp[imgIdx + 1];
        const prevB = gp[imgIdx + 2];
        if (prevMask === 1 && prevR === nextR && prevG === nextG && prevB === nextB) continue;
        if (history?.recordGroundChange) {
          history.recordGroundChange(
            maskIdx,
            prevMask,
            prevR,
            prevG,
            prevB,
            1,
            nextR,
            nextG,
            nextB
          );
        }
        mask[maskIdx] = 1;
        gp[imgIdx] = nextR;
        gp[imgIdx + 1] = nextG;
        gp[imgIdx + 2] = nextB;
        changed += 1;
      }
    }
    if (changed > 0) {
      this.applyGroundBulkChange(x0, y0, x1 - x0, y1 - y0, { invalidateMiniMap });
    }
    return changed;
  },

  setGroundAt(x, y, paletteIndex) {
    const maskIdx = y * this.width + x;
    const idx = (y * this.width + x) * 4;
    const gp = this.groundImage;
    const history = getRuntimeHistory(this.runtime);
    if (history?.recordGroundChange) {
      const prevMask = this.groundMask.mask[maskIdx];
      const prevR = gp[idx];
      const prevG = gp[idx + 1];
      const prevB = gp[idx + 2];
      const nextR = this.colorPalette.getR(paletteIndex);
      const nextG = this.colorPalette.getG(paletteIndex);
      const nextB = this.colorPalette.getB(paletteIndex);
      history.recordGroundChange(
        maskIdx,
        prevMask,
        prevR,
        prevG,
        prevB,
        1,
        nextR,
        nextG,
        nextB
      );
    }
    this.groundMask.setGroundAt(x, y);
    gp[idx]     = this.colorPalette.getR(paletteIndex);
    gp[idx + 1] = this.colorPalette.getG(paletteIndex);
    gp[idx + 2] = this.colorPalette.getB(paletteIndex);
    this._markGroundDirtyRect(x, y, 1, 1);
    getRuntimeMiniMap(this.runtime)?.onGroundChanged(x, y, false);
  },

  hasGroundAt(x, y) { return this.groundMask.hasGroundAt(x, y); },

  clearGroundAt(x, y) {
    if (this.isSteelAt(x, y)) return;
    const idx = (y * this.width + x) * 4;
    const gp  = this.groundImage;
    const history = getRuntimeHistory(this.runtime);
    if (history?.recordGroundChange) {
      const maskIdx = y * this.width + x;
      const prevMask = this.groundMask.mask[maskIdx];
      const prevR = gp[idx];
      const prevG = gp[idx + 1];
      const prevB = gp[idx + 2];
      history.recordGroundChange(
        maskIdx,
        prevMask,
        prevR,
        prevG,
        prevB,
        0,
        0,
        0,
        0
      );
    }
    this.groundMask.clearGroundAt(x, y);
    gp[idx] = gp[idx + 1] = gp[idx + 2] = 0;
    this._markGroundDirtyRect(x, y, 1, 1);
    getRuntimeMiniMap(this.runtime)?.onGroundChanged(x, y, true);
  },

  clearGroundRow(x, y, width) {
    if (!Number.isFinite(y) || y < 0 || y >= this.height) return 0;
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.width, Math.ceil(x + width));
    if (x1 <= x0) return 0;
    const mask = this.groundMask?.mask;
    const gp = this.groundImage;
    if (!mask || !gp) return 0;
    const yy = Math.trunc(y);
    const row = yy * this.width;
    const history = getRuntimeHistory(this.runtime);
    let changed = 0;
    let minX = this.width;
    let maxX = -1;
    for (let xx = x0; xx < x1; xx += 1) {
      if (!mask[row + xx]) continue;
      if (this.isSteelAt(xx, yy)) continue;
      const maskIdx = row + xx;
      const imgIdx = maskIdx * 4;
      const prevMask = mask[maskIdx];
      const prevR = gp[imgIdx];
      const prevG = gp[imgIdx + 1];
      const prevB = gp[imgIdx + 2];
      history?.recordGroundChange?.(
        maskIdx,
        prevMask,
        prevR,
        prevG,
        prevB,
        0,
        0,
        0,
        0
      );
      mask[maskIdx] = 0;
      gp[imgIdx] = gp[imgIdx + 1] = gp[imgIdx + 2] = 0;
      changed += 1;
      if (xx < minX) minX = xx;
      if (xx > maxX) maxX = xx;
    }
    if (changed > 0) {
      const dirtyWidth = (maxX - minX) + 1;
      this._markGroundDirtyRect(minX, yy, dirtyWidth, 1);
      getRuntimeMiniMap(this.runtime)?.invalidateRegion?.(minX, yy, dirtyWidth, 1);
    }
    return changed;
  }
};
export { levelGroundMutationMethods };