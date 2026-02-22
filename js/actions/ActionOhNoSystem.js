import { ActionBaseSystem } from './ActionBaseSystem.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';
import { getAppContext } from '../core/dependencies.js';
    
class ActionOhNoSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.OHNO, singleSprite: true, actionName: 'oh-no' });
  }

  triggerLemAction(lem) {
    return false;
  }

  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
    if (lem.frameIndex === 15) {
      const miniMap = getAppContext()?.game?.lemmingManager?.miniMap;
      if (miniMap) miniMap.addDeath(lem.x, lem.y);
    }
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
