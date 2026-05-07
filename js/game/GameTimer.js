import { COUNTER_LIMIT } from '../core/constants.js';
import { getAppContext } from '../core/dependencies.js';
import { EventHandler } from '../util/EventHandler.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../util/performanceInstrumentation.js';

const getApp = () => {
  const app = getAppContext();
  if (app) return app;
  return null;
};

const TIMER_LOOP_DEVTOOLS = Object.freeze({
  track: 'GameTimer',
  trackGroup: 'Game Loop',
  color: 'primary',
  tooltipText: 'loop'
});

class GameTimer {
  #speedFactor;
  #frameTime;
  #rafId;
  #running;
  #lastTime;
  #lastGameSecond;
  #tickIndex;
  #loopBound;
  #autoPaused;
  #stableTicks;
  #catchupSlow;
  #catchupBaseSpeed;
  #visHandler;
  #timeTravel;
  #windowRef;
  #documentRef;
  #performanceRef;
  benchStartupFrames = 0;
  benchStableFactor = 1;

  constructor(level, runtime = {}) {
    this.TIME_PER_FRAME_MS = 60;
    this.#windowRef = runtime.window ?? (typeof window !== 'undefined' ? window : null);
    this.#documentRef = runtime.document ?? (typeof document !== 'undefined' ? document : null);
    this.#performanceRef = runtime.performance ?? (typeof performance !== 'undefined' ? performance : null);
    this.#speedFactor = 1;
    this.#frameTime = this.TIME_PER_FRAME_MS;
    this.#rafId = null;
    this.#running = false;
    this.#lastTime = 0;
    this.#lastGameSecond = 0;
    this.#tickIndex = 0;
    this.#loopBound = this.#loop.bind(this);
    this.onGameTick = new EventHandler();
    this.eachGameSecond = new EventHandler();
    this.onBeforeGameTick = new EventHandler();
    this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);
    this.#autoPaused = false;
    this.#stableTicks = 0;
    this.#catchupSlow = false;
    this.#catchupBaseSpeed = 1;
    this.#timeTravel = null;
    this.#visHandler = () => {
      const app = getApp();
      const skip = app?.bench || app?.bench2 || app?.benchReverse || app?.benchSequence;
      if (skip) return;
      const documentRef = this.#documentRef;
      const hidden = documentRef?.visibilityState === 'hidden' ||
        (typeof documentRef?.hasFocus === 'function' && !documentRef.hasFocus());
      if (hidden) {
        if (this.isRunning()) {
          this.#autoPaused = true;
          this.suspend();
        }
      } else if (this.#autoPaused) {
        this.#autoPaused = false;
        this.continue();
      }
    };
    this.#documentRef?.addEventListener?.('visibilitychange', this.#visHandler, false);
    this.#windowRef?.addEventListener?.('blur',  this.#visHandler, false);
    this.#windowRef?.addEventListener?.('focus', this.#visHandler, false);
    this.#updateFrameTime();
    this.benchStartupFrames = 0;
    this.benchStableFactor = 1;
  }

  isRunning() { return this.#running; }

  setTimeTravelController(controller) {
    this.#timeTravel = controller;
  }

  getTimeTravelController() { return this.#timeTravel; }

  get tickIndex() { return this.#tickIndex; }
  set tickIndex(v) {
    if (v >= COUNTER_LIMIT) {
      console.warn('tickIndex wrapped, resetting to 0');
      this.#tickIndex = 0;
    } else {
      this.#tickIndex = Math.max(0, Math.trunc(Number(v) || 0));
    }
    this.#lastGameSecond = this.#getWholeGameSecond();
  }
  #incrementTickIndex() {
    const next = this.#tickIndex + 1;
    if (next >= COUNTER_LIMIT) {
      console.warn('tickIndex wrapped, resetting to 0');
      this.#tickIndex = 0;
      this.#lastGameSecond = 0;
      return;
    }
    this.#tickIndex = next;
  }

  #now() {
    return this.#performanceRef?.now?.() ?? Date.now();
  }

  #getWholeGameSecond() {
    return Math.floor(this.#tickIndex * (this.TIME_PER_FRAME_MS / 1000));
  }

  #emitGameSecondIfChanged() {
    if (!this.eachGameSecond) return;
    const current = this.#getWholeGameSecond();
    if (current === this.#lastGameSecond) return;
    const step = current > this.#lastGameSecond ? 1 : -1;
    while (this.#lastGameSecond !== current) {
      this.#lastGameSecond += step;
      this.eachGameSecond.trigger(this.#lastGameSecond);
    }
  }

  get speedFactor() { return this.#speedFactor; }
  get tps() { return 1000 / this.#frameTime; }
  set speedFactor(value) {
    if (value <= 0) return;
    if (this.#speedFactor === value) return;
    this.#speedFactor = value;
    this.#updateFrameTime();
    if (this.isRunning()) {
      this.suspend();
      this.continue();
    }
  }

  get frameTime() { return this.#frameTime; }

  #updateFrameTime() {
    this.#frameTime = this.TIME_PER_FRAME_MS / this.#speedFactor;
  }

  toggle() {
    if (this.isRunning()) this.suspend();
    else this.continue();
  }

  continue() {
    if (this.isRunning()) return true;
    this.#lastTime = this.#now();
    this.#running = true;
    if (!this.#scheduleFrame()) {
      this.#running = false;
      this.#rafId = null;
      return false;
    }
    return true;
  }

  #scheduleFrame() {
    if (typeof this.#windowRef?.requestAnimationFrame !== 'function') {
      return false;
    }
    const rafId = this.#windowRef.requestAnimationFrame(this.#loopBound);
    if (rafId == null) return false;
    this.#rafId = rafId;
    return true;
  }

  suspend() {
    if (this.#rafId != null) {
      this.#windowRef?.cancelAnimationFrame?.(this.#rafId);
      this.#rafId = null;
    }
    this.#running = false;
  }

  /**
   * Advance or rewind the game state by a number of ticks without
   * starting the animation loop. Negative values rewind if possible.
   * @param {number} steps
   */
  tick(steps = 1) {
    if (this.isRunning()) return;
    const count = Math.trunc(Math.abs(steps));
    const dir = Math.sign(steps);
    if (dir < 0 && this.#timeTravel?.stepBackward) {
      this.#timeTravel.stepBackward(count);
      return;
    }
    const beforeTick = this.onBeforeGameTick;
    const onTick = this.onGameTick;
    for (let i = 0; i < count; i++) {
      if (dir >= 0) {
        if (beforeTick) beforeTick.trigger(this.#tickIndex);
        this.#incrementTickIndex();
        this.#emitGameSecondIfChanged();
        if (onTick) onTick.trigger();
      } else if (this.#tickIndex > 0) {
        this.#tickIndex -= 1;
        if (beforeTick) beforeTick.trigger(this.#tickIndex);
        this.#emitGameSecondIfChanged();
        if (onTick) onTick.trigger();
      }
    }
  }

  #loop(now) {
    if (!this.isRunning()) return;
    const app = getApp();
    const bench = app?.bench === true;
    const bench2 = app?.bench2 === true;
    const benchReverse = app?.benchReverse === true;
    const benchSequence = app?.benchSequence === true;
    const inBenchMode = bench || bench2 || benchReverse || benchSequence;
    const perfEnabled = !!app &&
      !inBenchMode &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance(this.#performanceRef);
    const perfStart = perfEnabled ? this.#now() : 0;

    try {
      if (this.#rafId != null) {
        this.#windowRef?.cancelAnimationFrame?.(this.#rafId);
      }
      this.#rafId = null;
      const frameTime = this.#frameTime;
      if (app) app.tps = 1000 / frameTime;
      let delta = now - this.#lastTime;
      if (delta >= frameTime) {
        const steps = Math.floor(delta / frameTime);
        if (bench || benchReverse || benchSequence) {
          this.#benchSpeedAdjust(steps, app);
        }
        if (bench2) {
          if (steps > 1) this.#catchupSpeedAdjust(steps, app);
          else this.#restoreSpeed();
        }
        delta -= steps * frameTime;
        this.#lastTime = now - delta;
        const beforeTick = this.onBeforeGameTick;
        const onTick = this.onGameTick;
        for (let i = 0; i < steps; ++i) {
          if (beforeTick) beforeTick.trigger(this.#tickIndex);
          this.#incrementTickIndex();
          this.#emitGameSecondIfChanged();
          if (onTick) onTick.trigger();
        }
      }
      if (!this.#scheduleFrame()) {
        this.#running = false;
        this.#rafId = null;
      }
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('GameTimer loop', {
          start: perfStart,
          detail: { devtools: TIMER_LOOP_DEVTOOLS }
        }, { performanceRef: this.#performanceRef });
      }
    }
  }

  #benchSpeedAdjust(steps, appRef = null) {
    // dynamically adjust speed based on how far we fall behind
    // slowThreshold and recoverThreshold scale with the current speedFactor.
    // Below speedFactor 6 the values grow too large; use speedFactor * 1.5 so
    // lower speeds still trigger slowdown after at least 10 queued frames.
    const app = appRef || getApp();
    if (!app) return;
    app.steps = steps;
    const oldSpeed = this.#speedFactor;

    const mult = this.benchStartupFrames > 0 ? this.benchStableFactor : 1;
    // When speedFactor is below 6 the thresholds become huge and the game never
    // slows down. Scale using `speedFactor * 1.5` so lower speeds still react.
    const factor = this.#speedFactor < 6 ? this.#speedFactor * 1.5 : this.#speedFactor;
    const slowThreshold = Math.max(10, 16 / factor);
    const recoverThreshold = Math.max(4, 4 / factor);

    if (steps > recoverThreshold) this.#stableTicks -= 32;
    if (steps <= recoverThreshold / 2) this.#stableTicks += 1;

    if (this.benchStartupFrames > 0) {
      this.benchStartupFrames -= steps;
    }

    if (this.benchStartupFrames <= 0) {
      if (steps > 100) {
        this.#stableTicks = 0;
        const severeDrop = Math.min(this.#speedFactor * 0.5, this.#speedFactor - 1);
        this.#speedFactor = Math.max(0.2, severeDrop);
      } else if (steps > slowThreshold) {
        this.#stableTicks = 0;
        const sf = this.#speedFactor;
        if (sf > 60) this.#speedFactor = 60;
        else if (sf > 40) this.#speedFactor -= 10;
        else if (sf > 10) this.#speedFactor -= 9;
        else if (sf <= 10 && sf > 1) this.#speedFactor -= 1;
        else if (sf <= 1 && sf > 0.2) this.#speedFactor = ((this.#speedFactor * 10) - 1) / 10;
      }

      if (this.#stableTicks > 32 * mult && this.#speedFactor < 60) {
        this.#stableTicks = 0;
        this.#speedFactor += 1;
      }
      if (this.#stableTicks > 2 * mult && this.#speedFactor < 1) {
        this.#stableTicks = 0;
        this.#speedFactor = ((this.#speedFactor * 10) + 1) / 10;
      }
    }

    const diff = this.#speedFactor - oldSpeed;
    if (diff !== 0) {
      this.#updateFrameTime();
      const intensity = Math.min(Math.abs(diff) / 5, 1);
      const color = diff > 0
        ? `rgba(0,255,0,${intensity})`
        : `rgba(255,0,0,${intensity})`;
      const dashLen = Math.max(2, Math.min(steps, 20));
      const inBenchMode = app.bench || app.bench2 || app.benchReverse || app.benchSequence;
      const stage = app?.stage;
      if (stage?.startOverlayFade) {
        let rect = null;
        if (app.bench || app.bench2 || app.benchReverse) {
          const gui = stage.guiImgProps;
          const scale = gui.viewPoint.scale;
          rect = { x: gui.x + 160 * scale, y: gui.y + 32 * scale, width: 16 * scale, height: 10 * scale };
        }
        stage.startOverlayFade(color, rect, inBenchMode ? 0 : dashLen);
      }
    }
  }

  #catchupSpeedAdjust(steps, appRef = null) {
    const newFactor = Math.max(0.1, 1 / steps);
    const app = appRef || getApp();
    if (!this.#catchupSlow) {
      this.#catchupBaseSpeed = this.#speedFactor;
    }
    if (newFactor < this.#speedFactor) {
      if (app?.logBenchCatchup === true) {
        console.log(`catchup: ${steps} steps, speed ${newFactor}`);
      }
      this.#speedFactor = newFactor;
      this.#updateFrameTime();
      this.#catchupSlow = true;
    }
  }

  #restoreSpeed() {
    if (this.#catchupSlow) {
      this.#catchupSlow = false;
      if (this.#speedFactor !== this.#catchupBaseSpeed) {
        this.#speedFactor = this.#catchupBaseSpeed;
        this.#updateFrameTime();
      }
    }
  }

  stop() {
    this.suspend();
    this.#documentRef?.removeEventListener?.('visibilitychange', this.#visHandler, false);
    this.#windowRef?.removeEventListener?.('blur', this.#visHandler, false);
    this.#windowRef?.removeEventListener?.('focus', this.#visHandler, false);

    // Dispose all event handlers to prevent leaks across level reloads
    if (this.onBeforeGameTick && this.onBeforeGameTick.dispose)
      this.onBeforeGameTick.dispose();
    if (this.onGameTick && this.onGameTick.dispose)
      this.onGameTick.dispose();
    if (this.eachGameSecond && this.eachGameSecond.dispose)
      this.eachGameSecond.dispose();
    this.onBeforeGameTick = null;
    this.onGameTick = null;
    this.eachGameSecond = null;
  }

  getGameTime() { return this.ticksToSeconds(this.tickIndex); }
  getGameTicks() { return this.tickIndex; }
  getGameLeftTime() {
    let left = this.ticksTimeLimit - this.tickIndex;
    if (left < 0) left = 0;
    return Math.floor(this.ticksToSeconds(left));
  }
  getGameLeftTimeString() {
    const app = getApp();
    if (app?.endless === true) {
      return '4-20';
    }
    const secs = this.getGameLeftTime();
    return Math.floor(secs / 60) + '-' + ('0' + (secs % 60)).slice(-2);
  }
  ticksToSeconds(t) {
    const app = getApp();
    if (app?.endless === true) {
      return 42069 * (this.TIME_PER_FRAME_MS / 1000);
    }
    return t * (this.TIME_PER_FRAME_MS / 1000);
  }
  secondsToTicks(s) { return s * (1000 / this.TIME_PER_FRAME_MS); }
}

export { GameTimer };
