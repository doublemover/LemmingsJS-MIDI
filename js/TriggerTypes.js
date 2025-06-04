import { Lemmings } from './LemmingsNamespace.js';

export const TriggerTypes = Object.freeze({
  NO_TRIGGER: 0,
  EXIT_LEVEL: 1,
  UNKNOWN_2: 2,
  UNKNOWN_3: 3,
  TRAP: 4,
  DROWN: 5,
  KILL: 6,
  ONEWAY_LEFT: 7,
  ONEWAY_RIGHT: 8,
  STEEL: 9,
  BLOCKER_LEFT: 10,
  BLOCKER_RIGHT: 11,
  FRYING: 12, // gross hack alert to make frying work for now
});

Lemmings.TriggerTypes = TriggerTypes;