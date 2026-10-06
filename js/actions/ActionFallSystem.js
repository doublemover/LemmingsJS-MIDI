import { ActionBaseSystem } from './ActionBaseSystem.js';
import { Lemming } from '../lemmings/Lemming.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';
import { SoundEventTypes, SoundEffectIds } from '../game/SoundEvents.js';
import { getRuntimeSoundEvents } from '../game/GameRuntime.js';

class ActionFallSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.FALLING, actionName: 'falling' });
  }

  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
  }

  process(level, lem) {
    lem.frameIndex++;
    if (lem.state > 16 && (lem.hasParachute)) {
      return LemmingStateType.FLOATING;
    }

    // fall down!
    let i = 0;
    for (; i < 3; i++) {
      if (level.hasGroundAt(lem.x, lem.y + i)) {
        break;
      }
    }
    lem.y += i;
    if (i === 3) {
      lem.state += i;
      return LemmingStateType.NO_STATE_TYPE;
    } else {
      // landed
      if (lem.state > Lemming.LEM_MAX_FALLING) {
        return LemmingStateType.SPLATTING;
      }
      if (lem.state > 0 || i > 0) {
        getRuntimeSoundEvents(this.runtime)?.emitSfx?.(
          SoundEventTypes.LEMMING_LAND,
          SoundEffectIds.LAND,
          { lemmingId: lem.id, x: lem.x, y: lem.y }
        );
      }
      return LemmingStateType.WALKING;
    }
  }
}
export { ActionFallSystem };
