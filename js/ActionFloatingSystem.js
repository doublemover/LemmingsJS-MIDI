import { Lemmings } from './LemmingsNamespace.js';

class ActionFloatingSystem {
    constructor(sprites) {
        this.sprite = [];
        this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.UMBRELLA, false));
        this.sprite.push(sprites.getAnimation(Lemmings.SpriteTypes.UMBRELLA, true));
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
        let ani = this.sprite[(lem.lookRight ? 1 : 0)];
        let frame = ani.getFrame(ActionFloatingSystem.floatFrame[lem.frameIndex]);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }
    process(level, lem) {
        lem.frameIndex++;
        if (lem.frameIndex >= ActionFloatingSystem.floatFrame.length) {
            /// first 8 are the opening of the umbrella
            lem.frameIndex = 8;
        }
        let speed = ActionFloatingSystem.floatSpeed[lem.frameIndex];
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
