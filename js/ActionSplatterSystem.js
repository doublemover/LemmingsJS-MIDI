import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';
import { LemmingStateType } from './LemmingStateType.js';
import { SpriteTypes } from './SpriteTypes.js';
import { TriggerTypes } from './TriggerTypes.js';
        
class ActionSplatterSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.SPLATTING, singleSprite: true, actionName: 'splatter' });
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
      const triggerType = lem.lastTriggerType;
      const isTrapDeath =
            triggerType === TriggerTypes.TRAP ||
            triggerType === TriggerTypes.KILL;
      if (!isTrapDeath) {
        const soundBus = getSoundBus();
        soundBus?.emitSfx?.(
          SoundEventTypes.LEMMING_SPLAT,
          SoundEffectIds.SPLAT,
          { lemmingId: lem.id, x: lem.x, y: lem.y }
        );
      }
      lem.lastTriggerType = null;
    }
    if (++lem.frameIndex >= 16) return LemmingStateType.OUT_OF_LEVEL;
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionSplatterSystem };
