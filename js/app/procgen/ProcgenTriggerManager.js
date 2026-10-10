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
    owned.lane = lane; owned.x = owner.x; owned.y = owner.y;
    trigger.runtime = this.world.runtime; owned.push(trigger);
    (this.byLane[lane] ||= []).push(trigger);
  }
  removeByOwner(owner) {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    this.byOwner.delete(owner);
    this.byLane[owned.lane] = this.byLane[owned.lane]?.filter(trigger => trigger.owner !== owner);
  }
  synchronize(owner) {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    if (owner.removed || owner.failureReason || owner.disabled || owner.terminalReason || owner.action?.actionName !== 'blocking') { this.removeByOwner(owner); return; }
    if (owned.lane !== owner.laneIndex) {
      this.byLane[owned.lane] = this.byLane[owned.lane]?.filter(trigger => trigger.owner !== owner);
      (this.byLane[owner.laneIndex] ||= []).push(...owned); owned.lane = owner.laneIndex;
    }
    const dx = owner.x - owned.x, dy = owner.y - owned.y;
    if (dx || dy) for (const trigger of owned) { trigger.x1 += dx; trigger.x2 += dx; trigger.y1 += dy; trigger.y2 += dy; }
    owned.x = owner.x; owned.y = owner.y;
  }
  trigger(x, y, actor, tick) {
    const hazard = this.hazards.trigger(x, y, actor, tick);
    if (hazard !== Types.NO_TRIGGER) return hazard;
    for (let lane = Math.max(0, Math.floor(y / this.world.laneHeight) - 1); lane <= Math.min(this.byLane.length - 1, Math.floor(y / this.world.laneHeight) + 1); lane++) {
      const bucket = this.byLane[lane];
      if (bucket) for (const trigger of bucket) {
        const owner = trigger.owner;
        if (owner === actor || owner.removed || owner.disabled || owner.failureReason || owner.terminalReason || owner.action?.actionName !== 'blocking' ||
          x < trigger.x1 || x >= trigger.x2 || y < trigger.y1 || y >= trigger.y2) continue;
        return trigger.trigger(x, y, tick, actor);
      }
    }
    return Types.NO_TRIGGER;
  }
  snapshot() { return { owners: this.byOwner.size, directionalTriggers: this.byOwner.size * 2 }; }
  reset() { this.byOwner.clear(); this.byLane.fill(null); this.hazards.reset(); }
  dispose() { this.reset(); this.hazards.dispose(); this.world = null; }
}
export { ProcgenTriggerManager };
