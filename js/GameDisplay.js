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
    };
    this.display.onMouseMove.on(this._mouseMoveHandler);
  }
  render() {
    if (this.display == null)
      return;
    this.level.render(this.display);
    this.objectManager.render(this.display);
    this.lemmingManager.render(this.display);
  }
  renderDebug() {
    if (this.display == null)
      return;
    this.level.renderDebug(this.display);
    this.lemmingManager.renderDebug(this.display);
    this.triggerManager.renderDebug(this.display);
    if (this._mouseX >= 0 && this._mouseY >= 0) {
      const lem = this.lemmingManager.getNearestLemming(this._mouseX, this._mouseY);
      if (lem) {
        const x = lem.x - 5;
        const y = lem.y - 11;
        this.display.drawMarchingAntRect(x, y, 10, 13, 3, this._dashOffset);
        this._dashOffset = (this._dashOffset + 1) % 6;
      }
    }
  }

  dispose() {
    if (this.display && this._mouseHandler) {
      this.display.onMouseDown.off(this._mouseHandler);
      this._mouseHandler = null;
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
  }
}
Lemmings.GameDisplay = GameDisplay;

export { GameDisplay };
