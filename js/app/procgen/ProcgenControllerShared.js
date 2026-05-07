import { Lemming } from '../../lemmings/Lemming.js';
import { SkillTypes } from '../../game/SkillTypes.js';
import { SoundEventTypes } from '../../game/SoundEvents.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';

const HAZARD_TRIGGER_TYPES = new Set([
  TriggerTypes.TRAP,
  TriggerTypes.DROWN,
  TriggerTypes.KILL,
  TriggerTypes.FRYING
]);

export {
  HAZARD_TRIGGER_TYPES,
  Lemming,
  SkillTypes,
  SoundEventTypes,
  TriggerTypes
};
