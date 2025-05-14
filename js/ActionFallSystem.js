import { Lemmings } from './LemmingsNamespace.js';

class ActionFallSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.FALLING, true));
        }
        getActionName() {
            return "falling";
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
            if (lem.state > 16 && (lem.hasParachute)) {
                return Lemmings.LemmingStateType.FLOATING;
            }
            // fall down!
            let i = 0;
            for (; i < 3; i++) {
                if (level.hasGroundAt(lem.x, lem.y + i)) {
                    break;
                }
            }
            lem.y += i;
            if (i == 3) {
                lem.state += i;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            } else {
                // landed
                if (lem.state > Lemmings.Lemming.LEM_MAX_FALLING) {
                    return Lemmings.LemmingStateType.SPLATTING;
                }
                return Lemmings.LemmingStateType.WALKING;
            }
        }
    }
    Lemmings.ActionFallSystem = ActionFallSystem;

export { ActionFallSystem };
