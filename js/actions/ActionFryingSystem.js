import { ActionBaseSystem } from './ActionBaseSystem.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

class ActionFryingSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.FRYING, singleSprite: true, actionName: 'frying' });
  }

  triggerLemAction(lem) {
    return false;
  }

  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
  }

  process(level, lem) {
    lem.disable();
    if (lem.frameIndex === 0) {
      lem.lastTriggerType = null;
    }
    lem.frameIndex++;
    if (lem.frameIndex === 13) {
      const miniMap = globalThis?.lemmings?.game?.lemmingManager?.miniMap;
      if (miniMap) miniMap.addDeath(lem.x, lem.y);
    }
    if (lem.frameIndex === 14) {
      return LemmingStateType.OUT_OF_LEVEL;
    }
    if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
      lem.x += (lem.lookRight ? 1 : -1);
    } else {
      lem.lookRight = !lem.lookRight;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionFryingSystem };
