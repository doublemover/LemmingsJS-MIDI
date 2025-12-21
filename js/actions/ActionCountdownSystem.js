import { ActionBaseSystem } from './ActionBaseSystem.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { MaskTypes } from '../render/MaskTypes.js';

class ActionCountdownSystem extends ActionBaseSystem {
  static numberMasks = new Map();
  constructor(masks) {
    super({ actionName: 'countdown' });
    if (ActionCountdownSystem.numberMasks.size == 0) {
      ActionCountdownSystem.numberMasks.set('numbers', masks.GetMask(MaskTypes.NUMBERS));
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
    let numberFrame = ActionCountdownSystem.numberMasks.get('numbers').GetMask(count);
    gameDisplay.drawMask(numberFrame, lem.x, lem.y);
  }

  process(level, lem) {
    if (lem.countdown <= 0) {
      return LemmingStateType.NO_STATE_TYPE;
    }
    lem.countdown--;
    if (lem.countdown == 0) {
      lem.setCountDown(null);
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.LEMMING_OHNO,
        SoundEffectIds.OHNO,
        { lemmingId: lem.id, x: lem.x, y: lem.y }
      );
      return LemmingStateType.OHNO;
    }
    return LemmingStateType.NO_STATE_TYPE;
  }
}
export { ActionCountdownSystem };
