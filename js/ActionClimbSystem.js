import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
    
class ActionClimbSystem extends ActionBaseSystem {

    constructor(sprites) {
        super({ sprites, spriteType: Lemmings.SpriteTypes.CLIMBING, actionName: 'climbing' });
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
                return Lemmings.LemmingStateType.HOISTING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        } else {
            lem.y--;
            if (level.hasGroundAt(lem.x + (lem.lookRight ? -1 : 1), lem.y - 8)) {
                lem.lookRight = !lem.lookRight;
                lem.x += (lem.lookRight ? 2 : -2);
                return Lemmings.LemmingStateType.FALLING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
}
Lemmings.ActionClimbSystem = ActionClimbSystem;

export { ActionClimbSystem };
