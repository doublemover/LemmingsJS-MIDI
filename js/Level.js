import { Lemmings } from './LemmingsNamespace.js';

class Level {
  constructor(width, height, mechanics = {}) {
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

    this.name = "";
    this.releaseRate = 0;
    this.releaseCount = 0;
    this.needCount = 0;
    this.timeLimit = 0;
    this.skills = new Array(Object.keys(Lemmings.SkillTypes).length);
    this.screenPositionX = 0;
    this.isSuperLemming = false;
    this.mechanics = mechanics;
  }

  setMapObjects(objects, objectImg) {
    // const start = performance.now();
    this.objects.length = 0;
    this.entrances.length = 0;
    this.triggers.length = 0;
    let arrowRects = [];
    let idx = 0;
    for (const ob of objects) {
      if (this.mechanics.DisableObjectsAfter15 && idx >= 16) break;
      const info = objectImg[ob.id];
      if (info == null) continue;
      let tfxID = info.trigger_effect_id;

      if (tfxID === 6 && (ob.id === 7 || ob.id === 8 || ob.id === 10)) {
        tfxID = 12;
      }

      const mapOb = new Lemmings.MapObject(ob, info, new Lemmings.Animation(), tfxID);
      this.objects.push(mapOb);
      if (ob.id === 1) {
        if (!this.mechanics.Max4EnabledEntrances || this.entrances.length < 4) {
          this.entrances.push(ob);
        }
      }

      if (tfxID !== 0) {
        const x1 = ob.x + info.trigger_left;
        const y1 = ob.y + info.trigger_top;
        const x2 = x1 + info.trigger_width;
        const y2 = y1 + info.trigger_height;
        let repeatDelay = 0;
        if (tfxID != 1) {
          if (tfxID != 5 && tfxID != 6 && tfxID != 7 && tfxID != 8 && tfxID != 12) {
            repeatDelay = info.frameCount;
          }
        }

        let trigger = new Lemmings.Trigger(tfxID, x1, y1, x2, y2, repeatDelay, info.trap_sound_effect_id, mapOb);

        if (mapOb.triggerType == 7 || mapOb.triggerType == 8) {
          var newRange = new Lemmings.Range();
          newRange.x = ob.x + info.trigger_left;
          newRange.y = ob.y + info.trigger_top;
          newRange.width = info.trigger_width;
          newRange.height = info.trigger_height;
          newRange.direction = mapOb.triggerType == 8 ? 1 : 0;
          arrowRects.push(newRange);
          this.arrowTriggers.push(trigger);
        }

        this.triggers.push(trigger);
      }
      idx++;
    }
    if (arrowRects.length > 0) {
      this.setArrowAreas(arrowRects);
    }
    // performance.measure(`setMapObjects`, { start, detail: { devtools: { track: "Level", trackGroup: "Game State", color: "primary-light", properties: [["Objects", `${this.objects.length}`],["Entrances", `${this.entrances.length}`],["Triggers", `${this.triggers.length}`]], tooltipText: `setMapObjects` } } });
  }

  getGroundMaskLayer() { return this.groundMask; }
  setGroundMaskLayer(solidLayer) { this.groundMask = solidLayer; }

  isOutOfLevel(y) { return y < 0 || y >= this.height; }

  clearGroundWithMask(mask, x, y) {
    this.groundMask.clearGroundWithMask(
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
        img[idx] = img[idx + 1] = img[idx + 2] = 0;
      }
    }
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
  }

  isArrowAt(x, y, direction) {
    const a = this.arrowRanges;
    for (let i = 0, len = a.length; i < len; i += 5) {
      if (x >= a[i] && x < a[i] + a[i+2] && y >= a[i+1] && y < a[i+1] + a[i+3]) {
        if (direction != a[i+4]) return true;
        if (this.mechanics.MinerOneWayRightBug && a[i+4] === 1) return true;
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
        var newRange = new Lemmings.Range();
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
    const s = this.steelRanges;
    for (let i = 0, len = s.length; i < len; i += 4) {
      gameDisplay.drawRect(s[i], s[i+1], s[i+2], s[i+3], 0, 255, 255);
    }
    const a = this.arrowRanges;
    for (let i = 0, len = a.length; i < len; i += 5) {
      if (a[i+4]) {
        gameDisplay.drawRect(a[i], a[i+1], a[i+2], a[i+3], 128, 255, 0);
      } else {
        gameDisplay.drawRect(a[i], a[i+1], a[i+2], a[i+3], 255, 128, 0);
      }
    }
  }
}

Lemmings.Level = Level;
export { Level };
