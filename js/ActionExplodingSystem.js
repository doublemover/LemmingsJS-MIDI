import { Lemmings } from './LemmingsNamespace.js';

class ActionExplodingSystem {
        constructor(sprites, masks, triggerManager, particleTable) {
            this.triggerManager = triggerManager;
            this.particleTable = particleTable;
            this.mask = masks.GetMask(Lemmings.MaskTypes.EXPLODING);
            this.sprite = sprites.getAnimation(Lemmings.SpriteTypes.EXPLODING, false);
        }
        getActionName() {
            return "exploding";
        }
        triggerLemAction(lem) {
            return false;
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            if (lem.frameIndex == 0) {
                let frame = this.sprite.getFrame(lem.frameIndex);
                gameDisplay.drawFrame(frame, lem.x-10, lem.y-8);
            } else {
                this.particleTable.draw(gameDisplay, lem.frameIndex - 1, lem.x, lem.y);
            }
        }
        process(level, lem) {
            lem.disable();
            lem.frameIndex++;
            if (lem.frameIndex == 1) {
                this.triggerManager.removeByOwner(lem);
                level.clearGroundWithMask(this.mask.GetMask(0), lem.x, lem.y);
            }
            if (lem.frameIndex == 52) {
                return Lemmings.LemmingStateType.OUT_OF_LEVEL;
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
    }
    Lemmings.ActionExplodingSystem = ActionExplodingSystem;

export { ActionExplodingSystem };
