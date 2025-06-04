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
            let h = 0;
            while (h <= 6 && groundMask.hasGroundAt(x, y - h)) {
                h++;
            }
            return h; // 0..7 (7 means obstacle higher than 6)
        }

        getGroundGapDepth(groundMask, x, y) {
            let d = 1;
            while (d <= 3 && !groundMask.hasGroundAt(x, y + d)) {
                d++;
            }
            return d; // 1..4 (4 means gap deeper than 3)
        }
        process(level, lem) {
            lem.frameIndex++;
            lem.x += (lem.lookRight ? 1 : -1);

            const gm = level.getGroundMaskLayer();

            if (gm.hasGroundAt(lem.x, lem.y)) {
                let h = this.getGroundStepHeight(gm, lem.x, lem.y);

                if (h > 6) {
                    if (lem.canClimb) {
                        return Lemmings.LemmingStateType.CLIMBING;
                    }
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }

                if (h >= 3) {
                    lem.y -= 2;
                    lem.state = 0;
                    return Lemmings.LemmingStateType.JUMPING;
                }

                lem.y -= h;
                if (lem.y < Lemmings.Lemming.LEM_MIN_Y) {
                    lem.y = Lemmings.Lemming.LEM_MIN_Y;
                }
                return Lemmings.LemmingStateType.NO_STATE_TYPE;
            }

            const d = this.getGroundGapDepth(gm, lem.x, lem.y);
            lem.y += d;
            if (d == 4) {
                return Lemmings.LemmingStateType.FALLING;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionWalkSystem = ActionWalkSystem;

export { ActionWalkSystem };