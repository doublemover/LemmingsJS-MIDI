import { BaseLogger } from '../util/LogHandler.js';
import { Animation } from '../render/Animation.js';
import { ColorPalette } from '../render/ColorPalette.js';
import { Frame } from '../render/Frame.js';
import { MapObject } from './MapObject.js';
import { Range } from '../util/Range.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { SolidLayer } from '../render/SolidLayer.js';
import { Trigger } from './Trigger.js';
import { getAppContext } from '../core/dependencies.js';

// Palette remapping for the fire shooter trap. 
const FIRE_INDICES = Object.freeze([3, 4, 5, 6, 10, 11, 12, 13, 14]);
const ICE_COLORS   = Object.freeze([
  ColorPalette.colorFromRGB(92, 224, 255),
  ColorPalette.colorFromRGB(96, 255, 255),
  ColorPalette.colorFromRGB(72, 192, 255),
  ColorPalette.colorFromRGB(64, 160, 255),
  ColorPalette.colorFromRGB(4, 48, 136),
  ColorPalette.colorFromRGB(0, 64, 152),
  ColorPalette.colorFromRGB(2, 32, 120),
  ColorPalette.colorFromRGB(0, 64, 152),
  ColorPalette.colorFromRGB(64, 160, 255)
]);

const canMeasurePerformance = () => (typeof performance !== 'undefined' &&
  typeof performance.now === 'function' &&
  typeof performance.measure === 'function');

const SET_MAP_OBJECTS_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'Level',
    trackGroup: 'Game State',
    color: 'primary-light',
    tooltipText: 'setMapObjects'
  })
});

const SET_STEEL_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'Level',
    trackGroup: 'Game State',
    color: 'secondary-light',
    tooltipText: 'newSetSteelAreas'
  })
});

const getRuntimeApp = () => getAppContext();
const getRuntimeGame = () => getRuntimeApp()?.game ?? null;
const getRuntimeHistory = () => getRuntimeGame()?.history ?? null;
const getRuntimeMiniMap = () => getRuntimeGame()?.lemmingManager?.miniMap ?? null;

class Level extends BaseLogger {
  constructor(width, height) {
    super();
    this.width = width | 0;
    this.height = height | 0;
    this.groundMask = new SolidLayer(this.width, this.height);
    this.groundImages = null;
    this.steelRanges = new Int32Array(0);
    this.steelMask = new SolidLayer(this.width, this.height);

    this.objects = [];
    this.entrances = [];
    this.triggers = [];
    this.arrowRanges = new Int32Array(0);
    this.arrowTriggers = [];

    this.name = '';
    this.releaseRate = 0;
    this.releaseCount = 0;
    this.needCount = 0;
    this.timeLimit = 0;
    this.skills = new Array(Object.keys(SkillTypes).length);
    this.screenPositionX = 0;
    this.isSuperLemming = false;
    /** mechanics customization */
    this.mechanics = {};

    /** @type {Frame|null} prebuilt debug overlay */
    this._debugFrame = null;
    this._groundTileSize = 64;
    this._groundTileColumns = Math.max(1, Math.ceil(this.width / this._groundTileSize));
    this._groundTileRows = Math.max(1, Math.ceil(this.height / this._groundTileSize));
    this._groundDirtyTiles = new Set();
    this._groundDirtyFull = true;
    this._groundDirtyRects = [];
  }

  setMapObjects(objects, objectImg) {
    const app = getRuntimeApp();
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

        const mapOb = new MapObject(ob, objectInfo, new Animation(), tfxID);
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
        try {
          performance.measure('setMapObjects', {
            start: perfStart,
            detail: SET_MAP_OBJECTS_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
  }

  getGroundMaskLayer() { return this.groundMask; }
  setGroundMaskLayer(solidLayer) { this.groundMask = solidLayer; }

  _markGroundDirtyAll() {
    this._groundDirtyFull = true;
    this._groundDirtyTiles.clear();
    this._groundDirtyRects.length = 0;
  }

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
  }

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
  }

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
  }

  isOutOfLevel(y) { return y < 0 || y >= this.height; }

  _clearGroundWithMaskInternal(mask, x, y, opts = null) {
    let changed = false;
    let removed = 0;
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    const revealSteel = opts?.revealSteel === true;
    const history = getRuntimeHistory();
    const gm = this.groundMask;
    const gmMask = gm.mask;
    const img = this.groundImage;
    const w = this.width;
    const { offsetX, offsetY, width: mw, height: mh } = mask;
    for (let dy = 0; dy < mh; ++dy) {
      for (let dx = 0; dx < mw; ++dx) {
        if (mask.at(dx, dy)) continue; // Only erase where mask is TRANSPARENT  
        const px = x + offsetX + dx;
        const py = y + offsetY + dy;
        if (px < 0 || px >= this.width || py < 0 || py >= this.height) continue;
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
    if (changed && maxX >= minX && maxY >= minY) {
      this._markGroundDirtyRect(minX, minY, (maxX - minX) + 1, (maxY - minY) + 1);
    }
    return { changed, removed };
  }

  clearGroundWithMask(mask, x, y, opts = null) {
    return this._clearGroundWithMaskInternal(mask, x, y, opts).changed;
  }

  clearGroundWithMaskCount(mask, x, y, opts = null) {
    return this._clearGroundWithMaskInternal(mask, x, y, opts).removed;
  }

  applyGroundBulkChange(x, y, width, height, { invalidateMiniMap = true } = {}) {
    this._markGroundDirtyRect(x, y, width, height);
    if (invalidateMiniMap) {
      getRuntimeMiniMap()?.invalidateRegion?.(x, y, width, height);
    }
  }

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
    const history = recordHistory ? getRuntimeHistory() : null;
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
  }

  setGroundAt(x, y, paletteIndex) {
    const maskIdx = y * this.width + x;
    const idx = (y * this.width + x) * 4;
    const gp = this.groundImage;
    const history = getRuntimeHistory();
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
    getRuntimeMiniMap()?.onGroundChanged(x, y, false);
  }

  hasGroundAt(x, y) { return this.groundMask.hasGroundAt(x, y); }

  clearGroundAt(x, y) {
    if (this.isSteelAt(x, y)) return;
    const idx = (y * this.width + x) * 4;
    const gp  = this.groundImage;
    const history = getRuntimeHistory();
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
    getRuntimeMiniMap()?.onGroundChanged(x, y, true);
  }

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
  }

  isArrowAt(x, y, direction) {
    const a = this.arrowRanges;
    for (let i = 0, len = a.length; i < len; i += 5) {
      if (x >= a[i] && x < a[i] + a[i+2] && y >= a[i+1] && y < a[i+1] + a[i+3] && direction != a[i+4]) {
        return true;
      }
    }
    return false;
  }

  isArrowGround(x, y, direction) { return this.isArrowAt(x, y, direction) && this.hasGroundAt(x, y); }

  hasArrowUnderMask(mask, ox, oy, direction) {
    const { offsetX:mx, offsetY:my, width:w, height:h } = mask;
    for (let dy = 0; dy < h; ++dy) {
      for (let dx = 0; dx < w; ++dx) {
        if (!mask.at(dx, dy) && this.isArrowGround(ox + mx + dx, oy + my + dy, direction)) {
          return true;
        }
      }
    }
    return false;
  }

  newSetSteelAreas(levelReader, terrainImages) {
    const app = getRuntimeApp();
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
          for (let dy = tObj.y; dy < tObj.y+terImg.height; dy++) {
            for (let dx = tObj.x; dx < tObj.x+terImg.width; dx++) {
              if (this.isSteelAt(dx,dy, true)) {
                newSteelRanges.push(newRange);
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
        try {
          performance.measure('newSetSteelAreas', {
            start: perfStart,
            detail: SET_STEEL_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
  }

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
  }

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
  }

  isSteelGround(x, y, loading = false) {
    if (loading == false) {
      return this.steelMask.hasMaskAt(x,y);
    }
    if (this.hasGroundAt(x, y)) {
      return this.isSteelAt(x, y);
    }
  }

  hasSteelUnderMask(mask, ox, oy) {
    const { offsetX:mx, offsetY:my, width:w, height:h } = mask;
    for (let dy = 0; dy < h; ++dy) {
      for (let dx = 0; dx < w; ++dx) {
        if (!mask.at(dx, dy) && this.isSteelGround(ox + mx + dx, oy + my + dy)) {
          return true;
        }
      }
    }
    return false;
  }

  setGroundImage(img) {
    this.groundImage = new Uint8ClampedArray(img);
    this._groundTileColumns = Math.max(1, Math.ceil(this.width / this._groundTileSize));
    this._groundTileRows = Math.max(1, Math.ceil(this.height / this._groundTileSize));
    this._markGroundDirtyAll();
  }
  setPalettes(colorPalette, groundPalette) {
    this.colorPalette = colorPalette;
    this.groundPalette = groundPalette;
  }

  render(gameDisplay) {
    gameDisplay.initSize(this.width, this.height);
    if (typeof gameDisplay.restoreBackground === 'function' &&
        typeof gameDisplay.syncBackground === 'function') {
      gameDisplay.setDirtyTileSize?.(this._groundTileSize);
      gameDisplay.restoreBackground();
      if (this._groundDirtyFull || !gameDisplay.hasBackground?.()) {
        gameDisplay.syncBackground(this.groundImage, this.groundMask, null, this._groundTileSize);
        this._groundDirtyFull = false;
        this._groundDirtyTiles.clear();
        this._groundDirtyRects.length = 0;
        return;
      }
      if (this._groundDirtyTiles.size || this._groundDirtyRects.length) {
        let dirtyRects = this._consumeGroundDirtyTileRects();
        if (!dirtyRects.length && this._groundDirtyRects.length) {
          dirtyRects = this._groundDirtyRects.slice();
        }
        gameDisplay.syncBackground(this.groundImage, this.groundMask, dirtyRects, this._groundTileSize);
        this._groundDirtyRects.length = 0;
        return;
      }
      gameDisplay.groundMask = this.groundMask;
      return;
    }
    gameDisplay.setBackground(this.groundImage, this.groundMask);
  }

  renderDebug(gameDisplay) {
    if (!this._debugFrame) this.#buildDebugFrame();
    gameDisplay.drawFrame(this._debugFrame, 0, 0);
  }

  #buildDebugFrame() {
    const frame = new Frame(this.width, this.height);
    const steelColor  = ColorPalette.colorFromRGB(0, 255, 255);
    const arrowRColor = ColorPalette.colorFromRGB(128, 255, 0);
    const arrowLColor = ColorPalette.colorFromRGB(255, 128, 0);

    const s = this.steelRanges;
    for (let i = 0, len = s.length; i < len; i += 4) {
      frame.drawRect(s[i], s[i+1], s[i+2], s[i+3], steelColor);
    }

    const a = this.arrowRanges;
    for (let i = 0, len = a.length; i < len; i += 5) {
      const col = a[i+4] ? arrowRColor : arrowLColor;
      frame.drawRect(a[i], a[i+1], a[i+2], a[i+3], col);
    }

    this._debugFrame = frame;
  }
}

export { Level };
