import { SoundEffectIds } from '../../game/SoundEvents.js';
import { applyGameEventMidiPreset } from './GameEventMidiPresets.js';
import { sanitizeMidiProject } from './MidiProject.js';

const PROCGEN_SPAWN_MIDI_DEFAULTS = Object.freeze({ velocity: 32, priority: 0 });
const isSpawn = source => source.kind === 'sfx' && source.sourceKey === String(SoundEffectIds.SPAWN);

const applyProcgenGameEventMidiPreset = (project, presetId, options = {}) => {
  const clean = sanitizeMidiProject(project);
  const previous = clean.sources.find(isSpawn)?.mapping;
  const next = applyGameEventMidiPreset(clean, presetId, options);
  return sanitizeMidiProject({ ...next, sources: next.sources.map(source => isSpawn(source) ? {
    ...source, mapping: { ...source.mapping,
      velocity: previous?.velocity ?? PROCGEN_SPAWN_MIDI_DEFAULTS.velocity,
      priority: previous?.priority ?? PROCGEN_SPAWN_MIDI_DEFAULTS.priority }
  } : source) });
};

export { PROCGEN_SPAWN_MIDI_DEFAULTS, applyProcgenGameEventMidiPreset };
