import { Lemmings } from './LemmingsNamespace.js';

class ActionOhNoSystem {
        constructor(sprites) {
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.OHNO, false);
        }
        getActionName() {
            return "oh-no";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            const frame = this.sprite.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
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
