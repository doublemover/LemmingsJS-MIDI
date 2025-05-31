import { Lemmings } from './LemmingsNamespace.js';

class ActionBuildSystem {
    static sprites = new Map();
    constructor(sprites) {
        if (ActionBuildSystem.sprites.size == 0) {
            ActionBuildSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.BUILDING, false));
            ActionBuildSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.BUILDING, true));
        }
    }

    getActionName() {
        return "building";
    }

    triggerLemAction(lem) {
        lem.setAction(this);
        return true;
    }
    draw(gameDisplay, lem) {
        const ani = ActionBuildSystem.sprites.get(lem.getDirection());
        const frame = ani.getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }
    process(level, lem) {
        lem.frameIndex = (lem.frameIndex + 1) % 16;
        if (lem.frameIndex == 9) {
            /// lay brick
            const startX = lem.x + (lem.lookRight ? 0 : -4);
            for (let i = 0; i < 6; i++) {
                level.setGroundAt(startX + i, lem.y - 1, 7);
            }
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
        if (lem.frameIndex == 0) {
            lem.y--;
            for (let i = 0; i < 2; i++) {
                lem.x += (lem.lookRight ? 1 : -1);
                if (level.hasGroundAt(lem.x, lem.y - 1)) {
                    lem.lookRight = !lem.lookRight;
                    return Lemmings.LemmingStateType.WALKING;
                }
            }
            if (++lem.state >= 12) return Lemmings.LemmingStateType.SHRUG;
            if (level.hasGroundAt(lem.x + (lem.lookRight ? 2 : -2), lem.y - 9)) {
                lem.lookRight = !lem.lookRight;
                return Lemmings.LemmingStateType.WALKING;
            }
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}
Lemmings.ActionBuildSystem = ActionBuildSystem;

export { ActionBuildSystem };
