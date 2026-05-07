import { ActionBaseSystem } from './ActionBaseSystem.js';
import { Lemming } from '../lemmings/Lemming.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';

class ActionJumpSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.JUMPING, actionName: 'jump' });
  }

  triggerLemAction(lem) {
    return false;
  }

  draw(gameDisplay, lem) {
    super.draw(gameDisplay, lem);
  }

  process(level, lem) {
    lem.frameIndex++;
    lem.x += (lem.lookRight ? 1 : -1);

    if (lem.state === null || lem.state === undefined) {
      lem.state = 0; // how far we've jumped so far
    }

    let moved = 0;
    while (lem.state < 2 && moved < 2 && level.hasGroundAt(lem.x, lem.y - 1)) {
      lem.y--;
      lem.state++;
      moved++;
    }
    if (lem.state >= 2 || !level.hasGroundAt(lem.x, lem.y - 1)) {
      if (lem.y < Lemming.LEM_MIN_Y) {
        lem.y = Lemming.LEM_MIN_Y;
      }
      lem.state = 0;
      return LemmingStateType.WALKING;
    }

    return LemmingStateType.JUMPING;
  }
}
export { ActionJumpSystem };
