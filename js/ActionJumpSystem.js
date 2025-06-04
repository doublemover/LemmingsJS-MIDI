import { Lemmings } from './LemmingsNamespace.js';

class ActionJumpSystem {
    static sprites = new Map();
    constructor(sprites) {
        if (ActionJumpSystem.sprites.size == 0) {
            ActionJumpSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.JUMPING, false));
            ActionJumpSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.JUMPING, true));
        }
    }

    getActionName() {
        return "jump";
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        const ani = ActionJumpSystem.sprites.get(lem.getDirection());
        const frame = ani.getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }

    process(level, lem) {
        lem.frameIndex++;
        lem.x += (lem.lookRight ? 1 : -1);

        let moved = 0;
        while (moved < 2 && level.hasGroundAt(lem.x, lem.y - moved - 1)) {
            moved++;
            lem.y--;
        }

        if (moved < 2) {
            return Lemmings.LemmingStateType.WALKING;
        }

        if (!level.hasGroundAt(lem.x, lem.y + 1)) {
            return Lemmings.LemmingStateType.FALLING;
        }

        if (lem.y < Lemmings.Lemming.LEM_MIN_Y) {
            lem.y = Lemmings.Lemming.LEM_MIN_Y;
        }

        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionJumpSystem = ActionJumpSystem;
export { ActionJumpSystem };
