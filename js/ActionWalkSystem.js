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
            for (let i = 0; i <= 6; i++) {
                if (!groundMask.hasGroundAt(x, y - i)) {
                    return i;
                }
            }
            return 7;
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

            if (groundMask.hasGroundAt(lem.x, lem.y)) {
                let dy = 0;
                let newY = lem.y;
                while (dy <= 6 && groundMask.hasGroundAt(lem.x, newY - 1)) {
                    dy++;
                    newY--;
                }

                if (dy > 6) {
                    if (lem.canClimb) {
                        return Lemmings.LemmingStateType.CLIMBING;
                    } else {
                        lem.lookRight = !lem.lookRight;
                        return Lemmings.LemmingStateType.NO_STATE_TYPE;
                    }
                }

                if (dy >= 3) {
                    lem.y -= 2;
                    return Lemmings.LemmingStateType.JUMPING;
                }

                lem.y = newY;
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }

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