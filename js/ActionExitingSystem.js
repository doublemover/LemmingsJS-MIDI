import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';

class ActionExitingSystem extends ActionBaseSystem {
  constructor(sprites, gameVictoryCondition) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.EXITING, singleSprite: true, actionName: 'exiting' });
    this.gameVictoryCondition = gameVictoryCondition;
  }
  triggerLemAction(lem) {
    return false;
  }
  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
  }
  process(level, lem) {
    lem.disable();
    if (lem.frameIndex === 0) {
      const triggerType = lem.lastTriggerType ?? null;
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.LEMMING_EXIT,
        SoundEffectIds.EXIT,
        { lemmingId: lem.id, x: lem.x, y: lem.y, triggerType }
      );
      lem.lastTriggerType = null;
    }
    lem.frameIndex++;
    if (lem.frameIndex >= 8) {
      this.gameVictoryCondition.addSurvivor();
      return Lemmings.LemmingStateType.OUT_OF_LEVEL;
    }
    return Lemmings.LemmingStateType.NO_STATE_TYPE;
  }
}
Lemmings.ActionExitingSystem = ActionExitingSystem;
export { ActionExitingSystem };
