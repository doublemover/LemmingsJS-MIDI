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
const gamepadConfigMethods = {
  _loadPersistedConfig() {
    try {
      const stored = this.storage?.getItem?.(this.storageKey);
      const parsed = parseGamepadBindingConfig(stored);
      if (parsed) {
        this._layers.persisted = compactGamepadOverrideConfig(parsed);
        this._persistConfig();
        this._applyConfigLayers();
      }
    } catch {
      /* ignored */
    }
  },

  _persistConfig() {
    try {
      this.storage?.setItem?.(this.storageKey, JSON.stringify(this._layers.persisted || {
        version: this.registry.config.version,
        bindings: {}
      }));
    } catch {
      /* ignored */
    }
  },

  _loadFileConfig() {
    if (!this.fileProvider?.loadString) return;
    this.fileProvider.loadString('gamepadbindings.json')
      .then((text) => {
        const parsed = parseGamepadBindingConfig(text);
        if (!parsed) return;
        this._layers.file = cloneGamepadConfig(parsed);
        if (this._layers.persisted) {
          this._layers.persisted = compactGamepadOverrideConfig(
            this._layers.persisted,
            mergeGamepadConfigLayers(this._layers.file)
          );
          this._persistConfig();
        }
        this._applyConfigLayers();
      })
      .catch(() => {});
  },

  _applyConfigLayers() {
    this.registry.setConfig(mergeGamepadConfigLayers(
      this._layers.file,
      this._layers.persisted,
      this._layers.session
    ));
    this._releaseAllActions();
    this._bindingActive.clear();
  },

  getDisplayBindings(action) {
    return this.registry
      .getBindingsForAction(this.mode, action)
      .map(spec => formatGamepadBindingSpec(spec))
      .filter(Boolean);
  }
};
export { gamepadConfigMethods };