import { migrateArpConfig } from './midiUiDomain.js';

const midiStorageKeys = {
  storageVersion: 'lemmings.midi.storageVersion',
  inputId: 'lemmings.midi.inputId',
  outputId: 'lemmings.midi.outputId',
  viewPan: 'lemmings.midi.viewPan',
  enabled: 'lemmings.midi.enabled',
  inputChannel: 'lemmings.midi.inputChannel',
  adsrTarget: 'lemmings.midi.adsrTarget',
  overrides: 'lemmings.midi.overrides',
  midiIntent: 'lemmings.midi.intent',
  schemaHash: 'lemmings.midi.schemaHash',
  panelCollapsed: 'lemmings.midi.panelCollapsed',
  tabLeft: 'lemmings.midi.tabLeft',
  tabRight: 'lemmings.midi.tabRight',
  sectionStates: 'lemmings.midi.sectionStates'
};
const MIDI_STORAGE_VERSION = 3;
const migratedMidiStorages = new WeakSet();
const MAX_LEARN_TARGET_LENGTH = 128;

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

  const migrateMappingEntries = (group) => {
    if (!isPlainObject(group)) return group;
    const out = {};
    for (const [key, entry] of Object.entries(group)) {
      if (!isPlainObject(entry)) continue;
      const next = { ...entry };
      if (next.arp != null) {
        const migratedArp = migrateArpConfig(next.arp);
        if (migratedArp) {
          next.arp = migratedArp;
        } else {
          delete next.arp;
        }
      }
      out[key] = next;
    }
    return out;
  };
  if (isPlainObject(overrides.sfx)) {
    overrides.sfx = migrateMappingEntries(overrides.sfx);
  }
  if (isPlainObject(overrides.triggers)) {
    overrides.triggers = migrateMappingEntries(overrides.triggers);
  }

  return overrides;
};

const normalizeMidiIntentPayload = (value) => {
  const source = isPlainObject(value) ? value : {};
  const learnSource = isPlainObject(source.learn) ? source.learn : null;
  const learnTarget = typeof learnSource?.target === 'string'
    ? learnSource.target.trim().slice(0, MAX_LEARN_TARGET_LENGTH)
    : '';
  const learn = learnTarget
    ? {
      target: learnTarget,
      lastCapture: Number.isFinite(learnSource?.lastCapture) ? Math.max(0, Math.min(127, Math.trunc(learnSource.lastCapture))) : undefined,
      armedAt: Number.isFinite(learnSource?.armedAt) ? Math.trunc(learnSource.armedAt) : undefined,
      capturedAt: Number.isFinite(learnSource?.capturedAt) ? Math.trunc(learnSource.capturedAt) : undefined
    }
    : null;
  if (learn && learn.lastCapture === undefined) delete learn.lastCapture;
  if (learn && learn.armedAt === undefined) delete learn.armedAt;
  if (learn && learn.capturedAt === undefined) delete learn.capturedAt;
  const lastIntentType = typeof source.lastIntentType === 'string'
    ? source.lastIntentType.slice(0, 64)
    : null;
  return {
    revision: Number.isFinite(source.revision) ? Math.max(0, Math.trunc(source.revision)) : 0,
    overrides: migrateMidiOverrides(source.overrides),
    learn,
    lastIntentType
  };
};

const normalizeSectionStatesPayload = (value) => {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > 96) continue;
    if (typeof entry === 'boolean') {
      out[key] = entry;
    }
  }
  return out;
};

const readStoredSectionStates = (storage) => {
  ensureMidiStorageMigrated(storage);
  const raw = readStoredJson(storage, midiStorageKeys.sectionStates);
  return normalizeSectionStatesPayload(raw);
};

const readStoredMidiOverrides = (storage) => {
  ensureMidiStorageMigrated(storage);
  const raw = readStoredJson(storage, midiStorageKeys.overrides);
  return migrateMidiOverrides(raw);
};

const readStoredMidiIntentState = (storage) => {
  ensureMidiStorageMigrated(storage);
  const rawIntent = readStoredJson(storage, midiStorageKeys.midiIntent);
  if (rawIntent != null) {
    return normalizeMidiIntentPayload(rawIntent);
  }
  return normalizeMidiIntentPayload({
    overrides: readStoredJson(storage, midiStorageKeys.overrides)
  });
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

const storeMidiIntentState = (storage, value) => {
  const normalized = normalizeMidiIntentPayload(value);
  storeJson(storage, midiStorageKeys.midiIntent, normalized);
  storeJson(storage, midiStorageKeys.overrides, normalized.overrides);
};

function ensureMidiStorageMigrated(storage) {
  if (!storage || typeof storage !== 'object') return;
  if (migratedMidiStorages.has(storage)) return;
  migratedMidiStorages.add(storage);

  const rawVersion = readStoredMidiId(storage, midiStorageKeys.storageVersion);
  const version = Number(rawVersion);
  if (Number.isFinite(version) && version >= MIDI_STORAGE_VERSION) {
    return;
  }

  const overridesRaw = readStoredJson(storage, midiStorageKeys.overrides);
  const intentRaw = readStoredJson(storage, midiStorageKeys.midiIntent);
  const sectionStatesRaw = readStoredJson(storage, midiStorageKeys.sectionStates);
  const migratedOverrides = migrateMidiOverrides(overridesRaw);
  const migratedIntent = normalizeMidiIntentPayload(
    intentRaw != null ? intentRaw : { overrides: migratedOverrides }
  );
  const migratedSectionStates = normalizeSectionStatesPayload(sectionStatesRaw);

  storeJson(storage, midiStorageKeys.overrides, migratedIntent.overrides);
  storeJson(storage, midiStorageKeys.midiIntent, migratedIntent);
  storeJson(storage, midiStorageKeys.sectionStates, migratedSectionStates);
  storeMidiId(storage, midiStorageKeys.storageVersion, String(MIDI_STORAGE_VERSION));
}

export {
  midiStorageKeys,
  migrateMidiOverrides,
  normalizeMidiIntentPayload,
  readStoredMidiOverrides,
  readStoredMidiIntentState,
  readStoredSectionStates,
  readStoredMidiId,
  storeMidiId,
  readStoredJson,
  storeJson,
  storeMidiIntentState
};
