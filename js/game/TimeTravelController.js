class TimeTravelController {
  constructor(game, history) {
    this.game = game;
    this.history = history;
    this.timer = game?.getGameTimer?.() || null;
    this.playbackDirection = 1;
    this._reverseActive = false;
    this._reverseRaf = 0;
    this._lastTime = 0;
    this._resumeForward = false;
    this._prevInputEnabled = null;
  }

  get isReversing() { return this._reverseActive; }

  stepBackward(count = 1) {
    if (!this.timer || !this.history || !this.game) return;
    if (this.timer.isRunning?.()) this.timer.suspend?.();
    const steps = Math.max(0, Math.trunc(count));
    for (let i = 0; i < steps; i++) {
      if (this.timer.tickIndex <= 0) {
        this.timer.tickIndex = 0;
        break;
      }
      const targetTick = this.timer.tickIndex - 1;
      const delta = this.history.deltas.get(targetTick);
      if (!delta) {
        this.seekToTick(targetTick);
        break;
      }
      this.history.applyDeltaBackward(this.game, delta);
      this.timer.tickIndex = targetTick;
      this._emitReverseEvents(delta);
      if (this.game.gameGui) {
        this.game.gameGui.gameTimeChanged = true;
      }
    }
    this.game.render?.();
  }

  seekToTick(targetTickIndex) {
    if (!this.timer || !this.history || !this.game) return;
    if (this.timer.isRunning?.()) this.timer.suspend?.();
    const target = Math.max(0, Math.trunc(targetTickIndex));
    const keyframe = this.history.getKeyframeAtOrBefore(target);
    if (!keyframe) return;
    this.history.applyKeyframe(this.game, keyframe);
    this.timer.tickIndex = keyframe.tickIndex ?? target;
    let cursor = this.timer.tickIndex;
    while (cursor < target) {
      const delta = this.history.deltas.get(cursor);
      if (!delta) break;
      this.history.applyDeltaForward(this.game, delta);
      cursor += 1;
      this.timer.tickIndex = cursor;
    }
    if (this.game.gameGui) {
      this.game.gameGui.gameTimeChanged = true;
    }
    this.game.render?.();
  }

  startReverse() {
    if (this._reverseActive || !this.timer || !this.game) return;
    this.playbackDirection = -1;
    this._reverseActive = true;
    this._resumeForward = !!this.timer.isRunning?.();
    if (this._prevInputEnabled === null) {
      this._prevInputEnabled = this.game.inputEnabled ?? true;
    }
    this.game.inputEnabled = false;
    if (this.game.gameGui) {
      this.game.gameGui.gameTimeChanged = true;
    }
    this.timer.suspend?.();
    this.history?.pause?.();
    this._lastTime = performance.now();
    const loop = (now) => {
      if (!this._reverseActive) return;
      const frameTime = this.timer.frameTime || this.timer.TIME_PER_FRAME_MS || 60;
      let delta = now - this._lastTime;
      if (delta >= frameTime) {
        const steps = Math.floor(delta / frameTime);
        delta -= steps * frameTime;
        this._lastTime = now - delta;
        this.stepBackward(steps);
      }
      this._reverseRaf = window.requestAnimationFrame(loop);
    };
    this._reverseRaf = window.requestAnimationFrame(loop);
  }

  stopReverse() {
    if (!this._reverseActive) return;
    this._reverseActive = false;
    if (this._reverseRaf) {
      window.cancelAnimationFrame(this._reverseRaf);
      this._reverseRaf = 0;
    }
    if (this._resumeForward) {
      this.history?.truncateAfter?.(this.timer.tickIndex);
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
      this.timer.continue?.();
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
