import { Lemmings } from './LemmingsNamespace.js';

class ActionCountdownSystem {
    static numberMasks = new Map();
    constructor(masks) {
        if (ActionCountdownSystem.numberMasks.size == 0) {
            ActionCountdownSystem.numberMasks.set("numbers", masks.GetMask(Lemmings.MaskTypes.NUMBERS));
        }
    }

    getActionName() {
        return "countdown";
    }

    triggerLemAction(lem) {
        return lem.setCountDown(this);
    }

    draw(gameDisplay, lem) {
        let count = lem.getCountDownTime();
        if (count <= 0) {
            return;
        }
        let numberFrame = ActionCountdownSystem.numberMasks.get("numbers").GetMask(count);
        gameDisplay.drawMask(numberFrame, lem.x, lem.y);
    }

    process(level, lem) {
        if (lem.countdown <= 0) {
            return Lemmings.LemmingStateType.NO_STATE_TYPE;
        }
        lem.countdown--;
        if (lem.countdown == 0) {
            lem.setCountDown(null);
            return Lemmings.LemmingStateType.OHNO;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
    }
}

Lemmings.ActionCountdownSystem = ActionCountdownSystem;
export { ActionCountdownSystem };
