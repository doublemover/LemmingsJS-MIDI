import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { MaskTypes } from '../render/MaskTypes.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const countClearable = (mask) => {
  if (!mask) return 0;
  let count = 0;
  for (let dy = 0; dy < mask.height; dy++) {
    for (let dx = 0; dx < mask.width; dx++) {
      if (!mask.at(dx, dy)) count++;
    }
  }
  return count;
};
const scaleIntensity = (removed, maxCount) => {
  if (!removed || removed <= 0) return 1;
  const denom = Math.max((maxCount || 1) - 1, 1);
  const ratio = (removed - 1) / denom;
  return clamp(1 + ratio, 0.1, 2);
};

class ActionMineSystem extends ActionBaseSystem {
  constructor(sprites, masks) {
    super({
      sprites,
      spriteType: SpriteTypes.MINING,
      masks,
      maskTypes: { left: MaskTypes.MINING_L, right: MaskTypes.MINING_R },
      actionName: 'mining'
    });
  }
  process(level, lem) {
    lem.frameIndex = (lem.frameIndex + 1) % 24;
    switch (lem.frameIndex) {
    case 1:
    case 2:
      let mask = this.masks.get(lem.getDirection());
      let maskIndex = lem.frameIndex - 1;
      let subMask   = mask.GetMask(maskIndex);
      if (level.hasSteelUnderMask(subMask, lem.x, lem.y)) {
        const soundBus = getSoundBus();
        soundBus?.emitSfx?.(
          SoundEventTypes.STEEL_HIT,
          SoundEffectIds.STEEL_HIT,
          { lemmingId: lem.id, x: lem.x, y: lem.y }
        );
        return LemmingStateType.SHRUG;
      }
      if (level.hasArrowUnderMask(subMask, lem.x, lem.y, lem.lookRight)) {      
        return LemmingStateType.SHRUG;
      }
      const removed = typeof level.clearGroundWithMaskCount === 'function'
        ? level.clearGroundWithMaskCount(subMask, lem.x, lem.y)
        : (level.clearGroundWithMask(subMask, lem.x, lem.y), 0);
      if (removed > 0) {
        const soundBus = getSoundBus();
        soundBus?.emitSfx?.(
          SoundEventTypes.LEMMING_MINE,
          SoundEffectIds.MINE,
          {
            lemmingId: lem.id,
            x: lem.x,
            y: lem.y,
            removed,
            intensity: scaleIntensity(removed, countClearable(subMask))
          }
        );
      }
      break;
    case 3:
      lem.y++;
      // no break here
    case 15:
      lem.x += lem.lookRight ? 1 : -1;
      if (!level.hasGroundAt(lem.x, lem.y)) {
        return LemmingStateType.FALLING;
      }
      break;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionMineSystem };
