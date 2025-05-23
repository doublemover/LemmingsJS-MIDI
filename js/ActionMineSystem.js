import { Lemmings } from './LemmingsNamespace.js';

class ActionMineSystem {
        constructor(sprites, masks) {
            this.sprite = [
                sprites.getAnimation(Lemmings.SpriteTypes.MINING, false),
                sprites.getAnimation(Lemmings.SpriteTypes.MINING, true)
            ];
            this.masks = [
                masks.GetMask(Lemmings.MaskTypes.MINING_L),
                masks.GetMask(Lemmings.MaskTypes.MINING_R)
            ];
        }
        draw(gameDisplay, lem) {
            const ani = this.sprite[(lem.lookRight ? 1 : 0)];
            const frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        getActionName() {
            return "mining";
        }
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        process(level, lem) {
            lem.frameIndex = (lem.frameIndex + 1) % 24;
            switch (lem.frameIndex) {
            case 1:
            case 2:
                let mask = this.masks[(lem.lookRight ? 1 : 0)];
                let maskIndex = lem.frameIndex - 1;
                let subMask   = mask.GetMask(maskIndex);
                if (level.hasSteelUnderMask(subMask, lem.x, lem.y)) {
                    return Lemmings.LemmingStateType.SHRUG;
                }
                if (level.hasArrowUnderMask(subMask, lem.x, lem.y, lem.lookRight)) {
                        return Lemmings.LemmingStateType.SHRUG;
                }
                level.clearGroundWithMask(subMask, lem.x, lem.y);
                break;
            case 3:
                lem.y++;
                // no break here
            case 15:
                lem.x += lem.lookRight ? 1 : -1;
                if (!level.hasGroundAt(lem.x, lem.y)) {
                    return Lemmings.LemmingStateType.FALLING;
                }
                break;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionMineSystem = ActionMineSystem;

export { ActionMineSystem };
