import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionBuildSystem extends ActionBaseSystem {
        super({ sprites, spriteType: Lemmings.SpriteTypes.BUILDING, actionName: 'building' });
                if (level.hasGroundAt(lem.x, lem.y - 1)) {
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.WALKING;
                }
            }
            if (++lem.state >= 12) return Lemmings.LemmingStateType.SHRUG;
            if (level.hasGroundAt(lem.x + (lem.lookRight ? 2 : -2), lem.y - 9)) {
                lem.lookRight = !lem.lookRight;
                return Lemmings.LemmingStateType.WALKING;
            }
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}
Lemmings.ActionBuildSystem = ActionBuildSystem;

export { ActionBuildSystem };
