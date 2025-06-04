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
      //console.log(e.x +" "+ e.y);
      let lem = this.lemmingManager.getNearestLemming(e.x, e.y);
      if (!lem)
        return;
      this.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
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
      if (this.hoverIndex >= 0 && this.hoverIndex !== this.lemmingManager.selectedIndex) {
        const h = this.lemmingManager.getLemming(this.hoverIndex);
        if (h && !h.removed) this.#drawHover(h);
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
    const x1 = lem.x - 5;
    const y1 = lem.y - 6;
    const x2 = lem.x + 5 - 2;
    const y2 = lem.y + 7 - 2;
    this.#drawCorner(x1, y1, 255, 255, 255);
    this.#drawCorner(x2, y1, 255, 255, 255);
    this.#drawCorner(x1, y2, 255, 255, 255);
    this.#drawCorner(x2, y2, 255, 255, 255);
  }

  #drawHover(lem) {
    const x1 = lem.x - 5;
    const y1 = lem.y - 6;
    const width = 10;
    const height = 13;
    this.display.drawRect(x1, y1, width, height, 64, 64, 64);
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
