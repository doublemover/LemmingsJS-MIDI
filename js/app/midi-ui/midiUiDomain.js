import { SoundEffectIds } from '../../game/SoundEvents.js';
import { SkillTypes } from '../../game/SkillTypes.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { fromMidiFlagTriggerType, toMidiFlagTriggerType } from '../../midi/MidiFlagTriggers.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_OPTIONS = [
  'triad',
  'seventh',
  'sixth',
  'ninth',
  'power',
  'sus2',
  'sus4',
  'octave'
];
const POSITION_AXIS_OPERATORS = [
  { value: 'add', label: '+' },
  { value: 'sub', label: '-' },
  { value: 'mul', label: '*' },
  { value: 'div', label: '/' }
];
const POSITION_TARGETS = [
  { value: 'note', label: 'Note offset' },
  { value: 'velocity', label: 'Intensity' },
  { value: 'timbre', label: 'Timbre' },
  { value: 'pan', label: 'Pan' },
  { value: 'duration', label: 'Duration' },
  { value: 'pitchBend', label: 'Pitch bend' },
  { value: 'attack', label: 'Attack' },
  { value: 'decay', label: 'Decay' },
  { value: 'sustain', label: 'Sustain' },
  { value: 'release', label: 'Release' }
];
const REPEAT_TARGETS = [
  { value: 'velocity', label: 'Intensity' },
  { value: 'accent', label: 'Accent' },
  { value: 'note', label: 'Note' },
  { value: 'timbre', label: 'Timbre' },
  { value: 'pan', label: 'Pan' },
  { value: 'duration', label: 'Duration' },
  { value: 'pitchBend', label: 'Pitch bend' },
  { value: 'attack', label: 'Attack' },
  { value: 'decay', label: 'Decay' },
  { value: 'sustain', label: 'Sustain' },
  { value: 'release', label: 'Release' }
];
const REPEAT_WINDOW_OPTIONS = [
  { value: 0.0625, label: '1/16' },
  { value: 0.125, label: '1/8' },
  { value: 1 / 3, label: '1/3' },
  { value: 0.25, label: '1/4' },
  { value: 0.5, label: '1/2' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 8, label: '8' }
];

const ALL_SKILLS = Object.values(SkillTypes)
  .filter(value => Number.isFinite(value) && value !== SkillTypes.UNKNOWN);

const SKILL_SFX_MAP = new Map([
  [SoundEffectIds.BUILDER_STEP, SkillTypes.BUILDER],
  [SoundEffectIds.BUILDER_WARNING, SkillTypes.BUILDER],
  [SoundEffectIds.BASH, SkillTypes.BASHER],
  [SoundEffectIds.DIG, SkillTypes.DIGGER],
  [SoundEffectIds.MINE, SkillTypes.MINER],
  [SoundEffectIds.OHNO, SkillTypes.BOMBER],
  [SoundEffectIds.EXPLOSION, SkillTypes.BOMBER]
]);

const ANY_SKILL_SFX = new Set([
  SoundEffectIds.SKILL_SELECT,
  SoundEffectIds.SKILL_ASSIGN
]);

const TRAP_SFX_IDS = new Set([
  SoundEffectIds.TRAP_ZAP,
  SoundEffectIds.TRAP_SQUISH,
  SoundEffectIds.TRAP_SLICER,
  SoundEffectIds.TRAP_FIRE,
  SoundEffectIds.TRAP_TEN_TON,
  SoundEffectIds.TRAP_BEAR
]);
const EXCLUDED_SFX_IDS = new Set([
  SoundEffectIds.UNKNOWN_0B
]);
const SFX_NAME_BY_ID = new Map(
  Object.entries(SoundEffectIds)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .map(([name, value]) => [value, name.toLowerCase().replace(/_/g, '-')])
);

const EXCLUDED_TRIGGER_NAMES = new Set(['UNKNOWN_2', 'UNKNOWN_3']);
const TRIGGER_NAME_BY_VALUE = new Map(
  Object.entries(TriggerTypes).map(([name, value]) => [value, name])
);

const resolveSkillAvailability = (level, skills) => {
  const available = new Set();
  const cheat = skills?.cheatMode === true;
  if (cheat) {
    ALL_SKILLS.forEach(skill => available.add(skill));
    return { cheat: true, available, hasAny: true };
  }
  for (const skill of ALL_SKILLS) {
    let count = null;
    if (skills?.getSkill) {
      count = skills.getSkill(skill);
    } else if (Array.isArray(level?.skills)) {
      count = level.skills[skill] ?? 0;
    }
    if (Number.isFinite(count) && count > 0) {
      available.add(skill);
    }
  }
  return { cheat: false, available, hasAny: available.size > 0 };
};

const levelHasSteel = (level) => {
  if (!level) return false;
  if (level.steelRanges && level.steelRanges.length > 0) return true;
  if (level.steelMask?.mask && level.steelMask.mask.some(value => value)) return true;
  return false;
};

const collectTriggerTypes = (level) => {
  const types = new Set();
  if (!level) return types;
  const triggers = Array.isArray(level.triggers) ? level.triggers : [];
  for (const trigger of triggers) {
    if (Number.isFinite(trigger?.type)) types.add(trigger.type);
    if (trigger?.disableTicksCount > 0) types.add(TriggerTypes.DISABLED);
  }
  if (level.arrowRanges && level.arrowRanges.length > 0) {
    types.add(TriggerTypes.ONEWAY_LEFT);
    types.add(TriggerTypes.ONEWAY_RIGHT);
  }
  if (levelHasSteel(level)) {
    types.add(TriggerTypes.STEEL);
  }
  const midiFlags = Array.isArray(level.midiFlags) ? level.midiFlags : [];
  for (const flag of midiFlags) {
    const triggerType = Number.isFinite(flag?.triggerType)
      ? Math.trunc(flag.triggerType)
      : toMidiFlagTriggerType(flag?.id);
    if (Number.isFinite(triggerType)) {
      types.add(triggerType);
    }
  }
  return types;
};

const buildTriggerLabel = (triggerType) => {
  if (TRIGGER_NAME_BY_VALUE.has(triggerType)) {
    return TRIGGER_NAME_BY_VALUE.get(triggerType);
  }
  const midiFlagId = fromMidiFlagTriggerType(triggerType);
  if (midiFlagId != null) {
    return `MIDI_FLAG_${midiFlagId}`;
  }
  return `TRIGGER_${triggerType}`;
};

const listTriggerEntries = (config = null, availableTriggerTypes = null, level = null) => {
  const values = new Set();
  const addValue = (value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const triggerValue = Math.trunc(value);
    if (availableTriggerTypes && !availableTriggerTypes.has(triggerValue)) return;
    values.add(triggerValue);
  };
  for (const [name, value] of Object.entries(TriggerTypes)) {
    if (!Number.isFinite(value) || value <= 0 || EXCLUDED_TRIGGER_NAMES.has(name)) continue;
    addValue(value);
  }
  const overrideIds = Object.keys(config?.triggers || {})
    .map(key => Number(key))
    .filter(value => Number.isFinite(value));
  overrideIds.forEach(addValue);
  if (availableTriggerTypes) {
    for (const value of availableTriggerTypes) {
      addValue(value);
    }
  }
  const midiFlags = Array.isArray(level?.midiFlags) ? level.midiFlags : [];
  for (const flag of midiFlags) {
    addValue(flag?.triggerType);
    addValue(toMidiFlagTriggerType(flag?.id));
  }
  return Array.from(values)
    .sort((a, b) => a - b)
    .map(value => ({ value, name: buildTriggerLabel(value) }));
};

const collectTrapSfxIds = (level) => {
  const ids = new Set();
  if (!level) return ids;
  const triggers = Array.isArray(level.triggers) ? level.triggers : [];
  for (const trigger of triggers) {
    if (trigger?.type === TriggerTypes.TRAP) {
      if (Number.isFinite(trigger.soundIndex) && trigger.soundIndex > 0) {
        ids.add(trigger.soundIndex);
      }
    }
    if (trigger?.type === TriggerTypes.KILL || trigger?.type === TriggerTypes.FRYING) {
      ids.add(SoundEffectIds.TRAP_FIRE);
    }
  }
  return ids;
};

const resolveAvailableSfxIds = (config, level, skills) => {
  const available = new Set();
  const sfx = config?.sfx || {};
  const ids = Object.keys(sfx)
    .map(key => Number(key))
    .filter(id => Number.isFinite(id));
  if (!level && !skills) {
    ids.forEach(id => available.add(id));
    return available;
  }
  const skillInfo = resolveSkillAvailability(level, skills);
  const trapSfx = collectTrapSfxIds(level);
  const triggerTypes = collectTriggerTypes(level);
  const hasSteel = levelHasSteel(level);
  for (const id of ids) {
    if (SKILL_SFX_MAP.has(id)) {
      const skill = SKILL_SFX_MAP.get(id);
      if (skillInfo.cheat || skillInfo.available.has(skill)) {
        available.add(id);
      }
      continue;
    }
    if (ANY_SKILL_SFX.has(id)) {
      if (skillInfo.cheat || skillInfo.hasAny) {
        available.add(id);
      }
      continue;
    }
    if (id === SoundEffectIds.STEEL_HIT) {
      if (hasSteel) available.add(id);
      continue;
    }
    if (id === SoundEffectIds.DROWN) {
      if (triggerTypes.has(TriggerTypes.DROWN)) available.add(id);
      continue;
    }
    if (TRAP_SFX_IDS.has(id)) {
      if (trapSfx.has(id)) available.add(id);
      continue;
    }
    available.add(id);
  }
  return available;
};

const normalizePositionMapping = (entry) => {
  const axisX = typeof entry?.axisX === 'boolean' ? entry.axisX : null;
  const axisY = typeof entry?.axisY === 'boolean' ? entry.axisY : null;
  const axisOp = entry?.axisOp || 'add';
  if (axisX != null || axisY != null) {
    return {
      ...entry,
      axisX: axisX ?? false,
      axisY: axisY ?? false,
      axisOp
    };
  }
  const axis = entry?.axis || 'x';
  if (axis === 'xy') {
    return { ...entry, axisX: true, axisY: true, axisOp };
  }
  if (axis === 'y') {
    return { ...entry, axisX: false, axisY: true, axisOp };
  }
  return { ...entry, axisX: true, axisY: false, axisOp };
};

const resolvePositionMappings = (config) => {
  const position = config?.position || {};
  if (Array.isArray(position.mappings)) {
    return position.mappings.map(entry => normalizePositionMapping({ ...entry }));
  }
  // Hard-cutover behavior: only explicit mapping entries are surfaced to UI.
  return [];
};

export {
  NOTE_NAMES,
  CHORD_OPTIONS,
  POSITION_AXIS_OPERATORS,
  POSITION_TARGETS,
  REPEAT_TARGETS,
  REPEAT_WINDOW_OPTIONS,
  EXCLUDED_TRIGGER_NAMES,
  TRIGGER_NAME_BY_VALUE,
  buildTriggerLabel,
  listTriggerEntries,
  TRAP_SFX_IDS,
  EXCLUDED_SFX_IDS,
  SFX_NAME_BY_ID,
  collectTriggerTypes,
  resolveAvailableSfxIds,
  resolvePositionMappings
};
