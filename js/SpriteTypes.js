import { Lemmings } from './LemmingsNamespace.js';

export const SpriteTypes = Object.freeze({
  WALKING: 0,
  EXPLODING: 1,
  JUMPING: 2,
  DIGGING: 3,
  CLIMBING: 4,
  POSTCLIMBING: 5,
  BUILDING: 6,
  BLOCKING: 7,
  BASHING: 8,
  FALLING: 9,
  UMBRELLA: 10,
  SPLATTING: 11,
  MINING: 12,
  DROWNING: 13,
  EXITING: 14,
  FRYING: 15,
  OHNO: 16,
  LEMACTION_SHRUG: 17,
  SHRUGGING: 18,
  OUT_OF_LEVEL: 19
});

Lemmings.SpriteTypes = SpriteTypes;
