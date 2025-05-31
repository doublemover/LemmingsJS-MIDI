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
        let i = 0;
        for (; i < 2; i++) {
            if (!level.hasGroundAt(lem.x, lem.y - i - 1)) {
                break;
            }
        }
        lem.y -= i;
        if (i < 2) { // stop jumping
            return Lemmings.LemmingStateType.WALKING;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE; // this.check_top_collision(lem); <no idea what this is for
    }
}

Lemmings.ActionJumpSystem = ActionJumpSystem;
export { ActionJumpSystem };
