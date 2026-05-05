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
import { gamepadConfigMethods } from './GamepadConfig.js';
import { gamepadPollingMethods } from './GamepadPolling.js';
class GamepadInputController {
  constructor(options = {}) {
    this.mode = normalizeModeName(options.mode || 'gameplay') || 'gameplay';
    this.onAction = typeof options.onAction === 'function' ? options.onAction : null;
    this.window = options.window ?? globalThis.window;
    this.navigator = options.navigator ?? globalThis.navigator;
    this.storage = options.storage ?? globalThis.localStorage;
    this.fileProvider = options.fileProvider || null;
    this.storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    this.registry = new GamepadBindingRegistry();
    this._layers = {
      file: null,
      persisted: null,
      session: null
    };
    this._bindingActive = new Map();
    this._actionActiveCounts = new Map();
    this._raf = 0;
    this._running = false;
    this._tick = this._tick.bind(this);
    this._lastNoGamepadPollMs = -Infinity;
    this._hasConnectedGamepad = false;
    this._onGamepadConnected = () => {
      this._hasConnectedGamepad = true;
      this._lastNoGamepadPollMs = -Infinity;
    };
    this._onGamepadDisconnected = () => {
      this._hasConnectedGamepad = this._detectConnectedGamepad() !== null;
      if (!this._hasConnectedGamepad) {
        this._releaseAllActions();
        this._bindingActive.clear();
      }
    };
    this.window?.addEventListener?.('gamepadconnected', this._onGamepadConnected);
    this.window?.addEventListener?.('gamepaddisconnected', this._onGamepadDisconnected);
    this._loadPersistedConfig();
    this._loadFileConfig();
    this._hasConnectedGamepad = this._detectConnectedGamepad() !== null;
    this._start();
  }

  setConfig(config, { persist = true, layer = null } = {}) {
    const layerName = layer || (persist ? 'persisted' : 'session');
    if (!Object.hasOwn(this._layers, layerName)) {
      throw new Error(`unknown gamepad config layer: ${layerName}`);
    }
    this._layers[layerName] = layerName === 'persisted'
      ? compactGamepadOverrideConfig(config, mergeGamepadConfigLayers(this._layers.file))
      : cloneGamepadConfig(config);
    this._applyConfigLayers();
    if (persist) {
      this._persistConfig();
    }
  }

  _poll() {
    const bindings = this.registry.getCompiledBindings(this.mode);
    if (!bindings.length) {
      this._releaseAllActions();
      this._bindingActive.clear();
      return;
    }
    const gamepad = this._getPrimaryGamepad();
    if (!gamepad) {
      this._hasConnectedGamepad = false;
      this._releaseAllActions();
      this._bindingActive.clear();
      return;
    }
    this._hasConnectedGamepad = true;
    for (const binding of bindings) {
      const nextActive = this._isBindingActive(binding.spec, gamepad);
      this._setBindingState(binding.id, binding.action, nextActive);
    }
  }
}
for (const methods of [
  gamepadConfigMethods,
  gamepadPollingMethods
]) {
  Object.defineProperties(GamepadInputController.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { GamepadInputController };