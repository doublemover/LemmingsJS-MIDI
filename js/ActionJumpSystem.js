import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionJumpSystem extends ActionBaseSystem {
    constructor(sprites) {
        super({ sprites, spriteType: Lemmings.SpriteTypes.JUMPING, actionName: 'jump' });
    }

    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        super.draw(gameDisplay, lem);
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
