import { Lemmings } from './LemmingsNamespace.js';

class ActionBashSystem {
        constructor(sprites, masks) {
            this.sprite = [];
            this.masks = [];
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.BASHING, false));
            this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.BASHING, true));
            this.masks.push(masks.GetMask(Lemmings.MaskTypes.BASHING_L));
            this.masks.push(masks.GetMask(Lemmings.MaskTypes.BASHING_R));
        }
        getActionName() {
            return "bashing";
        }
        /** user called this action */
        triggerLemAction(lem) {
            lem.setAction(this);
            return true;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let ani = this.sprite[(lem.lookRight ? 1 : 0)];
            let frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x, lem.y);
        }
        process(level, lem) {
            let groundMask = level.getGroundMaskLayer();
            lem.frameIndex++;
            let state = lem.frameIndex % 16;
            /// move lemming
            if (state > 10) {
                lem.x += (lem.lookRight ? 1 : -1);
                let yDelta = this.findGapDelta(groundMask, lem.x, lem.y);
                lem.y += yDelta;
                if (yDelta == 3) {
                    return Lemmings.LemmingStateType.FALLING;
                }
            }
            /// apply mask
            if ((state > 1) && (state < 6)) {
                let mask = this.masks[lem.lookRight ? 1 : 0];
                let maskIndex = state - 2;
                let subMask   = mask.GetMask(maskIndex);
                if (state === 3) {
                    if (level.hasSteelUnderMask(subMask, lem.x, lem.y)) {
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
