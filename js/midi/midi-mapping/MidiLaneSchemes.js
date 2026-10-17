import { createMidiProject, projectToMidiConfig } from '../project/MidiProject.js';
import { applyProcgenGameEventMidiPreset, PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../project/ProcgenMidiDefaults.js';
import { midiLaneMusicRange } from '../project/MidiLaneMusic.js';

const resolveMidiLaneScheme = (config, event, cache) => {
  const range = midiLaneMusicRange(config.laneMusic, event?.laneIndex);
  if (!range || !PROCGEN_GAME_EVENT_MIDI_PRESETS.some(scheme => scheme.id === range.schemeId)) return config;
  let resolved = cache.get(range.schemeId);
  if (!resolved) {
    const project = applyProcgenGameEventMidiPreset(createMidiProject(), range.schemeId, { mode: config.laneMusic.mode });
    const profile = projectToMidiConfig(project);
    resolved = { ...config, sfx: profile.sfx, triggers: profile.triggers, ensemble: profile.ensemble || null, laneReferenceRoot: profile.scale.root };
    cache.set(range.schemeId, resolved);
  }
  return resolved;
};
const laneSchemeSource = (original, replacement) => {
  if (!replacement || original?.disabled || original?.clipSequence) return original;
  // Lane schemes change the automatic voice, not explicit routing or mute/clip edits.
  return { ...replacement, outputId: original?.outputId ?? null };
};
export { resolveMidiLaneScheme, laneSchemeSource };
