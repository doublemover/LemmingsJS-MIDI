import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
class ActionCountdownSystem extends ActionBaseSystem {
        super({ actionName: 'countdown' });

        if (ActionCountdownSystem.numberMasks.size == 0) {
            ActionCountdownSystem.numberMasks.set("numbers", masks.GetMask(Lemmings.MaskTypes.NUMBERS));
        }
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
