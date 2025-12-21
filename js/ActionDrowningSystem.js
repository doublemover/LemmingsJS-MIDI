import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';

class ActionDrowningSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.DROWNING, singleSprite: true, actionName: 'drowning' });
  }
  triggerLemAction(lem) {
    return false;
  }
  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
    if (lem.frameIndex === 15) {
      const miniMap = globalThis?.lemmings?.game?.lemmingManager?.miniMap;
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
Lemmings.ActionDrowningSystem = ActionDrowningSystem;

export { ActionDrowningSystem };
