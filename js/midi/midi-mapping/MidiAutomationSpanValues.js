import { resolveScale, quantizeToScale, noteToFrequency } from './MidiMappingDomain.js';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const safeRange = (range, low, high) => ({ min: clamp(Number.isFinite(range?.min) ? range.min : low, low, high), max: clamp(Number.isFinite(range?.max) ? range.max : high, low, high) });
const applyMidiAutomationSpanValues = (spec, values, config) => {
  if (!values.size) return spec;
  const result = { ...spec }, value = target => values.get(target)?.value;
  const velocities = safeRange(config.velocityRange, 1, 127), duration = safeRange(config.durationTicks, 1, 960);
  if (values.has('note')) {
    const global = safeRange(config.noteRange, 0, 127), role = config.ensemble?.roles?.find(entry => entry.id === spec.ensembleRole)?.register;
    const low = Math.max(global.min, role?.min ?? 0), high = Math.min(global.max, role?.max ?? 127), scale = resolveScale(config.scale);
    if (low > high) return null;
    const pitch = original => {
      let wanted = original + value('note');
      if (!spec.percussion) wanted = quantizeToScale(wanted, scale);
      wanted = clamp(Math.round(wanted), low, high);
      if (spec.percussion) return wanted;
      let best = null, distance = Infinity;
      for (let candidate = Math.ceil(low); candidate <= high; candidate++) {
        if (!scale.degrees.includes(((candidate - scale.root) % 12 + 12) % 12)) continue;
        if (Math.abs(candidate - wanted) < distance) { best = candidate; distance = Math.abs(candidate - wanted); }
      }
      return best;
    };
    result.note = pitch(spec.note);
    if (Array.isArray(spec.notes)) result.notes = spec.notes.map(pitch);
    if (result.note == null || result.notes?.some(note => note == null)) return null;
    result.frequencyHz = noteToFrequency(result.note);
  }
  const altersVelocity = ['velocity', 'attack', 'decay'].some(target => values.has(target));
  if (altersVelocity) {
    let velocity = value('velocity') ?? spec.velocity ?? 64;
    if (values.has('attack')) velocity *= value('attack');
    if (values.has('decay')) velocity *= clamp(1 - value('decay') * 0.25, 0.1, 1);
    result.velocity = clamp(Math.round(velocity), velocities.min, velocities.max);
  }
  if (altersVelocity || values.has('release')) {
    const releaseRatio = (spec.releaseVelocity ?? spec.velocity ?? 64) / Math.max(1, spec.velocity ?? 64);
    result.releaseVelocity = clamp(Math.round((result.velocity ?? 64) * (value('release') ?? releaseRatio)), 1, 127);
  }
  if (values.has('duration') || values.has('sustain')) result.durationTicks = clamp(Math.round((value('duration') ?? spec.durationTicks ?? 1) * (value('sustain') ?? 1)), duration.min, duration.max);
  if (values.has('pan')) { result.spanPan = true; result.spanBasePan = spec.pan; result.pan = clamp(Math.round(value('pan')), -127, 127); result.spatialPan = false; }
  if (values.has('timbre')) { result.spanTimbre = true; result.spanBaseTimbre = spec.timbre; result.timbre = clamp(Math.round(value('timbre')), 0, 127); }
  return result;
};
export { applyMidiAutomationSpanValues };
