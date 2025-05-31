import { Lemmings } from './LemmingsNamespace.js';

class ActionExitingSystem {
    static sprites = new Map();
    static gameVictoryCondition = null;
    constructor(sprites, gameVictoryCondition) {
        if (!ActionExitingSystem.gameVictoryCondition) {
            ActionExitingSystem.gameVictoryCondition = gameVictoryCondition;
        }
        if (ActionExitingSystem.sprites.size == 0) {
            ActionExitingSystem.sprites.set("both", sprites.getAnimation(Lemmings.SpriteTypes.EXITING, false));
        }
    }
    getActionName() {
        return "exiting";
    }
    triggerLemAction(lem) {
        return false;
    }
    draw(gameDisplay, lem) {
        const frame = ActionExitingSystem.sprites.get("both").getFrame(lem.frameIndex)
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }
    process(level, lem) {
        lem.disable();
        lem.frameIndex++;
        if (lem.frameIndex >= 8) {
            ActionExitingSystem.gameVictoryCondition.addSurvivor();
            return Lemmings.LemmingStateType.OUT_OF_LEVEL;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionExitingSystem = ActionExitingSystem;
export { ActionExitingSystem };
