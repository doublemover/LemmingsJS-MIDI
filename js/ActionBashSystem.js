import { Lemmings } from './LemmingsNamespace.js';

class ActionBashSystem {
    static sprites = new Map();
    static masks = new Map();
    constructor(sprites, masks) {
        if (ActionBashSystem.sprites.size == 0) {
            ActionBashSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.BASHING, false));
            ActionBashSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.BASHING, true));
        }
        if (ActionBashSystem.masks.size == 0) {
            ActionBashSystem.masks.set("left", masks.GetMask(Lemmings.MaskTypes.BASHING_L));
            ActionBashSystem.masks.set("right", masks.GetMask(Lemmings.MaskTypes.BASHING_R));
        }
    }
    getActionName() {
        return "bashing";
    }

    triggerLemAction(lem) {
        lem.setAction(this);
        return true;
    }

    draw(gameDisplay, lem) {
        const ani = ActionBashSystem.sprites.get(lem.getDirection());
        const frame = ani.getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }

    process(level, lem) {
        const groundMask = level.getGroundMaskLayer();
        lem.frameIndex++;
        const state = lem.frameIndex % 16;
        // move lemming
        if (state > 10) {
            lem.x += (lem.lookRight ? 1 : -1);
            const yDelta = this.findGapDelta(groundMask, lem.x, lem.y);
            lem.y += yDelta;
            if (yDelta == 3) {
                return Lemmings.LemmingStateType.FALLING;
            }
        }
        // apply mask
        if ((state > 1) && (state < 6)) {
            const subMask = ActionBashSystem.masks.get(lem.getDirection()).GetMask(state - 2);
            if (state === 3) {
                if (level.hasSteelUnderMask(subMask, lem.x, lem.y) ||
                    level.hasArrowUnderMask(subMask, lem.x, lem.y, lem.lookRight)) {
                    return Lemmings.LemmingStateType.SHRUG;
                }
            }
            level.clearGroundWithMask(subMask, lem.x, lem.y);
        }
        /// check if end of solid?
        if (state == 5) {
            if (this.findHorizontalSpace(groundMask, lem.x + (lem.lookRight ? 8 : -8), lem.y - 6, lem.lookRight) == 4) {
                return Lemmings.LemmingStateType.WALKING;
            }
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
    findGapDelta(groundMask, x, y) {
        for (let i = 0; i < 3; i++) {
            if (groundMask.hasGroundAt(x, y + i)) {
                return i;
            }
        }
        return 3;
    }
    findHorizontalSpace(groundMask, x, y, lookRight) {
        for (let i = 0; i < 4; i++) {
            if (groundMask.hasGroundAt(x, y)) {
                return i;
            }
            x += (lookRight ? 1 : -1);
        }
        return 4;
    }
}
Lemmings.ActionBashSystem = ActionBashSystem;

export { ActionBashSystem };
