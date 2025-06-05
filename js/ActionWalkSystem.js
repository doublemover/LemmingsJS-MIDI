import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';

class ActionWalkSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.WALKING, actionName: 'walk' });
  }
  triggerLemAction(lem) {
    return false;
  }
  getGroundStepHeight(slice) {
    const { height } = slice;
    for (let i = 0; i < height; i++) {
      const y = height - 1 - i;
      if (!slice.hasGroundAt(0, y)) {
        return i;
      }
    }
    return height;
  }

  getGroundGapDepth(slice) {
    const { height } = slice;
    for (let i = 0; i < height; i++) {
      if (slice.hasGroundAt(0, i)) {
        return i + 1;
      }
    }
    return height + 1;
  }
  process(level, lem) {
    lem.frameIndex++;
    const prevX = lem.x;
    lem.x += (lem.lookRight ? 1 : -1);

    const groundMask = level.getGroundMaskLayer();
    const stepSlice = groundMask.getSubLayer(lem.x, lem.y - 7, 1, 8);
    const upDelta = this.getGroundStepHeight(stepSlice);
    if (upDelta == 8) {
      // collision with obstacle
      lem.x = prevX; // revert movement into wall
      if (lem.canClimb) {
        return Lemmings.LemmingStateType.CLIMBING;
      } else {
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
      const gapSlice = groundMask.getSubLayer(lem.x, lem.y + 1, 1, 3);
      let downDelta = this.getGroundGapDepth(gapSlice);
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
