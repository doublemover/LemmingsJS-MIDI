import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';
import { getAppContext } from '../core/dependencies.js';

class ActionDrowningSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.DROWNING, singleSprite: true, actionName: 'drowning' });
  }
  triggerLemAction(lem) {
    return false;
  }
  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
    if (lem.frameIndex === 15) {
      const miniMap = getAppContext()?.game?.lemmingManager?.miniMap;
      if (miniMap) miniMap.addDeath(lem.x, lem.y);
    }
  }
  process(level, lem) {
    lem.disable();
    if (lem.frameIndex === 0) {
      const triggerType = lem.lastTriggerType ?? null;
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.LEMMING_DROWN,
        SoundEffectIds.DROWN,
        { lemmingId: lem.id, x: lem.x, y: lem.y, triggerType }
      );
      lem.lastTriggerType = null;
    }
    lem.frameIndex++;
    if (lem.frameIndex >= 16) {
      return LemmingStateType.OUT_OF_LEVEL;
    }
    if (!level.hasGroundAt(lem.x + (lem.lookRight ? 8 : -8), lem.y)) {
      lem.x += (lem.lookRight ? 1 : -1);
    } else {
      lem.lookRight = !lem.lookRight;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionDrowningSystem };
