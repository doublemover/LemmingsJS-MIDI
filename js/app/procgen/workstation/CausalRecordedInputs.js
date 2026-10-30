import { journalError } from './CausalJournalCanonical.js';

const fields = {
  'world-speed': ['version', 'kind', 'speedFactor'],
  'transport-state': ['version', 'kind', 'playing', 'speedFactor'],
  'intervention-cancel': ['version', 'kind', 'commandId'],
  'instrument-performance': ['version', 'kind', 'change', 'mapping'],
  'physical-feedback-boundary': ['version', 'kind', 'commands', 'outcomes', 'cancelIds', 'state'],
  'external-observation': ['version', 'kind', 'sourceId', 'effect', 'timestamp', 'bytes']
};
const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const only = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const speed = (value, paused = false) => Number.isFinite(value) && (paused ? value >= 0 : value > 0) && value <= 1000000;
const refuse = message => { throw journalError('unsupported-recorded-input', message); };

export function validateRecordedCausalInput(input, replayVersion) {
  if (!plain(input) || !Object.hasOwn(fields, input.kind) || !only(input, fields[input.kind]) ||
      input.version !== 1 && !(input.version === 2 && input.kind === 'transport-state')) refuse('Unknown input schema cannot be substituted during replay.');
  if (input.kind === 'world-speed' && !speed(input.speedFactor)) refuse('Recorded world speed is outside its finite positive range.');
  if (input.kind === 'transport-state') {
    if (typeof input.playing !== 'boolean' || input.version === 1 && Object.hasOwn(input, 'speedFactor') ||
        input.version === 2 && (replayVersion !== 2 || !speed(input.speedFactor, true))) refuse('A transport observation requires its versioned physical clock state.');
  }
  if (input.kind === 'intervention-cancel' && !id(input.commandId)) refuse('Recorded cancellation requires a bounded command identity.');
  if (input.kind === 'external-observation' && (!id(input.sourceId) || input.effect !== 'observation-only' ||
      Object.hasOwn(input, 'timestamp') && (!Number.isFinite(input.timestamp) || Math.abs(input.timestamp) > Number.MAX_SAFE_INTEGER) ||
      Object.hasOwn(input, 'bytes') && (!Array.isArray(input.bytes) || input.bytes.length > 65536 || input.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)))) {
    refuse('An external observation requires bounded source bytes and a finite source timestamp; its effect must be observation-only.');
  }
  return input;
}

export function validateRecordedCausalTimeline(input) {
  if (!only(input, ['version', 'kind', 'bpm']) || input.version !== 1 || input.kind !== 'tempo' || !Number.isFinite(input.bpm) || input.bpm <= 0 || input.bpm > 1000000)
    refuse('A recorded tempo requires its supported schema and finite positive BPM.');
  return input;
}
