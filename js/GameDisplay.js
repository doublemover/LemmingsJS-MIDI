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
    this._moveHandler = null;
    this.hoverIndex = -1;
  }
  setGuiDisplay(display) {
    this.display = display;
    this._mouseHandler = (e) => {
      const lem = this.lemmingManager.getLemmingAt(e.x, e.y);
      if (!lem) return;
      if (lem.id === this.lemmingManager.selectedIndex) {
        this.game.queueCommand(new Lemmings.CommandLemmingsAction(lem.id));
      } else {
        this.lemmingManager.selectedIndex = lem.id;
      }
    };
    this._moveHandler = (e) => {
      const lem = this.lemmingManager.getLemmingAt(e.x, e.y);
      this.hoverIndex = lem ? lem.id : -1;
    };
    this.display.onMouseDown.on(this._mouseHandler);
    this.display.onMouseMove.on(this._moveHandler);
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
    this.display = null;
    this.game = null;
    this.level = null;
    this.lemmingManager = null;
    this.objectManager = null;
    this.triggerManager = null;
    this.hoverIndex = -1;
  }
}
Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
