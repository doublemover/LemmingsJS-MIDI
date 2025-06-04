import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionMineSystem extends ActionBaseSystem {
    constructor(sprites, masks) {
        super({
            sprites,
            spriteType: Lemmings.SpriteTypes.MINING,
            masks,
            maskTypes: { left: Lemmings.MaskTypes.MINING_L, right: Lemmings.MaskTypes.MINING_R },
            actionName: 'mining'
        });
            let mask = this.masks.get(lem.getDirection());
            }
            level.clearGroundWithMask(subMask, lem.x, lem.y);
            break;
        case 3:
            lem.y++;
            // no break here
        case 15:
            lem.x += lem.lookRight ? 1 : -1;
            if (!level.hasGroundAt(lem.x, lem.y)) {
                return Lemmings.LemmingStateType.FALLING;
            }
            break;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}
Lemmings.ActionMineSystem = ActionMineSystem;

export { ActionMineSystem };
