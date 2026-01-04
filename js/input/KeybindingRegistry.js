const DEFAULT_KEYBINDINGS = Object.freeze({
  version: 1,
  bindings: Object.freeze({
    releaseRateDown: ['Digit1'],
    releaseRateDownMax: ['Shift+Digit1'],
    releaseRateUp: ['Digit2'],
    releaseRateUpMax: ['Shift+Digit2'],
    selectSkillClimber: ['Digit3'],
    selectSkillFloater: ['Digit4'],
    selectSkillBomber: ['Digit5'],
    selectSkillBlocker: ['Digit6'],
    selectSkillBuilder: ['KeyQ'],
    selectSkillBasher: ['KeyW'],
    selectSkillMiner: ['KeyE'],
    selectSkillDigger: ['KeyR'],
    togglePause: ['Space'],
    stepForward: ['BracketRight'],
    stepBackward: ['BracketLeft', 'Alt+BracketRight'],
    toggleReverse: ['KeyB'],
    nuke: ['KeyT'],
    nukeInstant: ['Shift+KeyT'],
    restartLevel: ['Backspace'],
    panLeft: ['ArrowLeft'],
    panRight: ['ArrowRight'],
    panUp: ['ArrowUp'],
    panDown: ['ArrowDown'],
    panBoost: ['ShiftLeft', 'ShiftRight'],
    zoomIn: ['KeyZ'],
    zoomOut: ['KeyX'],
    zoomReset: ['KeyV'],
    cycleSkillNext: ['Tab'],
    cycleSkillPrev: ['Shift+Tab'],
    applySkillToSelected: ['KeyK'],
    toggleDebug: ['Backslash'],
    speedDown: ['Minus', 'NumpadSubtract', 'Alt+Equal', 'Alt+NumpadAdd'],
    speedDownFast: ['Shift+Minus', 'Shift+NumpadSubtract', 'Alt+Shift+Equal', 'Alt+Shift+NumpadAdd'],
    speedUp: ['Equal', 'NumpadAdd'],
    speedUpFast: ['Shift+Equal', 'Shift+NumpadAdd'],
    levelPrev: ['Comma'],
    levelNext: ['Period'],
    levelGroupPrev: ['Shift+Comma'],
    levelGroupNext: ['Shift+Period'],
    editorToggle: ['Shift+Backquote'],
    editorToolSelect: ['KeyS'],
    editorToolTerrain: ['KeyT'],
    editorToolGadget: ['KeyG'],
    editorToolTrigger: ['KeyR'],
    editorToolEntrance: ['KeyE'],
    editorToolExit: ['KeyX'],
    editorToolSteel: ['KeyF'],
    editorToolBrush: ['KeyB'],
    editorToolEraser: ['KeyD'],
    editorCopy: ['Ctrl+KeyC'],
    editorPaste: ['Ctrl+KeyV'],
    editorDuplicate: ['Ctrl+KeyD'],
    editorNudgeLeft: ['ArrowLeft'],
    editorNudgeRight: ['ArrowRight'],
    editorNudgeUp: ['ArrowUp'],
    editorNudgeDown: ['ArrowDown'],
    editorNudgeLeftFast: ['Shift+ArrowLeft'],
    editorNudgeRightFast: ['Shift+ArrowRight'],
    editorNudgeUpFast: ['Shift+ArrowUp'],
    editorNudgeDownFast: ['Shift+ArrowDown'],
    editorSnapSelection: ['Ctrl+KeyG'],
    editorTogglePlaytest: ['KeyP'],
    editorUndo: ['Ctrl+KeyZ'],
    editorRedo: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'],
    editorDelete: ['Delete', 'Backspace']
  })
});

const MODIFIER_ALIASES = new Map([
  ['shift', 'shift'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['alt', 'alt'],
  ['option', 'alt'],
  ['meta', 'meta'],
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['win', 'meta'],
  ['super', 'meta']
]);

const normalizeCodeToken = (token) => {
  const trimmed = token.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower.length === 1) {
    if (lower >= 'a' && lower <= 'z') {
      return `Key${lower.toUpperCase()}`;
    }
    if (lower >= '0' && lower <= '9') {
      return `Digit${lower}`;
    }
  }
  if (lower.startsWith('key') && lower.length === 4) {
    return `Key${lower[3].toUpperCase()}`;
  }
  if (lower.startsWith('digit') && lower.length === 6) {
    return `Digit${lower[5]}`;
  }
  return trimmed;
};

const parseChord = (value) => {
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  let code = null;
  const spec = {
    shift: false,
    ctrl: false,
    alt: false,
    meta: false
  };
  for (const part of parts) {
    const lower = part.toLowerCase();
    const modifier = MODIFIER_ALIASES.get(lower);
    if (modifier) {
      spec[modifier] = true;
      continue;
    }
    if (code) return null;
    code = normalizeCodeToken(part);
  }
  if (!code) return null;
  spec.code = code;
  spec.specificity = (spec.shift ? 1 : 0)
    + (spec.ctrl ? 1 : 0)
    + (spec.alt ? 1 : 0)
    + (spec.meta ? 1 : 0);
  return spec;
};

const normalizeBindingEntry = (entry) => {
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  if (typeof entry === 'string') return [entry];
  return [];
};

const normalizeBindings = (bindings) => {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    return {};
  }
  return bindings;
};

const mergeKeybindingConfig = (base, overrides = null) => {
  const merged = {
    version: base.version,
    bindings: { ...base.bindings }
  };
  if (!overrides || typeof overrides !== 'object') return merged;
  if (Number.isFinite(overrides.version)) {
    merged.version = overrides.version;
  }
  const bindingOverrides = normalizeBindings(overrides.bindings);
  for (const [action, entry] of Object.entries(bindingOverrides)) {
    merged.bindings[action] = entry;
  }
  return merged;
};

const parseKeybindingConfig = (jsonString) => {
  if (typeof jsonString !== 'string') return null;
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return null;
  }
};

const isModifierKey = (code, key) => code === `${key}Left` || code === `${key}Right`;

const normalizeEventModifiers = (event) => {
  const code = event?.code || '';
  return {
    shift: isModifierKey(code, 'Shift') ? false : !!event.shiftKey,
    ctrl: isModifierKey(code, 'Control') ? false : !!event.ctrlKey,
    alt: isModifierKey(code, 'Alt') ? false : !!event.altKey,
    meta: isModifierKey(code, 'Meta') ? false : !!event.metaKey
  };
};

const isExactMatch = (spec, mods) => (
  spec.shift === mods.shift
  && spec.ctrl === mods.ctrl
  && spec.alt === mods.alt
  && spec.meta === mods.meta
);

const isShiftFallbackMatch = (spec, mods) => {
  if (spec.ctrl || spec.alt || spec.meta) return false;
  if (spec.shift && !mods.shift) return false;
  return true;
};

class KeybindingRegistry {
  constructor(config = DEFAULT_KEYBINDINGS) {
    this._bindingsByCode = new Map();
    this._bindingsByAction = new Map();
    this.setConfig(config);
  }

  setConfig(config) {
    const merged = mergeKeybindingConfig(DEFAULT_KEYBINDINGS, config);
    this.config = merged;
    this._bindingsByCode.clear();
    this._bindingsByAction.clear();
    const bindings = normalizeBindings(merged.bindings);
    for (const [action, entry] of Object.entries(bindings)) {
      const rawBindings = normalizeBindingEntry(entry);
      if (!rawBindings.length) continue;
      const specs = [];
      for (const chord of rawBindings) {
        const spec = parseChord(chord);
        if (!spec) continue;
        specs.push(spec);
        const list = this._bindingsByCode.get(spec.code) || [];
        list.push({ action, spec });
        this._bindingsByCode.set(spec.code, list);
      }
      if (specs.length) {
        this._bindingsByAction.set(action, specs);
      }
    }
  }

  getBindingsForAction(action) {
    return this._bindingsByAction.get(action) || [];
  }

  getActionsForEvent(event) {
    const code = event?.code;
    if (!code) return [];
    const list = this._bindingsByCode.get(code);
    if (!list || list.length === 0) return [];
    const mods = normalizeEventModifiers(event);
    const exact = list.filter(({ spec }) => isExactMatch(spec, mods));
    if (exact.length) return exact.map(({ action }) => action);
    if (mods.ctrl || mods.alt || mods.meta) return [];
    const fallback = list.filter(({ spec }) => isShiftFallbackMatch(spec, mods));
    return fallback.map(({ action }) => action);
  }
}

export {
  DEFAULT_KEYBINDINGS,
  KeybindingRegistry,
  mergeKeybindingConfig,
  parseKeybindingConfig
};
