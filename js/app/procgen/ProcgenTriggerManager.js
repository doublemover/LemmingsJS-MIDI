import { TriggerTypes as Types } from '../../level/TriggerTypes.js';

// Source hazards retain their chunk owners; blockers use the actual actor as
// owner and only two small directional rectangles, never a dense world grid.
class ProcgenTriggerManager {
  constructor(world, hazards) {
    this.world = world; this.hazards = hazards;
    this.byOwner = new Map(); this.byLane = new Array(world.laneCount);
  }
  add(trigger) {
    const owner = trigger.owner, lane = owner?.laneIndex;
    if (![Types.BLOCKER_LEFT, Types.BLOCKER_RIGHT].includes(trigger.type) || !Number.isInteger(lane) || lane < 0 || lane >= this.byLane.length) return;
    let owned = this.byOwner.get(owner);
    if (!owned) { owned = []; this.byOwner.set(owner, owned); }
    if (owned.includes(trigger)) return;
    trigger.runtime = this.world.runtime; owned.push(trigger);
    (this.byLane[lane] ||= []).push(trigger);
  }
  removeByOwner(owner) {
    if (!this.byOwner.delete(owner)) return;
    const lane = owner.laneIndex;
    this.byLane[lane] = this.byLane[lane].filter(trigger => trigger.owner !== owner);
  }
  synchronize(owner) {
    if (this.byOwner.has(owner) && (owner.removed || owner.failureReason || owner.disabled || owner.terminalReason || owner.action?.actionName !== 'blocking')) this.removeByOwner(owner);
  }
  trigger(x, y, actor, tick) {
    const hazard = this.hazards.trigger(x, y, actor, tick);
    if (hazard !== Types.NO_TRIGGER) return hazard;
    const bucket = this.byLane[actor.laneIndex];
    if (bucket) for (const trigger of bucket) {
      const owner = trigger.owner;
      if (owner === actor || owner.removed || owner.disabled || owner.failureReason || owner.terminalReason || owner.action?.actionName !== 'blocking' ||
          x < trigger.x1 || x >= trigger.x2 || y < trigger.y1 || y >= trigger.y2) continue;
      return trigger.trigger(x, y, tick, actor);
    }
    return Types.NO_TRIGGER;
  }
  snapshot() { return { owners: this.byOwner.size, directionalTriggers: this.byOwner.size * 2 }; }
  reset() { this.byOwner.clear(); this.byLane.fill(null); this.hazards.reset(); }
  dispose() { this.reset(); this.hazards.dispose(); this.world = null; }
}
export { ProcgenTriggerManager };
