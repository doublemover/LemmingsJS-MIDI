import { Lemmings } from './LemmingsNamespace.js';

class ActionFryingSystem {
    static sprites = new Map();
    constructor(sprites) {
        if (ActionFryingSystem.sprites.size == 0) {
            ActionFryingSystem.sprites.set("both", sprites.getAnimation(Lemmings.SpriteTypes.FRYING, false));
        }
    }

    getActionName() {
        return "frying";
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        const frame = ActionFryingSystem.sprites.get("both").getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }

    process(level, lem) {
        lem.disable();
        lem.frameIndex++;
        if (lem.frameIndex >= 13) {
            lemmings.game.lemmingManager.miniMap.addDeath(lem.x, lem.y);
        }
        if (lem.frameIndex == 14) {
            return Lemmings.LemmingStateType.OUT_OF_LEVEL;
        }
        if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
            lem.x += (lem.lookRight ? 1 : -1);
        } else {
            lem.lookRight = !lem.lookRight;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionFryingSystem = ActionFryingSystem;
export { ActionFryingSystem };
