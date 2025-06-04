import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionFryingSystem extends ActionBaseSystem {
        super({ sprites, spriteType: Lemmings.SpriteTypes.FRYING, singleSprite: true, actionName: 'frying' });
    }

    draw(gameDisplay, lem) {
        super.draw(gameDisplay, lem);

    process(level, lem) {
        lem.disable();
        lem.frameIndex++;
        if (lem.frameIndex >= 13) {
            lemmings.game.lemmingManager.miniMap.addDeath(lem.x, lem.y);
        }
        if (lem.frameIndex == 14) {
            return Lemmings.LemmingStateType.OUT_OF_LEVEL;
        }
        if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
            lem.x += (lem.lookRight ? 1 : -1);
        } else {
            lem.lookRight = !lem.lookRight;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionFryingSystem = ActionFryingSystem;
export { ActionFryingSystem };
