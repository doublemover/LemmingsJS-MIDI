const midiStorageKeys = {
  inputId: 'lemmings.midi.inputId',
  outputId: 'lemmings.midi.outputId',
  viewPan: 'lemmings.midi.viewPan',
  enabled: 'lemmings.midi.enabled',
  inputChannel: 'lemmings.midi.inputChannel',
  adsrTarget: 'lemmings.midi.adsrTarget',
  overrides: 'lemmings.midi.overrides',
  schemaHash: 'lemmings.midi.schemaHash',
  panelCollapsed: 'lemmings.midi.panelCollapsed'
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

const readStoredJson = (storage, key) => {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
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
  readStoredMidiId,
  storeMidiId,
  readStoredJson,
  storeJson
};
