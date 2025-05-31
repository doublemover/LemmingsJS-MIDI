import { Lemmings } from './LemmingsNamespace.js';

const FLOAT_SPEED = [3, 3, 3, 3, -1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2];
const FLOAT_FRAME = [0, 1, 3, 5, 5, 5, 5, 5, 5, 6, 7, 7, 6, 5, 4, 4];

class ActionFloatingSystem {
    static sprites = new Map();
    constructor(sprites) {
        if (ActionFloatingSystem.sprites.size == 0) {
            ActionFloatingSystem.sprites.set("left", sprites.getAnimation(Lemmings.SpriteTypes.UMBRELLA, false));
            ActionFloatingSystem.sprites.set("right", sprites.getAnimation(Lemmings.SpriteTypes.UMBRELLA, true));
        }
    }
    getActionName() {
        return "floating";
    }
    triggerLemAction(lem) {
        if (lem.hasParachute) {
            return false;
        }
        lem.hasParachute = true;
        return true;
    }
    /** render Lemming to gamedisplay */
    draw(gameDisplay, lem) {
        const ani = ActionFloatingSystem.sprites.get(lem.getDirection());
        const frame = ani.getFrame(FLOAT_FRAME[lem.frameIndex]);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }
    process(level, lem) {
        lem.frameIndex++;
        if (lem.frameIndex >= FLOAT_FRAME.length) {
            /// first 8 are the opening of the umbrella
            lem.frameIndex = 8;
        }
        const speed = FLOAT_SPEED[lem.frameIndex];
        for (let i = 0; i < speed; i++) {
            if (level.hasGroundAt(lem.x, lem.y + i)) {
                // landed
                lem.y += i;
                return Lemmings.LemmingStateType.WALKING;
            }
        }
        lem.y += speed;
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}
Lemmings.ActionFloatingSystem = ActionFloatingSystem;
export { ActionFloatingSystem };
