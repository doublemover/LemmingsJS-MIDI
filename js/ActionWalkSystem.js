import { Lemmings } from './LemmingsNamespace.js';

class ActionWalkSystem {
        constructor(sprites) {
            this.sprite = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.WALKING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.WALKING, true));
        }
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        getActionName() {
            return "walk";
        }
        triggerLemAction(lem) {
            return false;
        }
        getGroundStepDelta(groundMask, x, y) {
            for (let i = 0; i < 8; i++) {
                if (!groundMask.hasGroundAt(x, y - i)) {
                    return i;
                }
            }
            return 8;
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
            let groundMask = level.getGroundMaskLayer();
            let upDelta = this.getGroundStepDelta(groundMask, lem.x, lem.y);
            if (upDelta == 8) {
                // collision with obstacle
                if (lem.canClimb) {
                    // start climbing
                    return Lemmings.LemmingStateType.CLIMBING;
                } else {
                    // turn around
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            } else if (upDelta > 0) {
                lem.y -= upDelta - 1;
                if (upDelta > 3) {
                    // jump
                    return Lemmings.LemmingStateType.JUMPING;
                } else {
                    // walk with small jump up
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            } else {
                // walk or fall
                let downDelta = this.getGroudGapDelta(groundMask, lem.x, lem.y);
                lem.y += downDelta;
                if (downDelta == 4) {
                    return Lemmings.LemmingStateType.FALLING;
                } else {
                    // walk with small jump down
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
                }
            }
        }
    }
    Lemmings.ActionWalkSystem = ActionWalkSystem;

export { ActionWalkSystem };
