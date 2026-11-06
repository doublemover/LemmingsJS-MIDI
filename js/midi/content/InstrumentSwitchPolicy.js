import { cloneData } from '../../core/CanonicalData.js';
export const INSTRUMENT_SWITCH_MODES = Object.freeze(['new-notes-only', 'crossfade-held', 'rearticulate-held']);
export const INSTRUMENT_SWITCH_BOUNDARIES = Object.freeze(['immediate', 'next-beat', 'next-bar']);
export function validateInstrumentSwitchPolicy(raw = null) {
  const value = raw === null ? { version: 1, mode: 'new-notes-only', boundary: 'immediate', fadeSeconds: 0.02 } : cloneData(raw, { maxBytes: 4096, maxNodes: 64 });
  if (!value || Object.keys(value).some(key => !['version', 'mode', 'boundary', 'fadeSeconds'].includes(key)) || value.version !== 1 ||
      !INSTRUMENT_SWITCH_MODES.includes(value.mode) || !INSTRUMENT_SWITCH_BOUNDARIES.includes(value.boundary) || !Number.isFinite(value.fadeSeconds) || value.fadeSeconds < 0.005 || value.fadeSeconds > 0.2) throw new TypeError('Choose an authored note-switch policy, score boundary and bounded5–200ms fade.');
  return Object.freeze(value);
}
export function laneInstrumentSwitchPolicy(lane, definition = null) {
  const authored = validateInstrumentSwitchPolicy(definition?.voicePolicy?.switchPolicy || null);
  return validateInstrumentSwitchPolicy({ ...authored, mode: lane?.soundChangePolicy ?? authored.mode, boundary: lane?.soundChangeBoundary ?? authored.boundary,
    fadeSeconds: lane?.soundChangeFadeSeconds ?? authored.fadeSeconds });
}
export function instrumentSwitchFidelity(policy) {
  return policy.mode === 'new-notes-only' ? 'held-original-renderers-retained' : policy.mode === 'crossfade-held' ?
    'authored-crossfade-to-new-realizations;no-phase-or-sample-cursor-transfer' : 'authored-held-note-rearticulation;new-attack';
}
