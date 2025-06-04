import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionFloatingSystem extends ActionBaseSystem {
        super({ sprites, spriteType: Lemmings.SpriteTypes.UMBRELLA, actionName: 'floating' });
    triggerLemAction(lem) {
        if (lem.hasParachute) {
            return false;
        }
        lem.hasParachute = true;
        return true;
    }
    /** render Lemming to gamedisplay */
    draw(gameDisplay, lem) {
        const ani = this.sprites.get(lem.getDirection());
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
