import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionClimbSystem extends ActionBaseSystem {
        super({ sprites, spriteType: Lemmings.SpriteTypes.CLIMBING, actionName: 'climbing' });
            return false;
        }
        lem.canClimb = true;
        return true;
    }

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
