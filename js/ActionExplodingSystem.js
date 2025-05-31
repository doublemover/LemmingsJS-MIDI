import { Lemmings } from './LemmingsNamespace.js';

class ActionExplodingSystem {
    static sprites = new Map();
    static masks = new Map();

    constructor(sprites, masks, triggerManager, particleTable) {
        this.triggerManager = triggerManager;
        this.particleTable = particleTable;
        if (ActionExplodingSystem.sprites.size == 0) {
            ActionExplodingSystem.sprites.set("both", sprites.getAnimation(Lemmings.SpriteTypes.EXPLODING, false));
        }
        if (ActionExplodingSystem.masks.size == 0) {
            ActionExplodingSystem.masks.set("both", masks.GetMask(Lemmings.MaskTypes.EXPLODING));
        }
    }

    getActionName() {
        return "exploding";
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        if (lem.frameIndex == 0) {
            const ani = ActionExplodingSystem.sprites.get("both");
            const frame = ani.getFrame(lem.frameIndex);
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
            level.clearGroundWithMask(ActionExplodingSystem.masks.get("both").GetMask(0), lem.x, lem.y);
        }
        if (lem.frameIndex == 52) {
            return Lemmings.LemmingStateType.OUT_OF_LEVEL;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionExplodingSystem = ActionExplodingSystem;
export { ActionExplodingSystem };
