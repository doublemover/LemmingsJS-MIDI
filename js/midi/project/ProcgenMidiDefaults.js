import { SoundEffectIds } from '../../game/SoundEvents.js';
import { applyGameEventMidiPreset, GAME_EVENT_MIDI_PRESETS } from './GameEventMidiPresets.js';
import { createMidiSourceFromMapping, sanitizeMidiProject, reduceMidiProject } from './MidiProject.js';
import { quantizeToScale, resolveScale } from '../midi-mapping/MidiMappingDomain.js';

const PROCGEN_SPAWN_MIDI_DEFAULTS = Object.freeze({ velocity: 24, priority: 0 });
const PROCGEN_PRESETS = Object.freeze([
  { id: 'procgen-bass-relay', label: 'Crowd relay - Dorian bass', basePresetId: 'game-dorian-bass-pulse', family: 'Procgen', description: 'Dry bass answers, quiet descending landings and two-bar evolving crowd replies.', bars: 2, evolve: 2, landingTicks: 2 },
  { id: 'procgen-airy-arrivals', label: 'Airy arrivals - Lydian', basePresetId: 'game-lydian-lanterns', family: 'Procgen', description: 'High descending arrivals and sparse four-bar crowd arches with long releases.', bars: 4, evolve: 4, landingTicks: 5 },
  { id: 'procgen-clockwork-crowd', label: 'Clockwork crowd - harmonic minor', basePresetId: 'game-harmonic-minor-clockwork', family: 'Procgen', description: 'Angular construction and three-bar crowd phrases with short quiet arrivals.', bars: 3, evolve: -2, landingTicks: 3 }
]);
const PROCGEN_GAME_EVENT_MIDI_PRESETS = Object.freeze([...GAME_EVENT_MIDI_PRESETS, ...PROCGEN_PRESETS]);
const sourceAt = (project, id) => project.sources.find(source => source.kind === 'sfx' && source.sourceKey === String(id));

const applyProcgenGameEventMidiPreset = (project, presetId, options = {}) => {
  const clean = sanitizeMidiProject(project), definition = PROCGEN_PRESETS.find(preset => preset.id === presetId);
  const next = applyGameEventMidiPreset(clean, definition?.basePresetId || presetId, options);
  const preset = definition || GAME_EVENT_MIDI_PRESETS.find(preset => preset.id === presetId);
  const scale = resolveScale(next.global.scale), landing = sourceAt(next, SoundEffectIds.LAND);
  const landBase = (landing?.mapping.note || 48) + 24;
  const previousMappings = new Map(clean.sources.map(source => [source.kind + ':' + source.sourceKey, source.mapping]));
  const rollingDefaults = { enabled: true, bars: definition?.bars || 2, evolve: definition?.evolve ?? 2 };
  const landingTicks = definition?.landingTicks || (preset.family === 'Atmospheric' ? 5 : preset.family === 'Gentle' ? 2 : preset.family === 'Rhythmic' ? 2 : 3);
  // A completed local cohort is distinct from an authored exit or a death.
  // Keep an existing source intact, including its bypass, clip and track edits.
  const sources = [...next.sources];
  if (!sourceAt(next, SoundEffectIds.PROCGEN_ROUTE_COMPLETE)) {
    const root = quantizeToScale((landing?.mapping.note ?? 48) + 12, scale);
    sources.push(createMidiSourceFromMapping('sfx', SoundEffectIds.PROCGEN_ROUTE_COMPLETE, {
      name: 'Crew passage - rising resolution', note: root,
      notes: [0, 4, 7, 12].map(offset => quantizeToScale(root + offset, scale)),
      velocity: 56, priority: 8, durationTicks: 3,
      phrase: { enabled: true, mode: 'up', spacingTicks: 3 }
    }, next.ensemble?.sourceTrackId || next.tracks[0].id));
  }
  return sanitizeMidiProject({ ...next,
    global: { ...next.global, position: { ...next.global.position, lanePanSpread: clean.global.position.lanePanSpread ?? 72 } },
    sources: sources.map(source => {
      const previous = previousMappings.get(source.kind + ':' + source.sourceKey), performance = {};
      for (const field of ['velocity', 'priority', 'pan', 'timbre', 'pitchBend', 'envelope']) if (previous?.[field] != null) performance[field] = previous[field];
      source = { ...source, mapping: { ...source.mapping, ...performance } };
      if (source.kind !== 'sfx') return source;
      const id = Number(source.sourceKey);
      if (id === SoundEffectIds.SPAWN) return { ...source, mapping: { ...source.mapping,
        velocity: previous?.velocity ?? PROCGEN_SPAWN_MIDI_DEFAULTS.velocity,
        priority: previous?.priority ?? PROCGEN_SPAWN_MIDI_DEFAULTS.priority } };
      if (id === SoundEffectIds.LAND) return { ...source, label: 'Safe landing - quiet descending arrival', mapping: { ...source.mapping,
        notes: [0, 4, 7, 12].map(offset => quantizeToScale(landBase + offset, scale)), note: quantizeToScale(landBase, scale),
        velocity: previous?.velocity ?? 32, priority: previous?.priority ?? 0, durationTicks: landingTicks,
        arp: null, phrase: { enabled: true, mode: 'down', spacingTicks: Math.min(8, landingTicks) } } };
      if (id === SoundEffectIds.BLOCKER_TURN || id === SoundEffectIds.BLOCKER_CONTACT) return { ...source,
        label: 'Crowd turns - rolling multi-bar reply', mapping: { ...source.mapping,
          notes: [0, 4, 7].map(offset => quantizeToScale(source.mapping.note + offset, scale)),
          velocity: previous?.velocity ?? 18, priority: previous?.priority ?? 0,
          phrase: { enabled: true, mode: 'up', spacingTicks: 2,
            rolling: options.replaceRollingDefaults === true ? rollingDefaults : previous?.phrase?.rolling || rollingDefaults } } };
      return source;
    }) });
};

// Musical beats use the base simulation tick, independent of live playback speed.
const getProcgenMusicBeatTicks = (project, baseTickMs = 60) => {
  const requestedBpm = Number(project?.transport?.bpmBase), requestedTick = Number(baseTickMs);
  const bpm = Number.isFinite(requestedBpm) ? Math.max(20, Math.min(320, requestedBpm)) : 120;
  const tickMs = Number.isFinite(requestedTick) && requestedTick > 0 ? requestedTick : 60;
  return 60000 / bpm / tickMs;
};

const getProcgenSpawnPriority = project => sourceAt(project, SoundEffectIds.SPAWN)?.mapping.priority ?? PROCGEN_SPAWN_MIDI_DEFAULTS.priority;
const setProcgenSpawnPriority = (project, priority) => {
  const source = sourceAt(project, SoundEffectIds.SPAWN);
  if (!source || !Number.isFinite(Number(priority))) return project;
  return reduceMidiProject(project, { type: 'source.mapping.update', sourceId: source.id, patch: { priority: Math.max(0, Math.min(100, Math.round(Number(priority)))) } });
};

export { getProcgenMusicBeatTicks, getProcgenSpawnPriority, setProcgenSpawnPriority, PROCGEN_SPAWN_MIDI_DEFAULTS, PROCGEN_GAME_EVENT_MIDI_PRESETS, applyProcgenGameEventMidiPreset };
