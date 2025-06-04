import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionWalkSystem extends ActionBaseSystem {
        constructor(sprites) {
            super({ sprites, spriteType: Lemmings.SpriteTypes.WALKING, actionName: 'walk' });
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
            const groundMask = level.getGroundMaskLayer();
            const upDelta = this.getGroundStepDelta(groundMask, lem.x, lem.y);
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
                    return Lemmings.LemmingStateType.NO_STATE_TYPE;
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