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
      const ani = this.sprites.get('both');
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
      const mask = this.masks.get('both').GetMask(0);
      const changed = level.clearGroundWithMask(mask, lem.x, lem.y);
      if (changed) {
        lemmings.game.lemmingManager.miniMap.invalidateRegion(
          lem.x + mask.offsetX,
          lem.y + mask.offsetY,
          mask.width,
          mask.height
        );
      }
      lemmings.game.lemmingManager.miniMap.addDeath(lem.x, lem.y);
    }
    if (lem.frameIndex == 52) {
      return Lemmings.LemmingStateType.OUT_OF_LEVEL;
    }
    return Lemmings.LemmingStateType.NO_STATE_TYPE;
  }
}

Lemmings.ActionExplodingSystem = ActionExplodingSystem;
export { ActionExplodingSystem };
