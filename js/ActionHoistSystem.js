import { Lemmings } from './LemmingsNamespace.js';

class ActionHoistSystem {
    static sprites = new Map();
    constructor(sprites) {
        if (ActionHoistSystem.sprites.size == 0) {
            ActionHoistSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.POSTCLIMBING, false));
            ActionHoistSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.POSTCLIMBING, true));
        }
    }

    getActionName() {
        return "hoist";
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        const ani = ActionHoistSystem.sprites.get(lem.getDirection());
        const frame = ani.getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }

    // y+1, x+1 & y+1, x+2 & y+2?
    process(level, lem) {
        lem.frameIndex++;
        // if (!level.hasGroundAt(x + 1, y - 1) &&   // above wall, just ahead
        //     !level.hasGroundAt(x + 2, y - 1) &&   // further ahead, still above
        //     !level.hasGroundAt(x + 2, y)) {       // 2 ahead, at current height

        if (lem.frameIndex <= 4) {
            lem.y -= 2;
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }

        if (lem.frameIndex > 4 && lem.frameIndex < 8) {
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
                   
        if (lem.frameIndex >= 8) {
            return Lemmings.LemmingStateType.WALKING;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionHoistSystem = ActionHoistSystem;
export { ActionHoistSystem };
