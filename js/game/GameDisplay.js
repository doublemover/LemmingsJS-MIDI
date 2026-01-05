import { CommandLemmingsAction } from '../commands/CommandLemmingsAction.js';
import { ActionBashSystem } from '../actions/ActionBashSystem.js';
import { ActionBlockerSystem } from '../actions/ActionBlockerSystem.js';
import { ActionDiggSystem } from '../actions/ActionDiggSystem.js';
import { ActionMineSystem } from '../actions/ActionMineSystem.js';
import { SkillTypes } from './SkillTypes.js';
import { getDependency } from '../core/dependencies.js';
import { withPerformance } from '../util/LogHandler.js';

class GameDisplay {
  constructor(game, level, lemmingManager, objectManager, triggerManager) {
    this.game = game;
    this.level = level;
    this.lemmingManager = lemmingManager;
    this.objectManager = objectManager;
    this.triggerManager = triggerManager;
    this.display = null;
    this._mouseHandler = null;
    this._mouseMoveHandler = null;
    this._mouseX = -1;
    this._mouseY = -1;
    this._hoverRafId = 0;
    this._hoverX = 0;
    this._hoverY = 0;
    this._dashOffset = 0;
    this.hoverIndex = -1;
    this.hoverLemming = null;
    this._redundantActions = {
      [SkillTypes.BASHER]: getDependency('ActionBashSystem', ActionBashSystem),
      [SkillTypes.BLOCKER]: getDependency('ActionBlockerSystem', ActionBlockerSystem),
      [SkillTypes.DIGGER]: getDependency('ActionDiggSystem', ActionDiggSystem),
      [SkillTypes.MINER]: getDependency('ActionMineSystem', ActionMineSystem)
    };
  }
  _scheduleHoverUpdate() {
    if (this._hoverRafId) return;
    const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
      ? window.requestAnimationFrame.bind(window)
      : (cb => { cb(); return 0; });
    this._hoverRafId = raf(() => {
      this._hoverRafId = 0;
      this._updateHover();
    });
  }
  _updateHover() {
    const x = this._hoverX;
    const y = this._hoverY;
    const prev = this.hoverLemming;
    let cand = prev;
    if (cand && (cand.removed || cand.disabled || cand.getClickDistance(x, y) < 0)) {
      cand = null;
    }
    if (!cand) {
      cand = this.lemmingManager.getNearestLemming(x, y);
    }
    if (cand?.action?.getActionName?.() === 'exploding') cand = null;
    if (prev !== cand && this.game?.gameGui) {
      this.hoverLemming = cand;
      this.game.gameGui.backgroundChanged = true;
      this.game.gameGui.gameTimeChanged = true;
    } else {
      this.hoverLemming = cand;
    }
  }
  setGuiDisplay(display) {
    this.display = display;
    this._mouseHandler = (e) => {
      if (this.game?.inputEnabled === false) return;
      const lem = this.lemmingManager.getNearestLemming(e.x, e.y);
      if (lem) {
        this.game.queueCommand(new CommandLemmingsAction(lem.id));
      }
    };
    this.display.onMouseDown.on(this._mouseHandler);
    this._mouseMoveHandler = (e) => {
      if (this.game?.inputEnabled === false) return;
      this._mouseX = e.x;
      this._mouseY = e.y;
      this._hoverX = e.x;
      this._hoverY = e.y;
      this._scheduleHoverUpdate();
    };
    this.display.onMouseMove.on(this._mouseMoveHandler);
  }
  render() {
    return withPerformance(
      'GameDisplay render',
      {
        track: 'GameDisplay',
        trackGroup: 'Render',
        color: 'primary',
        tooltipText: 'render'
      },
      () => {
        if (this.display == null)
          return;
        this.level.render(this.display);
        this.objectManager.render(this.display);
        this.lemmingManager.render(this.display);
        if (!this.game.showDebug) {
          const sel = this.lemmingManager.getSelectedLemming();
          if (sel && !sel.removed) this.#drawSelection(sel);

          if (this.hoverLemming && !this.hoverLemming.removed) {
            this.#drawHover(this.hoverLemming);
          }
        }
      }
    ).call(this);
  }
  renderDebug() {
    return withPerformance(
      'GameDisplay renderDebug',
      {
        track: 'GameDisplay',
        trackGroup: 'Render',
        color: 'secondary',
        tooltipText: 'renderDebug'
      },
      () => {
        if (this.display == null)
          return;
        this.level.renderDebug(this.display);
        this.lemmingManager.renderDebug(this.display);
        this.triggerManager.renderDebug(this.display);
        if (this.hoverLemming) {
          const x = this.hoverLemming.x - 5;
          const y = this.hoverLemming.y - 11;
          this.display.drawDashedRect(x, y, 10, 13, 3, this._dashOffset);
          this._dashOffset = (this._dashOffset + 1) % 6;
        }
      }
    ).call(this);
  }

  #drawCorner(x, y, r, g, b) {
    this.display.drawRect(x, y, 2, 2, r, g, b, true);
  }

  #drawSelection(lem) {
    const x = lem.x - 5;
    const y = lem.y - 11; // sits a bit higher

    let color = 0x00ff00; // bright green
    const skills = this.game?.getGameSkills?.();
    if (skills) {
      const selectedSkill = skills.getSelectedSkill();
      const ActionClass = this._redundantActions[selectedSkill];
      if (ActionClass && lem.action instanceof ActionClass) {
        color = 0xffffff00; // yellow tint for redundant action
      }
    }

    this.display.drawCornerRect(
      x,
      y,
      { width: 10, height: 13 },
      color & 0xff,
      (color >> 8) & 0xff,
      (color >> 16) & 0xff,
      1
    );
  }

  #drawHover(lem) {
    const x = lem.x - 5;
    const y = lem.y - 11; // sits a bit higher
    const color = 0x5e5e5e; // slightly lighter grey

    this.display.drawCornerRect(x, y, { width: 10, height: 13 }, color & 0xff, (color >> 8) & 0xff, (color >> 16) & 0xff);
  }

  static __test__ = {
    drawCorner(instance, x, y, r, g, b) {
      instance.#drawCorner(x, y, r, g, b);
    }
  };

  dispose() {
    if (this.display && this._mouseHandler) {
      this.display.onMouseDown.off(this._mouseHandler);
      this._mouseHandler = null;
    }
    if (this.display && this._mouseMoveHandler) {
      this.display.onMouseMove.off(this._mouseMoveHandler);
      this._mouseMoveHandler = null;
    }
    if (this._hoverRafId && typeof window !== 'undefined' && window.cancelAnimationFrame) {
      window.cancelAnimationFrame(this._hoverRafId);
      this._hoverRafId = 0;
    }
    this.display = null;
    this.game = null;
    this.level = null;
    this.lemmingManager = null;
    this.objectManager = null;
    this.triggerManager = null;
    this.hoverIndex = -1;
    this.hoverLemming = null;
  }
}

export { GameDisplay };
