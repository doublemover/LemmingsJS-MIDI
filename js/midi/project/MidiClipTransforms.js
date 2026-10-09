const MAX_CLIP_CELL_VOICES = 8;
const MAX_CLIP_TRANSFORM_LAYERS = 4;
const MAX_CLIP_CELL_OUTPUTS = 16;
const MAX_CLIP_PHRASE_OUTPUTS = 256;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const integer = (value, fallback) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
const counterUnit = value => ['event', 'bar', 'pass'].includes(value) ? value : 'event';
const clipCounter = (unit, eventCount, passCount, barCount) => unit === 'bar' ? barCount : unit === 'pass' ? passCount : eventCount;
const sanitizeClipCondition = condition => {
  const every = clamp(integer(condition?.every, 1), 1, 64);
  return { unit: counterUnit(condition?.unit), every, phase: clamp(integer(condition?.phase, 0), 0, every - 1) };
};
const clipConditionMatches = (condition, eventCount, passCount, barCount = 1) => {
  const every = Math.max(1, condition?.every || 1);
  return clipCounter(condition?.unit, eventCount, passCount, barCount) % every === (condition?.phase || 0);
};
const sanitizeClipVoices = voices => Array.isArray(voices) ? voices.slice(0, MAX_CLIP_CELL_VOICES)
  .filter(voice => voice && voice.note != null && Number.isFinite(Number(voice.note)))
  .map(voice => ({ note: clamp(integer(voice.note, 60), 0, 127),
    velocity: voice.velocity == null ? null : clamp(integer(voice.velocity, 80), 1, 127),
    durationTicks: voice.durationTicks == null ? null : clamp(integer(voice.durationTicks, 6), 1, 960) })) : null;
const getMidiClipVoices = step => Array.isArray(step?.voices) ? step.voices.slice(0, MAX_CLIP_CELL_VOICES)
  : Number.isFinite(step?.note) ? [{ note: step.note, velocity: step.velocity, durationTicks: step.durationTicks }] : [];
const sanitizeClipTransformLayers = layers => Array.isArray(layers) ? layers.slice(0, MAX_CLIP_TRANSFORM_LAYERS)
  .filter(layer => layer && typeof layer === 'object')
  .map(layer => ({ type: layer.type === 'repeat' ? 'repeat' : 'pitch', enabled: layer.enabled !== false,
    condition: sanitizeClipCondition(layer.condition),
    ...(layer.type === 'repeat' ? { count: clamp(integer(layer.count, 2), 1, 8), spacingTicks: clamp(integer(layer.spacingTicks, 1), 1, 8),
      transpose: clamp(integer(layer.transpose, 0), -24, 24) }
      : { transpose: clamp(integer(layer.transpose, 0), -48, 48), octave: clamp(integer(layer.octave, 0), -4, 4),
        interval: clamp(integer(layer.interval, 0), -12, 12), span: clamp(integer(layer.span, 1), 1, 16), unit: counterUnit(layer.unit) }) })) : null;
const applyMidiClipTransforms = (step, eventCount, passCount, barCount = 1) => {
  if (!Number.isFinite(step?.note)) return step;
  const layer = step.transforms || {};
  const offset = (Math.max(1, clipCounter(layer.unit, eventCount, passCount, barCount)) - 1) % Math.max(1, layer.span || 1);
  return { ...step, note: clamp(step.note + (layer.transpose || 0) + 12 * (layer.octave || 0) + offset * (layer.interval || 0), 0, 127) };
};
const expandMidiClipCell = (step, eventCount, passCount, barCount = 1) => {
  let notes = getMidiClipVoices(step).filter(voice => Number.isFinite(voice.note)).map((voice, voiceIndex) => ({
    ...applyMidiClipTransforms({ ...step, ...voice, velocity: voice.velocity ?? step.velocity,
      durationTicks: voice.durationTicks ?? step.durationTicks }, eventCount, passCount, barCount), voiceIndex, offsetTicks: 0 }));
  let truncated = 0;
  for (const layer of sanitizeClipTransformLayers(step?.transformLayers) || []) {
    if (!layer.enabled || !clipConditionMatches(layer.condition, eventCount, passCount, barCount)) continue;
    if (layer.type === 'pitch') notes = notes.map(note => applyMidiClipTransforms({ ...note, transforms: layer }, eventCount, passCount, barCount));
    else {
      const expanded = [], total = notes.length * layer.count;
      for (let repeat = 0; repeat < layer.count; repeat++) for (const note of notes) {
        if (expanded.length >= MAX_CLIP_CELL_OUTPUTS) continue;
        expanded.push({ ...note, note: clamp(note.note + repeat * layer.transpose, 0, 127),
          offsetTicks: note.offsetTicks + repeat * layer.spacingTicks });
      }
      truncated += Math.max(0, total - expanded.length); notes = expanded;
    }
  }
  notes.sort((a, b) => a.offsetTicks - b.offsetTicks || a.voiceIndex - b.voiceIndex);
  return { notes, truncated };
};
export { MAX_CLIP_CELL_VOICES, MAX_CLIP_TRANSFORM_LAYERS, MAX_CLIP_CELL_OUTPUTS, MAX_CLIP_PHRASE_OUTPUTS,
  sanitizeClipCondition, sanitizeClipVoices, getMidiClipVoices, sanitizeClipTransformLayers,
  clipConditionMatches, applyMidiClipTransforms, expandMidiClipCell };
