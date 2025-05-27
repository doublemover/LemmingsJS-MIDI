import { Lemmings } from './LemmingsNamespace.js';

class ActionDrowningSystem {
        constructor(sprites) {
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.DROWNING, false);
        }
        getActionName() {
            return "drowning";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            const frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
            if (frameIndex >= 15) {
                lemmings.game.lemmingManager.miniMap.addDeath(lem.x, lem.y);
            }
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex >= 16) {
                return Lemmings.LemmingStateType.OUT_OF_LEVEL;
            }
            if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
                lem.x += (lem.lookRight ? 1 : -1);
            } else {
                lem.lookRight = !lem.lookRight;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionDrowningSystem = ActionDrowningSystem;

export { ActionDrowningSystem };
