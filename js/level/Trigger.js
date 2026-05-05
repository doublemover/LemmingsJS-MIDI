// @ts-check
import { COUNTER_LIMIT } from '../core/constants.js';
import { TriggerTypes } from './TriggerTypes.js';
import { getAppContext } from '../core/dependencies.js';

class Trigger {
  #disabledUntilTick;
  /**
   * @param {number} [type]
   * @param {number} [x1]
   * @param {number} [y1]
 * @param {number} [x2] exclusive right edge
 * @param {number} [y2] exclusive bottom edge
   * @param {number} [disableTicksCount]
   * @param {number} [soundIndex]
   * @param {any} [owner]
   */
  constructor(type = TriggerTypes.NO_TRIGGER, x1 = 0, y1 = 0, x2 = 0, y2 = 0, disableTicksCount = 0, soundIndex = -1, owner = null) {
    this.#disabledUntilTick = 0;
    /** @type {number|undefined} */
    this.__historyId = undefined;
    this.owner = owner;
    this.type = Number(type);
    this.soundIndex = soundIndex;
    this.x1 = Math.min(x1, x2);
    this.y1 = Math.min(y1, y2);
    this.x2 = Math.max(x1, x2);
    this.y2 = Math.max(y1, y2);
    this.disableTicksCount = disableTicksCount;
  }

  get disabledUntilTick() { return this.#disabledUntilTick; }
  set disabledUntilTick(v) {
    if (v >= COUNTER_LIMIT) {
      console.warn('disabledUntilTick wrapped, resetting to 0');
      this.#disabledUntilTick = 0;
    } else {
      this.#disabledUntilTick = v;
    }
  }
  trigger(x, y, tick, lemming = null) {
    if (this.disabledUntilTick <= tick) {
      if ((x >= this.x1) && (y >= this.y1) && (x < this.x2) && (y < this.y2)) {
        const prev = this.disabledUntilTick;
        const next = tick + this.disableTicksCount;
        if (prev !== next) {
          const history = getAppContext()?.game?.history ?? null;
          history?.recordTriggerCooldown?.(this, prev, next);
        }
        this.disabledUntilTick = next;
        if (this.owner?.onTrigger){
          this.owner.onTrigger(tick, lemming, this, x, y);
        }
        return this.type;
      }
    } else {
      return TriggerTypes.DISABLED;
    }
    return TriggerTypes.NO_TRIGGER;
  }
  draw(gameDisplay) {
    if (this.type === TriggerTypes.ONEWAY_LEFT || this.type === TriggerTypes.ONEWAY_RIGHT) {
      return; // don't render arrow triggers to debug display, that is handled in level
    }
    gameDisplay.drawRect(
      this.x1,
      this.y1,
      Math.max(0, this.x2 - this.x1 - 1),
      Math.max(0, this.y2 - this.y1 - 1),
      255,
      0,
      0
    );
  }
}

export { Trigger };
