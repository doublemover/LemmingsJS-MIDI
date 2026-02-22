const midiStorageKeys = {
  inputId: 'lemmings.midi.inputId',
  outputId: 'lemmings.midi.outputId',
  viewPan: 'lemmings.midi.viewPan',
  enabled: 'lemmings.midi.enabled',
  inputChannel: 'lemmings.midi.inputChannel',
  adsrTarget: 'lemmings.midi.adsrTarget',
  overrides: 'lemmings.midi.overrides',
  schemaHash: 'lemmings.midi.schemaHash',
  panelCollapsed: 'lemmings.midi.panelCollapsed',
  tabLeft: 'lemmings.midi.tabLeft',
  tabRight: 'lemmings.midi.tabRight',
  sectionStates: 'lemmings.midi.sectionStates'
};

const isPlainObject = (value) => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const sanitizeStoredValue = (value, depth = 0) => {
  if (depth > 12) return undefined;
  if (value === null) return null;
  const valueType = typeof value;
  if (valueType === 'string') return value.slice(0, 512);
  if (valueType === 'boolean') return value;
  if (valueType === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const out = [];
    const maxItems = Math.min(value.length, 256);
    for (let i = 0; i < maxItems; i += 1) {
      const next = sanitizeStoredValue(value[i], depth + 1);
      if (next !== undefined) out.push(next);
    }
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key.length > 96) continue;
      const next = sanitizeStoredValue(entry, depth + 1);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return undefined;
};

const migrateMidiOverrides = (value) => {
  const sanitized = sanitizeStoredValue(value);
  if (!isPlainObject(sanitized)) return {};
  const overrides = { ...sanitized };

  if (isPlainObject(overrides.repeat)) {
    const repeat = { ...overrides.repeat };
    const spacingTicks = repeat.spacingTicks;
    if (Number.isFinite(spacingTicks) && !Number.isFinite(repeat.windowBeats)) {
      repeat.windowBeats = spacingTicks;
    }
    overrides.repeat = repeat;
  }

  if (isPlainObject(overrides.input)) {
    const input = { ...overrides.input };
    if (typeof input.channel === 'string') {
      const normalized = input.channel.trim().toLowerCase();
      if (normalized === 'omni') {
        input.channel = 'omni';
      } else {
        const parsed = Number(normalized);
        input.channel = Number.isFinite(parsed) ? Math.max(1, Math.min(16, Math.trunc(parsed))) : 'omni';
      }
    } else if (Number.isFinite(input.channel)) {
      input.channel = Math.max(1, Math.min(16, Math.trunc(input.channel)));
    } else if (input.channel !== null && input.channel !== undefined) {
      delete input.channel;
    }
    overrides.input = input;
  }

  if (isPlainObject(overrides.position)) {
    const position = { ...overrides.position };
    if (Array.isArray(position.mappings)) {
      position.mappings = position.mappings
        .filter(isPlainObject)
        .slice(0, 256);
    } else if (position.mappings != null) {
      delete position.mappings;
    }
    overrides.position = position;
  }

  return overrides;
};

const readStoredSectionStates = (storage) => {
  const raw = readStoredJson(storage, midiStorageKeys.sectionStates);
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.length > 96) continue;
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
};

const readStoredMidiOverrides = (storage) => {
  const raw = readStoredJson(storage, midiStorageKeys.overrides);
  return migrateMidiOverrides(raw);
};

const readStoredMidiId = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch (e) {
    return null;
  }
};

const storeMidiId = (storage, key, value) => {
  try {
    if (value) {
      storage?.setItem(key, value);
    } else {
      storage?.removeItem(key);
    }
  } catch (e) {
    // Ignore storage failures (private mode, blocked access, etc.).
  }
};

const readStoredJson = (storage, key, options = {}) => {
  try {
    const raw = storage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof options.guard === 'function') {
      return options.guard(parsed);
    }
    return parsed;
  } catch (e) {
    return null;
  }
};

const storeJson = (storage, key, value) => {
  try {
    if (value == null) {
      storage?.removeItem(key);
    } else {
      storage?.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    // ignore
  }
};

export {
  midiStorageKeys,
  migrateMidiOverrides,
  readStoredMidiOverrides,
  readStoredSectionStates,
  readStoredMidiId,
  storeMidiId,
  readStoredJson,
  storeJson
};
