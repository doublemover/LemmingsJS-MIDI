import { sanitizeMidiProject } from '../../midi/project/MidiProject.js';
import { sanitizeMidiLaneMusic, MAX_LANE_MUSIC_RANGES } from '../../midi/project/MidiLaneMusic.js';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../../midi/project/ProcgenMidiDefaults.js';
import { ScaleLibrary } from '../../midi/MidiMapping.js';
const scales = Object.fromEntries([...Object.entries(ScaleLibrary), ...PROCGEN_GAME_EVENT_MIDI_PRESETS.filter(preset => preset.scale).map(preset => [preset.scale.name, preset.scale.degrees])]);

const procgenMusicDefaults = (project, settings) => sanitizeMidiLaneMusic({ referenceRoot: project.global.scale.root,
  pitchEnabled: false, defaultSchemeId: settings.preset, mode: settings.mode });
const procgenMusicState = (project, settings) => {
  const music = project.global.laneMusic || procgenMusicDefaults(project, settings);
  return { ...music, root: project.global.scale.root, scaleId: project.global.scale.name, laneCount: settings.laneCount,
    stereoWidth: project.global.position.lanePanSpread ?? 96, maxRanges: MAX_LANE_MUSIC_RANGES,
    schemes: PROCGEN_GAME_EVENT_MIDI_PRESETS, scales: [...new Set([...Object.keys(scales), project.global.scale.name])].map(id => ({ id, label: id })) };
};
const editProcgenMusicProject = (project, settings, command) => {
  const music = { ...(project.global.laneMusic || procgenMusicDefaults(project, settings)) }, global = { ...project.global };
  let ranges = music.ranges.map(range => ({ ...range }));
  if (command.type === 'global') {
    const patch = command.patch || {};
    if ('root' in patch || 'scaleId' in patch || 'spread' in patch) music.pitchEnabled = true;
    const name = Object.hasOwn(scales, patch.scaleId) ? patch.scaleId : global.scale.name;
    global.scale = { ...global.scale, name, root: patch.root ?? global.scale.root,
      degrees: Object.hasOwn(scales, patch.scaleId) ? [...scales[name]] : global.scale.degrees };
    if ('spread' in patch) music.spread = patch.spread;
    if ('variation' in patch) music.variation = patch.variation;
    if ('stereoWidth' in patch) global.position = { ...global.position, lanePanSpread: patch.stereoWidth };
  } else if (command.type === 'addRange' && ranges.length < MAX_LANE_MUSIC_RANGES) {
    let serial = 1; while (ranges.some(range => range.id === `lane-music-${serial}`)) serial++;
    ranges.push({ id: `lane-music-${serial}`, enabled: true, startLane: 1, endLane: settings.laneCount, schemeId: 'procgen-drum-pocket' });
  } else if (command.type === 'updateRange') {
    ranges = ranges.map(range => range.id === command.id ? { ...range, ...command.patch, id: range.id } : range);
  } else if (command.type === 'removeRange') ranges = ranges.filter(range => range.id !== command.id);
  else if (command.type === 'moveRange') {
    const index = ranges.findIndex(range => range.id === command.id), destination = index + Math.sign(command.direction);
    if (index >= 0 && destination >= 0 && destination < ranges.length) [ranges[index], ranges[destination]] = [ranges[destination], ranges[index]];
  }
  global.laneMusic = sanitizeMidiLaneMusic({ ...music, ranges });
  return sanitizeMidiProject({ ...project, global });
};
export { procgenMusicDefaults, procgenMusicState, editProcgenMusicProject };
