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
        const step = lem.lookRight ? 1 : -1;
        lem.x += step;

        if (level.hasGroundAt(lem.x, lem.y)) {
            lem.x -= step;
            lem.lookRight = !lem.lookRight;
            lem.state = 0;
            return Lemmings.LemmingStateType.WALKING;
        }

        if (lem.state == null) {
            lem.state = 0; // how far we've jumped so far
        }

        let moved = 0;
        while (lem.state < 2 && moved < 2 && level.hasGroundAt(lem.x, lem.y - 1)) {
            lem.y--;
            lem.state++;
            moved++;
        }

        if (lem.state >= 2 || !level.hasGroundAt(lem.x, lem.y - 1)) {
            if (lem.y < Lemmings.Lemming.LEM_MIN_Y) {
                lem.y = Lemmings.Lemming.LEM_MIN_Y;
            }
            lem.state = 0;
            return Lemmings.LemmingStateType.WALKING;
        }

        return Lemmings.LemmingStateType.JUMPING;
    }
}

Lemmings.ActionJumpSystem = ActionJumpSystem;
export { ActionJumpSystem };
