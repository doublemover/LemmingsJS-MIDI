import { Lemmings } from './LemmingsNamespace.js';

class ActionJumpSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, true));
        }
        getActionName() {
            return "jump";
        }
        triggerLemAction(lem) {
            return false;
        }
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            lem.frameIndex++;
            let i = 0;
            for (; i < 2; i++) {
                if (!level.hasGroundAt(lem.x, lem.y + i - 1)) {
                    break;
                }
            }
            lem.y -= i;
            if (i < 2) {
                return Lemmings.LemmingStateType.WALKING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE; // this.check_top_collision(lem);
        }
    }
    Lemmings.ActionJumpSystem = ActionJumpSystem;

export { ActionJumpSystem };
