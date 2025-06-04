import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

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
