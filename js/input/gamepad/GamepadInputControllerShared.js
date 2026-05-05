
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

export {
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
};
