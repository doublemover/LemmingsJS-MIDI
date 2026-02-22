import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { MaskTypes } from '../render/MaskTypes.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

class ActionExplodingSystem extends ActionBaseSystem {

  constructor(sprites, masks, triggerManager, particleTable) {
    super({
      sprites,
      spriteType: SpriteTypes.EXPLODING,
      singleSprite: true,
      masks,
      maskTypes: MaskTypes.EXPLODING,
      actionName: 'exploding'
    });
    this.triggerManager = triggerManager;
    this.particleTable = particleTable;
  }


  triggerLemAction(lem) {
    return false;
  }

  draw(gameDisplay, lem) {
    if (lem.frameIndex === 0) {
      const ani = this.sprites.get('both');
      const frame = ani.getFrame(lem.frameIndex);
      gameDisplay.drawFrame(frame, lem.x-10, lem.y-8);
    } else {
      this.particleTable.draw(gameDisplay, lem.frameIndex - 1, lem.x, lem.y);
    }
  }

  process(level, lem) {
    lem.disable();
    if (lem.frameIndex === 0) {
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.LEMMING_EXPLODE,
        SoundEffectIds.EXPLOSION,
        { lemmingId: lem.id, x: lem.x, y: lem.y }
      );
    }
    lem.frameIndex++;
    if (lem.frameIndex === 1) {
      this.triggerManager.removeByOwner(lem);
      const mask = this.masks.get('both').GetMask(0);
      const changed = level.clearGroundWithMask(mask, lem.x, lem.y, { revealSteel: true });
      const miniMap = globalThis?.lemmings?.game?.lemmingManager?.miniMap;
      if (changed && miniMap) {
        miniMap.invalidateRegion(
          lem.x + mask.offsetX,
          lem.y + mask.offsetY,
          mask.width,
          mask.height
        );
      }
      if (miniMap) miniMap.addDeath(lem.x, lem.y);
    }
    if (lem.frameIndex === 52) {
      return LemmingStateType.OUT_OF_LEVEL;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionExplodingSystem };
