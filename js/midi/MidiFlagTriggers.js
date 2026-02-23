const MIDI_FLAG_TRIGGER_BASE = 1000;
const MIDI_FLAG_TRIGGER_MAX = 9999;

/**
 * Parse and clamp a MIDI flag id to the supported trigger id space.
 * Returns null when the input cannot map to a valid positive flag id.
 */
const clampMidiFlagId = (value) => {
  if (!Number.isFinite(value)) return null;
  const id = Math.trunc(value);
  if (id < 1) return null;
  if (id > MIDI_FLAG_TRIGGER_MAX) return MIDI_FLAG_TRIGGER_MAX;
  return id;
};

/**
 * Convert a MIDI flag id into a trigger type used by MIDI mapping lookups.
 */
const toMidiFlagTriggerType = (flagId) => {
  const id = clampMidiFlagId(flagId);
  if (!id) return null;
  return MIDI_FLAG_TRIGGER_BASE + id;
};

/**
 * Convert a trigger type back to its MIDI flag id when it is in the MIDI
 * flag trigger range.
 */
const fromMidiFlagTriggerType = (triggerType) => {
  if (!Number.isFinite(triggerType)) return null;
  const value = Math.trunc(triggerType);
  const maxTriggerType = MIDI_FLAG_TRIGGER_BASE + MIDI_FLAG_TRIGGER_MAX;
  if (value <= MIDI_FLAG_TRIGGER_BASE || value > maxTriggerType) return null;
  return value - MIDI_FLAG_TRIGGER_BASE;
};

/**
 * Check whether a trigger type belongs to the MIDI flag trigger namespace.
 */
const isMidiFlagTriggerType = (triggerType) => fromMidiFlagTriggerType(triggerType) !== null;

export {
  MIDI_FLAG_TRIGGER_BASE,
  MIDI_FLAG_TRIGGER_MAX,
  clampMidiFlagId,
  toMidiFlagTriggerType,
  fromMidiFlagTriggerType,
  isMidiFlagTriggerType
};
