import { Lemmings } from './LemmingsNamespace.js';

/**
 * GameGui – unchanged public API, now updates itself
 * even while the simulation is paused.
 */
class GameGui {
  constructor(game, skillPanelSprites, skills, gameTimer, gameVictoryCondition) {
    /* external handles */
    this.game                 = game;
    this.skillPanelSprites    = skillPanelSprites;
    this.skills               = skills;
    this.gameTimer            = gameTimer;
    this.gameVictoryCondition = gameVictoryCondition;

    /* change-tracking flags (original names) */
    this.gameTimeChanged       = true;
    this.skillsCountChanged    = true;
    this.skillSelectionChanged = true;
    this.backgroundChanged     = true;
    this.releaseRateChanged    = true;

    this.nukePrepared          = false;
    this.lastGameSpeed      = 0;

    /* sprite caches */
    this._panelSprite    = skillPanelSprites.getPanelSprite();
    this._numLeftCache   = new Array(10);
    this._numRightCache  = new Array(10);
    this._numEmptySprite = skillPanelSprites.getNumberSpriteEmpty();
    this._letterCache    = new Map();

    /* runtime state */
    this.display          = null;
    this.miniMap          = null;
    this.deltaReleaseRate = 0;

    /* marching ants selection animation settings */
    this.selectionDashLen   = 4;   // length of dash segments (1px longer)
    this.selectionAnimDelay = 60;  // frames between offset increments (slower)
    this.selectionAnimStep  = 1;   // pixels per animation step
    this._selectionOffset   = 0;
    this._selectionCounter  = 0;

    /* hover state */
    this._hoverPanelIdx   = -1;
    this._hoverSpeedUp    = false;
    this._hoverSpeedDown  = false;

    /* release rate lock state */
    this._rrLockMin = false;
    this._rrLockMax = false;

    this._guiBound = this._guiLoop.bind(this);
    this._guiRafId        = 0;

    this.smoothScroller = new Lemmings.SmoothScroller();

    this._nukeAfterCountdown = 0;


    gameTimer.eachGameSecond.on(() => {
      this._applyReleaseRateAuto();
      if (lemmings.nukeAfter > 0) {
        this._nukeAfterCountdown++;
        if (this._nukeAfterCountdown == lemmings.nukeAfter) {
          this.game.queueCommand(new Lemmings.CommandNuke());
          this.nukePrepared = false;
        }
      }
      if ((Math.floor(this.gameTimer.getGameTime()) % 2) == 0) {
        this.backgroundChanged = true;
      }

      if (this._guiRafId == 0) {
        this._guiRafId = window.requestAnimationFrame(this._guiBound);
      }
    });

    skills.onCountChanged.on(() => {
      this.backgroundChanged = true;
    });

    skills.onSelectionChanged.on(() => {
      this.backgroundChanged = true;
      this._selectionOffset  = 0;
    });
  }

  setMiniMap(miniMap) {
    this.miniMap = miniMap;
    this.game?.lemmingManager?.setMiniMap?.(miniMap);
  }

  _applyReleaseRateAuto() {
    if (!this.deltaReleaseRate) return;
    if (this.gameTimer.isRunning()) {
      const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
      const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
      const cur = this.gameVictoryCondition.getCurrentReleaseRate();
      let   neu = cur + this.deltaReleaseRate;
      if (neu < min) neu = min;
      if (neu > max) neu = max;
      this.gameVictoryCondition.setCurrentReleaseRate?.(neu) ??
                (this.gameVictoryCondition.currentReleaseRate = neu);
      this.releaseRateChanged = true;
    }
    if (this.deltaReleaseRate > 0)
      this.game.queueCommand(new Lemmings.CommandReleaseRateIncrease(this.deltaReleaseRate));
    else
      this.game.queueCommand(new Lemmings.CommandReleaseRateDecrease(-this.deltaReleaseRate));
  }

  handleSkillMouseDown(e) {
    const panelIndex = Math.trunc(e.x / 16);
    if (panelIndex !== 11) {
      this.nukePrepared = false;
      this.backgroundChanged = true;
      this.gameTimeChanged = true;
    }

    if (panelIndex === 0 || panelIndex === 1) {
      const step = panelIndex === 0 ? -3 : +3;
      const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
      const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
      const cur = this.gameVictoryCondition.getCurrentReleaseRate();
      if ((step < 0 && cur <= min) || (step > 0 && cur >= max)) {
        if (this.skills.clearSelectedSkill()) {
          this.skillSelectionChanged = true;
        }
        return;
      }
      if (this.gameTimer.isRunning()) {
        let neu = cur + step;
        if (neu < min) neu = min;
        if (neu > max) neu = max;
        this.lastGameSpeed = neu;
        this.gameVictoryCondition.setCurrentReleaseRate?.(neu) ??
                    (this.gameVictoryCondition.currentReleaseRate = neu);
      }
      this.deltaReleaseRate = step;
      this._applyReleaseRateAuto();
      this.gameTimeChanged = true;
      return;
    }
    if (panelIndex === 10) {
      if (e.y >= 32) { // if it is the bottom of the pause button
        const pauseX = e.x - 159; // the leftmost position
        const pauseIndex = Math.trunc(pauseX / 9);
        const speedFac = this.gameTimer.speedFactor;
        const debugOrBench = (this.game.showDebug || lemmings.bench == true);
        if (pauseIndex === 0) {
          if (speedFac > 10) {
            this.gameTimer.speedFactor -= 10;
            this.drawSpeedChange(false);
            return;
          }
          if (speedFac > 1) {
            this.gameTimer.speedFactor--;
            this.drawSpeedChange(false); 
            return;
          }
          if (debugOrBench || speedFac == 1 || speedFac > 0.1 && speedFac < 1) {
            this.gameTimer.speedFactor = Math.trunc((this.gameTimer.speedFactor-0.1)*100)/100;
            this.drawSpeedChange(false);
            return;
          }
        }
        if (pauseIndex === 1) {
          if (speedFac < 1) {
            this.gameTimer.speedFactor = Math.trunc((this.gameTimer.speedFactor+0.1)*100)/100;
            this.drawSpeedChange(true);
            return;
          }
          if (speedFac >= 10 && speedFac < 120) {
            this.gameTimer.speedFactor += 10;
            this.drawSpeedChange(true);
            return;
          }
          if (speedFac < 10) {
            this.gameTimer.speedFactor++;
            this.drawSpeedChange(true);
            return;
          }
        }
      } else {
        this.gameTimer.toggle();
      }
      this.skillSelectionChanged = true;
      this.gameTimeChanged = true;
      return;
    }
    if (panelIndex === 11) {
      if (this.nukePrepared) {
        this.game.queueCommand(new Lemmings.CommandNuke());
        this.nukePrepared = false;
        this.gameTimeChanged = true;
      } else {
        this.nukePrepared = true;
        this.gameTimeChanged = true;
      }
      if (this.skills.clearSelectedSkill()) {
        this.skillSelectionChanged = true;
      }
      this.skillSelectionChanged = true;
      return;
    }
    const newSkill = this.getSkillByPanelIndex(panelIndex);
    if (newSkill === Lemmings.SkillTypes.UNKNOWN) return;
    if (this.skills.getSkill(newSkill) <= 0) {
      if (this.skills.clearSelectedSkill()) this.skillSelectionChanged = true;
      return;
    }
    this.skills.setSelectedSkill(newSkill);
    this.game.queueCommand(new Lemmings.CommandSelectSkill(newSkill));
  }

  handleSkillMouseRightDown(e) {
    const panelIndex = Math.trunc(e.x / 16);

    this.nukePrepared = false; // always cancel nuke confirmation on right click
    this.gameTimeChanged = true;

    if (panelIndex === 0) {
      const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
      this.gameVictoryCondition.setCurrentReleaseRate?.(min);
      this.deltaReleaseRate = -min;
      this._applyReleaseRateAuto();
      return;
    }

    if (panelIndex === 1) {
      const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
      this.gameVictoryCondition.setCurrentReleaseRate?.(max);
      this.deltaReleaseRate = max;
      this._applyReleaseRateAuto();
      return;
    }

    if (panelIndex === 10) { // reset game speed if you right click pause
      if (this.gameTimer.speedFactor !== 1) {
        this.gameTimer.speedFactor = 1;
        this.drawSpeedChange(false, true);
      }
      return;
    }

    if (panelIndex === 11) { // enable debug mode if you right click nuke
      this.game.showDebug = !this.game.showDebug;
      return;
    }
  }

  handleSkillDoubleClick(e) {
    if (Math.trunc(e.x / 16) === 11)
      this.game.queueCommand(new Lemmings.CommandNuke());
  }

  handleMouseMove(e) {
    const rawIdx = e.y > 15 ? Math.trunc(e.x / 16) : -1;
    let idx = rawIdx;

    if (!this.gameTimer.isRunning() && rawIdx !== 11) {
      idx = -1;
    }

    if (rawIdx === 0 || rawIdx === 1) {
      const rrMin = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
      const rrMax = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
      const rrCur = this.gameVictoryCondition.getCurrentReleaseRate?.() ?? 0;
      if ((rawIdx === 0 && rrCur <= rrMin) || (rawIdx === 1 && rrCur >= rrMax)) {
        idx = -1;
      }
    } else if (rawIdx >= 2 && rawIdx <= 9) {
      const skill = this.getSkillByPanelIndex(rawIdx);
      if (this.skills.getSkill(skill) <= 0) idx = -1;
    }

    const wasIdx = this._hoverPanelIdx;
    if (idx !== wasIdx) {
      this._hoverPanelIdx = idx;
      this.backgroundChanged = true;
      this.gameTimeChanged = true;
    }

    let up = false, down = false;
    if (rawIdx === 10 && e.y >= 32) {
      const pauseIndex = Math.trunc((e.x - 159) / 9);
      const speedFac = this.gameTimer.speedFactor;
      if (pauseIndex === 1 && speedFac < 120) up = true;
      if (pauseIndex === 0 && speedFac > 0.1) down = true;
    }
    if (up !== this._hoverSpeedUp || down !== this._hoverSpeedDown) {
      this._hoverSpeedUp = up;
      this._hoverSpeedDown = down;
      this.gameSpeedChanged = true;
      this.gameTimeChanged = true;
    }
  }

  setGuiDisplay(display) {
    if (this.display && this._displayListeners) {
      for (const [event, handler] of this._displayListeners) {
        this.display[event].off(handler);
      }
    }
    this.display = display;
    if (!this.miniMap) {
      this.setMiniMap(new Lemmings.MiniMap(this.game.gameDisplay, this.game.level, display));
    }

    this._displayListeners = [
      ['onMouseDown', e => { this.deltaReleaseRate = 0; if (e.y > 15) this.handleSkillMouseDown(e); }],
      ['onMouseUp', () => { this.deltaReleaseRate = 0; }],
      ['onMouseRightDown', e => { if (e.y > 15) this.handleSkillMouseRightDown(e); }],
      ['onMouseRightUp', () => { }],
      ['onDoubleClick', e => { if (e.y > 15) this.handleSkillDoubleClick(e); }],
      ['onMouseMove', e => { this.handleMouseMove(e); }],
    ];
    for (const [event, handler] of this._displayListeners) {
      display[event].on(handler);
    }

    this.gameTimeChanged = this.skillsCountChanged = this.skillSelectionChanged = this.backgroundChanged = this.releaseRateChanged = true;
    this._guiRafId = window.requestAnimationFrame(this._guiBound);
  }

  _guiLoop(now) {
    if (!this.display) {
      return;
    }
    const ss = this.smoothScroller;
    if (ss) {
      ss.update();
    }

    window.cancelAnimationFrame(this._guiRafId);
    this.render();
    this.display.redraw();
    this._guiRafId = window.requestAnimationFrame(this._guiBound);
  }

  dispose() {
    if (this._guiRafId) {
      window.cancelAnimationFrame(this._guiRafId);
      this._guiRafId = 0;
      this.gameTimer.eachGameSecond.off();
    }
    if (this.display && this._displayListeners) {
      for (const [event, handler] of this._displayListeners) {
        this.display[event].off(handler);
      }
    }
    this._letterCache = null;
    this._numRightCache = null;
    this._numLeftCache = null;
    this._panelSprite = null;
    this._numEmptySprite = null;
    if (this.miniMap?.dispose) this.miniMap.dispose();
    this.miniMap = null;
    this.smoothScroller = null;

  }

  render() {
    if (!this.display) return;
    const d = this.display;

    if (this.backgroundChanged) {
      this.backgroundChanged = false;
      d.initSize(this._panelSprite.width, this._panelSprite.height);
      d.setBackground(this._panelSprite.getData());

      this.gameTimeChanged = this.skillsCountChanged = this.skillSelectionChanged = this.releaseRateChanged = this.gameSpeedChanged = true;
    }

    if (this.gameTimeChanged) {
      this.gameTimeChanged = false;

      if (lemmings.bench == false) {
        let text = '';
        if (this._hoverPanelIdx >= 0) {
          text = this._getPanelName(this._hoverPanelIdx);
          if (this._hoverPanelIdx === 10) {
            if (this._hoverSpeedUp) text = 'Increase';
            else if (this._hoverSpeedDown) text = 'Decrease';
          }
        } else if (this.nukePrepared) {
          text = 'Nuke';
        } else if (!this.gameTimer.isRunning()) {
          text = 'Pause';
        } else {
          const sel = this.skills.getSelectedSkill();
          if (sel !== Lemmings.SkillTypes.UNKNOWN) {
            const key = Object.keys(Lemmings.SkillTypes)[sel];
            if (key) {
              text = key.charAt(0) + key.slice(1).toLowerCase();
            }
          }
        }
        if (text) {
          this.drawGreenString(d, text, 0, 0);
        }
        this.drawGreenString(d, 'Time ' + this.gameTimer.getGameLeftTimeString() + '-00', 248, 0);
        const outCount = this.gameVictoryCondition.getOutCount();
        if (outCount >= 0) {
          this.drawGreenString(d, 'Out ' + this.gameVictoryCondition.getOutCount() + '  ', 112, 0);
        }
        this.drawGreenString(d, 'In'  + this._pad(this.gameVictoryCondition.getSurvivorPercentage(), 3) + '%', 186, 0);
      } else if (lemmings.bench == true && this.gameSpeedChanged) {
        const stats = [
          'T' + lemmings.steps,
          'TPS ' + Math.round(lemmings.tps),
          'Spawn ' + (this.game.getLemmingManager?.().spawnTotal ?? 0)
        ];
        let x = 0;
        for (let i = 0; i < stats.length; i++) {
          const s = stats[i];
          this.drawGreenString(d, s, x, 0);
          x += s.length * 8;
          if (i < stats.length - 1) x += 8; // space between stats
        }
      }
    }

    if (this.gameSpeedChanged) {
      this.gameSpeedChanged = false;
      const speedFac = this.gameTimer.speedFactor;

      d.drawRect(160, 32, 16, 10, 0, 0, 0, true); // draw bottom black rect on pause button

      if (speedFac != 120) {
        const greenS  = this._getGreenLetter('f');
        d.drawFrameResized(greenS, 173, 34, 3, 4);
      }

      if (speedFac != 0.1) {
        const greenP  = this._getGreenLetter('-');
        d.drawFrameResized(greenP, 161, 33, 3, 6);
      }

      const tens  = Math.floor(speedFac / 10);
      const ones  = speedFac % 10;
      const left  = this._getRightDigit(tens);
      const right = this._getRightDigit(ones);
      let rightX = 164;
      if (left && tens > 0) {
        rightX = 164;
        d.drawFrameResized(left, rightX-4, 33, 8, 6);
      }
      if (right) {
        d.drawFrameResized(right, rightX, 33, 8, 6);
      }
      if (speedFac < 1) {
        let sn = Math.trunc((speedFac)*10);
        const small = this._getRightDigit(sn);
        d.setPixel(167, 38, 255, 255, 255);
        d.drawFrameResized(small, 164, 33, 8, 6);
        d.drawHorizontalLine(169, 33, 175, 0, 0, 0);
      }

      if (this._hoverSpeedUp) {
        d.drawHorizontalLine(172, 32, 175, 0, 166, 0);
        d.drawHorizontalLine(172, 38, 175, 0, 166, 0);
      } else if (this._hoverSpeedDown) {
        d.drawHorizontalLine(161, 32, 164, 0, 166, 0);
        d.drawHorizontalLine(161, 38, 164, 0, 166, 0);
      }
    }


    if (this.skillsCountChanged) {
      this.skillsCountChanged = false;
      for (let s = 1; s < Object.keys(Lemmings.SkillTypes).length; ++s) {
        const panel = this.getPanelIndexBySkill(s);
        const count = this.skills.getSkill(s);
        this.drawPanelNumber(d, count, panel);
      }
    }
    for (let s = 1; s < Object.keys(Lemmings.SkillTypes).length; ++s) {
      if (this.skills.getSkill(s) <= 0) {
        const panel = this.getPanelIndexBySkill(s);
        d.drawStippleRect(panel * 16, 16, 16, 23, 160, 160, 160);
      }
    }
    if (this.skillSelectionChanged) {
      this.skillSelectionChanged = false;
    }

    if (!this.gameTimer.isRunning()) {
      this.drawPaused(d);
    }
    if (this.nukePrepared) {
      this.drawNukeConfirm(d);
      this.drawNukeHover(d);
    }

    if (this._hoverPanelIdx >= 0) {
      if (this._hoverPanelIdx === 11) {
        if (!this.nukePrepared) this.drawSkillHover(d, this._hoverPanelIdx, 255, 128, 0);
      } else {
        this.drawSkillHover(d, this._hoverPanelIdx);
      }
    }

    // update marching ants animation
    if (++this._selectionCounter >= this.selectionAnimDelay) {
      this._selectionCounter = 0;
      this._selectionOffset += this.selectionAnimStep;
    }

    this.drawSelection(d, this.getPanelIndexBySkill(this.skills.getSelectedSkill()));
    if (this.releaseRateChanged) {
      this.releaseRateChanged = false;
      this.drawPanelNumber(d, this.gameVictoryCondition.getMinReleaseRate(),     0);
      this.drawPanelNumber(d, this.gameVictoryCondition.getCurrentReleaseRate(), 1);
    }

    const rrMin = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
    const rrMax = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
    const rrCur = this.gameVictoryCondition.getCurrentReleaseRate?.() ?? 0;

    const lockMin = rrCur <= rrMin;
    const lockMax = rrCur >= rrMax;

    if (lockMin) this._drawLockEdge(d, 0);
    if (lockMax) this._drawLockEdge(d, 1);

    if (this._rrLockMin && !lockMin) this.backgroundChanged = true;
    if (this._rrLockMax && !lockMax) this.backgroundChanged = true;

    this._rrLockMin = lockMin;
    this._rrLockMax = lockMax;

    if (this.miniMap) {
      const viewX = this.game.level.screenPositionX;
      const viewW = d.worldDataSize.width;

      this.miniMap.render(viewX, viewW);
    }
  }

  _pad(v, len) { const s = String(v); return s.length >= len ? s : ' '.repeat(len - s.length) + s; }
  _getLeftDigit(d)  { if (d <= 0) return null;
    if (!this._numLeftCache[d])  this._numLeftCache[d]  = this.skillPanelSprites.getNumberSpriteLeft(d);
    return this._numLeftCache[d]; }
  _getRightDigit(d) { if (!this._numRightCache[d])
    this._numRightCache[d] = this.skillPanelSprites.getNumberSpriteRight(d);
  return this._numRightCache[d]; 
  }
  _getGreenLetter(ch) {
    const cachedGreenLet  = this._letterCache.get(ch);
    if (!cachedGreenLet) { 
      const newGreenLet = this.skillPanelSprites.getLetterSprite(ch); 
      this._letterCache.set(ch, newGreenLet); 
      return newGreenLet;
    } else {
      return cachedGreenLet;
    }
  }

  drawSelection(d, panelIdx) {
    if (panelIdx < 0) return;
    d.drawMarchingAntRect(
      16 * panelIdx,
      16,
      16,
      23,
      this.selectionDashLen,
      this._selectionOffset
    );
  }

  drawPaused(d) {
    d.drawMarchingAntRect(
      16 * 10,
      16,
      16,
      23,
      this.selectionDashLen,
      this._selectionOffset
    );
  }

  drawSkillHover(d, panelIdx, r = 255, g = 255, b = 0) {
    if (panelIdx < 0) return;
    d.drawRect(16 * panelIdx, 16, 16, 23, r, g, b);
  }

  _getPanelName(idx) {
    switch (idx) {
    case 0:  return 'Decrease';
    case 1:  return 'Increase';
    case 10: return 'Pause';
    case 11: return 'Nuke';
    default:
      const skill = this.getSkillByPanelIndex(idx);
      if (skill !== Lemmings.SkillTypes.UNKNOWN) {
        const key = Object.keys(Lemmings.SkillTypes)[skill];
        if (key) return key.charAt(0) + key.slice(1).toLowerCase();
      }
      return '';
    }
  }

  _drawLockEdge(d, panelIdx) {
    const x = 16 * panelIdx + 2;
    const y = 18;
    const w = 11; // narrower than full panel
    const h = 18; // shorter than full panel
    d.drawStippleRect(x, y, w, 0, 160, 160, 160);       // top
    d.drawStippleRect(x, y + h, w, 0, 160, 160, 160);    // bottom
    d.drawStippleRect(x, y, 0, h, 160, 160, 160);        // left
    d.drawStippleRect(x + w, y, 0, h, 160, 160, 160);    // right
  }

  drawSpeedChange(upDown, reset = false) {
    if (!reset) {
      if (upDown) {
        this.display.drawHorizontalLine(172, 32, 175, 0, 166, 0);
        this.display.drawHorizontalLine(172, 38, 175, 0, 166, 0);
      } else {
        this.display.drawHorizontalLine(161, 32, 164, 0, 166, 0);
        this.display.drawHorizontalLine(161, 38, 164, 0, 166, 0);
      }
    } else {
      this.display.drawHorizontalLine(161, 32, 175, 111, 0, 0);
      this.display.drawHorizontalLine(161, 38, 175, 111, 0, 0);
    }

    if (this._hoverSpeedUp) {
      this.display.drawHorizontalLine(172, 32, 175, 0, 166, 0);
      this.display.drawHorizontalLine(172, 38, 175, 0, 166, 0);
    } else if (this._hoverSpeedDown) {
      this.display.drawHorizontalLine(161, 32, 164, 0, 166, 0);
      this.display.drawHorizontalLine(161, 38, 164, 0, 166, 0);
    }

    this.gameSpeedChanged = true;
  }

  drawNukeConfirm(d) {
    d.drawRect(16 * 11, 16, 16, 23, 255, 0, 0);
  }

  drawNukeHover(d) {
    d.drawMarchingAntRect(
      16 * 11,
      16,
      16,
      23,
      this.selectionDashLen,
      this._selectionOffset * 2,
      0xFF0080FF,
      0xFF00FFFF
    );
  }

  drawPanelNumber(d, num, panelIdx) { 
    this.drawNumber(d, num, 4 + 16 * panelIdx, 17); 
  }

  drawNumber(d, num, x, y, small = false) {
    if (num <= 0) { 
      d.drawFrame(this._numEmptySprite, x, y); return; 
    }
    const tens  = Math.floor(num / 10);
    const ones  = num % 10;
    const left  = this._getLeftDigit(tens);
    const right = this._getRightDigit(ones);
    if (left) { 
      d.drawFrameCovered(left,  x, y, 0, 0, 0);
    }
    d.drawFrame(right, x, y);
  }

  drawGreenString(d, text, x, y) {
    for (let i = 0; i < text.length; ++i) {
      const ch = text[i];
      let img  = this._letterCache.get(ch);
      if (!img) { 
        img = this.skillPanelSprites.getLetterSprite(ch); 
        this._letterCache.set(ch, img); 
      }
      if (img) {
        d.drawFrameCovered(img, x, y, 0, 0, 0);
      }
      x += 8;
    }
  }

  getSkillByPanelIndex(idx) {
    switch (Math.trunc(idx)) {
    case 2:  return Lemmings.SkillTypes.CLIMBER;
    case 3:  return Lemmings.SkillTypes.FLOATER;
    case 4:  return Lemmings.SkillTypes.BOMBER;
    case 5:  return Lemmings.SkillTypes.BLOCKER;
    case 6:  return Lemmings.SkillTypes.BUILDER;
    case 7:  return Lemmings.SkillTypes.BASHER;
    case 8:  return Lemmings.SkillTypes.MINER;
    case 9:  return Lemmings.SkillTypes.DIGGER;
    default: return Lemmings.SkillTypes.UNKNOWN;
    }
  }

  getPanelIndexBySkill(skill) {
    switch (skill) {
    case Lemmings.SkillTypes.CLIMBER: return 2;
    case Lemmings.SkillTypes.FLOATER: return 3;
    case Lemmings.SkillTypes.BOMBER:  return 4;
    case Lemmings.SkillTypes.BLOCKER: return 5;
    case Lemmings.SkillTypes.BUILDER: return 6;
    case Lemmings.SkillTypes.BASHER:  return 7;
    case Lemmings.SkillTypes.MINER:   return 8;
    case Lemmings.SkillTypes.DIGGER:  return 9;
    default: return -1;
    }
  }
}

class SmoothScroller {
  static minZoom = 0.25;
  static maxZoom = 8;

  constructor() {
    this.velocity = 0;     // pixels/frame (or units/frame)
    this.friction = 0.99;
    this.minVelocity = 0.7;       //0.0175;
    this._lastVelocity = 0;

    this.onHasVelocity = new Lemmings.EventHandler();
  }

  hasVelocity() {
    if (this.velocity < this.minVelocity || this.velocity == 0) {
      return false;
    }
    return true;
  }

  // call this whenever a wheel event fires:
  addImpulse(delta) {
    if (delta == 0) {
      console.log('error: trying to add 0 impulse');
      return;
    }
    if (delta > 50) {
      delta = 50;
    }
    if (delta < -50) {
      delta = -50;
    }

    if (this.velocity+delta > 500) {
      this.velocity = 500;
      return;
    }
    if (this.velocity-delta < -500) {
      this.velocity = -500;
      return;
    }

    this.velocity += delta; 
  }

  update() {
    // decay the velocity:
    this.velocity = this.velocity * this.friction;


    // stop if below threshold:
    if (Math.abs(this.velocity) < this.minVelocity) {
      this.velocity = 0;
      if (this._lastVelocity != 0) {
        this._lastVelocity = 0;
        this.onHasVelocity.trigger(this.velocity);
      }
      return;
    }
    this._lastVelocity = this.velocity;
    this.onHasVelocity.trigger(this.velocity);
  }
}

Lemmings.SmoothScroller = SmoothScroller;
Lemmings.GameGui = GameGui;
export { GameGui, SmoothScroller };
