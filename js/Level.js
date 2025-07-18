import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';
import './ColorPalette.js';
import './SolidLayer.js';
import './SkillTypes.js';

// Palette remapping for the fire shooter trap. 
const FIRE_INDICES = Object.freeze([3, 4, 5, 6, 10, 11, 12, 13, 14]);
const ICE_COLORS   = Object.freeze([
  Lemmings.ColorPalette.colorFromRGB(92, 224, 255),
  Lemmings.ColorPalette.colorFromRGB(96, 255, 255),
  Lemmings.ColorPalette.colorFromRGB(72, 192, 255),
  Lemmings.ColorPalette.colorFromRGB(64, 160, 255),
  Lemmings.ColorPalette.colorFromRGB(4, 48, 136),
  Lemmings.ColorPalette.colorFromRGB(0, 64, 152),
  Lemmings.ColorPalette.colorFromRGB(2, 32, 120),
  Lemmings.ColorPalette.colorFromRGB(0, 64, 152),
  Lemmings.ColorPalette.colorFromRGB(64, 160, 255)
]);

class Level extends Lemmings.BaseLogger {
  constructor(width, height) {
    super();
    this.width = width | 0;
    this.height = height | 0;
    this.groundMask = new Lemmings.SolidLayer(this.width, this.height);
    this.groundImages = null;
    this.steelRanges = new Int32Array(0);
    this.steelMask = new Lemmings.SolidLayer(this.width, this.height);

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
    this.skills = new Array(Object.keys(Lemmings.SkillTypes).length);
    this.screenPositionX = 0;
    this.isSuperLemming = false;
    /** mechanics customization */
    this.mechanics = {};

    /** @type {Lemmings.Frame|null} prebuilt debug overlay */
    this._debugFrame = null;
  }

  setMapObjects(objects, objectImg) {
    Lemmings.withPerformance(
      'setMapObjects',
      {
        track: 'Level',
        trackGroup: 'Game State',
        color: 'primary-light',
        tooltipText: 'setMapObjects'
      },
      () => {
        this.objects.length = 0;
        this.entrances.length = 0;
        this.triggers.length = 0;
        let arrowRects = [];
        for (const ob of objects) {
          let objectInfo = objectImg[ob.id];
          if (objectInfo == null) continue;

          // // Ice palette swap for fire shooter traps
          // if (ob.id === 8 || ob.id === 10) {
          //   const pal = new Lemmings.ColorPalette();
          //   for (let i = 0; i < 16; ++i) {
          //     pal.setColorInt(i, objectInfo.palette.getColor(i));
          //   }
          //   for (let i = 0; i < FIRE_INDICES.length; ++i) {
          //     pal.setColorInt(FIRE_INDICES[i], ICE_COLORS[i]);
          //   }

          //   const clone = new Lemmings.ObjectImageInfo();
          //   Object.assign(clone, objectInfo);
          //   clone.palette = pal;
          //   objectInfo = clone;
          // }
          let tfxID = objectInfo.trigger_effect_id;

          if (tfxID === 6 && (ob.id === 7 || ob.id === 8 || ob.id === 10)) {
            tfxID = 12;
          }

          const mapOb = new Lemmings.MapObject(ob, objectInfo, new Lemmings.Animation(), tfxID);
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

            let trigger = new Lemmings.Trigger(tfxID, x1, y1, x2, y2, repeatDelay, objectInfo.trap_sound_effect_id, mapOb);

            if (mapOb.triggerType == 7 || mapOb.triggerType == 8) {
              const newRange = new Lemmings.Range();
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
        }
        this._debugFrame = null; // invalidate cached debug overlay
      })();
  }

  getGroundMaskLayer() { return this.groundMask; }
  setGroundMaskLayer(solidLayer) { this.groundMask = solidLayer; }

  isOutOfLevel(y) { return y < 0 || y >= this.height; }

  clearGroundWithMask(mask, x, y) {
    let changed = this.groundMask.clearGroundWithMask(
      mask, x, y,
      (px, py) => this.isSteelAt(px, py)
    );
    const img = this.groundImage;
    const w = this.width;
    const { offsetX, offsetY, width: mw, height: mh } = mask;
    for (let dy = 0; dy < mh; ++dy) {
      for (let dx = 0; dx < mw; ++dx) {
        if (mask.at(dx, dy)) continue; // Only erase where mask is TRANSPARENT
        const px = x + offsetX + dx;
        const py = y + offsetY + dy;
        if (this.isSteelAt(px, py)) continue;
        if (px < 0 || px >= this.width || py < 0 || py >= this.height) continue;
        const idx = (py * w + px) * 4;
        if (img[idx] || img[idx + 1] || img[idx + 2]) changed = true;
        img[idx] = img[idx + 1] = img[idx + 2] = 0;
      }
    }
    return changed;
  }

  setGroundAt(x, y, paletteIndex) {
    this.groundMask.setGroundAt(x, y);
    const idx = (y * this.width + x) * 4;
    const gp = this.groundImage;
    gp[idx]     = this.colorPalette.getR(paletteIndex);
    gp[idx + 1] = this.colorPalette.getG(paletteIndex);
    gp[idx + 2] = this.colorPalette.getB(paletteIndex);
    lemmings.game.lemmingManager.miniMap.onGroundChanged(x, y, false);
  }

  hasGroundAt(x, y) { return this.groundMask.hasGroundAt(x, y); }

  clearGroundAt(x, y) {
    if (this.isSteelAt(x, y)) return;
    this.groundMask.clearGroundAt(x, y);
    const idx = (y * this.width + x) * 4;
    const gp  = this.groundImage;
    gp[idx] = gp[idx + 1] = gp[idx + 2] = 0;
    lemmings.game.lemmingManager.miniMap.onGroundChanged(x, y, true);
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
    Lemmings.withPerformance(
      'newSetSteelAreas',
      {
        track: 'Level',
        trackGroup: 'Game State',
        color: 'secondary-light',
        tooltipText: 'newSetSteelAreas'
      },
      () => {
        if (!this.steelMask || this.steelMask.width !== this.width || this.steelMask.height !== this.height) {
          this.steelMask = new Lemmings.SolidLayer(this.width, this.height);
        } else {
          // Clear all
          this.steelMask.mask.fill(0);
        }
        const { levelWidth, levelHeight, terrains } = levelReader;
        let newSteelRanges = [];
        if (this.steelRanges.length == 0) return;
        for (let i = 0, len = terrains.length; i < len; ++i) {
          const tObj = terrains[i];
          const terImg = terrainImages[tObj.id];
          if (terImg.isSteel == true) {
            const newRange = new Lemmings.Range();
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
      })();
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

  setGroundImage(img) { this.groundImage = new Uint8ClampedArray(img); }
  setPalettes(colorPalette, groundPalette) {
    this.colorPalette = colorPalette;
    this.groundPalette = groundPalette;
  }

  render(gameDisplay) {
    gameDisplay.initSize(this.width, this.height);
    gameDisplay.setBackground(this.groundImage, this.groundMask);
  }

  renderDebug(gameDisplay) {
    if (!this._debugFrame) this.#buildDebugFrame();
    gameDisplay.drawFrame(this._debugFrame, 0, 0);
  }

  #buildDebugFrame() {
    const frame = new Lemmings.Frame(this.width, this.height);
    const steelColor  = Lemmings.ColorPalette.colorFromRGB(0, 255, 255);
    const arrowRColor = Lemmings.ColorPalette.colorFromRGB(128, 255, 0);
    const arrowLColor = Lemmings.ColorPalette.colorFromRGB(255, 128, 0);

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

Lemmings.Level = Level;
export { Level };
