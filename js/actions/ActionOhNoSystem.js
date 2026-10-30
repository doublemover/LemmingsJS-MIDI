import { ActionBaseSystem } from './ActionBaseSystem.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

class ActionOhNoSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.OHNO, singleSprite: true, actionName: 'oh-no' });
  }

  triggerLemAction(lem) {
    return false;
  }


  process(level, lem) {
    if (++lem.frameIndex === 16) {
      return LemmingStateType.EXPLODING;
    }

    // fall down!
    for (let i = 0; i < 3; i++) {
      if (!level.hasGroundAt(lem.x, lem.y + 1)) {
        lem.y++;
        break;
      }
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionOhNoSystem };
