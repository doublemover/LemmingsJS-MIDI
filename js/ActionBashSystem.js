import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';
import { LemmingStateType } from './LemmingStateType.js';
import { MaskTypes } from './MaskTypes.js';
import { SpriteTypes } from './SpriteTypes.js';
class ActionBashSystem extends ActionBaseSystem {
  constructor(sprites, masks) {
    super({
      sprites,
      spriteType: SpriteTypes.BASHING,
      masks,
      maskTypes: { left: MaskTypes.BASHING_L, right: MaskTypes.BASHING_R },
      actionName: 'bashing'
    });
  }

  process(level, lem) {
    const groundMask = level.getGroundMaskLayer();
    lem.frameIndex++;
    const state = lem.frameIndex % 16;

    // move lemming
    if (state > 10) {
      lem.x += (lem.lookRight ? 1 : -1);
      const yDelta = this.findGapDelta(groundMask, lem.x, lem.y);
      lem.y += yDelta;
      if (yDelta == 3) {
        return LemmingStateType.FALLING;
      }
    }

    // apply mask
    if (state > 1 && state < 6) {
      const subMask = this.masks.get(lem.getDirection()).GetMask(state - 2);
      if (state === 3) {
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
      }
      level.clearGroundWithMask(subMask, lem.x, lem.y);
    }

    // check if end of solid
    if (state == 5) {
      if (this.findHorizontalSpace(groundMask, lem.x + (lem.lookRight ? 8 : -8),
        lem.y - 6, lem.lookRight) == 4) {
        return LemmingStateType.WALKING;
      }
    }

    return LemmingStateType.NO_STATE_TYPE;
  }
  
  findGapDelta(groundMask, x, y) {
    for (let i = 0; i < 3; i++) {
      if (groundMask.hasGroundAt(x, y + i)) {
        return i;
      }
    }
    return 3;
  }
  findHorizontalSpace(groundMask, x, y, lookRight) {
    for (let i = 0; i < 4; i++) {
      if (groundMask.hasGroundAt(x, y)) {
        return i;
      }
      x += (lookRight ? 1 : -1);
    }
    return 4;
  }
}
export { ActionBashSystem };
