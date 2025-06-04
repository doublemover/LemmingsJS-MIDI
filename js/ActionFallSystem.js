import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionFallSystem extends ActionBaseSystem {
    constructor(sprites) {
        super({ sprites, spriteType: Lemmings.SpriteTypes.FALLING, actionName: 'falling' });
    }
    triggerLemAction(lem) {
        return false;
    }
    /** render Lemming to gamedisplay */
    draw(gameDisplay, lem) {
        super.draw(gameDisplay, lem);
    }
    process(level, lem) {
        lem.frameIndex++;
        if (lem.state > 16 && (lem.hasParachute)) {
            return Lemmings.LemmingStateType.FLOATING;
        }
        // fall down!
        let i = 0;
        for (; i < 3; i++) {
            if (level.hasGroundAt(lem.x, lem.y + i)) {
                break;
            }
        }
        lem.y += i;
        if (i == 3) {
            lem.state += i;
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        } else {
            // landed
            if (lem.state > Lemmings.Lemming.LEM_MAX_FALLING) {
                return Lemmings.LemmingStateType.SPLATTING;
            }
            return Lemmings.LemmingStateType.WALKING;
        }
    }
}
Lemmings.ActionFallSystem = ActionFallSystem;

export { ActionFallSystem };
