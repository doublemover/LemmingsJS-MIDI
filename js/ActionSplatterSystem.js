import { Lemmings } from './LemmingsNamespace.js';

class ActionSplatterSystem {
        constructor(sprites) {
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.SPLATTING, false);
        }
        getActionName() {
            return "splatter";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            const frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
            if (lem.frameIndex >= 15) {
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
