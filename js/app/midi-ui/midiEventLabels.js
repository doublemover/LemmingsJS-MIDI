import { SoundEffectIds } from '../../game/SoundEvents.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
const SOUND_LABELS = {
  NONE: 'No sound', SKILL_SELECT: 'Skill selected', ENTRANCE_OPEN: 'Entrance opens', LEVEL_START: 'Level starts', SKILL_ASSIGN: 'Skill assigned',
  OHNO: 'Bomber warning', SPLAT: 'Fatal landing', STEEL_HIT: 'Tool hits steel', EXPLOSION: 'Explosion', EXIT: 'Successful exit', DROWN: 'Drowning',
  BUILDER_WARNING: 'Builder running out of bricks', FELL_OFF: 'Actor leaves the level', BUILDER_STEP: 'Builder places a brick', BASH: 'Basher clears terrain',
  DIG: 'Digger clears terrain', MINE: 'Miner clears terrain', SPAWN: 'Actor released from entrance', LAND: 'Safe landing',
  BLOCKER_TURN: 'Walker turns at a wall or blocker', BLOCKER_CONTACT: 'Walker touches a blocker', COUNTDOWN: 'Bomber countdown', PROCGEN_ROUTE_COMPLETE: 'Procgen crew completes a connected route',
  TRAP_ZAP: 'Electric trap', TRAP_SQUISH: 'Squashing trap', TRAP_SLICER: 'Slicing trap', TRAP_FIRE: 'Fire hazard', TRAP_TEN_TON: 'Heavy trap', TRAP_BEAR: 'Snapping trap', UNKNOWN_0B: 'Unidentified legacy sound'
};
const TRIGGER_LABELS = { NO_TRIGGER: 'No physical trigger', EXIT_LEVEL: 'Exit trigger', TRAP: 'Trap contact', DROWN: 'Water contact', KILL: 'Lethal contact',
  FRYING: 'Fire contact', ONEWAY_LEFT: 'One-way left terrain', ONEWAY_RIGHT: 'One-way right terrain', STEEL: 'Steel terrain',
  BLOCKER_LEFT: 'Blocker turns left', BLOCKER_RIGHT: 'Blocker turns right', DISABLED: 'Cooling or disabled trigger', UNKNOWN_2: 'Unidentified legacy trigger 2', UNKNOWN_3: 'Unidentified legacy trigger 3' };
const midiConditionChoices = (kind, selected = null) => {
  const sound = kind === 'sfx', labels = sound ? SOUND_LABELS : TRIGGER_LABELS, ids = sound ? SoundEffectIds : TriggerTypes;
  const choices = [['', sound ? 'Any sound event' : 'Any physical trigger'], ...Object.entries(ids).map(([key, id]) => [String(id), labels[key]])];
  if (selected != null && !choices.some(([id]) => id === String(selected))) choices.push([String(selected), 'Unrecognized saved ' + (sound ? 'sound event' : 'trigger') + ' (' + selected + ')']);
  return choices;
};
export { midiConditionChoices };
