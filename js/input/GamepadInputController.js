const DEFAULT_GAMEPAD_BINDINGS = Object.freeze({
  version: 1,
  bindings: Object.freeze({
    gameplay: Object.freeze({
      togglePause: ['button:9'],
      stepBackward: ['button:2'],
      stepForward: ['button:3'],
      toggleReverse: ['button:10'],
      nuke: ['button:8'],
      restartLevel: ['button:11'],
      cycleSkillPrev: ['button:4'],
      cycleSkillNext: ['button:5'],
      applySkillToSelected: ['button:0'],
      levelPrev: ['button:6'],
      levelNext: ['button:7'],
      toggleShortcutOverlay: ['button:16'],
      panLeft: ['button:14', 'axis:0:-:0.35'],
      panRight: ['button:15', 'axis:0:+:0.35'],
      panUp: ['button:12', 'axis:1:-:0.35'],
      panDown: ['button:13', 'axis:1:+:0.35'],
      zoomIn: ['axis:3:-:0.35'],
      zoomOut: ['axis:3:+:0.35'],
      zoomReset: ['button:1']
    }),
    editor: Object.freeze({
      editorToolSelect: ['button:10'],
      editorToolTerrain: ['button:0'],
      editorToolGadget: ['button:1'],
      editorToolTrigger: ['button:2'],
      editorToolMidiFlag: ['button:3'],
      editorToolBrush: ['button:4'],
      editorToolEraser: ['button:5'],
      editorUndo: ['button:6'],
      editorRedo: ['button:7'],
      editorDelete: ['button:8'],
      editorTogglePlaytest: ['button:9'],
      editorToggleShortcutOverlay: ['button:16'],
      editorNudgeLeft: ['button:14', 'axis:0:-:0.35'],
      editorNudgeRight: ['button:15', 'axis:0:+:0.35'],
      editorNudgeUp: ['button:12', 'axis:1:-:0.35'],
      editorNudgeDown: ['button:13', 'axis:1:+:0.35']
    })
  })
});

const DEFAULT_STORAGE_KEY = 'lem-gamepad-bindings-v1';
const DEFAULT_BUTTON_THRESHOLD = 0.5;
const DEFAULT_AXIS_DEAD_ZONE = 0.35;
const NO_GAMEPAD_POLL_INTERVAL_MS = 1000;

const GAMEPAD_BUTTON_LABELS = Object.freeze({
  0: 'A / Cross',
  1: 'B / Circle',
  2: 'X / Square',
  3: 'Y / Triangle',
  4: 'L1',
  5: 'R1',
  6: 'L2',
  7: 'R2',
  8: 'Select / View',
  9: 'Start / Menu',
  10: 'L3',
  11: 'R3',
  12: 'DPad Up',
  13: 'DPad Down',
  14: 'DPad Left',
  15: 'DPad Right',
  16: 'Home / Guide'
});

const normalizeBindingsMap = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input;
};

const normalizeBindingList = (entry) => {
  if (Array.isArray(entry)) return entry;
  if (typeof entry === 'string') return [entry];
  return [];
};

const normalizeModeName = (value) => String(value || '').trim().toLowerCase();

const parseNumberValue = (raw, fallback = null) => {
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
};

const clampUnit = (value, fallback) => {
  const num = parseNumberValue(value, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, 0), 1);
};

const parseBindingSpec = (raw) => {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(':').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const type = parts[0].toLowerCase();
  if (type === 'button') {
    const index = parseNumberValue(parts[1], null);
    if (!Number.isFinite(index) || index < 0) return null;
    const threshold = clampUnit(parts[2], DEFAULT_BUTTON_THRESHOLD);
    return {
      kind: 'button',
      index: Math.trunc(index),
      threshold
    };
  }
  if (type === 'axis') {
    const index = parseNumberValue(parts[1], null);
    if (!Number.isFinite(index) || index < 0) return null;
    const dirRaw = String(parts[2] || '').toLowerCase();
    const direction = dirRaw === '+' || dirRaw === 'pos' || dirRaw === 'positive'
      ? 1
      : dirRaw === '-' || dirRaw === 'neg' || dirRaw === 'negative'
        ? -1
        : 0;
    if (!direction) return null;
    const deadZone = clampUnit(parts[3], DEFAULT_AXIS_DEAD_ZONE);
    return {
      kind: 'axis',
      index: Math.trunc(index),
      direction,
      deadZone
    };
  }
  return null;
};

const formatGamepadBindingSpec = (spec) => {
  if (!spec) return '';
  if (spec.kind === 'button') {
    const label = GAMEPAD_BUTTON_LABELS[spec.index] || `Button ${spec.index}`;
    return label;
  }
  if (spec.kind === 'axis') {
    const dir = spec.direction < 0 ? '-' : '+';
    return `Axis ${spec.index} ${dir}`;
  }
  return '';
};

const parseGamepadBindingConfig = (text) => {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const cloneGamepadConfig = (config) => {
  if (!config || typeof config !== 'object') return null;
  const clone = {
    version: Number.isFinite(config.version) ? Math.trunc(config.version) : undefined,
    bindings: {}
  };
  const modes = normalizeBindingsMap(config.bindings);
  let hasBindings = false;
  for (const modeName of ['gameplay', 'editor']) {
    const modeBindings = normalizeBindingsMap(modes[modeName]);
    const nextMode = {};
    for (const [action, entry] of Object.entries(modeBindings)) {
      if (Array.isArray(entry)) {
        nextMode[action] = entry.slice();
      } else if (typeof entry === 'string') {
        nextMode[action] = entry;
      } else {
        nextMode[action] = entry;
      }
    }
    if (Object.keys(nextMode).length) {
      clone.bindings[modeName] = nextMode;
      hasBindings = true;
    }
  }
  if (!hasBindings) delete clone.bindings;
  if (clone.version == null) delete clone.version;
  return clone;
};

const bindingEntriesEqual = (left, right) => {
  const leftList = normalizeBindingList(left);
  const rightList = normalizeBindingList(right);
  if (leftList.length !== rightList.length) return false;
  for (let i = 0; i < leftList.length; i += 1) {
    if (leftList[i] !== rightList[i]) return false;
  }
  return true;
};

const mergeGamepadConfig = (base, overrides = null) => {
  const merged = {
    version: base.version,
    bindings: {
      gameplay: { ...normalizeBindingsMap(base.bindings?.gameplay) },
      editor: { ...normalizeBindingsMap(base.bindings?.editor) }
    }
  };
  if (!overrides || typeof overrides !== 'object') return merged;
  if (Number.isFinite(overrides.version)) {
    merged.version = Math.trunc(overrides.version);
  }
  const overrideModes = normalizeBindingsMap(overrides.bindings);
  for (const modeName of ['gameplay', 'editor']) {
    const modeOverrides = normalizeBindingsMap(overrideModes[modeName]);
    for (const [action, bindings] of Object.entries(modeOverrides)) {
      merged.bindings[modeName][action] = bindings;
    }
  }
  return merged;
};

const mergeGamepadConfigLayers = (...layers) => {
  let merged = mergeGamepadConfig(DEFAULT_GAMEPAD_BINDINGS);
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    merged = mergeGamepadConfig(merged, layer);
  }
  return merged;
};

const compactGamepadOverrideConfig = (config, baseConfig = DEFAULT_GAMEPAD_BINDINGS) => {
  const clone = cloneGamepadConfig(config);
  if (!clone?.bindings) return clone;
  const base = mergeGamepadConfig(DEFAULT_GAMEPAD_BINDINGS, baseConfig || null);
  for (const modeName of ['gameplay', 'editor']) {
    const modeBindings = normalizeBindingsMap(clone.bindings?.[modeName]);
    const baseModeBindings = normalizeBindingsMap(base.bindings?.[modeName]);
    for (const [action, bindings] of Object.entries(modeBindings)) {
      if (bindingEntriesEqual(bindings, baseModeBindings[action])) {
        delete modeBindings[action];
      }
    }
    if (!Object.keys(modeBindings).length) {
      delete clone.bindings[modeName];
    }
  }
  if (!Object.keys(clone.bindings || {}).length) {
    delete clone.bindings;
  }
  return clone;
};

class GamepadBindingRegistry {
  constructor(config = DEFAULT_GAMEPAD_BINDINGS) {
    this._compiledByMode = new Map();
    this._specsByModeAction = new Map();
    this.setConfig(config);
  }

  setConfig(config) {
    this.config = mergeGamepadConfig(DEFAULT_GAMEPAD_BINDINGS, config);
    this._compiledByMode.clear();
    this._specsByModeAction.clear();

    for (const modeName of ['gameplay', 'editor']) {
      const modeBindings = normalizeBindingsMap(this.config.bindings?.[modeName]);
      const compiled = [];
      const byAction = new Map();
      for (const [action, entry] of Object.entries(modeBindings)) {
        const rawSpecs = normalizeBindingList(entry);
        if (!rawSpecs.length) continue;
        const parsedSpecs = [];
        for (const rawSpec of rawSpecs) {
          const spec = parseBindingSpec(rawSpec);
          if (!spec) continue;
          parsedSpecs.push(spec);
          compiled.push({
            id: `${action}:${spec.kind}:${spec.index}:${spec.direction ?? 0}:${spec.deadZone ?? spec.threshold ?? 0}`,
            action,
            spec
          });
        }
        if (parsedSpecs.length) {
          byAction.set(action, parsedSpecs);
        }
      }
      this._compiledByMode.set(modeName, compiled);
      this._specsByModeAction.set(modeName, byAction);
    }
  }

  getCompiledBindings(mode) {
    return this._compiledByMode.get(normalizeModeName(mode)) || [];
  }

  getBindingsForAction(mode, action) {
    const map = this._specsByModeAction.get(normalizeModeName(mode));
    return map?.get(action) || [];
  }
}

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
  }

  _persistConfig() {
    try {
      this.storage?.setItem?.(this.storageKey, JSON.stringify(this._layers.persisted || {
        version: this.registry.config.version,
        bindings: {}
      }));
    } catch {
      /* ignored */
    }
  }

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
  }

  _applyConfigLayers() {
    this.registry.setConfig(mergeGamepadConfigLayers(
      this._layers.file,
      this._layers.persisted,
      this._layers.session
    ));
    this._releaseAllActions();
    this._bindingActive.clear();
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

  getDisplayBindings(action) {
    return this.registry
      .getBindingsForAction(this.mode, action)
      .map(spec => formatGamepadBindingSpec(spec))
      .filter(Boolean);
  }

  _start() {
    if (this._running) return;
    if (typeof this.window?.requestAnimationFrame !== 'function') return;
    if (typeof this.navigator?.getGamepads !== 'function') return;
    this._running = true;
    this._raf = this.window.requestAnimationFrame(this._tick);
  }

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

  _detectConnectedGamepad() {
    const rawPads = this.navigator?.getGamepads?.();
    if (!rawPads) return null;
    for (let i = 0; i < rawPads.length; i += 1) {
      const pad = rawPads[i];
      if (pad && pad.connected !== false) return pad;
    }
    return null;
  }

  _getPrimaryGamepad() {
    return this._detectConnectedGamepad();
  }

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
  }

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
  }

  _releaseAllActions() {
    if (!this._actionActiveCounts.size) return;
    for (const action of this._actionActiveCounts.keys()) {
      this.onAction?.(action, 'up');
    }
    this._actionActiveCounts.clear();
  }

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
}

export {
  DEFAULT_GAMEPAD_BINDINGS,
  GamepadBindingRegistry,
  GamepadInputController,
  formatGamepadBindingSpec,
  mergeGamepadConfigLayers,
  mergeGamepadConfig,
  parseBindingSpec,
  compactGamepadOverrideConfig,
  parseGamepadBindingConfig
};
