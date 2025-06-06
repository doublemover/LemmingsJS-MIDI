import { Lemmings } from './LemmingsNamespace.js';
import { ActionBaseSystem } from './ActionBaseSystem.js';
        
class ActionDiggSystem extends ActionBaseSystem {
  constructor(sprites) {
    super({ sprites, spriteType: Lemmings.SpriteTypes.DIGGING, actionName: 'digging' });
  }
  process(level, lem) {
    if (level.isSteelGround(lem.x, lem.y) || 
                level.isSteelGround(lem.x, lem.y - 1) || 
                level.isSteelGround(lem.x, lem.y - 2)) {
      return Lemmings.LemmingStateType.SHRUG;
    }
    if (lem.state == 0) {
      this.digRow(level, lem, lem.y - 2);
      this.digRow(level, lem, lem.y - 1);
      lem.state = 1;
    } else {
      lem.frameIndex = (lem.frameIndex + 1) % 16;
    }
    if (!(lem.frameIndex & 0x07)) {
      lem.y++;
      if (level.isOutOfLevel(lem.y)) {
        return Lemmings.LemmingStateType.FALLING;
      }
      if (!this.digRow(level, lem, lem.y - 1)) {
        return Lemmings.LemmingStateType.FALLING;
      }
    }
    return Lemmings.LemmingStateType.NO_STATE_TYPE;
  }
  digRow(level, lem, y) {
    let removeCount = 0;
    for (let x = lem.x - 4; x < lem.x + 5; x++) {
      if (level.hasGroundAt(x, y)) {
        level.clearGroundAt(x, y);
        removeCount++;
      }
    }
    return (removeCount > 0);
  }
}
Lemmings.ActionDiggSystem = ActionDiggSystem;

export { ActionDiggSystem };
