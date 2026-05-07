import {
  DEFAULT_AXIS_DEAD_ZONE,
  DEFAULT_BUTTON_THRESHOLD,
  DEFAULT_GAMEPAD_BINDINGS,
  DEFAULT_STORAGE_KEY,
  GAMEPAD_BUTTON_LABELS,
  GamepadBindingRegistry,
  NO_GAMEPAD_POLL_INTERVAL_MS,
  bindingEntriesEqual,
  clampUnit,
  cloneGamepadConfig,
  compactGamepadOverrideConfig,
  formatGamepadBindingSpec,
  mergeGamepadConfig,
  mergeGamepadConfigLayers,
  normalizeBindingList,
  normalizeBindingsMap,
  normalizeModeName,
  parseBindingSpec,
  parseGamepadBindingConfig,
  parseNumberValue
} from './GamepadInputControllerShared.js';
const gamepadPollingMethods = {
  _start() {
    if (this._running) return;
    if (typeof this.window?.requestAnimationFrame !== 'function') return;
    if (typeof this.navigator?.getGamepads !== 'function') return;
    this._running = true;
    this._raf = this.window.requestAnimationFrame(this._tick);
  },

  _tick() {
    this._raf = 0;
    if (!this._running) return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (this._hasConnectedGamepad || (now - this._lastNoGamepadPollMs) >= NO_GAMEPAD_POLL_INTERVAL_MS) {
      this._lastNoGamepadPollMs = now;
      this._poll();
    }
    this._raf = this.window.requestAnimationFrame(this._tick);
  },

  _detectConnectedGamepad() {
    const rawPads = this.navigator?.getGamepads?.();
    if (!rawPads) return null;
    for (let i = 0; i < rawPads.length; i += 1) {
      const pad = rawPads[i];
      if (pad && pad.connected !== false) return pad;
    }
    return null;
  },

  _getPrimaryGamepad() {
    return this._detectConnectedGamepad();
  },

  _isBindingActive(spec, gamepad) {
    if (spec.kind === 'button') {
      const button = gamepad?.buttons?.[spec.index];
      if (!button) return false;
      const pressed = button.pressed === true;
      const value = Number.isFinite(button.value) ? button.value : (pressed ? 1 : 0);
      return pressed || value >= (spec.threshold ?? DEFAULT_BUTTON_THRESHOLD);
    }
    if (spec.kind === 'axis') {
      const value = Number(gamepad?.axes?.[spec.index] ?? 0);
      if (!Number.isFinite(value)) return false;
      const deadZone = spec.deadZone ?? DEFAULT_AXIS_DEAD_ZONE;
      if (spec.direction < 0) {
        return value <= -deadZone;
      }
      return value >= deadZone;
    }
    return false;
  },

  _setBindingState(bindingId, action, active) {
    const prev = this._bindingActive.get(bindingId) === true;
    if (prev === active) return;
    this._bindingActive.set(bindingId, active);

    const prevCount = this._actionActiveCounts.get(action) || 0;
    if (active) {
      const nextCount = prevCount + 1;
      this._actionActiveCounts.set(action, nextCount);
      if (prevCount === 0) {
        this.onAction?.(action, 'down');
      }
      return;
    }

    const nextCount = Math.max(0, prevCount - 1);
    if (nextCount === 0) {
      this._actionActiveCounts.delete(action);
      this.onAction?.(action, 'up');
    } else {
      this._actionActiveCounts.set(action, nextCount);
    }
  },

  _releaseAllActions() {
    if (!this._actionActiveCounts.size) return;
    for (const action of this._actionActiveCounts.keys()) {
      this.onAction?.(action, 'up');
    }
    this._actionActiveCounts.clear();
  },

  dispose() {
    this._running = false;
    if (this._raf) {
      this.window?.cancelAnimationFrame?.(this._raf);
      this._raf = 0;
    }
    this.window?.removeEventListener?.('gamepadconnected', this._onGamepadConnected);
    this.window?.removeEventListener?.('gamepaddisconnected', this._onGamepadDisconnected);
    this._releaseAllActions();
    this._bindingActive.clear();
  }
};
export { gamepadPollingMethods };