import { SoundEffectIds } from '../../game/SoundEvents.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { createDefaultMidiEnsemble } from './MidiEnsemble.js';
import { DEFAULT_SCALES } from '../midi-mapping/MidiMappingDomain.js';
import { createMidiSourceFromMapping, sanitizeMidiProject } from './MidiProject.js';

const freezeDefinition = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDefinition(child);
    Object.freeze(value);
  }
  return value;
};

const musicalScale = (name, root, degrees = DEFAULT_SCALES[name]) => ({ name, root, degrees: [...degrees] });
const steps = (degrees, direction = 'up', options = {}) => ({ degrees, playback: 'steps', direction, ...options });
const voices = (degrees, options = {}) => ({ degrees, playback: 'chord', velocity: 48, durationTicks: 4, ...options });
const strike = (degree, options = {}) => ({ degrees: [degree], playback: 'note', ...options });

const PRESET_DEFINITIONS = freezeDefinition([
  {
    id: 'game-major', label: 'Bright steps · C major',
    description: 'C-major spawn and exit notes with bright construction voices.',
    family: 'Classic', register: 'Mid / high', contour: 'Falling spawns, rising exits',
    rhythm: 'Crisp event steps', voicing: 'Single notes', scale: musicalScale('major', 0), baseNote: 60
  },
  {
    id: 'game-minor', label: 'Cavern steps · A minor',
    description: 'A-minor spawn and exit notes with low excavation voices.',
    family: 'Classic', register: 'Low / mid', contour: 'Falling spawns, rising exits',
    rhythm: 'Crisp event steps', voicing: 'Single notes', scale: musicalScale('minor', 9), baseNote: 57
  },
  {
    id: 'game-chromatic', label: 'Chromatic machinery',
    description: 'Semitone spawn and exit runs with compact mechanical action voices.',
    family: 'Classic', register: 'Mid / high', contour: 'Semitone runs',
    rhythm: 'Crisp event steps', voicing: 'Single notes', scale: musicalScale('chromatic', 0), baseNote: 60
  },
  {
    id: 'game-pentatonic-rain', label: 'Pentatonic rain · D',
    description: 'High five-note raindrops, skipping builds and soft open-fifth arrivals.',
    family: 'Gentle', register: 'High', contour: 'Falling pentatonic drops', rhythm: 'Light two-tick taps',
    voicing: 'Open-fifth arrivals', scale: musicalScale('pentatonic', 2), baseNote: 62,
    actions: {
      SPAWN: steps([0, 1, 2, 3, 4], 'down', { octave: 1, velocity: 52, durationTicks: 2 }),
      EXIT: voices([0, 3], { octave: 1, velocity: 46, durationTicks: 5 }),
      BUILDER_STEP: steps([0, 2, 4, 6], 'up', { velocity: 58, durationTicks: 2 }),
      BASH: steps([0, 3], 'updown', { octave: -1, velocity: 58, durationTicks: 2 }),
      DIG: steps([0, 1, 3, 4], 'down', { velocity: 50, durationTicks: 2 }),
      MINE: steps([0, 2, 3], 'down', { octave: -1, velocity: 56 }),
      LAND: strike(0, { octave: -1, velocity: 48 })
    },
    phrase: { spacingTicks: 2, durationTicks: 2 }
  },
  {
    id: 'game-dorian-switchbacks', label: 'Dorian switchbacks · D',
    description: 'Bouncing modal climbs and held-pitch switchbacks over low digging replies.',
    family: 'Modal', register: 'Mid', contour: 'Arch and switchback', rhythm: 'Repeated-pitch turns',
    voicing: 'Single notes', scale: musicalScale('dorian', 2), baseNote: 62,
    actions: {
      SPAWN: steps([0, 2, 4, 5], 'updown', { velocity: 62 }),
      EXIT: steps([0, 2, 4, 5, 7], 'up', { durationTicks: 4, velocity: 74 }),
      BUILDER_STEP: steps([0, 1, 3, 5], 'up', { pattern: ['up', 'hold', 'up', 'down'], velocity: 66 }),
      BASH: steps([0, 3, 4], 'updown', { octave: -1, durationTicks: 2 }),
      DIG: steps([0, 2, 5, 6], 'down', { octave: -1, durationTicks: 2 }),
      MINE: steps([0, 3, 5], 'updown', { octave: -1, velocity: 64 })
    },
    phrase: { spacingTicks: 3, durationTicks: 2 }
  },
  {
    id: 'game-mixolydian-parade', label: 'Mixolydian parade · G',
    description: 'Low marching spawns, bright rising builds and compact two-voice fanfares.',
    family: 'Rhythmic', register: 'Low / mid', contour: 'Marching rise', rhythm: 'Short marching taps',
    voicing: 'Two-voice fanfares', scale: musicalScale('mixolydian', 7), baseNote: 55,
    actions: {
      SPAWN: steps([0, 4, 6, 7], 'up', { durationTicks: 2, velocity: 66 }),
      EXIT: voices([2, 6], { octave: 1, velocity: 54, durationTicks: 4 }),
      BUILDER_STEP: steps([0, 2, 4, 6], 'up', { octave: 1, durationTicks: 2, velocity: 68 }),
      BASH: steps([0, 4], 'updown', { durationTicks: 2, velocity: 72 }),
      DIG: steps([0, 3, 6], 'down', { octave: -1, durationTicks: 2 }),
      MINE: steps([0, 4, 6], 'down', { durationTicks: 2 }),
      ENTRANCE_OPEN: voices([0, 4], { velocity: 48 })
    },
    phrase: { spacingTicks: 2, durationTicks: 2 }
  },
  {
    id: 'game-lydian-lanterns', label: 'Lydian lanterns · F',
    description: 'Floating raised-fourth arches, airy construction and a quiet open-triad exit.',
    family: 'Atmospheric', register: 'High', contour: 'Wide floating arches', rhythm: 'Spacious four-tick phrases',
    voicing: 'Open-triad arrivals', scale: musicalScale('lydian', 5, [0, 2, 4, 6, 7, 9, 11]), baseNote: 65,
    actions: {
      SPAWN: steps([0, 3, 4, 7], 'updown', { velocity: 48, durationTicks: 4 }),
      EXIT: voices([0, 4, 9], { velocity: 40, durationTicks: 6 }),
      BUILDER_STEP: steps([0, 3, 5, 7], 'up', { velocity: 54, durationTicks: 4 }),
      BASH: steps([0, 3], 'updown', { octave: -1, velocity: 50 }),
      DIG: steps([0, 3, 4], 'down', { octave: -1, velocity: 48 }),
      MINE: steps([0, 4, 7], 'down', { octave: -1, durationTicks: 4, velocity: 50 }),
      STEEL_HIT: strike(3, { octave: 1, durationTicks: 2, velocity: 78 })
    },
    phrase: { spacingTicks: 4, durationTicks: 3 }
  },
  {
    id: 'game-phrygian-forge', label: 'Phrygian forge · E',
    description: 'Dark low semitone answers, insistent hammering and a heavy open-fifth exit.',
    family: 'Dark', register: 'Low', contour: 'Narrow semitone tension', rhythm: 'Held hammer pulses',
    voicing: 'Low open fifths', scale: musicalScale('phrygian', 4, [0, 1, 3, 5, 7, 8, 10]), baseNote: 52,
    actions: {
      SPAWN: steps([0, 1, 4], 'down', { velocity: 62, durationTicks: 2 }),
      EXIT: voices([0, 4], { velocity: 54, durationTicks: 5 }),
      BUILDER_STEP: steps([0, 1, 3, 4], 'up', { pattern: ['hold', 'up', 'up', 'down'], durationTicks: 2 }),
      BASH: steps([0, 1], 'updown', { octave: -1, velocity: 76, durationTicks: 2 }),
      DIG: steps([0, 1, 2], 'down', { octave: -1, velocity: 70, durationTicks: 2 }),
      MINE: steps([0, 1, 4], 'down', { octave: -1, velocity: 72 }),
      BUILDER_WARNING: strike(1, { octave: 1, velocity: 88, durationTicks: 2 })
    },
    phrase: { spacingTicks: 3, durationTicks: 2 }
  },
  {
    id: 'game-harmonic-minor-clockwork', label: 'Clockwork · A harmonic minor',
    description: 'Angular minor runs, raised-seventh warnings and measured held-step mechanisms.',
    family: 'Dark', register: 'Mid', contour: 'Angular minor climbs', rhythm: 'Held-step mechanisms',
    voicing: 'Single notes', scale: musicalScale('harmonic-minor', 9, [0, 2, 3, 5, 7, 8, 11]), baseNote: 57,
    actions: {
      SPAWN: steps([0, 2, 5, 6], 'down', { octave: 1, durationTicks: 2 }),
      EXIT: steps([0, 2, 4, 6, 7], 'up', { velocity: 78, durationTicks: 4 }),
      BUILDER_STEP: steps([0, 2, 5, 6], 'up', { pattern: ['up', 'up', 'hold', 'down', 'up'], durationTicks: 2 }),
      BASH: steps([0, 2, 6], 'updown', { octave: -1, durationTicks: 2 }),
      DIG: steps([0, 2, 5, 6], 'down', { octave: -1, durationTicks: 2 }),
      MINE: steps([0, 4, 6], 'updown', { octave: -1 }),
      BUILDER_WARNING: strike(6, { velocity: 86, durationTicks: 2 })
    },
    phrase: { spacingTicks: 2, durationTicks: 2 }
  },
  {
    id: 'game-whole-tone-drift', label: 'Whole-tone drift · C',
    description: 'Weightless equal-step arches and wide excavation sweeps with soft dyad arrivals.',
    family: 'Atmospheric', register: 'Mid / high', contour: 'Equal-step arches', rhythm: 'Slow five-tick phrases',
    voicing: 'Whole-tone dyads', scale: musicalScale('whole-tone', 0, [0, 2, 4, 6, 8, 10]), baseNote: 60,
    actions: {
      SPAWN: steps([0, 1, 3, 5], 'updown', { octave: 1, velocity: 44, durationTicks: 5 }),
      EXIT: voices([0, 4], { octave: 1, velocity: 42, durationTicks: 6 }),
      BUILDER_STEP: steps([0, 2, 4, 6], 'updown', { velocity: 50, durationTicks: 4 }),
      BASH: steps([0, 3], 'updown', { octave: -1, velocity: 50, durationTicks: 4 }),
      DIG: steps([0, 2, 4, 6], 'down', { octave: -1, velocity: 48, durationTicks: 4 }),
      MINE: steps([0, 3, 5], 'down', { octave: -1, velocity: 50, durationTicks: 5 })
    },
    phrase: { spacingTicks: 5, durationTicks: 3 }
  },
  {
    id: 'game-minor-pentatonic-plucks', label: 'Plucked tunnels · A minor pentatonic',
    description: 'Dry plucked answers, minor-pentatonic skips and repeated-note construction hooks.',
    family: 'Rhythmic', register: 'Low / mid', contour: 'Skipping call and response', rhythm: 'Dry two-tick plucks',
    voicing: 'Single notes', scale: musicalScale('minor-pentatonic', 9, [0, 3, 5, 7, 10]), baseNote: 57,
    actions: {
      SPAWN: steps([0, 2, 3, 4], 'up', { durationTicks: 2, velocity: 56 }),
      EXIT: steps([0, 1, 3, 5], 'updown', { durationTicks: 3, velocity: 70 }),
      BUILDER_STEP: steps([0, 1, 3], 'up', { pattern: ['up', 'hold', 'down', 'hold'], durationTicks: 2, velocity: 64 }),
      BASH: steps([0, 3], 'updown', { octave: -1, durationTicks: 2, velocity: 68 }),
      DIG: steps([0, 2, 4], 'down', { octave: -1, durationTicks: 2 }),
      MINE: steps([0, 1, 3, 4], 'down', { octave: -1, durationTicks: 2 }),
      LAND: strike(0, { octave: -1, durationTicks: 2, velocity: 54 })
    },
    phrase: { spacingTicks: 3, durationTicks: 2 }
  },
  {
    id: 'game-major-open-harmony', label: 'Open meadow · C major',
    description: 'Wide single-note spawns with soft third-and-fifth construction and open-triad arrivals.',
    family: 'Harmony', register: 'Mid', contour: 'Wide broken triads', rhythm: 'Sustained arrival accents',
    voicing: 'Two- and three-note harmony', scale: musicalScale('major', 0), baseNote: 60,
    actions: {
      SPAWN: steps([0, 4, 7, 9], 'down', { velocity: 54, durationTicks: 3 }),
      EXIT: voices([0, 4, 9], { velocity: 42, durationTicks: 7 }),
      BUILDER_STEP: voices([2, 4], { velocity: 44, durationTicks: 3 }),
      BASH: voices([0, 4], { octave: -1, velocity: 44, durationTicks: 2 }),
      DIG: steps([0, 2, 4], 'down', { octave: -1, velocity: 52 }),
      MINE: steps([0, 4, 7], 'down', { octave: -1, velocity: 56, durationTicks: 4 }),
      ENTRANCE_OPEN: voices([0, 4], { velocity: 42, durationTicks: 5 }),
      LEVEL_START: voices([0, 4, 9], { octave: -1, velocity: 42, durationTicks: 7 })
    },
    phrase: { spacingTicks: 4, durationTicks: 3 }
  },
  {
    id: 'game-dorian-bass-pulse', label: 'Bass relay · C dorian',
    description: 'Compact bass-register pedals, repeated-pitch relays and a brief high exit answer.',
    family: 'Rhythmic', register: 'Bass', contour: 'Pedal and return', rhythm: 'Short repeated-pitch pulses',
    voicing: 'Single notes', scale: musicalScale('dorian', 0), baseNote: 48,
    actions: {
      SPAWN: steps([0, 4], 'up', { pattern: ['hold', 'up', 'hold', 'down'], durationTicks: 2, velocity: 66 }),
      EXIT: steps([0, 2, 4, 5], 'up', { octave: 1, durationTicks: 3, velocity: 74 }),
      BUILDER_STEP: steps([0, 2, 4], 'up', { pattern: ['up', 'down', 'hold'], durationTicks: 2, velocity: 70 }),
      BASH: strike(0, { octave: 0, durationTicks: 2, velocity: 76 }),
      DIG: steps([0, 1, 2], 'down', { durationTicks: 2, velocity: 66 }),
      MINE: steps([0, 4], 'updown', { durationTicks: 2, velocity: 70 }),
      EXPLOSION: strike(0, { octave: -1, durationTicks: 4, velocity: 90 }),
      TRAP_TEN_TON: strike(0, { octave: -1, durationTicks: 4, velocity: 90 })
    },
    phrase: { spacingTicks: 2, durationTicks: 2 }
  },
  {
    id: 'game-major-music-box', label: 'Music-box stairs · E major',
    description: 'Tiny high-register staircases, rocking construction and delicate low-note landings.',
    family: 'Gentle', register: 'High', contour: 'Close high staircases', rhythm: 'Delicate two-tick taps',
    voicing: 'Single notes', scale: musicalScale('major', 4), baseNote: 76,
    actions: {
      SPAWN: steps([0, 1, 2, 3, 4], 'down', { velocity: 42, durationTicks: 2 }),
      EXIT: steps([0, 2, 4, 7], 'up', { velocity: 58, durationTicks: 3 }),
      BUILDER_STEP: steps([0, 1, 2, 4], 'updown', { velocity: 48, durationTicks: 2 }),
      BASH: steps([0, 2], 'updown', { octave: -1, velocity: 46, durationTicks: 2 }),
      DIG: steps([0, 1, 2, 3], 'down', { octave: -1, velocity: 44, durationTicks: 2 }),
      MINE: steps([0, 2, 4], 'down', { octave: -1, velocity: 48, durationTicks: 2 }),
      STEEL_HIT: strike(7, { octave: 0, durationTicks: 2, velocity: 70 }),
      LAND: strike(0, { octave: -1, durationTicks: 2, velocity: 40 })
    },
    phrase: { spacingTicks: 3, durationTicks: 2 }
  },
  {
    id: 'game-suspended-stillwater', label: 'Stillwater · D suspended pentatonic',
    description: 'Sparse suspended arches, open fourth-and-fifth replies and widely spaced arrival phrases.',
    family: 'Atmospheric', register: 'Mid', contour: 'Suspended open arches', rhythm: 'Spacious six-tick phrases',
    voicing: 'Suspended dyads', scale: musicalScale('suspended-pentatonic', 2, [0, 2, 5, 7, 10]), baseNote: 62,
    actions: {
      SPAWN: steps([0, 2, 3], 'updown', { velocity: 42, durationTicks: 5 }),
      EXIT: voices([1, 3], { octave: 1, velocity: 40, durationTicks: 7 }),
      BUILDER_STEP: steps([0, 2, 3, 5], 'updown', { velocity: 48, durationTicks: 4 }),
      BASH: voices([0, 2], { octave: -1, velocity: 40, durationTicks: 3 }),
      DIG: steps([0, 2, 3], 'down', { octave: -1, velocity: 44, durationTicks: 4 }),
      MINE: steps([0, 3, 5], 'updown', { octave: -1, velocity: 46, durationTicks: 5 }),
      ENTRANCE_OPEN: voices([0, 3], { velocity: 40, durationTicks: 6 }),
      LAND: strike(0, { octave: -1, velocity: 42, durationTicks: 4 })
    },
    phrase: { spacingTicks: 6, durationTicks: 4 }
  },
  {
    id: 'game-iron-ensemble', ensemble: true, label: 'Iron ensemble · D dorian',
    description: 'Stable lemming bass, guitar, lead and drum roles in D dorian, driven by real game events.',
    family: 'Ensemble', register: 'Bass / rhythm / lead / drums', contour: 'Modal builds and low replies',
    rhythm: 'Game-event grooves', voicing: 'Complementary lemming roles', scale: musicalScale('dorian', 2), baseNote: 62,
    actions: {
      SPAWN: steps([0, 2, 4, 5], 'down', { velocity: 64, durationTicks: 2 }),
      EXIT: steps([0, 2, 4, 7], 'up', { velocity: 80, durationTicks: 4 }),
      BUILDER_STEP: steps([0, 2, 4, 5], 'up', { velocity: 72, durationTicks: 2 }),
      BASH: steps([0, 4], 'updown', { octave: -1, velocity: 72, durationTicks: 2 }),
      DIG: steps([0, 2, 4], 'down', { octave: -1, velocity: 68, durationTicks: 2 }),
      MINE: steps([0, 3, 4], 'down', { octave: -1, velocity: 70, durationTicks: 2 })
    },
    phrase: { spacingTicks: 2, durationTicks: 2 }
  },
]);

const GAME_EVENT_MIDI_PRESETS = Object.freeze(PRESET_DEFINITIONS.map(({ actions, phrase, ...metadata }) => Object.freeze(metadata)));

const PALETTES = Object.freeze({
  'game-major': { base: 60, scale: 'major', root: 0, third: 4, second: 2, fifth: 7, seventh: 11, run: [0, 4, 7, 12] },
  'game-minor': { base: 57, scale: 'minor', root: 9, third: 3, second: 2, fifth: 7, seventh: 10, run: [0, 3, 7, 12] },
  'game-chromatic': { base: 60, scale: 'chromatic', root: 0, third: 3, second: 1, fifth: 6, seventh: 11, run: [0, 1, 2, 3] }
});

const createClassicMappings = (palette, mode) => {
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
    [SoundEffectIds.BLOCKER_TURN, note('Walker turn', 0, 2, 72, 55)],
    [SoundEffectIds.BLOCKER_CONTACT, note('Blocker reply', fifth, 2, 72, 75)],
    [SoundEffectIds.COUNTDOWN, note('Bomber countdown', 0, 2, 76, 80)],
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
      mapping.name = id === SoundEffectIds.SPAWN ? 'Spawn · falling phrase' : 'Exit · rising phrase';
      mapping.notes = phraseRun.map(offset => base + offset + octave);
      mapping.note = mapping.notes[0];
      mapping.arp = null;
      mapping.phrase = { enabled: true, mode: direction, spacingTicks: 2 };
      mapping.durationTicks = 2;
      mapping.velocity = id === SoundEffectIds.SPAWN ? 64 : 80;
    }
  }
  return mappings;
};

const createScaleMappings = (preset, mode) => {
  const count = preset.scale.degrees.length;
  const pitch = (degree, octave = 0) => preset.baseNote + octave * 12 + Math.floor(degree / count) * 12
    + preset.scale.degrees[((degree % count) + count) % count];
  const nearestDegree = (semitones) => preset.scale.degrees.reduce((best, value, index, degrees) => (
    Math.abs(value - semitones) < Math.abs(degrees[best] - semitones) ? index : best
  ), 0);
  const third = nearestDegree(4);
  const fifth = nearestDegree(7);
  const seventh = count - 1;
  const defaults = {
    BLOCKER_TURN: strike(0, { durationTicks: 2, velocity: 60, timbre: 55 }),
    BLOCKER_CONTACT: strike(fifth, { durationTicks: 2, velocity: 60, timbre: 75 }),
    COUNTDOWN: strike(0, { durationTicks: 2, velocity: 66, timbre: 80 }),
    SPAWN: steps([0, third, fifth, count], 'down', { velocity: 56 }),
    EXIT: steps([0, third, fifth, count], 'up', { velocity: 76, durationTicks: 5 }),
    LAND: strike(0, { octave: -1, velocity: 54, timbre: 50 }),
    BUILDER_STEP: steps([0, 1, third, fifth], 'up', { velocity: 64, timbre: 86 }),
    BUILDER_WARNING: strike(seventh, { durationTicks: 2, velocity: 88, timbre: 104 }),
    BASH: steps([0, fifth], 'updown', { octave: -1, durationTicks: 2, velocity: 66, timbre: 48 }),
    DIG: steps([0, third, fifth, count], 'down', { octave: -1, durationTicks: 2, velocity: 60, timbre: 42 }),
    MINE: steps([0, third, fifth], 'down', { octave: -1, velocity: 66, timbre: 50 }),
    STEEL_HIT: strike(0, { octave: 2, durationTicks: 2, velocity: 90, timbre: 112 }),
    SKILL_SELECT: strike(fifth, { durationTicks: 2, velocity: 48 }),
    SKILL_ASSIGN: strike(0, { octave: 1, velocity: 66, timbre: 82 }),
    ENTRANCE_OPEN: strike(0, { durationTicks: 5, velocity: 58, timbre: 62 }),
    LEVEL_START: strike(0, { octave: -1, durationTicks: 7, velocity: 70, timbre: 46 }),
    OHNO: steps([fifth, seventh], 'updown', { octave: -1, durationTicks: 4, velocity: 76 }),
    EXPLOSION: strike(0, { octave: -2, durationTicks: 5, velocity: 94, timbre: 24 }),
    SPLAT: strike(0, { octave: -1, durationTicks: 2, velocity: 80, timbre: 32 }),
    DROWN: steps([0, third, fifth, count], 'down', { octave: -1, durationTicks: 4, velocity: 58, timbre: 32 }),
    FELL_OFF: strike(0, { octave: -1, durationTicks: 2, velocity: 52, timbre: 38 }),
    TRAP_ZAP: strike(seventh, { durationTicks: 2, velocity: 84, timbre: 106 }),
    TRAP_SQUISH: strike(0, { octave: -1, velocity: 80, timbre: 32 }),
    TRAP_SLICER: strike(fifth, { durationTicks: 2, velocity: 86, timbre: 96 }),
    TRAP_FIRE: strike(third, { octave: -1, durationTicks: 4, velocity: 74, timbre: 42 }),
    TRAP_TEN_TON: strike(0, { octave: -2, durationTicks: 4, velocity: 94, timbre: 24 }),
    TRAP_BEAR: strike(fifth, { octave: -1, durationTicks: 2, velocity: 86, timbre: 62 })
  };
  const mappings = new Map();
  for (const [action, fallback] of Object.entries(defaults)) {
    const voice = { ...fallback, ...preset.actions[action] };
    const notes = voice.degrees.map(degree => pitch(degree, voice.octave));
    const mapping = {
      name: `${action.toLowerCase().replaceAll('_', ' ')} · ${preset.label.split(' · ')[0]}`,
      note: notes[0],
      durationTicks: voice.durationTicks ?? 3,
      velocity: voice.velocity ?? 64,
      timbre: voice.timbre ?? 70
    };
    if (notes.length > 1) mapping.notes = notes;
    if (voice.playback === 'steps') {
      mapping.arp = { enabled: true, mode: voice.direction, length: notes.length };
      if (voice.pattern) mapping.arp.pattern = { preset: 'custom', steps: [...voice.pattern] };
    }
    if (mode === 'phrase' && (action === 'SPAWN' || action === 'EXIT')) {
      mapping.arp = null;
      mapping.phrase = { enabled: true, mode: action === 'SPAWN' ? 'down' : 'up', spacingTicks: preset.phrase.spacingTicks };
      mapping.durationTicks = preset.phrase.durationTicks;
      mapping.velocity = Math.min(mapping.velocity, action === 'SPAWN' ? 64 : 80);
    }
    mappings.set(SoundEffectIds[action], mapping);
  }
  return mappings;
};

const applyGameEventMidiPreset = (project, presetId, { mode = 'steps' } = {}) => {
  const preset = PRESET_DEFINITIONS.find(entry => entry.id === presetId);
  if (!preset) throw new Error(`Unknown game-event MIDI preset: ${presetId}`);
  if (mode !== 'phrase' && mode !== 'steps') throw new Error(`Unknown game-event playback mode: ${mode}`);
  const clean = sanitizeMidiProject(project);
  const mappings = preset.actions ? createScaleMappings(preset, mode) : createClassicMappings(PALETTES[preset.id], mode);
  for (const mapping of mappings.values()) mapping.velocity = Math.min(127, Math.round(mapping.velocity * 1.5));
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
      ...(preset.id === 'game-iron-ensemble' ? { trackId: clean.tracks[0].id } : {}),
      mapping
    };
  });
  for (const [key, mapping] of replacements) {
    const [kind, sourceKey] = key.split(':');
    sources.push(createMidiSourceFromMapping(kind, sourceKey, mapping, clean.tracks[0].id));
  }
  const presetNotes = [...mappings.values()].flatMap(mapping => mapping.notes || [mapping.note]);
  const spawn = sources.find(source => source.kind === 'sfx' && source.sourceKey === String(SoundEffectIds.SPAWN));
  const ensemble = preset.id === 'game-iron-ensemble' ? createDefaultMidiEnsemble(clean.tracks[0].id, clean.tracks) : null;
  return sanitizeMidiProject({
    ...clean,
    ...(ensemble || { ensemble: null }),
    updatedAt: Date.now(),
    global: {
      ...clean.global,
      scale: { ...preset.scale, degrees: [...preset.scale.degrees] },
      ...(ensemble ? { mpe: { ...clean.global.mpe, enabled: false },
        position: { ...clean.global.position, viewPan: false },
        density: { ...clean.global.density, velocityBoost: 0.15, durationScale: 0.25 } } : {}),
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
