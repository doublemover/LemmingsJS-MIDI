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
            let frameIndex = lem.frameIndex;
            let frame = this.sprite.getFrame(frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
            if (frameIndex >= 16) {
                gameDisplay.miniMap.addDeath(lem.x, lem.y);
            }
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex >= 16) {
                return Lemmings.LemmingStateType.OUT_OF_LEVEL;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionSplatterSystem = ActionSplatterSystem;

export { ActionSplatterSystem };
