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
const levelArrowSteelMethods = {
  setArrowAreas(ranges = []) {
    const buf = new Int32Array(ranges.length * 5);
    for (let i = 0, o = 0; i < ranges.length; ++i, o += 5) {
      const r = ranges[i];
      buf[o]   = r.x;
      buf[o+1] = r.y;
      buf[o+2] = r.width;
      buf[o+3] = r.height;
      buf[o+4] = r.direction;
    }
    this.arrowRanges = buf;
    this._debugFrame = null; // invalidate cached debug overlay
  },

  isArrowAt(x, y, direction) {
    const a = this.arrowRanges;
    for (let i = 0, len = a.length; i < len; i += 5) {
      if (x >= a[i] && x < a[i] + a[i+2] && y >= a[i+1] && y < a[i+1] + a[i+3] && direction != a[i+4]) {
        return true;
      }
    }
    return false;
  },

  isArrowGround(x, y, direction) { return this.isArrowAt(x, y, direction) && this.hasGroundAt(x, y); },

  hasArrowUnderMask(mask, ox, oy, direction) {
    const { offsetX:mx, offsetY:my, width:w, height:h } = mask;
    const spans = getMaskTransparentSpans(mask);
    if (spans?.rows?.length) {
      const rows = spans.rows;
      const starts = spans.starts;
      const lengths = spans.lengths;
      for (let i = 0; i < rows.length; i += 1) {
        const dy = rows[i];
        const y = oy + my + dy;
        const start = starts[i];
        const end = start + lengths[i];
        for (let dx = start; dx < end; dx += 1) {
          if (this.isArrowGround(ox + mx + dx, y, direction)) {
            return true;
          }
        }
      }
      return false;
    }
    for (let dy = 0; dy < h; ++dy) {
      for (let dx = 0; dx < w; ++dx) {
        if (!mask.at(dx, dy) && this.isArrowGround(ox + mx + dx, oy + my + dy, direction)) {
          return true;
        }
      }
    }
    return false;
  },

  newSetSteelAreas(levelReader, terrainImages) {
    const app = getRuntimeApp(this.runtime);
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!this.steelMask || this.steelMask.width !== this.width || this.steelMask.height !== this.height) {
        this.steelMask = new SolidLayer(this.width, this.height);
      } else {
        // Clear all
        this.steelMask.mask.fill(0);
      }
      const { terrains } = levelReader;
      let newSteelRanges = [];
      if (this.steelRanges.length == 0) return;
      for (let i = 0, len = terrains.length; i < len; ++i) {
        const tObj = terrains[i];
        const terImg = terrainImages[tObj.id];
        if (terImg.isSteel == true) {
          const newRange = new Range();
          newRange.x = tObj.x;
          newRange.y = tObj.y;
          newRange.width = terImg.steelWidth;
          newRange.height = terImg.steelHeight;
          let hasSteelPixels = false;
          for (let dy = tObj.y; dy < tObj.y+terImg.height; dy++) {
            for (let dx = tObj.x; dx < tObj.x+terImg.width; dx++) {
              if (this.isSteelAt(dx,dy, true)) {
                if (!hasSteelPixels) {
                  newSteelRanges.push(newRange);
                  hasSteelPixels = true;
                }
                this.steelMask.setMaskAt(dx, dy);
              }
            }
          }
        }
      }
      if (newSteelRanges.length > 0) {
        this.steelRanges = new Int32Array(0);
        this.setSteelAreas(newSteelRanges);
      }
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('newSetSteelAreas', {
          start: perfStart,
          detail: SET_STEEL_MEASURE_DETAIL
        });
      }
    }
  },

  setSteelAreas(ranges = []) {
    const buf = new Int32Array(ranges.length * 4);
    for (let i = 0, o = 0; i < ranges.length; ++i, o += 4) {
      const r = ranges[i];
      buf[o]   = r.x;
      buf[o+1] = r.y;
      buf[o+2] = r.width;
      buf[o+3] = r.height;
    }
    this.steelRanges = buf;
    this._debugFrame = null; // invalidate cached debug overlay
  },

  isSteelAt(x, y, loading = false) {
    if (loading == false) {
      return this.steelMask.hasMaskAt(x,y);
    }
    const s = this.steelRanges;
    for (let i = 0, len = s.length; i < len; i += 4) {
      if (x >= s[i] && x < s[i] + s[i+2] && y >= s[i+1] && y < s[i+1] + s[i+3]) {
        return true;
      }
    }
    return false;
  },

  isSteelGround(x, y, loading = false) {
    if (loading == false) {
      return this.steelMask.hasMaskAt(x,y);
    }
    if (this.hasGroundAt(x, y)) {
      return this.isSteelAt(x, y);
    }
  },

  hasSteelUnderMask(mask, ox, oy) {
    const { offsetX:mx, offsetY:my, width:w, height:h } = mask;
    const spans = getMaskTransparentSpans(mask);
    if (spans?.rows?.length) {
      const rows = spans.rows;
      const starts = spans.starts;
      const lengths = spans.lengths;
      for (let i = 0; i < rows.length; i += 1) {
        const dy = rows[i];
        const y = oy + my + dy;
        const start = starts[i];
        const end = start + lengths[i];
        for (let dx = start; dx < end; dx += 1) {
          if (this.isSteelGround(ox + mx + dx, y)) {
            return true;
          }
        }
      }
      return false;
    }
    for (let dy = 0; dy < h; ++dy) {
      for (let dx = 0; dx < w; ++dx) {
        if (!mask.at(dx, dy) && this.isSteelGround(ox + mx + dx, oy + my + dy)) {
          return true;
        }
      }
    }
    return false;
  }
};
export { levelArrowSteelMethods };