import { Lemmings } from './LemmingsNamespace.js';

/**
 * Re‑written GameTimer using requestAnimationFrame for
 * sub‑millisecond stability and zero setInterval drift.
 *
 * Public API is **identical** to the original so existing callers
 * need no edits.
 */
class GameTimer {
  /**
   * @param {Lemmings.Level} level – needed only for the time‑limit.
   */
  constructor (level) {
    this.TIME_PER_FRAME_MS = 60; // desired step length (ms) at speedFactor
    this._speedFactor = 1;       // multiplier, 2 = double speed 0.5 = half speed
    this._frameTime = this.TIME_PER_FRAME_MS;
    this._rafId = 0;             // requestAnimationFrame id when running, else 0 
    this._lastTime = 0;          // last wall‑clock timestamp processed (ms)
    this.tickIndex = 0;          // the current game time in number of ticks processed
    this._loopBound = this._loop.bind(this); // Only allocate once

    this.onGameTick        = new Lemmings.EventHandler();
    this.onBeforeGameTick  = new Lemmings.EventHandler();

    // total ticks allowed in minutes
    this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);

    this._autoPaused = false;

    this._visHandler = () => {
      // use both visibilityState and window focus for robustness
      const hidden = document.visibilityState === 'hidden' || !document.hasFocus();
      if (hidden) {
        if (this.isRunning()) {
          this._autoPaused = true;
          this.suspend();
        }
      } else if (this._autoPaused) {
        this._autoPaused = false;
        this.continue();
      }
    };

    document.addEventListener('visibilitychange', this._visHandler, false);
    window.addEventListener('blur',  this._visHandler, false);
    window.addEventListener('focus', this._visHandler, false);
    this._updateFrameTime();
  }

  /** whether the timer is currently advancing */
  isRunning()            { return this._rafId !== 0; }

  get speedFactor () { return this._speedFactor; }
  set speedFactor (value) {
    if (value <= 0) return;  // ignore invalid
    if (this._speedFactor === value) return;
    this._speedFactor = value;
    this._updateFrameTime();
    if (this.isRunning()) {
      this.suspend();
      this.continue();
    }
  }

  _updateFrameTime() {
    this._frameTime = this.TIME_PER_FRAME_MS / this._speedFactor;
  }

  toggle () {
    if (this.isRunning()) this.suspend();
    else this.continue();
  }

  continue () {
    if (this.isRunning()) return;
    this._lastTime = performance.now();
    this._rafId = window.requestAnimationFrame(this._loopBound);
  }

  suspend () {
    if (this._rafId) {
      window.cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  _loop(now) {
    if (!this.isRunning()) return;

    let delta = now - this._lastTime;
    if (delta >= this._frameTime) {
      // How many whole ticks fit in elapsed time
      const steps = Math.floor(delta / this._frameTime);
      delta -= steps * this._frameTime;  // Carry forward leftover
      this._lastTime = now - delta;

      for (let i = 0; i < steps; ++i) {
        if (this.onBeforeGameTick) this.onBeforeGameTick.trigger(this.tickIndex);
        ++this.tickIndex;
        if (this.onGameTick) this.onGameTick.trigger();
      }
    }
    this._rafId = window.requestAnimationFrame(this._loopBound);
  }

  stop () {
    this.suspend();
    document.removeEventListener('visibilitychange', this._visHandler, false);
    window.removeEventListener('blur', this._visHandler, false);
    window.removeEventListener('focus', this._visHandler, false);
    if (this.onBeforeGameTick && this.onBeforeGameTick.dispose)
      this.onBeforeGameTick.dispose();
    if (this.onGameTick && this.onGameTick.dispose)
      this.onGameTick.dispose();
  }

  getGameTime()          { return this.ticksToSeconds(this.tickIndex); }
  getGameTicks()         { return this.tickIndex; }
  getGameTimeLimit()     { return this.ticksTimeLimit; }

  getGameLeftTime() {
    let left = this.ticksTimeLimit - this.tickIndex;
    if (left < 0) left = 0;
    return Math.floor(this.ticksToSeconds(left));
  }

  getGameLeftTimeString() {
    const secs = this.getGameLeftTime();
    return Math.floor(secs / 60) + '-' + ('0' + (secs % 60)).slice(-2);
  }

  ticksToSeconds(t)      { return t * (this.TIME_PER_FRAME_MS / 1000); }
  secondsToTicks(s)      { return s * (1000 / this.TIME_PER_FRAME_MS); }
}

Lemmings.GameTimer = GameTimer;
export { GameTimer };
