import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
    
class ActionOhNoSystem extends ActionBaseSystem {
    constructor(sprites) {
        super({ sprites, spriteType: Lemmings.SpriteTypes.OHNO, singleSprite: true, actionName: 'oh-no' });
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
        if (++lem.frameIndex == 16) {
            return Lemmings.LemmingStateType.EXPLODING;
        }
        
        // fall down!
        for (let i = 0; i < 3; i++) {
            if (!level.hasGroundAt(lem.x, lem.y + 1)) {
                lem.y++;
                break;
            }
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionOhNoSystem = ActionOhNoSystem;
export { ActionOhNoSystem };
