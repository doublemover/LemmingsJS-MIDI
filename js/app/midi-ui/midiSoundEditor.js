import { SoundEffectIds } from '../../game/SoundEvents.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';

const GAME_SOUND_EVENTS = Object.freeze([
  [SoundEffectIds.BLOCKER_TURN, 'Walker turn'], [SoundEffectIds.BLOCKER_CONTACT, 'Blocker reply'],
  [SoundEffectIds.COUNTDOWN, 'Bomber countdown'], [SoundEffectIds.TRAP_FIRE, 'Fire'],
  [SoundEffectIds.SPAWN, 'Spawn'], [SoundEffectIds.LAND, 'Land'], [SoundEffectIds.EXIT, 'Exit'],
  [SoundEffectIds.BUILDER_STEP, 'Build'], [SoundEffectIds.BUILDER_WARNING, 'Builder warning'], [SoundEffectIds.DIG, 'Dig'], [SoundEffectIds.BASH, 'Bash'],
  [SoundEffectIds.MINE, 'Mine'], [SoundEffectIds.STEEL_HIT, 'Hit steel'],
  [SoundEffectIds.SKILL_ASSIGN, 'Assign skill'], [SoundEffectIds.SKILL_SELECT, 'Select skill'],
  [SoundEffectIds.ENTRANCE_OPEN, 'Open hatch'], [SoundEffectIds.OHNO, 'Bomber warning'],
  [SoundEffectIds.EXPLOSION, 'Explosion'], [SoundEffectIds.SPLAT, 'Splat'], [SoundEffectIds.DROWN, 'Drown']
].map(([id, label]) => Object.freeze({ id, label })));

const resolveGameSoundSource = (project, event) => {
  const trigger = event.id === SoundEffectIds.EXIT ? TriggerTypes.EXIT_LEVEL
    : event.id === SoundEffectIds.DROWN ? TriggerTypes.DROWN
      : event.id === SoundEffectIds.TRAP_FIRE ? TriggerTypes.FRYING : null;
  const override = trigger == null ? null : project.sources.find(source => source.kind === 'trigger' && Number(source.sourceKey) === trigger);
  return override || project.sources.find(source => source.kind === 'sfx' && Number(source.sourceKey) === event.id) || null;
};

const getEventBehavior = (source) => {
  const mapping = source?.mapping;
  if (!mapping || source.mode !== 'direct') return 'custom';
  if (mapping.phrase?.enabled) return mapping.phrase.mode === 'down' ? 'falling' : 'rising';
  if (mapping.arp?.enabled) return 'steps';
  if (mapping.chord || mapping.degree != null || mapping.notes?.length > 1) return 'custom';
  return 'note';
};
const clampNote = value => Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
const soundNoteName = value => {
  if (!Number.isFinite(value)) return '—';
  const note = clampNote(value);
  return `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][note % 12]}${Math.floor(note / 12) - 1}`;
};
const createScaleRun = (base, scale = {}) => {
  const degrees = Array.isArray(scale.degrees) && scale.degrees.length ? scale.degrees : [0, 2, 4, 5, 7, 9, 11];
  const classes = new Set(degrees.map(value => ((value + (scale.root || 0)) % 12 + 12) % 12));
  const notes = [];
  for (let note = base; note <= 127 && notes.length < 5; note += 1) {
    if (classes.has(note % 12)) notes.push(note);
  }
  return notes.length ? notes : [base];
};
const createEventBehaviorPatch = (source, behavior, scale) => {
  if (!source || behavior === 'custom') return null;
  const mapping = source.mapping || {};
  const base = clampNote(mapping.note ?? mapping.notes?.[0] ?? 60);
  if (behavior === 'note') return { note: base, notes: null, phrase: null, arp: null, chord: null, degree: null };
  if (!['falling', 'rising', 'steps'].includes(behavior)) return null;
  const notes = mapping.notes?.length > 1 ? [...mapping.notes] : createScaleRun(base, scale);
  return {
    note: base, notes, chord: null, degree: null,
    phrase: behavior === 'steps' ? null : { enabled: true, mode: behavior === 'falling' ? 'down' : 'up', spacingTicks: mapping.phrase?.spacingTicks || 2 },
    arp: behavior === 'steps' ? { enabled: true, mode: mapping.phrase?.mode || mapping.arp?.mode || 'up', length: notes.length } : null
  };
};
const transposeEventPitch = (mapping, value) => {
  const note = clampNote(value);
  const old = Number.isFinite(mapping?.note) ? mapping.note : mapping?.notes?.[0] ?? 60;
  return { note, ...(mapping?.notes?.length ? { notes: mapping.notes.map(item => clampNote(item + note - old)) } : {}) };
};

export { resolveGameSoundSource, GAME_SOUND_EVENTS, getEventBehavior, createEventBehaviorPatch, transposeEventPitch, soundNoteName };
