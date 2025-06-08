import { Lemmings } from './LemmingsNamespace.js';

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
    this._dashOffset = 0;
    this.hoverIndex = -1;
    this.hoverLemming = null;
  }
  setGuiDisplay(display) {
    this.display = display;
    this._mouseHandler = (e) => {
      const lem = this.lemmingManager.getNearestLemming(e.x, e.y);
      if (lem) {
        this.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
      }
    };
    this.display.onMouseDown.on(this._mouseHandler);
    this._mouseMoveHandler = (e) => {
      this._mouseX = e.x;
      this._mouseY = e.y;
      this.hoverLemming = this.lemmingManager.getNearestLemming(e.x, e.y);
    };
    this.display.onMouseMove.on(this._mouseMoveHandler);
  }
  render() {
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
  renderDebug() {
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
      const redundant = {
        [Lemmings.SkillTypes.BASHER]: Lemmings.ActionBashSystem,
        [Lemmings.SkillTypes.BLOCKER]: Lemmings.ActionBlockerSystem,
        [Lemmings.SkillTypes.DIGGER]: Lemmings.ActionDiggSystem,
        [Lemmings.SkillTypes.MINER]: Lemmings.ActionMineSystem
      };
      const ActionClass = redundant[selectedSkill];
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

  dispose() {
    if (this.display && this._mouseHandler) {
      this.display.onMouseDown.off(this._mouseHandler);
      this._mouseHandler = null;
      if (this._moveHandler) {
        this.display.onMouseMove.off(this._moveHandler);
        this._moveHandler = null;
      }
    }
    if (this.display && this._mouseMoveHandler) {
      this.display.onMouseMove.off(this._mouseMoveHandler);
      this._mouseMoveHandler = null;
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
Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
