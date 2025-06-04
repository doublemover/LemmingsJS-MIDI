import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionBashSystem extends ActionBaseSystem {
    constructor(sprites, masks) {
        super({
            sprites,
            spriteType: Lemmings.SpriteTypes.BASHING,
            masks,
            maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R },
            actionName: 'bashing'
        });
    }

    process(level, lem) {
        lem.frameIndex = (lem.frameIndex + 1) % 32;
        const state = Math.floor(lem.frameIndex / 6);

        if (state > 1 && state < 6) {
            const subMask = this.masks.get(lem.getDirection()).GetMask(state - 2);
            if (state === 3) {
                if (level.hasSteelUnderMask(subMask, lem.x, lem.y) ||
                    level.hasArrowUnderMask(subMask, lem.x, lem.y, lem.lookRight)) {
                    return Lemmings.LemmingStateType.SHRUG;
                }
            }
            level.clearGroundWithMask(subMask, lem.x, lem.y);
        }

        if (state == 5) {
            const groundMask = level.getGroundMaskLayer();
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
