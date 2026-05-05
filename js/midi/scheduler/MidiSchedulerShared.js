const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIDI_BITS_PER_SECOND = 31250;
const MIDI_BYTES_PER_SECOND = MIDI_BITS_PER_SECOND / 8;
const MIDI_MESSAGE_BYTES = 3;
const MAX_RATE_ENTRIES = 4096;
const toFiniteNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const toPositiveInt = (value, fallback) => {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
};
const normalizeChannelNumber = (value, fallback = 1) => {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return clamp(numeric, 1, 16);
};

export {
  MIDI_BYTES_PER_SECOND,
  MIDI_MESSAGE_BYTES,
  MAX_RATE_ENTRIES,
  clamp,
  normalizeChannelNumber,
  toFiniteNumber,
  toPositiveInt
};
