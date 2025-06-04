import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionHoistSystem extends ActionBaseSystem {
        super({ sprites, spriteType: Lemmings.SpriteTypes.POSTCLIMBING, actionName: 'hoist' });

    draw(gameDisplay, lem) {
        super.draw(gameDisplay, lem);
    // y+1, x+1 & y+1, x+2 & y+2?
    process(level, lem) {
        lem.frameIndex++;
        // if (!level.hasGroundAt(x + 1, y - 1) &&   // above wall, just ahead
        //     !level.hasGroundAt(x + 2, y - 1) &&   // further ahead, still above
        //     !level.hasGroundAt(x + 2, y)) {       // 2 ahead, at current height

        if (lem.frameIndex <= 4) {
            lem.y -= 2;
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }

        if (lem.frameIndex > 4 && lem.frameIndex < 8) {
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
                   
        if (lem.frameIndex >= 8) {
            return Lemmings.LemmingStateType.WALKING;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionHoistSystem = ActionHoistSystem;
export { ActionHoistSystem };
