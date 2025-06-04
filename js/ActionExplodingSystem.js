import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionExplodingSystem extends ActionBaseSystem {

    constructor(sprites, masks, triggerManager, particleTable) {
        super({
            sprites,
            spriteType: Lemmings.SpriteTypes.EXPLODING,
            singleSprite: true,
            masks,
            maskTypes: Lemmings.MaskTypes.EXPLODING,
            actionName: 'exploding'
        });
        this.triggerManager = triggerManager;
        this.particleTable = particleTable;
    }


    triggerLemAction(lem) {
        return false;
    }

    draw(gameDisplay, lem) {
        if (lem.frameIndex == 0) {
            const ani = this.sprites.get("both");
            const frame = ani.getFrame(lem.frameIndex);
            gameDisplay.drawFrame(frame, lem.x-10, lem.y-8);
        } else {
            this.particleTable.draw(gameDisplay, lem.frameIndex - 1, lem.x, lem.y);
        }
    }

    process(level, lem) {
        lem.disable();
        lem.frameIndex++;
        if (lem.frameIndex == 1) {
            this.triggerManager.removeByOwner(lem);
            level.clearGroundWithMask(this.masks.get("both").GetMask(0), lem.x, lem.y);
        }
        if (lem.frameIndex == 52) {
            return Lemmings.LemmingStateType.OUT_OF_LEVEL;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionExplodingSystem = ActionExplodingSystem;
export { ActionExplodingSystem };
