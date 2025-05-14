import { Lemmings } from './LemmingsNamespace.js';

class ActionCountdownSystem {
        constructor(masks) {
            this.numberMasks = masks.GetMask(Lemmings.MaskTypes.NUMBERS);
        }
        getActionName() {
            return "countdown";
        }
        triggerLemAction(lem) {
            return lem.setCountDown(this);
        }
        /** render Lemming to gamedisplay */
        draw(gameDisplay, lem) {
            let count = lem.getCountDownTime();
            if (count <= 0) {
                return;
            }
            let numberFrame = this.numberMasks.GetMask(count);
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
