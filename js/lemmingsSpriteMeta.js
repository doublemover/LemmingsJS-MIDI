import { Lemmings } from './LemmingsNamespace.js';

const SPRITE_META = {
  [Lemmings.SpriteTypes.WALKING]:    { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.JUMPING]:    { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.DIGGING]:    { bits: 3, width: 16, height: 14 },
  [Lemmings.SpriteTypes.CLIMBING]:   { bits: 2, width: 16, height: 12 },
  [Lemmings.SpriteTypes.DROWNING]:   { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.POSTCLIMBING]:{ bits: 2, width: 16, height: 12 },
  [Lemmings.SpriteTypes.BUILDING]:   { bits: 3, width: 16, height: 13 },
  [Lemmings.SpriteTypes.BASHING]:    { bits: 3, width: 16, height: 10 },
  [Lemmings.SpriteTypes.MINING]:     { bits: 3, width: 16, height: 13 },
  [Lemmings.SpriteTypes.FALLING]:    { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.UMBRELLA]:   { bits: 3, width: 16, height: 16 },
  [Lemmings.SpriteTypes.SPLATTING]:  { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.EXITING]:    { bits: 2, width: 16, height: 13 },
  [Lemmings.SpriteTypes.FRYING]:     { bits: 4, width: 16, height: 14 },
  [Lemmings.SpriteTypes.BLOCKING]:   { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.SHRUGGING]:  { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.OHNO]:       { bits: 2, width: 16, height: 10 },
  [Lemmings.SpriteTypes.EXPLODING]:  { bits: 3, width: 32, height: 32 }
};

export { SPRITE_META };

