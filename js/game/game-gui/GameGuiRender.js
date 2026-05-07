import {
  CommandNuke,
  CommandReleaseRateDecrease,
  CommandReleaseRateIncrease,
  CommandSelectSkill,
  EventHandler,
  MiniMap,
  SKILL_COUNT,
  SKILL_KEYS,
  SKILL_LABELS,
  SkillTypes,
  SmoothScroller,
  canMeasurePerformance,
  formatSkillLabel,
  getApp,
  getAppContext,
  getDependency,
  recordPerformanceMeasure
} from './GameGuiShared.js';
const gameGuiRenderMethods = {
  render() {
    const app = getApp();
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    if (!this.display) {
      if (perfEnabled) {
        recordPerformanceMeasure('GameGui render', {
          start: perfStart,
          detail: { devtools: { track: 'GameGui', trackGroup: 'Render', color: 'secondary', tooltipText: 'render' } }
        });
      }
      return false;
    }
    const d = this.display;
    const overlayDisplay = d.stage?.getGuiOverlayDisplay?.() || null;
    const bench = app?.bench === true || app?.bench2 === true || app?.benchReverse === true || app?.benchSequence === true;
    if (bench) this.gameTimeChanged = true;

    if (this.backgroundChanged) {
      this.backgroundChanged = false;
      this._invalidateAntState();
      d.initSize(this._panelSprite.width, this._panelSprite.height);
      d.setBackground(this._panelSprite.getData());
      this.miniMap?.invalidateFrame?.();

      this.gameTimeChanged = this.skillsCountChanged = this.skillSelectionChanged = this.releaseRateChanged = this.gameSpeedChanged = true;
    }

    if (this.gameTimeChanged) {
      this.gameTimeChanged = false;

      if (!bench) {
        let text = '';
        if (this._hoverPanelIdx >= 0) {
          text = this._getPanelName(this._hoverPanelIdx);
          if (this._hoverPanelIdx === 10) {
            if (this._hoverSpeedUp) text = 'Increase';
            else if (this._hoverSpeedDown) text = 'Decrease';
          }
        } else if (this.game?.gameDisplay?.hoverLemming?.action) {
          text = this.game.gameDisplay.hoverLemming.action.getActionName?.() || '';
        } else if (this.nukePrepared) {
          text = 'Nuke';
        } else if (!this.gameTimer.isRunning()) {
          text = 'Pause';
        } else {
          const sel = this.skills.getSelectedSkill();
          if (sel !== SkillTypes.UNKNOWN) {
            text = SKILL_LABELS[sel] || '';
          }
        }
        const statusText = this._composeStatusText(this._formatTickIndicator(), text);
        if (statusText) {
          this.drawGreenString(d, statusText, 0, 0);
        }
        const timeText = app?.endless ? '4-20' : this.gameTimer.getGameLeftTimeString();
        this.drawGreenString(d, 'Time ' + timeText + '-00', 248, 0);
        const totalCount = this.game?.getLemmingManager?.()?.spawnTotal ??
            this.gameVictoryCondition.getReleaseCount?.();
        if (totalCount >= 0) {
          this.drawGreenString(d, 'Out ' + totalCount + '  ', 112, 0);
        }
        const survivorPct = this.gameVictoryCondition.getSurvivorPercentage?.();
        if (Number.isFinite(survivorPct)) {
          this.drawGreenString(d, 'In' + this._pad(survivorPct, 3) + '%', 186, 0);
        }
      } else {
        const activeCount = this.game.getLemmingManager?.()?.getLemmings?.()?.length ?? 0;
        const stats = [
          'T' + (app?.steps ?? 0),
          'TPS ' + Math.round(app?.tps ?? 0),
          'ACTIVE ' + activeCount,
          'SPAWNED ' + (this.game.getLemmingManager?.().spawnTotal ?? 0)
        ];
        let x = 0;
        for (let i = 0; i < stats.length; i++) {
          const s = stats[i];
          this.drawGreenString(d, s, x, 0);
          x += (s.length+1) * 8;
        }
      }
    }

    if (this.gameSpeedChanged) {
      this.gameSpeedChanged = false;
      const speedFac = this.gameTimer.speedFactor;

      d.drawRect(160, 32, 16, 10, 0, 0, 0, true); // draw bottom black rect on pause button

      if (speedFac !== 120) {
        const greenS  = this._getGreenLetter('f');
        d.drawFrameResized(greenS, 173, 34, 3, 4);
      }

      if (speedFac !== 0.1) {
        const greenP  = this._getGreenLetter('-');
        d.drawFrameResized(greenP, 161, 33, 3, 6);
      }

      const tens  = Math.floor(speedFac / 10);
      const ones  = speedFac % 10;
      const left  = this._getLeftDigit(tens);
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
      for (let s = 1; s < SKILL_COUNT; ++s) {
        const panel = this.getPanelIndexBySkill(s);
        const count = this.skills.getSkill(s);
        this.drawPanelNumber(d, count, panel);
      }
      for (let s = 1; s < SKILL_COUNT; ++s) {
        if (this.skills.getSkill(s) <= 0) {
          const panel = this.getPanelIndexBySkill(s);
          d.drawStippleRect(panel * 16, 16, 16, 23, 160, 160, 160);
        }
      }
    }
    if (this.skillSelectionChanged) {
      this.skillSelectionChanged = false;
    }

    const paused = !this.gameTimer.isRunning();
    const selectedPanel = this.getPanelIndexBySkill(this.skills.getSelectedSkill());
    const antDelay = this._getSelectionAnimDelay(paused);
    if (++this._selectionCounter >= antDelay) {
      this._selectionCounter = 0;
      this._selectionOffset += this.selectionAnimStep;
    }
    const antStateChanged =
        this._lastAntPanel !== selectedPanel ||
        this._lastAntPaused !== paused ||
        this._lastAntNukePrepared !== this.nukePrepared ||
        this._lastAntHoverPanel !== this._hoverPanelIdx ||
        this._lastAntOffset !== this._selectionOffset;
    const drawOverlayDecorations = (target) => {
      let drawn = false;
      if (this.nukePrepared) {
        this.drawNukeConfirm(target);
        drawn = true;
      }
      if (this._hoverPanelIdx >= 0) {
        if (this._hoverPanelIdx === 11) {
          if (!this.nukePrepared) this.drawSkillHover(target, this._hoverPanelIdx, 255, 128, 0);
        } else {
          this.drawSkillHover(target, this._hoverPanelIdx);
        }
        drawn = true;
      }
      if (paused) {
        this.drawPaused(target);
        drawn = true;
      }
      if (this.nukePrepared) {
        this.drawNukeHover(target);
        drawn = true;
      }
      if (selectedPanel >= 0) {
        this.drawSelection(target, selectedPanel);
        drawn = true;
      }
      return drawn;
    };

    if (overlayDisplay) {
      if (antStateChanged) {
        overlayDisplay.clear(0x00000000);
        this._overlayHadContent = drawOverlayDecorations(overlayDisplay);
        d.stage?.setGuiOverlayVisible?.(this._overlayHadContent);
      }
    } else {
      if (this.nukePrepared) {
        this.drawNukeConfirm(d);
      }
      if (this._hoverPanelIdx >= 0) {
        if (this._hoverPanelIdx === 11) {
          if (!this.nukePrepared) this.drawSkillHover(d, this._hoverPanelIdx, 255, 128, 0);
        } else {
          this.drawSkillHover(d, this._hoverPanelIdx);
        }
      }
      if (antStateChanged) {
        if (paused) {
          this.drawPaused(d);
        }
        if (this.nukePrepared) {
          this.drawNukeHover(d);
        }
        this.drawSelection(d, selectedPanel);
      }
      this._overlayHadContent = false;
    }

    if (antStateChanged) {
      this._lastAntPanel = selectedPanel;
      this._lastAntPaused = paused;
      this._lastAntNukePrepared = this.nukePrepared;
      this._lastAntHoverPanel = this._hoverPanelIdx;
      this._lastAntOffset = this._selectionOffset;
    }
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
    if (perfEnabled) {
      recordPerformanceMeasure('GameGui render', {
        start: perfStart,
        detail: { devtools: { track: 'GameGui', trackGroup: 'Render', color: 'secondary', tooltipText: 'render' } }
      });
    }
    return !!(
      d.hasPendingDirty?.() ||
        overlayDisplay?.hasPendingDirty?.()
    );
  },

  _formatTickIndicator() {
    const tick = Math.max(0, this.gameTimer?.tickIndex ?? 0);
    const dir = this.game?.timeTravel?.isReversing ? '<' : '>';
    return `T${tick}${dir}`;
  },

  _composeStatusText(primary, secondary) {
    const left = primary || '';
    const right = secondary || '';
    if (!left && !right) return '';
    const combined = right ? `${left} ${right}` : left;
    const maxChars = 14;
    return combined.length > maxChars ? combined.slice(0, maxChars) : combined;
  },

  _pad(v, len) { const s = String(v); return s.length >= len ? s : ' '.repeat(len - s.length) + s; },

  _getLeftDigit(d)  { if (d <= 0) return null;
    if (!this._numLeftCache[d])  this._numLeftCache[d]  = this.skillPanelSprites.getNumberSpriteLeft(d);
    return this._numLeftCache[d]; },

  _getRightDigit(d) { if (!this._numRightCache[d])
    this._numRightCache[d] = this.skillPanelSprites.getNumberSpriteRight(d);
  return this._numRightCache[d];
  },

  _getGreenLetter(ch) {
    const cachedGreenLet  = this._letterCache.get(ch);
    if (!cachedGreenLet) {
      const newGreenLet = this.skillPanelSprites.getLetterSprite(ch);
      this._letterCache.set(ch, newGreenLet);
      return newGreenLet;
    } else {
      return cachedGreenLet;
    }
  },

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
  },

  drawPaused(d) {
    d.drawMarchingAntRect(
      16 * 10,
      16,
      16,
      23,
      this.selectionDashLen,
      this._selectionOffset
    );
  },

  drawSkillHover(d, panelIdx, r = 255, g = 255, b = 0) {
    if (panelIdx < 0) return;
    d.drawRect(16 * panelIdx, 16, 16, 23, r, g, b);
  },

  _getPanelName(idx) {
    switch (idx) {
    case 0:  return 'Decrease';
    case 1:  return 'Increase';
    case 10: return 'Pause';
    case 11: return 'Nuke';
    default:
      const skill = this.getSkillByPanelIndex(idx);
      if (skill !== SkillTypes.UNKNOWN) {
        return SKILL_LABELS[skill] || '';
      }
      return '';
    }
  },

  _drawLockEdge(d, panelIdx) {
    const x = 16 * panelIdx + 2;
    const y = 18;
    const w = 11; // narrower than full panel
    const h = 18; // shorter than full panel
    d.drawStippleRect(x, y, w, 0, 160, 160, 160);       // top
    d.drawStippleRect(x, y + h, w, 0, 160, 160, 160);    // bottom
    d.drawStippleRect(x, y, 0, h, 160, 160, 160);        // left
    d.drawStippleRect(x + w, y, 0, h, 160, 160, 160);    // right
  },

  drawSpeedChange(upDown, reset = false) {
    if (!this.display) {
      this.gameSpeedChanged = true;
      return;
    }
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
    this._requestGuiRender();
  },

  drawNukeConfirm(d) {
    d.drawRect(16 * 11, 16, 16, 23, 255, 0, 0);
  },

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
  },

  drawPanelNumber(d, num, panelIdx) {
    this.drawNumber(d, num, 4 + 16 * panelIdx, 17);
  },

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
  },

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
  },

  getSkillByPanelIndex(idx) {
    switch (Math.trunc(idx)) {
    case 2:  return SkillTypes.CLIMBER;
    case 3:  return SkillTypes.FLOATER;
    case 4:  return SkillTypes.BOMBER;
    case 5:  return SkillTypes.BLOCKER;
    case 6:  return SkillTypes.BUILDER;
    case 7:  return SkillTypes.BASHER;
    case 8:  return SkillTypes.MINER;
    case 9:  return SkillTypes.DIGGER;
    default: return SkillTypes.UNKNOWN;
    }
  },

  getPanelIndexBySkill(skill) {
    switch (skill) {
    case SkillTypes.CLIMBER: return 2;
    case SkillTypes.FLOATER: return 3;
    case SkillTypes.BOMBER:  return 4;
    case SkillTypes.BLOCKER: return 5;
    case SkillTypes.BUILDER: return 6;
    case SkillTypes.BASHER:  return 7;
    case SkillTypes.MINER:   return 8;
    case SkillTypes.DIGGER:  return 9;
    default: return -1;
    }
  }
};
export { gameGuiRenderMethods };