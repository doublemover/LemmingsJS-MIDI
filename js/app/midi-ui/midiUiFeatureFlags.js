import { readStoredMidiId } from './midiUiStorage.js';

const MIDI_UI_FEATURE_FLAG_DEFAULTS = Object.freeze({
  expressiveControls: true,
  audition: true
});

const parseFlagValue = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
};

const createDefaultMidiUiFeatureFlags = () => ({ ...MIDI_UI_FEATURE_FLAG_DEFAULTS });

/**
 * @param {{
 *   getConfig?: () => any,
 *   storage?: Storage | null,
 *   window?: any
 * }} [options]
 */
const resolveMidiUiFeatureFlags = ({
  getConfig,
  storage,
  window
} = {}) => {
  const config = getConfig?.() || {};
  const configFlags = config?.ui?.featureFlags?.midiUi
    || config?.featureFlags?.midiUi
    || {};
  const query = typeof URLSearchParams === 'function'
    ? new URLSearchParams(window?.location?.search || '')
    : null;
  const readQueryFlag = (...names) => {
    if (!query) return null;
    for (const name of names) {
      if (!query.has(name)) continue;
      return query.get(name);
    }
    return null;
  };
  const resolveFlag = ({
    configValue,
    defaultValue,
    queryNames,
    storageKey
  }) => {
    const configDefault = typeof configValue === 'boolean' ? configValue : defaultValue;
    const queryRaw = readQueryFlag(...queryNames);
    if (queryRaw != null) {
      return parseFlagValue(queryRaw, configDefault);
    }
    const storedRaw = readStoredMidiId(storage, storageKey);
    if (storedRaw != null) {
      return parseFlagValue(storedRaw, configDefault);
    }
    return configDefault;
  };
  return {
    expressiveControls: true,
    audition: resolveFlag({
      configValue: configFlags.audition,
      defaultValue: MIDI_UI_FEATURE_FLAG_DEFAULTS.audition,
      queryNames: ['midiAudition', 'mau'],
      storageKey: 'lemmings.midi.ui.audition'
    })
  };
};

export {
  MIDI_UI_FEATURE_FLAG_DEFAULTS,
  createDefaultMidiUiFeatureFlags,
  resolveMidiUiFeatureFlags
};
