import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionWalkSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.WALKING, actionName: 'walk' });
  }
  triggerLemAction(lem) {
    return false;
  }
  getGroundStepHeight(groundMask, x, y) {
    for (let i = 0; i < 8; i++) {
      if (!groundMask.hasGroundAt(x, y - i)) {
        return i;
      }
    }
    return 8;
  }

  getGroundGapDepth(groundMask, x, y) {
    for (let i = 1; i < 4; i++) {
      if (groundMask.hasGroundAt(x, y + i)) {
        return i;
      }
    }
    return 4;
  }
  process(level, lem) {
    lem.frameIndex++;
    const step = lem.lookRight ? 1 : -1;
    lem.x += step;

    const groundMask = level.getGroundMaskLayer();
    const upDelta = this.getGroundStepHeight(groundMask, lem.x, lem.y);
    if (upDelta == 8) {
      // collision with obstacle
      if (lem.canClimb) {
        return Lemmings.LemmingStateType.CLIMBING;
      } else {
        lem.x -= step;
        lem.lookRight = !lem.lookRight;
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
      }
    } else if (upDelta > 0) {
      lem.y -= upDelta - 1;
      if (upDelta > 3) {
        lem.state = 0;
        return Lemmings.LemmingStateType.JUMPING;
      } else {
        if (lem.y < Lemmings.Lemming.LEM_MIN_Y) {
          lem.y = Lemmings.Lemming.LEM_MIN_Y;
        }
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
      }
    } else {
      let downDelta = this.getGroundGapDepth(groundMask, lem.x, lem.y);
      lem.y += downDelta;
      if (downDelta == 4) {
        return Lemmings.LemmingStateType.FALLING;
      } else {
        return Lemmings.LemmingStateType.NO_STATE_TYPE;
      }
    }
  }
}
Lemmings.ActionWalkSystem = ActionWalkSystem;

export { ActionWalkSystem };
