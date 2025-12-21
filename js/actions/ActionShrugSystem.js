import { ActionBaseSystem } from './ActionBaseSystem.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

class ActionShrugSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.SHRUGGING, actionName: 'shrugging' });
  }

  triggerLemAction(lem) {
    return false;
  }

  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
  }

  process(level, lem) {
    lem.frameIndex++;
    if (lem.frameIndex >= 8) {
      return LemmingStateType.WALKING;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionShrugSystem };
