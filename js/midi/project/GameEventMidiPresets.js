import { SoundEffectIds } from '../../game/SoundEvents.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { DEFAULT_SCALES } from '../midi-mapping/MidiMappingDomain.js';
import { createMidiSourceFromMapping, sanitizeMidiProject } from './MidiProject.js';

const GAME_EVENT_MIDI_PRESETS = Object.freeze([
  Object.freeze({
    id: 'game-major',
    label: 'Bright steps · C major',
    description: 'C-major spawn and exit notes with bright construction voices.'
  }),
  Object.freeze({
    id: 'game-minor',
    label: 'Cavern steps · A minor',
    description: 'A-minor spawn and exit notes with low excavation voices.'
  }),
  Object.freeze({
    id: 'game-chromatic',
    label: 'Chromatic machinery',
    description: 'Semitone spawn and exit runs with compact mechanical action voices.'
  })
]);

const PALETTES = Object.freeze({
  'game-major': { base: 60, scale: 'major', root: 0, third: 4, second: 2, fifth: 7, seventh: 11, run: [0, 4, 7, 12] },
  'game-minor': { base: 57, scale: 'minor', root: 9, third: 3, second: 2, fifth: 7, seventh: 10, run: [0, 3, 7, 12] },
  'game-chromatic': { base: 60, scale: 'chromatic', root: 0, third: 3, second: 1, fifth: 6, seventh: 11, run: [0, 1, 2, 3] }
});

const createPresetMappings = (palette, mode) => {
  const { base, third, second, fifth, seventh, run } = palette;
  const note = (name, offset, durationTicks = 3, velocity = 76, timbre = 70) => ({
    name,
    note: base + offset,
    durationTicks,
    velocity,
    timbre
  });
  const arp = (name, offsets, mode, durationTicks = 3, velocity = 76, timbre = 70) => ({
    ...note(name, offsets[0], durationTicks, velocity, timbre),
    notes: offsets.map(offset => base + offset),
    arp: { enabled: true, mode, length: offsets.length }
  });
  const mappings = new Map([
    [SoundEffectIds.SPAWN, arp('Spawn · falling', run.map(offset => offset + 12), 'down', 3, 72, 90)],
    [SoundEffectIds.EXIT, arp('Exit · rising', run, 'up', 6, 96, 100)],
    [SoundEffectIds.LAND, note('Landing · plain low note', -12, 3, 72, 55)],
    [SoundEffectIds.BUILDER_STEP, arp('Build · rising steps', [0, second, third, fifth], 'up', 3, 78, 92)],
    [SoundEffectIds.BUILDER_WARNING, note('Build · warning', seventh, 2, 100, 110)],
    [SoundEffectIds.BASH, arp('Bash · alternating knocks', [-12, fifth - 12], 'updown', 2, 78, 55)],
    [SoundEffectIds.DIG, arp('Dig · falling steps', run.map(offset => offset - 12), 'down', 2, 74, 45)],
    [SoundEffectIds.MINE, arp('Mine · low falling steps', [-12, third - 12, fifth - 12], 'down', 3, 82, 55)],
    [SoundEffectIds.STEEL_HIT, note('Steel · high strike', 24, 2, 104, 118)],
    [SoundEffectIds.SKILL_SELECT, note('Skill · selection', fifth, 2, 60, 70)],
    [SoundEffectIds.SKILL_ASSIGN, note('Skill · assignment', 12, 3, 82, 85)],
    [SoundEffectIds.ENTRANCE_OPEN, note('Hatch · opening', 0, 5, 70, 65)],
    [SoundEffectIds.LEVEL_START, note('Level · start', -12, 8, 86, 50)],
    [SoundEffectIds.OHNO, arp('Bomber · warning', [fifth - 12, seventh - 12], 'updown', 4, 90, 75)],
    [SoundEffectIds.EXPLOSION, note('Explosion · low impact', -24, 6, 108, 25)],
    [SoundEffectIds.SPLAT, note('Splat · short impact', -12, 2, 92, 35)],
    [SoundEffectIds.DROWN, arp('Drown · sinking notes', run.map(offset => offset - 12), 'down', 5, 72, 35)],
    [SoundEffectIds.FELL_OFF, note('Fall off · low accent', -12, 2, 62, 40)],
    [SoundEffectIds.TRAP_ZAP, note('Trap · zap', seventh, 2, 96, 110)],
    [SoundEffectIds.TRAP_SQUISH, note('Trap · squish', -12, 3, 92, 35)],
    [SoundEffectIds.TRAP_SLICER, note('Trap · slicer', fifth, 2, 98, 100)],
    [SoundEffectIds.TRAP_FIRE, note('Fire · dark accent', third - 12, 4, 88, 45)],
    [SoundEffectIds.TRAP_TEN_TON, note('Trap · heavy impact', -24, 4, 108, 25)],
    [SoundEffectIds.TRAP_BEAR, note('Trap · snap', fifth - 12, 2, 100, 65)]
  ]);
  if (mode === 'phrase') {
    const phraseRun = palette.scale === 'chromatic' ? [0, 1, 2, 3, 4] : [0, third, fifth, 12, 12 + third];
    for (const [id, direction, octave] of [
      [SoundEffectIds.SPAWN, 'down', 0],
      [SoundEffectIds.EXIT, 'up', 0]
    ]) {
      const mapping = mappings.get(id);
      mapping.name = id === SoundEffectIds.SPAWN ? 'Spawn · quiet falling phrase' : 'Exit · rising phrase';
      mapping.notes = phraseRun.map(offset => base + offset + octave);
      mapping.note = mapping.notes[0];
      mapping.arp = null;
      mapping.phrase = { enabled: true, mode: direction, spacingTicks: 2 };
      mapping.durationTicks = 2;
      mapping.velocity = id === SoundEffectIds.SPAWN ? 42 : 58;
    }
  }
  return mappings;
};

const applyGameEventMidiPreset = (project, presetId, { mode = 'steps' } = {}) => {
  const preset = GAME_EVENT_MIDI_PRESETS.find(entry => entry.id === presetId);
  if (!preset) throw new Error(`Unknown game-event MIDI preset: ${presetId}`);
  if (mode !== 'phrase' && mode !== 'steps') throw new Error(`Unknown game-event playback mode: ${mode}`);
  const clean = sanitizeMidiProject(project);
  const palette = PALETTES[preset.id];
  const mappings = createPresetMappings(palette, mode);
  const replacements = new Map();
  for (const [id, mapping] of mappings) replacements.set(`sfx:${id}`, mapping);
  // These real events carry trigger metadata, which takes precedence over SFX mappings.
  for (const [trigger, sfx] of [
    [TriggerTypes.EXIT_LEVEL, SoundEffectIds.EXIT],
    [TriggerTypes.DROWN, SoundEffectIds.DROWN],
    [TriggerTypes.KILL, SoundEffectIds.TRAP_FIRE],
    [TriggerTypes.FRYING, SoundEffectIds.TRAP_FIRE]
  ]) {
    replacements.set(`trigger:${trigger}`, mappings.get(sfx));
  }
  const sources = clean.sources.map(source => {
    const key = `${source.kind}:${source.sourceKey}`;
    const mapping = replacements.get(key);
    if (!mapping) return source;
    replacements.delete(key);
    return {
      ...source,
      label: mapping.name,
      enabled: true,
      mode: 'direct',
      clipId: null,
      mapping
    };
  });
  for (const [key, mapping] of replacements) {
    const [kind, sourceKey] = key.split(':');
    sources.push(createMidiSourceFromMapping(kind, sourceKey, mapping, clean.tracks[0].id));
  }
  const presetNotes = [...mappings.values()].flatMap(mapping => mapping.notes || [mapping.note]);
  const spawn = sources.find(source => source.kind === 'sfx' && source.sourceKey === String(SoundEffectIds.SPAWN));
  return sanitizeMidiProject({
    ...clean,
    updatedAt: Date.now(),
    global: {
      ...clean.global,
      scale: { name: palette.scale, root: palette.root, degrees: [...DEFAULT_SCALES[palette.scale]] },
      noteRange: {
        min: Math.min(clean.global.noteRange.min, ...presetNotes),
        max: Math.max(clean.global.noteRange.max, ...presetNotes)
      }
    },
    sources,
    ui: {
      ...clean.ui,
      selectedSourceId: spawn.id,
      selectedTrackId: spawn.trackId,
      activeRegion: 'sources'
    }
  });
};

export { GAME_EVENT_MIDI_PRESETS, applyGameEventMidiPreset };
