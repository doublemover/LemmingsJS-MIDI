import {
  createMidiProjectFromMidiConfig,
  sanitizeMidiProject
} from './MidiProject.js';

const PROJECT_STORAGE_KEY = 'lemmings.midi.project.v1';

const LEGACY_MIDI_STORAGE_KEYS = Object.freeze([
  'lemmings.midi.intent',
  'lemmings.midi.overrides',
  'lemmings.midi.inputId',
  'lemmings.midi.outputId',
  'lemmings.midi.enabled',
  'lemmings.midi.inputChannel',
  'lemmings.midi.viewPan',
  'lemmings.midi.adsrTarget',
  'lemmings.midi.tabLeft',
  'lemmings.midi.tabRight',
  'lemmings.midi.sectionStates',
  'lemmings.midi.schemaHash',
  'lemmings.midi.storageVersion',
  'lemmings.midi.panelCollapsed',
  'lemmings.midi.ui.audition'
]);

const safeGetItem = (storage, key) => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (e) {
    return null;
  }
};

const safeSetItem = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
  } catch (e) {
    // Storage is optional; callers still get a sanitized in-memory project.
  }
};

const safeRemoveItem = (storage, key) => {
  try {
    storage?.removeItem?.(key);
  } catch (e) {
    // Storage cleanup is best-effort for private browsing and test doubles.
  }
};

const cleanupLegacyMidiProjectStorage = (storage) => {
  for (const key of LEGACY_MIDI_STORAGE_KEYS) {
    safeRemoveItem(storage, key);
  }
};

const saveMidiProject = (storage, project) => {
  const clean = sanitizeMidiProject(project);
  safeSetItem(storage, PROJECT_STORAGE_KEY, JSON.stringify(clean));
  return clean;
};

const readStoredMidiProject = (storage) => {
  const raw = safeGetItem(storage, PROJECT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return sanitizeMidiProject(JSON.parse(raw));
  } catch (e) {
    return null;
  }
};

const loadMidiProject = (storage, factoryConfig = {}) => {
  cleanupLegacyMidiProjectStorage(storage);
  return readStoredMidiProject(storage) || createMidiProjectFromMidiConfig(factoryConfig);
};

const resetMidiProjectStorage = (storage, factoryConfig = {}) => {
  cleanupLegacyMidiProjectStorage(storage);
  const project = createMidiProjectFromMidiConfig(factoryConfig);
  return saveMidiProject(storage, project);
};

const clearMidiProjectStorage = (storage) => {
  cleanupLegacyMidiProjectStorage(storage);
  safeRemoveItem(storage, PROJECT_STORAGE_KEY);
};

export {
  LEGACY_MIDI_STORAGE_KEYS,
  PROJECT_STORAGE_KEY,
  cleanupLegacyMidiProjectStorage,
  clearMidiProjectStorage,
  loadMidiProject,
  readStoredMidiProject,
  resetMidiProjectStorage,
  saveMidiProject
};
