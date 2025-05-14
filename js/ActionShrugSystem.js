import { Lemmings } from './LemmingsNamespace.js';

class ActionShrugSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.SHRUGGING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.SHRUGGING, true));
        }
        getActionName() {
            return "shrugging";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            if (lem.frameIndex >= 8) {
                return Lemmings.LemmingStateType.WALKING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionShrugSystem = ActionShrugSystem;

export { ActionShrugSystem };
