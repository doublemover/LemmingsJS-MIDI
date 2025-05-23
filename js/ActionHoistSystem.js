import { Lemmings } from './LemmingsNamespace.js';

class ActionHoistSystem {
        constructor(sprites) {
            this.sprite = [
                sprites.getAnimation(Lemmings.SpriteTypes.POSTCLIMBING, false),
                sprites.getAnimation(Lemmings.SpriteTypes.POSTCLIMBING, true)
            ];
        }
        getActionName() {
            return "hoist";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            const ani = this.sprite[(lem.lookRight ? 1 : 0)];
            const frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.frameIndex <= 4) {
                lem.y -= 2;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }
            if (lem.frameIndex >= 8) {
                return Lemmings.LemmingStateType.WALKING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionHoistSystem = ActionHoistSystem;

export { ActionHoistSystem };
