import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

class ActionBuildSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.BUILDING, actionName: 'building' });
  }
  process(level, lem) {
    const levelWidth = Number.isFinite(level?.width) ? level.width : null;
    const levelHeight = Number.isFinite(level?.height) ? level.height : null;
    const inHorizontalBounds = (x) => levelWidth == null || (x >= 0 && x < levelWidth);
    const inVerticalBounds = (y) => levelHeight == null || (y >= 0 && y < levelHeight);
    const hitsOpposingArrow = (x, y) => (
      typeof level?.isArrowAt === 'function' &&
      level.isArrowAt(x, y, lem.lookRight)
    );

    lem.frameIndex = (lem.frameIndex + 1) % 16;
    if (lem.frameIndex === 9) {
      /// lay brick
      const startX = lem.x + (lem.lookRight ? 0 : -4);
      const brickY = lem.y - 1;
      for (let i = 0; i < 6; i++) {
        const brickX = startX + i;
        if (!inHorizontalBounds(brickX) || !inVerticalBounds(brickY)) continue;
        level.setGroundAt(brickX, brickY, 7);
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
    if (lem.frameIndex === 0) {
      lem.y--;
      for (let i = 0; i < 2; i++) {
        const nextX = lem.x + (lem.lookRight ? 1 : -1);
        if (!inHorizontalBounds(nextX)) {
          lem.lookRight = !lem.lookRight;
          return LemmingStateType.WALKING;
        }
        if (hitsOpposingArrow(nextX, lem.y - 1)) {
          // One-way walls should reflect builders without dropping them to walk.
          lem.lookRight = !lem.lookRight;
          return LemmingStateType.NO_STATE_TYPE;
        }
        lem.x = nextX;
        if (level.hasGroundAt(lem.x, lem.y - 1)) {
          lem.lookRight = !lem.lookRight;
          return LemmingStateType.WALKING;
        }
      }
      if (++lem.state >= 12) return LemmingStateType.SHRUG;
      const nextHeadX = lem.x + (lem.lookRight ? 2 : -2);
      if (!inHorizontalBounds(nextHeadX)) {
        lem.lookRight = !lem.lookRight;
        return LemmingStateType.WALKING;
      }
      if (hitsOpposingArrow(nextHeadX, lem.y - 9)) {
        lem.lookRight = !lem.lookRight;
        return LemmingStateType.NO_STATE_TYPE;
      }
      if (level.hasGroundAt(nextHeadX, lem.y - 9)) {
        lem.lookRight = !lem.lookRight;
        return LemmingStateType.WALKING;
      }
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionBuildSystem };
