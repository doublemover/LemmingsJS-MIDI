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
  }

  get isReversing() { return this._reverseActive; }

  _resolveTimer() {
    const timer = this.game?.getGameTimer?.();
    if (timer) this.timer = timer;
    return this.timer;
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
      const delta = this.history.getDelta?.(targetTick)
        ?? this.history.deltas?.[targetTick];
      if (!delta) {
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
    this.history.applyKeyframe(this.game, keyframe);
    timer.tickIndex = keyframe.tickIndex ?? target;
    let cursor = timer.tickIndex;
    while (cursor < target) {
      const delta = this.history.getDelta?.(cursor)
        ?? this.history.deltas?.[cursor];
      if (!delta) break;
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
    if (this._reverseActive || !timer || !this.game) return;
    this.playbackDirection = -1;
    this._reverseActive = true;
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
    this._lastTime = performance.now();
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
      this._reverseRaf = window.requestAnimationFrame(loop);
    };
    this._reverseRaf = window.requestAnimationFrame(loop);
  }

  stopReverse() {
    if (!this._reverseActive) return;
    const timer = this._resolveTimer();
    this._reverseActive = false;
    if (this._reverseRaf) {
      window.cancelAnimationFrame(this._reverseRaf);
      this._reverseRaf = 0;
    }
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
