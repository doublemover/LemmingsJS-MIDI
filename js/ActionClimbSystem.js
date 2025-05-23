import { Lemmings } from './LemmingsNamespace.js';

class ActionClimbSystem {
        constructor(sprites) {
            this.sprite = [
                sprites.getAnimation(Lemmings.SpriteTypes.CLIMBING, false),
                sprites.getAnimation(Lemmings.SpriteTypes.CLIMBING, true)
            ];
        }
        getActionName() {
            return "climbing";
        }
        triggerLemAction(lem) {
            if (lem.canClimb) {
                return false;
            }
            lem.canClimb = true;
            return true;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            const ani = this.sprite[(lem.lookRight ? 1 : 0)];
            const frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
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
