const DEFAULT_HISTORY_RETENTION = Object.freeze({
  enableHistoryCap: true,
  historyCapTicks: 20000,
  historyWarnTicks: 15000
});

const getNowMs = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const resolveRafApi = () => {
  if (typeof window === 'undefined') return null;
  if (typeof window.requestAnimationFrame !== 'function') return null;
  if (typeof window.cancelAnimationFrame !== 'function') return null;
  return window;
};

class TimeTravelController {
  constructor(game, history) {
    this.game = game;
    this.history = history;
    this.timer = game?.getGameTimer?.() || null;
    this.playbackDirection = 1;
    this._reverseActive = false;
    this._reverseRaf = 0;
    this._lastTime = 0;
    this._reverseCarryMs = 0;
    this.maxReverseStepsPerFrame = 120;
    this.ignoreSpeedOnReverse = true;
    this._resumeForward = false;
    this._prevInputEnabled = null;
    this._rafApi = null;
    this._historyRetention = this._configureHistoryRetention();
  }

  get isReversing() { return this._reverseActive; }

  getHistoryRetention() {
    return { ...this._historyRetention };
  }

  _configureHistoryRetention() {
    return this.setHistoryRetention(DEFAULT_HISTORY_RETENTION);
  }

  setHistoryRetention(policy = null) {
    const requested = {
      ...DEFAULT_HISTORY_RETENTION,
      ...(policy && typeof policy === 'object' ? policy : {})
    };
    if (!this.history?.configureRetention) {
      this._historyRetention = { ...requested };
      return this.getHistoryRetention();
    }
    this._historyRetention = this.history.configureRetention(requested);
    return this.getHistoryRetention();
  }

  _resolveTimer() {
    const timer = this.game?.getGameTimer?.();
    if (timer) this.timer = timer;
    return this.timer;
  }

  _getDeltaAt(tickIndex) {
    if (!this.history) return null;
    if (typeof this.history.getDelta === 'function') {
      const delta = this.history.getDelta(tickIndex);
      if (delta !== undefined && delta !== null) return delta;
    }
    return this.history.deltas?.[tickIndex] ?? null;
  }

  stepBackward(count = 1) {
    const timer = this._resolveTimer();
    if (!timer || !this.history || !this.game) return;
    if (timer.isRunning?.()) timer.suspend?.();
    const steps = Math.max(0, Math.trunc(count));
    for (let i = 0; i < steps; i++) {
      if (timer.tickIndex <= 0) {
        timer.tickIndex = 0;
        break;
      }
      const targetTick = timer.tickIndex - 1;
      const delta = this._getDeltaAt(targetTick);
      if (!delta) {
        this.seekToTick(targetTick);
        break;
      }
      if (typeof this.history.applyDeltaBackward !== 'function') {
        this.seekToTick(targetTick);
        break;
      }
      this.history.applyDeltaBackward(this.game, delta);
      timer.tickIndex = targetTick;
      this._emitReverseEvents(delta);
      if (this.game.gameGui) {
        this.game.gameGui.gameTimeChanged = true;
      }
    }
    this.game.render?.();
  }

  seekToTick(targetTickIndex) {
    const timer = this._resolveTimer();
    if (!timer || !this.history || !this.game) return;
    if (timer.isRunning?.()) timer.suspend?.();
    const target = Math.max(0, Math.trunc(targetTickIndex));
    const keyframe = this.history.getKeyframeAtOrBefore(target);
    if (!keyframe) return;
    if (typeof this.history.applyKeyframe !== 'function') return;
    this.history.applyKeyframe(this.game, keyframe);
    timer.tickIndex = keyframe.tickIndex ?? target;
    let cursor = timer.tickIndex;
    while (cursor < target) {
      const delta = this._getDeltaAt(cursor);
      if (!delta) break;
      if (typeof this.history.applyDeltaForward !== 'function') break;
      this.history.applyDeltaForward(this.game, delta);
      cursor += 1;
      timer.tickIndex = cursor;
    }
    if (this.game.gameGui) {
      this.game.gameGui.gameTimeChanged = true;
    }
    this.game.render?.();
  }

  startReverse() {
    const timer = this._resolveTimer();
    const rafApi = resolveRafApi();
    if (this._reverseActive || !timer || !this.game || !rafApi) return;
    this.playbackDirection = -1;
    this._reverseActive = true;
    this._rafApi = rafApi;
    this._resumeForward = !!timer.isRunning?.();
    if (this._prevInputEnabled === null) {
      this._prevInputEnabled = this.game.inputEnabled ?? true;
    }
    this.game.inputEnabled = false;
    if (this.game.gameGui) {
      this.game.gameGui.gameTimeChanged = true;
    }
    timer.suspend?.();
    this.history?.pause?.();
    this._lastTime = getNowMs();
    this._reverseCarryMs = 0;
    const loop = (now) => {
      if (!this._reverseActive) return;
      const frameTime = timer.frameTime || timer.TIME_PER_FRAME_MS || 60;
      let delta = (now - this._lastTime) + this._reverseCarryMs;
      if (delta >= frameTime) {
        const rawSteps = Math.floor(delta / frameTime);
        const maxSteps = Number.isFinite(this.maxReverseStepsPerFrame)
          ? Math.max(1, Math.trunc(this.maxReverseStepsPerFrame))
          : rawSteps;
        const steps = Math.min(rawSteps, maxSteps);
        delta -= steps * frameTime;
        this._reverseCarryMs = delta;
        this._lastTime = now;
        this.stepBackward(steps);
      }
      this._reverseRaf = this._rafApi?.requestAnimationFrame?.(loop) ?? 0;
    };
    this._reverseRaf = this._rafApi.requestAnimationFrame(loop);
  }

  stopReverse() {
    if (!this._reverseActive) return;
    const timer = this._resolveTimer();
    this._reverseActive = false;
    const rafApi = this._rafApi || resolveRafApi();
    if (this._reverseRaf) {
      rafApi?.cancelAnimationFrame?.(this._reverseRaf);
      this._reverseRaf = 0;
    }
    this._rafApi = null;
    this._reverseCarryMs = 0;
    if (this._resumeForward && timer) {
      this.history?.truncateAfter?.(timer.tickIndex);
    }
    this.history?.resume?.();
    this.playbackDirection = 1;
    if (this._prevInputEnabled !== null) {
      this.game.inputEnabled = this._prevInputEnabled;
      this._prevInputEnabled = null;
    }
    if (this.game?.gameGui) {
      this.game.gameGui.gameTimeChanged = true;
    }
    if (this._resumeForward) {
      this._resumeForward = false;
      timer?.continue?.();
    }
  }

  toggleReverse() {
    if (this._reverseActive) this.stopReverse();
    else this.startReverse();
  }

  _emitReverseEvents(delta) {
    const events = delta?.soundEvents;
    if (!events || !events.length) return;
    const soundBus = this.game?.soundEvents;
    if (!soundBus?.emit) return;
    for (let i = events.length - 1; i >= 0; i--) {
      const { id, tick, timeMs, frameMs, speedFactor, tps, ...rest } = events[i];
      soundBus.emit({ ...rest, reverse: true });
    }
  }

  dispose() {
    this._resumeForward = false;
    this.stopReverse();
    this.game = null;
    this.history = null;
    this.timer = null;
  }
}

export { TimeTravelController };
