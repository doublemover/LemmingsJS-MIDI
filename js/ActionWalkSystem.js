import { Lemmings } from './LemmingsNamespace.js';

class ActionWalkSystem {
        static sprites = new Map();
        constructor(sprites) {
            ActionWalkSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.WALKING, false));
            ActionWalkSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.WALKING, true));
        }
        draw(gameDisplay, lem) {
            const ani = ActionWalkSystem.sprites.get(lem.getDirection());
            const frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        getActionName() {
            return "walk";
        }
        triggerLemAction(lem) {
            return false;
        }
        getGroundStepDelta(groundMask, x, y) {
            for (let i = 0; i <= 7; i++) {
                if (!groundMask.hasGroundAt(x, y - i)) {
                    return i;
                }
            }
            return 8; // solid column higher than 7px
        }
        getGroudGapDelta(groundMask, x, y) {
            for (let i = 1; i < 4; i++) {
                if (groundMask.hasGroundAt(x, y + i)) {
                    return i;
                }
            }
            return 4;
        }
        process(level, lem) {
            lem.frameIndex++;
            lem.x += (lem.lookRight ? 1 : -1);
            const groundMask = level.getGroundMaskLayer();
            const upDelta = this.getGroundStepDelta(groundMask, lem.x, lem.y);

            if (upDelta > 0) {
                // obstacle directly ahead
                if (upDelta > 6) {
                    if (lem.canClimb) {
                        return Lemmings.LemmingStateType.CLIMBING;
                    }
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
                if (upDelta >= 3) {
                    lem.y -= 2;
                    return Lemmings.LemmingStateType.JUMPING;
                }
                lem.y -= upDelta;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }

            // no obstacle, check for ground below
            let downDelta = this.getGroudGapDelta(groundMask, lem.x, lem.y);
            lem.y += downDelta;
            if (downDelta == 4) {
                return Lemmings.LemmingStateType.FALLING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionWalkSystem = ActionWalkSystem;

export { ActionWalkSystem };