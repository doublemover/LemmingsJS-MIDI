import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionShrugSystem extends ActionBaseSystem {
    constructor(sprites) {
        super({ sprites, spriteType: Lemmings.SpriteTypes.SHRUGGING, actionName: 'shrugging' });
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        super.draw(gameDisplay, lem);
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
