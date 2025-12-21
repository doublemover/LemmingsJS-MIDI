import { ActionBaseSystem } from './ActionBaseSystem.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';
    
class ActionClimbSystem extends ActionBaseSystem {

  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.CLIMBING, actionName: 'climbing' });
  }

  triggerLemAction(lem) {
    if (lem.canClimb) {
      return false;
    }
    lem.canClimb = true;
    return true;
  }

  process(level, lem) {
    lem.frameIndex = (lem.frameIndex + 1) % 8;
    if (lem.frameIndex < 4) {
      // check for top
      if (!level.hasGroundAt(lem.x, lem.y - lem.frameIndex - 7)) {
        lem.y = lem.y - lem.frameIndex + 2;
        return LemmingStateType.HOISTING;
      }
      return LemmingStateType.NO_STATE_TYPE;
    } else {
      lem.y--;
      if (level.hasGroundAt(lem.x + (lem.lookRight ? -1 : 1), lem.y - 8)) {
        lem.lookRight = !lem.lookRight;
        lem.x += (lem.lookRight ? 2 : -2);
        return LemmingStateType.FALLING;
      }
      return LemmingStateType.NO_STATE_TYPE;
    }
  }
}
export { ActionClimbSystem };
