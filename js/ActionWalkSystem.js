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
        getGroundStepHeight(groundMask, x, y) {
            for (let i = 0; i < 8; i++) {
                if (!groundMask.hasGroundAt(x, y - i)) {
                    return i;
                }
            }
            return 8;
        }

        getGroundGapDepth(groundMask, x, y) {
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
            const upDelta = this.getGroundStepHeight(groundMask, lem.x, lem.y);
            if (upDelta == 8) {
                // collision with obstacle
                if (lem.canClimb) {
                    return Lemmings.LemmingStateType.CLIMBING;
                } else {
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            } else if (upDelta > 0) {
                lem.y -= upDelta - 1;
                if (upDelta > 3) {
                    lem.state = 0;
                    return Lemmings.LemmingStateType.JUMPING;
                } else {
                    if (lem.y < Lemmings.Lemming.LEM_MIN_Y) {
                        lem.y = Lemmings.Lemming.LEM_MIN_Y;
                    }
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            } else {
                let downDelta = this.getGroundGapDepth(groundMask, lem.x, lem.y);
                lem.y += downDelta;
                if (downDelta == 4) {
                    return Lemmings.LemmingStateType.FALLING;
                } else {
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            }
        }
    }
    Lemmings.ActionWalkSystem = ActionWalkSystem;

export { ActionWalkSystem };