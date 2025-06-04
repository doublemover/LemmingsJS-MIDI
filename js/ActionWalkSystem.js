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
        /**
         * Scan upward to determine how tall the obstacle directly in front of
         * the lemming is. Returns a value between 0 and 7 inclusive, or 8 if
         * the column is completely solid up to 7px above the current Y.
         */
        getGroundStepDelta(groundMask, x, y) {
            let dy = 0;
            let checkY = y - 1; // start one pixel above current foot level
            while (dy <= 6 && groundMask.hasGroundAt(x, checkY)) {
                dy++;
                checkY--;
            }
            return dy;
        }

        /**
         * Scan downward to see how far the lemming can drop before falling.
         * Returns a value between 1 and 3 inclusive, or 4 if no ground was
         * found within those three pixels.
         */
        getGroudGapDelta(groundMask, x, y) {
            let dy = 1;
            while (dy <= 3) {
                if (groundMask.hasGroundAt(x, y + dy)) break;
                dy++;
            }
            return dy > 3 ? 4 : dy;
        }
        process(level, lem) {
            lem.frameIndex++;
            lem.x += (lem.lookRight ? 1 : -1);
            const groundMask = level.getGroundMaskLayer();

            if (groundMask.hasGroundAt(lem.x, lem.y)) {
                // Obstacle directly ahead - walk up, jump or turn around
                const upDelta = this.getGroundStepDelta(groundMask, lem.x, lem.y);

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

            // Nothing at feet - walk down or start falling
            const downDelta = this.getGroudGapDelta(groundMask, lem.x, lem.y);
            lem.y += downDelta;
            if (downDelta === 4) {
                return Lemmings.LemmingStateType.FALLING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionWalkSystem = ActionWalkSystem;

export { ActionWalkSystem };