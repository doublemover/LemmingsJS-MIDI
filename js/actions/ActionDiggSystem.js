import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';
        
class ActionDiggSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.DIGGING, actionName: 'digging' });
  }
  process(level, lem) {
    if (level.isSteelGround(lem.x, lem.y) ||
                level.isSteelGround(lem.x, lem.y - 1) ||
                level.isSteelGround(lem.x, lem.y - 2)) {
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.STEEL_HIT,
        SoundEffectIds.STEEL_HIT,
        { lemmingId: lem.id, x: lem.x, y: lem.y }
      );
      return LemmingStateType.SHRUG;
    }
    if (lem.state == 0) {
      this.digRow(level, lem, lem.y - 2);
      this.digRow(level, lem, lem.y - 1);
      lem.state = 1;
    } else {
      lem.frameIndex = (lem.frameIndex + 1) % 16;
    }
    if (!(lem.frameIndex & 0x07)) {
      lem.y++;
      if (level.isOutOfLevel(lem.y)) {
        return LemmingStateType.FALLING;
      }
      if (!this.digRow(level, lem, lem.y - 1)) {
        return LemmingStateType.FALLING;
      }
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
  digRow(level, lem, y) {
    let removeCount = 0;
    for (let x = lem.x - 4; x < lem.x + 5; x++) {
      if (level.hasGroundAt(x, y)) {
        level.clearGroundAt(x, y);
        removeCount++;
      }
    }
    return (removeCount > 0);
  }
}
export { ActionDiggSystem };
