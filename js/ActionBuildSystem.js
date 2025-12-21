import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';
import { LemmingStateType } from './LemmingStateType.js';
import { SpriteTypes } from './SpriteTypes.js';

class ActionBuildSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.BUILDING, actionName: 'building' });
  }
  process(level, lem) {
    lem.frameIndex = (lem.frameIndex + 1) % 16;
    if (lem.frameIndex == 9) {
      /// lay brick
      const startX = lem.x + (lem.lookRight ? 0 : -4);
      for (let i = 0; i < 6; i++) {
        level.setGroundAt(startX + i, lem.y - 1, 7);
      }
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.BUILDER_STEP,
        SoundEffectIds.BUILDER_STEP,
        { lemmingId: lem.id, x: lem.x, y: lem.y }
      );
      if (lem.state >= 9) {
        soundBus?.emitSfx?.(
          SoundEventTypes.BUILDER_WARNING,
          SoundEffectIds.BUILDER_WARNING,
          { lemmingId: lem.id, x: lem.x, y: lem.y }
        );
      }
      return LemmingStateType.NO_STATE_TYPE;
    }
    if (lem.frameIndex == 0) {
      lem.y--;
      for (let i = 0; i < 2; i++) {
        lem.x += (lem.lookRight ? 1 : -1);
        if (level.hasGroundAt(lem.x, lem.y - 1)) {
          lem.lookRight = !lem.lookRight;
          return LemmingStateType.WALKING;
        }
      }
      if (++lem.state >= 12) return LemmingStateType.SHRUG;
      if (level.hasGroundAt(lem.x + (lem.lookRight ? 2 : -2), lem.y - 9)) {
        lem.lookRight = !lem.lookRight;
        return LemmingStateType.WALKING;
      }
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionBuildSystem };
