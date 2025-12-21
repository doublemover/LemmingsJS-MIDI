import { ActionBaseSystem } from './ActionBaseSystem.js';
import { Lemming } from './Lemming.js';
import { LemmingStateType } from './LemmingStateType.js';
import { SpriteTypes } from './SpriteTypes.js';

class ActionWalkSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.WALKING, actionName: 'walk' });
  }
  triggerLemAction(lem) {
    return false;
  }
  process(level, lem) {
    lem.frameIndex++;
    const prevX = lem.x;
    lem.x += (lem.lookRight ? 1 : -1);

    const groundMask = level.getGroundMaskLayer();
    const upDelta = groundMask.getColumnStepHeight(lem.x, lem.y - 7, 8);
    if (upDelta == 8) {
      // collision with obstacle
      lem.x = prevX; // revert movement into wall
      if (lem.canClimb) {
        return LemmingStateType.CLIMBING;
      } else {
        lem.lookRight = !lem.lookRight;
        return LemmingStateType.NO_STATE_TYPE;
      }
    } else if (upDelta > 0) {
      lem.y -= upDelta - 1;
      if (upDelta > 3) {
        lem.state = 0;
        return LemmingStateType.JUMPING;
      } else {
        if (lem.y < Lemming.LEM_MIN_Y) {
          lem.y = Lemming.LEM_MIN_Y;
        }
        return LemmingStateType.NO_STATE_TYPE;
      }
    } else {
      let downDelta = groundMask.getColumnGapDepth(lem.x, lem.y + 1, 3);
      lem.y += downDelta;
      if (downDelta == 4) {
        return LemmingStateType.FALLING;
      } else {
        return LemmingStateType.NO_STATE_TYPE;
      }
    }
  }
}
export { ActionWalkSystem };
