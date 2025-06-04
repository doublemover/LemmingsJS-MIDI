import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionSplatterSystem extends ActionBaseSystem {
            super({ sprites, spriteType: Lemmings.SpriteTypes.SPLATTING, singleSprite: true, actionName: 'splatter' });
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            super.draw(gameDisplay, lem);
                lemmings.game.lemmingManager.miniMap.addDeath(lem.x, lem.y);
            }
        }
        process(level, lem) {
            lem.disable();
            if (++lem.frameIndex >= 16) return Lemmings.LemmingStateType.OUT_OF_LEVEL;
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionSplatterSystem = ActionSplatterSystem;

export { ActionSplatterSystem };
