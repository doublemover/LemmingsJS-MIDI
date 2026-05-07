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
const gameGuiInputMethods = {
  setMiniMap(miniMap) {
    this.miniMap = miniMap;
    this.game?.lemmingManager?.setMiniMap?.(miniMap);
  },

  _requestGuiRender() {
    if (!this.display || this._guiRafId) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }
    this._guiRafId = window.requestAnimationFrame(this._guiBound);
  },

  _invalidateAntState() {
    this._lastAntPanel = Number.NaN;
    this._lastAntPaused = null;
    this._lastAntNukePrepared = null;
    this._lastAntHoverPanel = Number.NaN;
    this._lastAntOffset = Number.NaN;
  },

  _isMechanicEnabled(name, fallback = false) {
    const value = this.game?.level?.mechanics?.[name];
    if (typeof value === 'boolean') return value;
    return fallback;
  },

  _getSelectionAnimDelay(paused) {
    const baseDelay = Math.max(1, Math.trunc(this.selectionAnimDelay) || 1);
    if (!paused) return baseDelay;
    const isIdle =
        this._hoverPanelIdx < 0 &&
        !this._hoverSpeedUp &&
        !this._hoverSpeedDown &&
        !this.nukePrepared;
    if (!isIdle) return baseDelay;
    const idleMultiplier = Math.max(1, Math.trunc(this.selectionAnimIdleMultiplier) || 1);
    return baseDelay * idleMultiplier;
  },

  _applyReleaseRateAuto({ queueWhenClamped = false } = {}) {
    if (!this.deltaReleaseRate) return;
    const isRunning = this.gameTimer.isRunning();
    if (isRunning) {
      const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
      const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
      const cur = this.gameVictoryCondition.getCurrentReleaseRate();
      let   neu = cur + this.deltaReleaseRate;
      if (neu < min) neu = min;
      if (neu > max) neu = max;
      if (neu === cur) {
        if (!queueWhenClamped) return;
      } else {
        this.gameVictoryCondition.setCurrentReleaseRate?.(neu) ??
                    (this.gameVictoryCondition.releaseRate = neu);
        this.releaseRateChanged = true;
      }
    }
    if (!isRunning && !this._isMechanicEnabled('pauseGlitch', true)) {
      return;
    }
    if (this.deltaReleaseRate > 0)
      this.game.queueCommand(new CommandReleaseRateIncrease(this.deltaReleaseRate));
    else
      this.game.queueCommand(new CommandReleaseRateDecrease(-this.deltaReleaseRate));
  },

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
                      (this.gameVictoryCondition.releaseRate = neu);
        this.releaseRateChanged = true;
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
        const app = getApp();
        const debugOrBench = (this.game.showDebug || app?.bench === true || app?.bench2 === true || app?.benchReverse === true);
        const syncSpeed = () => {
          if (app) app.gameSpeedFactor = this.gameTimer.speedFactor;
        };
        if (pauseIndex === 0) {
          if (speedFac > 10) {
            this.gameTimer.speedFactor -= 10;
            this.drawSpeedChange(false);
            syncSpeed();
            return;
          }
          if (speedFac > 1) {
            this.gameTimer.speedFactor--;
            this.drawSpeedChange(false);
            syncSpeed();
            return;
          }
          if (debugOrBench || speedFac === 1 || speedFac > 0.1 && speedFac < 1) {
            this.gameTimer.speedFactor = Math.trunc((this.gameTimer.speedFactor-0.1)*100)/100;
            this.drawSpeedChange(false);
            syncSpeed();
            return;
          }
        }
        if (pauseIndex === 1) {
          if (speedFac < 1) {
            this.gameTimer.speedFactor = Math.trunc((this.gameTimer.speedFactor+0.1)*100)/100;
            this.drawSpeedChange(true);
            syncSpeed();
            return;
          }
          if (speedFac >= 10 && speedFac < 120) {
            this.gameTimer.speedFactor += 10;
            this.drawSpeedChange(true);
            syncSpeed();
            return;
          }
          if (speedFac < 10) {
            this.gameTimer.speedFactor++;
            this.drawSpeedChange(true);
            syncSpeed();
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
        this.game.queueCommand(new CommandNuke());
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
    if (newSkill === SkillTypes.UNKNOWN) return;
    if (this.skills.getSkill(newSkill) <= 0) {
      if (this.skills.clearSelectedSkill()) this.skillSelectionChanged = true;
      return;
    }
    this.skills.setSelectedSkill(newSkill);
    this.game.queueCommand(new CommandSelectSkill(newSkill));
  },

  handleSkillMouseRightDown(e) {
    const panelIndex = Math.trunc(e.x / 16);

    this.nukePrepared = false; // always cancel nuke confirmation on right click
    this.gameTimeChanged = true;
    if (!this._isMechanicEnabled('rightClickGlitch', true)) {
      return;
    }

    if (panelIndex === 0) {
      const min = this.gameVictoryCondition.getMinReleaseRate?.() ?? 0;
      this.gameVictoryCondition.setCurrentReleaseRate?.(min) ??
          (this.gameVictoryCondition.releaseRate = min);
      this.deltaReleaseRate = -min;
      this.releaseRateChanged = true;
      this._applyReleaseRateAuto({ queueWhenClamped: true });
      return;
    }

    if (panelIndex === 1) {
      const max = this.gameVictoryCondition.getMaxReleaseRate?.() ?? 99;
      this.gameVictoryCondition.setCurrentReleaseRate?.(max) ??
          (this.gameVictoryCondition.releaseRate = max);
      this.deltaReleaseRate = max;
      this.releaseRateChanged = true;
      this._applyReleaseRateAuto({ queueWhenClamped: true });
      return;
    }

    if (panelIndex === 10) { // reset game speed if you right click pause
      if (this.gameTimer.speedFactor !== 1) {
        this.gameTimer.speedFactor = 1;
        this.drawSpeedChange(false, true);
        const app = getApp();
        if (app) app.gameSpeedFactor = this.gameTimer.speedFactor;
      }
      return;
    }

    if (panelIndex === 11) { // enable debug mode if you right click nuke
      this.game.showDebug = !this.game.showDebug;
      return;
    }
  },

  handleSkillDoubleClick(e) {
    if (Math.trunc(e.x / 16) === 11 && this._isMechanicEnabled('nukeGlitch', true))
      this.game.queueCommand(new CommandNuke());
  },

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
  },

  setGuiDisplay(display) {
    if (this.display && this._displayListeners) {
      for (const [event, handler] of this._displayListeners) {
        this.display[event].off(handler);
      }
    }
    this.display = display;
    this.display?.stage?.setGuiOverlayVisible?.(false);
    this._overlayHadContent = false;
    if (!this.miniMap) {
      const MiniMapCtor = getDependency('MiniMap', MiniMap);
      this.setMiniMap(new MiniMapCtor(this.game.gameDisplay, this.game.level, display, this.game.runtime));
    }

    this._displayListeners = [
      ['onMouseDown', e => {
        this.deltaReleaseRate = 0;
        if (e.y > 15) this.handleSkillMouseDown(e);
        this._requestGuiRender();
      }],
      ['onMouseUp', () => {
        this.deltaReleaseRate = 0;
        this._requestGuiRender();
      }],
      ['onMouseRightDown', e => {
        if (e.y > 15) this.handleSkillMouseRightDown(e);
        this._requestGuiRender();
      }],
      ['onMouseRightUp', () => {
        this.deltaReleaseRate = 0;
        this._requestGuiRender();
      }],
      ['onDoubleClick', e => {
        if (e.y > 15) this.handleSkillDoubleClick(e);
        this._requestGuiRender();
      }],
      ['onMouseMove', e => {
        this.handleMouseMove(e);
        this._requestGuiRender();
      }],
    ];
    for (const [event, handler] of this._displayListeners) {
      display[event].on(handler);
    }

    // Initialize the HUD size immediately so Stage can center it
    display.initSize(this._panelSprite.width, this._panelSprite.height);
    display.setBackground(this._panelSprite.getData());
    display.stage.updateStageSize();

    this.gameTimeChanged = this.skillsCountChanged = this.skillSelectionChanged = this.backgroundChanged = this.releaseRateChanged = true;
    this._requestGuiRender();
  },

  _guiLoop(now) {
    this._guiRafId = 0;
    if (!this.display) return;
    this.render();
    this.display.redraw();
  },

  dispose() {
    if (this._guiRafId) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this._guiRafId);
      }
      this._guiRafId = 0;
    }
    if (this.gameTimer?.eachGameSecond && this._onEachGameSecond) {
      this.gameTimer.eachGameSecond.off(this._onEachGameSecond);
      this._onEachGameSecond = null;
    }
    if (this.skills?.onCountChanged && this._onSkillCountChanged) {
      this.skills.onCountChanged.off(this._onSkillCountChanged);
      this._onSkillCountChanged = null;
    }
    if (this.skills?.onSelectionChanged && this._onSkillSelectionChanged) {
      this.skills.onSelectionChanged.off(this._onSkillSelectionChanged);
      this._onSkillSelectionChanged = null;
    }
    if (this.display && this._displayListeners) {
      for (const [event, handler] of this._displayListeners) {
        this.display[event].off(handler);
      }
    }
    this.display?.stage?.setGuiOverlayVisible?.(false);
    this._letterCache = null;
    this._numRightCache = null;
    this._numLeftCache = null;
    this._panelSprite = null;
    this._numEmptySprite = null;
    if (this.miniMap?.dispose) this.miniMap.dispose();
    this.miniMap = null;
    this.smoothScroller = null;
    this._overlayHadContent = false;

  }
};
export { gameGuiInputMethods };