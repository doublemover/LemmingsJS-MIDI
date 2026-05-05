const DEFAULT_WATCH_POLLING_CONFIG = Object.freeze({
  minMs: 0,
  activeMs: 250,
  maxMs: 2000,
  backoffFactor: 1.6,
  idleThreshold: 3,
  onDemandMinMs: 100
});

import {
  createPointerWatchState,
  parseJsonPointer,
  readPointerValue,
  updatePointerWatchState
} from './watchPointers.js';

const toFiniteNumber = (value, fallback) => {
  let number;
  try {
    number = Number(value);
  } catch {
    number = Number.NaN;
  }
  return Number.isFinite(number) ? number : fallback;
};

const normalizeConfig = (config = {}) => {
  const minMs = Math.max(0, Math.trunc(toFiniteNumber(config.minMs, DEFAULT_WATCH_POLLING_CONFIG.minMs)));
  const activeMs = Math.max(minMs, Math.trunc(toFiniteNumber(config.activeMs, DEFAULT_WATCH_POLLING_CONFIG.activeMs)));
  const maxMs = Math.max(activeMs, Math.trunc(toFiniteNumber(config.maxMs, DEFAULT_WATCH_POLLING_CONFIG.maxMs)));
  const backoffFactor = Math.max(1, toFiniteNumber(config.backoffFactor, DEFAULT_WATCH_POLLING_CONFIG.backoffFactor));
  const idleThreshold = Math.max(1, Math.trunc(toFiniteNumber(config.idleThreshold, DEFAULT_WATCH_POLLING_CONFIG.idleThreshold)));
  const onDemandMinMs = Math.max(0, Math.trunc(toFiniteNumber(config.onDemandMinMs, DEFAULT_WATCH_POLLING_CONFIG.onDemandMinMs)));
  return {
    minMs,
    activeMs,
    maxMs,
    backoffFactor,
    idleThreshold,
    onDemandMinMs
  };
};

const clampDelay = (value, minMs, maxMs) => {
  if (!Number.isFinite(value)) return minMs;
  return Math.min(maxMs, Math.max(minMs, Math.trunc(value)));
};

class WatchPollingController {
  constructor({
    hasWatchesFn,
    pollFn,
    setTimerFn = setTimeout,
    clearTimerFn = clearTimeout,
    nowFn = Date.now,
    config
  } = {}) {
    if (typeof hasWatchesFn !== 'function') {
      throw new Error('WatchPollingController requires hasWatchesFn');
    }
    if (typeof pollFn !== 'function') {
      throw new Error('WatchPollingController requires pollFn');
    }
    this.hasWatchesFn = hasWatchesFn;
    this.pollFn = pollFn;
    this.setTimerFn = setTimerFn;
    this.clearTimerFn = clearTimerFn;
    this.nowFn = nowFn;
    this.config = normalizeConfig(config);
    this.running = false;
    this.polling = false;
    this.pendingImmediate = false;
    this.idlePolls = 0;
    this.delayMs = this.config.activeMs;
    this.lastPollAtMs = null;
    this.timerHandle = null;
    this.nextRunAtMs = 0;
    this._idleWaiters = new Set();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.idlePolls = 0;
    this.delayMs = this.config.activeMs;
    this.pendingImmediate = false;
    this._schedule(0);
  }

  stop() {
    this.running = false;
    this.pendingImmediate = false;
    this._clearTimer();
    this._resolveIdleWaiters();
  }

  async stopAndWait(timeoutMs = 5000) {
    this.stop();
    if (!this.polling) return;
    await this._waitForIdle(timeoutMs);
  }

  request({ immediate = false } = {}) {
    if (!this.running || !this.hasWatchesFn()) return;
    if (immediate) {
      this.pendingImmediate = true;
      if (!this.polling) {
        this._schedule(0);
      }
      return;
    }
    if (!this.polling) {
      this._schedule(Math.min(this.delayMs, this.config.activeMs));
    }
  }

  async tickNow() {
    if (!this.running || !this.hasWatchesFn()) return null;
    if (this.polling) {
      this.pendingImmediate = true;
      return null;
    }
    const now = this.nowFn();
    if (Number.isFinite(this.lastPollAtMs) && (now - this.lastPollAtMs) < this.config.onDemandMinMs) {
      return null;
    }
    return this._runPollCycle();
  }

  getSnapshot() {
    return {
      running: this.running,
      polling: this.polling,
      pendingImmediate: this.pendingImmediate,
      idlePolls: this.idlePolls,
      delayMs: this.delayMs,
      lastPollAtMs: this.lastPollAtMs,
      nextRunAtMs: this.nextRunAtMs
    };
  }

  async _onTimer() {
    this.timerHandle = null;
    this.nextRunAtMs = 0;
    try {
      await this._runPollCycle();
    } catch (error) {
      // Ignore timer poll errors and let future polls continue.
    }
  }

  async _runPollCycle() {
    if (!this.running || !this.hasWatchesFn()) return null;
    if (this.polling) return null;
    this.polling = true;
    let outcome = null;
    let failed = false;
    try {
      outcome = await this.pollFn();
    } catch (error) {
      failed = true;
      outcome = null;
    } finally {
      this.polling = false;
      this.lastPollAtMs = this.nowFn();
      this._resolveIdleWaiters();
    }

    this._applyOutcome(outcome, failed);

    if (!this.running || !this.hasWatchesFn()) {
      this._clearTimer();
      return outcome;
    }
    if (this.pendingImmediate) {
      this.pendingImmediate = false;
      this._schedule(this.config.minMs);
      return outcome;
    }
    this._schedule(this.delayMs);
    return outcome;
  }

  _applyOutcome(outcome, failed) {
    if (failed) {
      this.idlePolls += 1;
      this.delayMs = clampDelay(
        Math.round(this.delayMs * this.config.backoffFactor),
        this.config.activeMs,
        this.config.maxMs
      );
      return;
    }

    const triggeredCount = Math.max(0, Math.trunc(toFiniteNumber(outcome?.triggeredCount, 0)));
    if (triggeredCount > 0) {
      this.idlePolls = 0;
      this.delayMs = this.config.activeMs;
      return;
    }

    this.idlePolls += 1;
    if (this.idlePolls < this.config.idleThreshold) {
      return;
    }
    this.delayMs = clampDelay(
      Math.round(this.delayMs * this.config.backoffFactor),
      this.config.activeMs,
      this.config.maxMs
    );
  }

  _schedule(delayMs) {
    if (!this.running) return;
    const normalized = clampDelay(delayMs, this.config.minMs, this.config.maxMs);
    const dueAt = this.nowFn() + normalized;
    if (this.timerHandle && this.nextRunAtMs > 0 && this.nextRunAtMs <= dueAt) {
      return;
    }
    this._clearTimer();
    this.nextRunAtMs = dueAt;
    this.timerHandle = this.setTimerFn(() => {
      void this._onTimer();
    }, normalized);
  }

  _clearTimer() {
    if (this.timerHandle) {
      this.clearTimerFn(this.timerHandle);
    }
    this.timerHandle = null;
    this.nextRunAtMs = 0;
  }

  _waitForIdle(timeoutMs) {
    if (!this.polling) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        timeoutId: null
      };
      if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
        waiter.timeoutId = this.setTimerFn(() => {
          this._idleWaiters.delete(waiter);
          resolve();
        }, timeoutMs);
      }
      this._idleWaiters.add(waiter);
    });
  }

  _resolveIdleWaiters() {
    if (this.polling || !this._idleWaiters.size) return;
    for (const waiter of this._idleWaiters) {
      if (waiter.timeoutId != null) {
        this.clearTimerFn(waiter.timeoutId);
      }
      waiter.resolve();
    }
    this._idleWaiters.clear();
  }
}

export {
  DEFAULT_WATCH_POLLING_CONFIG,
  WatchPollingController,
  parseJsonPointer,
  readPointerValue,
  createPointerWatchState,
  updatePointerWatchState
};
