import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class Lemming extends Lemmings.BaseLogger {
  constructor(x = 0, y = 0, id) {
    super();
    this.lookRight = true;
    this.frameIndex = 0;
    this.canClimb = false;
    this.hasParachute = false;
    this.removed = false;
    this.countdown = 0;
    this.action = 0;
    this.state = 0;
    this.hasExploded = false;
    this.disabled = false;
    this.x = x;
    this.y = y;
    this.id = id;
  }

  getDirection() {
    return this.lookRight ? 'right' : 'left';
  }

  getCountDownTime() {
    return (8 - (this.countdown >> 4));
  }

  setAction(action) {
    this.action = action;
    this.frameIndex = 0;
    this.state = 0;
  }

  setCountDown(action) {
    this.countdownAction = action;
    if (this.countdown > 0) return false;
    this.countdown = 80;
    return true;
  }

  getClickDistance(x, y) {
    const hw = Math.floor(Lemming.SPRITE_BASE_WIDTH / 2);
    const hh = Math.floor(Lemming.SPRITE_BASE_HEIGHT / 2);
    let yCenter = this.y - hh;
    let xCenter = this.x;
    let x1 = xCenter - hw;
    let y1 = yCenter - hh - 1;
    let x2 = xCenter + hw;
    let y2 = yCenter + hh + 1;
    if ((x >= x1) && (x <= x2) && (y >= y1) && (y < y2)) {
      return ((yCenter - y) * (yCenter - y) + (xCenter - x) * (xCenter - x));
    }
    return -1;
  }

  render(gameDisplay) {
    if (!this.action) return;
    if (this.countdownAction != null) {
      this.countdownAction.draw(gameDisplay, this);
    }
    this.action.draw(gameDisplay, this);
  }

  renderDebug(gameDisplay) {
    if (!this.action) return;
    gameDisplay.setDebugPixel(this.x, this.y);
  }

  process(level) {
    const lemX = this.x;
    const lemY = this.y;
    if ((lemX < 0) || (this.x >= level.width) || (this.y < 0) || (this.y >= level.height + 6)) {
      let newY = lemY;
      if (lemY >= level.height) {
        newY = level.height - 6;
      }
      if (lemmings?.game?.lemmingManager?.miniMap) {
        lemmings.game.lemmingManager.miniMap.addDeath(lemX, newY);
      }
      return Lemmings.LemmingStateType.OUT_OF_LEVEL;
    }
    // run main action
    if (!this.action) {
      if (lemmings?.game?.lemmingManager?.miniMap) {
        lemmings.game.lemmingManager.miniMap.addDeath(lemX, this.y);
      }
      return Lemmings.LemmingStateType.OUT_OF_LEVEL;
    }
    // run secondary action
    if (this.countdownAction) {
      let newAction = this.countdownAction.process(level, this);
      if (newAction != Lemmings.LemmingStateType.NO_STATE_TYPE) {
        return newAction;
      }
    }
    if (this.action) {
      let returnedState = this.action.process(level, this);
      return returnedState;
    }
    // prevent falling through function without returning a type
    this.log.log('lemming state falling through, fix it');
    return Lemmings.LemmingStateType.NO_STATE_TYPE;
  }

  disable() {
    this.disabled = true;
  }

  remove() {
    this.action = null;
    this.countdownAction = null;
    this.removed = true;
    this.hasExploded = false;
    this.id = null;
  }

  isDisabled() { return this.disabled; }
  isRemoved() { return (this.action == null); }
}

Lemming.LEM_MIN_Y = -5;
Lemming.LEM_MAX_FALLING = 59;
Lemming.SPRITE_BASE_WIDTH = 16;
Lemming.SPRITE_BASE_HEIGHT = 10;
Lemmings.Lemming = Lemming;
export { Lemming };
