import { Lemmings } from './LemmingsNamespace.js';

class ActionShrugSystem {
    static sprites = new Map();
    constructor(sprites) {
        if (ActionShrugSystem.sprites.size == 0) {
            ActionShrugSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.SHRUGGING, false));
            ActionShrugSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.SHRUGGING, true));
        }
    }

    getActionName() {
        return "shrugging";
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        const frame = ActionShrugSystem.sprites.get(lem.getDirection()).getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }

    process(level, lem) {
        lem.frameIndex++;
        if (lem.frameIndex >= 8) {
            return Lemmings.LemmingStateType.WALKING;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionShrugSystem = ActionShrugSystem;
export { ActionShrugSystem };
