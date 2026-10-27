import { ActionBaseSystem } from './ActionBaseSystem.js';
import { Lemming } from '../lemmings/Lemming.js';
import { LemmingStateType } from '../lemmings/LemmingStateType.js';
import { SpriteTypes } from '../lemmings/SpriteTypes.js';
import { recordPhysicalMotion } from './PhysicalMotionFacts.js';

class ActionWalkSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: SpriteTypes.WALKING, actionName: 'walk' });
  }
  triggerLemAction(lem) {
    return false;
  }
  process(level, lem) {
    const beforeX = lem.x, beforeY = lem.y;
    const next = this._process(level, lem);
    recordPhysicalMotion(level, lem, beforeX, beforeY);
    return next;
  }
  _process(level, lem) {
    lem.frameIndex++;
    const prevX = lem.x;
    lem.x += (lem.lookRight ? 1 : -1);

    const groundMask = level.getGroundMaskLayer();
    const upDelta = groundMask.getColumnStepHeight(lem.x, lem.y - 7, 8);
    if (upDelta === 8) {
      // collision with obstacle
      if (lem.canClimb) {
        return LemmingStateType.CLIMBING;
      } else {
        lem.x = prevX;
        const directionBefore = lem.lookRight ? 'right' : 'left';
        lem.lookRight = !lem.lookRight;
        const facts = lem.runtime?.physicalFacts;
        if (facts?.enabled?.(lem)) {
          const contactId = `${level.worldId}:${level.generation}:${level.tickIndex}:${lem.id}:wall`;
          const position = { x: lem.x, y: lem.y };
          facts.emit({ kind: 'ContactResolved', contactId, actorId: lem.id, laneId: lem.laneIndex ?? null,
            causeKind: 'wall', positionBefore: position, positionAfter: position,
            physicalPayload: { stepHeightPixels: upDelta } });
          facts.emit({ kind: 'DirectionChanged', contactId, actorId: lem.id, laneId: lem.laneIndex ?? null,
            directionBefore, directionAfter: lem.lookRight ? 'right' : 'left', causeKind: 'wall' });
          lem._physicalDirectionFactTick = level.tickIndex;
        }
        return LemmingStateType.NO_STATE_TYPE;
      }
    } else if (upDelta > 0) {
      lem.y -= upDelta - 1;
      if (upDelta > 3) {
        lem.state = 0;
        return LemmingStateType.JUMPING;
      } else {
        if (lem.y < Lemming.LEM_MIN_Y) {
          lem.y = Lemming.LEM_MIN_Y;
        }
        return LemmingStateType.NO_STATE_TYPE;
      }
    } else {
      let downDelta = groundMask.getColumnGapDepth(lem.x, lem.y + 1, 3);
      lem.y += downDelta;
      if (downDelta === 4) {
        return LemmingStateType.FALLING;
      } else {
        return LemmingStateType.NO_STATE_TYPE;
      }
    }
  }
}
export { ActionWalkSystem };
