import { Lemmings } from './LemmingsNamespace.js';

export const LemmingStateType = Object.freeze({
  NO_STATE_TYPE: 0,
  WALKING: 1,
  SPLATTING: 2,
  EXPLODING: 3,
  FALLING: 4,
  JUMPING: 5,
  DIGGING: 6,
  CLIMBING: 7,
  HOISTING: 8,
  BUILDING: 9,
  BLOCKING: 10,
  BASHING: 11,
  FLOATING: 12,
  MINING: 13,
  DROWNING: 14,
  EXITING: 15,
  FRYING: 16,
  OHNO: 17,
  SHRUG: 18,
  OUT_OF_LEVEL: 19
});

Lemmings.LemmingStateType = LemmingStateType; 
