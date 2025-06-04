import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionDrowningSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.DROWNING, singleSprite: true, actionName: 'drowning' });
  }
  triggerLemAction(lem) {
    return false;
  }
  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
    if (lem.frameIndex >= 15) {
      lemmings.game.lemmingManager.miniMap.addDeath(lem.x, lem.y);
    }
  }
  process(level, lem) {
    lem.disable();
    lem.frameIndex++;
    if (lem.frameIndex >= 16) {
      return Lemmings.LemmingStateType.OUT_OF_LEVEL;
    }
    if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
      lem.x += (lem.lookRight ? 1 : -1);
    } else {
      lem.lookRight = !lem.lookRight;
    }
    return Lemmings.LemmingStateType.NO_STATE_TYPE;
  }
}
Lemmings.ActionDrowningSystem = ActionDrowningSystem;

export { ActionDrowningSystem };
