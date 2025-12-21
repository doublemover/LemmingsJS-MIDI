import { ActionBaseSystem } from './ActionBaseSystem.js';
import { LemmingStateType } from './LemmingStateType.js';
import { SpriteTypes } from './SpriteTypes.js';

class ActionHoistSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.POSTCLIMBING, actionName: 'hoist' });
  }

  triggerLemAction(lem) {
    return false;
  }

  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
  }

  // y+1, x+1 & y+1, x+2 & y+2?
  process(level, lem) {
    lem.frameIndex++;
    // if (!level.hasGroundAt(x + 1, y - 1) &&   // above wall, just ahead
    //     !level.hasGroundAt(x + 2, y - 1) &&   // further ahead, still above
    //     !level.hasGroundAt(x + 2, y)) {       // 2 ahead, at current height

    if (lem.frameIndex <= 4) {
      lem.y -= 2;
      return LemmingStateType.NO_STATE_TYPE;
    }

    if (lem.frameIndex > 4 && lem.frameIndex < 8) {
      return LemmingStateType.NO_STATE_TYPE;
    }
                   
    if (lem.frameIndex >= 8) {
      return LemmingStateType.WALKING;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionHoistSystem };
