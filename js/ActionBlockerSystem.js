import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionBlockerSystem extends ActionBaseSystem {

  constructor(sprites, triggerManager) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.BLOCKING, singleSprite: true, actionName: 'blocking' });
    this.triggerManager = triggerManager;
  }

  process(level, lem) {
    if (lem.state == 0) {
      const trigger1 = new Lemmings.Trigger(Lemmings.TriggerTypes.BLOCKER_LEFT, lem.x - 6, lem.y + 4, lem.x - 3, lem.y - 10, 0, 0, lem);
      const trigger2 = new Lemmings.Trigger(Lemmings.TriggerTypes.BLOCKER_RIGHT, lem.x + 7, lem.y + 4, lem.x + 4, lem.y - 10, 0, 0, lem);
      this.triggerManager.add(trigger1);
      this.triggerManager.add(trigger2);
      lem.state = 1;
    }
    lem.frameIndex++;
    if (!level.hasGroundAt(lem.x, lem.y + 1)) {
      this.triggerManager.removeByOwner(lem);
      return Lemmings.LemmingStateType.FALLING;
    }
    return Lemmings.LemmingStateType.NO_STATE_TYPE;
  }
}

Lemmings.ActionBlockerSystem = ActionBlockerSystem;
export { ActionBlockerSystem };
