import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionBlockerSystem extends ActionBaseSystem {
        super({ sprites, spriteType: Lemmings.SpriteTypes.BLOCKING, singleSprite: true, actionName: 'blocking' });
        if (!level.hasGroundAt(lem.x, lem.y + 1)) {
            this.triggerManager.removeByOwner(lem);
            return Lemmings.LemmingStateType.FALLING;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}
Lemmings.ActionBlockerSystem = ActionBlockerSystem;

export { ActionBlockerSystem };
