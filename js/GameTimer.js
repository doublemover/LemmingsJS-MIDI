import { Lemmings } from './LemmingsNamespace.js';

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
  #visHandler;
  benchStartupFrames = 0;
  benchStableFactor = 1;

  constructor(level) {
    this.TIME_PER_FRAME_MS = 60;
    this.#speedFactor = 1;
    this.#frameTime = this.TIME_PER_FRAME_MS;
    this.#rafId = 0;
    this.#running = false;
    this.#lastTime = 0;
    this.#lastGameSecond = 0;
    this.#tickIndex = 0;
    this.#loopBound = this.#loop.bind(this);
    this.onGameTick = new Lemmings.EventHandler();
    this.eachGameSecond = new Lemmings.EventHandler();
    this.onBeforeGameTick = new Lemmings.EventHandler();
    this.ticksTimeLimit = this.secondsToTicks(level.timeLimit * 60);
    this.#autoPaused = false;
    this.#stableTicks = 0;
    this.#catchupSlow = false;
    this.#visHandler = () => {
      const hidden = document.visibilityState === 'hidden' || !document.hasFocus();
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
    document.addEventListener('visibilitychange', this.#visHandler, false);
    window.addEventListener('blur',  this.#visHandler, false);
    window.addEventListener('focus', this.#visHandler, false);
    this.#updateFrameTime();
    this.benchStartupFrames = 0;
    this.benchStableFactor = 1;
  }

  isRunning() { return this.#running; }

  get tickIndex() { return this.#tickIndex; }
  set tickIndex(v) {
    if (v >= Lemmings.COUNTER_LIMIT) {
      console.warn('tickIndex wrapped, resetting to 0');
      this.#tickIndex = 0;
    } else {
      this.#tickIndex = v;
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
    if (this.isRunning()) return;
    this.#lastTime = performance.now();
    this.#running = true;
    this.#rafId = window.requestAnimationFrame(this.#loopBound);
  }

  suspend() {
    if (this.#rafId) {
      window.cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
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
    for (let i = 0; i < count; i++) {
      if (dir >= 0) {
        if (this.onBeforeGameTick) this.onBeforeGameTick.trigger(this.tickIndex);
        ++this.tickIndex;
        if (this.onGameTick) this.onGameTick.trigger();
      } else if (this.tickIndex > 0) {
        --this.tickIndex;
        if (this.onBeforeGameTick) this.onBeforeGameTick.trigger(this.tickIndex);
        if (this.onGameTick) this.onGameTick.trigger();
      }
    }
  }

  #loop(now) {
    if (!this.isRunning()) return;
    window.cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
    lemmings.tps = this.tps;
    const gameSeconds = Math.floor(this.#lastTime / this.TIME_PER_FRAME_MS);
    if (gameSeconds > this.#lastGameSecond) {
      if (this.eachGameSecond) {
        this.#lastGameSecond = gameSeconds;
        this.eachGameSecond.trigger();
      }
    }
    let delta = now - this.#lastTime;
    if (delta >= this.#frameTime) {
      const steps = Math.floor(delta / this.#frameTime);
      if (lemmings.bench == true) {
        this.#benchSpeedAdjust(steps);
      } else if (steps > 1) {
        this.#catchupSpeedAdjust(steps);
      } else if (this.#catchupSlow) {
        this.#restoreSpeed();
      }
      delta -= steps * this.#frameTime;
      this.#lastTime = now - delta;
      for (let i = 0; i < steps; ++i) {
        if (this.onBeforeGameTick) this.onBeforeGameTick.trigger(this.tickIndex);
        ++this.tickIndex;
        if (this.onGameTick) this.onGameTick.trigger();
      }
    }
    this.#rafId = window.requestAnimationFrame(this.#loopBound);
  }

  #benchSpeedAdjust(steps) {
    // dynamically adjust speed based on how far we fall behind
    // slowThreshold scales with current speedFactor so faster games tolerate
    // fewer queued frames. minimum 10 frames before slowing down.
    // recoverThreshold likewise scales and controls when we start speeding up.
    lemmings.steps = steps;
    const oldSpeed = this.#speedFactor;

    const mult = this.benchStartupFrames > 0 ? this.benchStableFactor : 1;
    const slowThreshold = Math.max(10, 16 / this.#speedFactor);
    const recoverThreshold = Math.max(4, 4 / this.#speedFactor);

    if (steps > recoverThreshold) this.#stableTicks -= 32;
    if (steps <= recoverThreshold / 2) this.#stableTicks += 1;

    if (this.benchStartupFrames > 0) {
      this.benchStartupFrames -= steps;
    }

    if (this.benchStartupFrames <= 0) {
      if (steps > 100) {
        this.suspend();
        this.#stableTicks = 0;
        this.#speedFactor = 0.1;
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
      const stage = lemmings?.stage;
      if (stage?.startOverlayFade) {
        let rect = null;
        if (lemmings.bench) {
          const gui = stage.guiImgProps;
          const scale = gui.viewPoint.scale;
          rect = { x: gui.x + 160 * scale, y: gui.y + 32 * scale, width: 16 * scale, height: 10 * scale };
        }
        stage.startOverlayFade(color, rect, dashLen);
      }
    }
  }

  #catchupSpeedAdjust(steps) {
    const newFactor = Math.max(0.1, 1 / steps);
    if (newFactor < this.#speedFactor) {
      console.log(`catchup: ${steps} steps, speed ${newFactor}`);
      this.#speedFactor = newFactor;
      this.#updateFrameTime();
      this.#catchupSlow = true;
    }
  }

  #restoreSpeed() {
    if (this.#catchupSlow) {
      this.#catchupSlow = false;
      this.speedFactor = 1;
    }
  }

  stop() {
    this.suspend();
    document.removeEventListener('visibilitychange', this.#visHandler, false);
    window.removeEventListener('blur', this.#visHandler, false);
    window.removeEventListener('focus', this.#visHandler, false);

    // Dispose all event handlers to prevent leaks across level reloads
    if (this.onBeforeGameTick && this.onBeforeGameTick.dispose)
      this.onBeforeGameTick.dispose();
    if (this.onGameTick && this.onGameTick.dispose)
      this.onGameTick.dispose();
    if (this.eachGameSecond && this.eachGameSecond.dispose)
      this.eachGameSecond.dispose();
  }

  getGameTime() { return this.ticksToSeconds(this.tickIndex); }
  getGameTicks() { return this.tickIndex; }
  getGameLeftTime() {
    let left = this.ticksTimeLimit - this.tickIndex;
    if (left < 0) left = 0;
    return Math.floor(this.ticksToSeconds(left));
  }
  getGameLeftTimeString() {
    const secs = this.getGameLeftTime();
    return Math.floor(secs / 60) + '-' + ('0' + (secs % 60)).slice(-2);
  }
  ticksToSeconds(t) {
    if (lemmings.endless == true) {
      return 42069 * (this.TIME_PER_FRAME_MS / 1000);
    }  
    return t * (this.TIME_PER_FRAME_MS / 1000); 
  }
  secondsToTicks(s) { return s * (1000 / this.TIME_PER_FRAME_MS); }
}
Lemmings.GameTimer = GameTimer;
export { GameTimer };
