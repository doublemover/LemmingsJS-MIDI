const MAX_MIDI_AUTOMATION_SPANS = 64;
const MAX_MIDI_AUTOMATION_SPAN_STATES = 2048;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const optionalId = value => value == null || value === '' ? null : clamp(Math.round(number(value, 0)), 0, 65535);
const SPAN_TARGET_RANGES = Object.freeze({ note: [-48, 48], velocity: [1, 127], pan: [-127, 127], duration: [1, 960],
  timbre: [0, 127], attack: [0, 2], decay: [0, 2], sustain: [0.25, 2], release: [0, 2] });
const sanitizeMidiAutomationSpan = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const domain = value.domain === 'distance' ? 'distance' : 'beats';
  const laneScope = ['lane', 'group'].includes(value.laneScope) ? value.laneScope : 'global';
  const laneStart = clamp(Math.round(number(value.laneStart, 0)), 0, 1023);
  const condition = value.condition || {};
  const every = clamp(Math.round(number(condition.every, 1)), 1, 1024);
  return { domain, start: clamp(number(value.start, 0), 0, 1e9), duration: clamp(number(value.duration, domain === 'beats' ? 4 : 256), domain === 'beats' ? 1 / 1024 : 1, 1e6),
    loop: value.loop === true, shape: value.shape === 'ramp' ? 'ramp' : 'constant', laneScope, laneStart,
    laneEnd: laneScope === 'group' ? clamp(Math.round(number(value.laneEnd, laneStart)), laneStart, 1023) : laneStart,
    priority: clamp(Math.round(number(value.priority, 0)), -100, 100), condition: {
      sfxId: optionalId(condition.sfxId), triggerType: optionalId(condition.triggerType),
      unit: ['bar', 'pass'].includes(condition.unit) ? condition.unit : 'event', every,
      phase: clamp(Math.round(number(condition.phase, 0)), 0, every - 1) } };
};
const clampMidiAutomationSpanValue = (target, value, fallback = 0) => {
  const [low, high] = SPAN_TARGET_RANGES[target] || SPAN_TARGET_RANGES.velocity;
  return clamp(number(value, fallback), low, high);
};
/** Pure preview; a pass is a traversal of this span, independent of event and bar counters. */
const previewMidiAutomationSpan = (entry, position) => {
  const span = entry?.span;
  if (!span || !Number.isFinite(position) || !Number.isFinite(span.start) || !(span.duration > 0) || !Number.isFinite(span.duration)) return null;
  const relative = position - span.start;
  const active = relative >= 0 && (span.loop === true || relative < span.duration);
  const spanPass = relative < 0 ? 0 : Math.min(Number.MAX_SAFE_INTEGER, Math.floor(relative / span.duration) + 1);
  const phase = relative < 0 ? 0 : span.loop === true ? (relative % span.duration) / span.duration : clamp(relative / span.duration, 0, 1);
  const low = clampMidiAutomationSpanValue(entry.target, entry.min);
  const high = clampMidiAutomationSpanValue(entry.target, entry.max, low);
  return Object.freeze({ active, phase, spanPass, value: span.shape === 'ramp' ? low + (high - low) * phase : low, position });
};
export { MAX_MIDI_AUTOMATION_SPANS, MAX_MIDI_AUTOMATION_SPAN_STATES, SPAN_TARGET_RANGES,
  sanitizeMidiAutomationSpan, clampMidiAutomationSpanValue, previewMidiAutomationSpan };
