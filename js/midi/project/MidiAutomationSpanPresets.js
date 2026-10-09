import { SoundEffectIds } from '../../game/SoundEvents.js';
const MIDI_AUTOMATION_SPAN_PRESETS = Object.freeze([
  Object.freeze({ id: 'span-relay', label: 'Relay - intensity, length and stereo', description: 'Three spans share an eight-beat loop: intensity rises, note length stays short, stereo sweeps on every second bar.' }),
  Object.freeze({ id: 'span-open-air', label: 'Open air - pitch, length and release', description: 'Three slow spans lift scale-safe pitch, lengthen notes and soften their release over sixteen beats.' }),
  Object.freeze({ id: 'span-tool-dialogue', label: 'Tool dialogue - bash, mine and construction', description: 'Separate sound conditions shape basher intensity, miner length and builder stereo; all three spans remain editable.' })
]);
const createMidiAutomationSpanBundle = (id, { domain = 'beats', laneStart = 0, laneEnd = null } = {}) => {
  if (!MIDI_AUTOMATION_SPAN_PRESETS.some(preset => preset.id === id)) return [];
  const distance = domain === 'distance', duration = distance ? 512 : id === 'span-open-air' ? 16 : 8;
  const entry = (name, target, min, max, condition = {}, shape = 'ramp') => ({ name, enabled: true, scope: 'global', target, min, max,
    span: { domain: distance ? 'distance' : 'beats', start: 0, duration, loop: true, shape,
      laneScope: laneEnd == null ? 'global' : laneEnd === laneStart ? 'lane' : 'group', laneStart, laneEnd: laneEnd ?? laneStart, priority: 0,
      condition: { sfxId: null, triggerType: null, unit: 'event', every: 1, phase: 0, ...condition } } });
  if (id === 'span-relay') return [entry('Relay intensity', 'velocity', 40, 80), entry('Relay short notes', 'duration', 3, 3, {}, 'constant'), entry('Relay stereo answer', 'pan', -48, 48, { unit: 'bar', every: 2 })];
  if (id === 'span-open-air') return [entry('Open-air scale lift', 'note', 0, 12), entry('Open-air length', 'duration', 3, 10), entry('Open-air release', 'release', 0.7, 1.4)];
  return [entry('Basher rising intensity', 'velocity', 44, 88, { sfxId: SoundEffectIds.BASH }), entry('Miner length answer', 'duration', 2, 5, { sfxId: SoundEffectIds.MINE }), entry('Builder stereo arch', 'pan', -42, 42, { sfxId: SoundEffectIds.BUILDER_STEP })];
};
export { MIDI_AUTOMATION_SPAN_PRESETS, createMidiAutomationSpanBundle };
