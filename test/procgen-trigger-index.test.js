import { expect } from 'chai';
import { ProcgenTriggerManager } from '../js/app/procgen/ProcgenTriggerManager.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';

const fixture = () => {
  const hazards = { result: Types.NO_TRIGGER, trigger() { return this.result; }, reset() {}, dispose() {} };
  const manager = new ProcgenTriggerManager({ laneCount: 3, laneHeight: 96, runtime: null }, hazards);
  const add = (x, y, lane = Math.floor(y / 96)) => {
    const owner = { x, y, laneIndex: lane, action: { actionName: 'blocking' } };
    manager.add(new Trigger(Types.BLOCKER_LEFT, x - 6, y - 10, x - 3, y + 4, 0, -1, owner));
    manager.add(new Trigger(Types.BLOCKER_RIGHT, x + 4, y - 10, x + 7, y + 4, 0, -1, owner)); return owner;
  };
  const scan = (x, y, actor, tick) => {
    if (hazards.result !== Types.NO_TRIGGER) return hazards.result;
    for (let lane = Math.max(0, Math.floor(y / 96) - 1); lane <= Math.min(2, Math.floor(y / 96) + 1); lane++) {
      for (const trigger of manager.getLaneTriggers(lane, Infinity)) {
        const owner = trigger.owner;
        if (owner === actor || owner.removed || owner.disabled || owner.failureReason || owner.terminalReason || owner.action.actionName !== 'blocking' ||
            x < trigger.x1 || x >= trigger.x2 || y < trigger.y1 || y >= trigger.y2) continue;
        return trigger.trigger(x, y, tick, actor);
      }
    }
    return Types.NO_TRIGGER;
  };
  return { manager, hazards, add, scan };
};

describe('live blocker rectangle index', () => {
  it('matches insertion-ordered scans across edges, transfers, removals and hazard priority', () => {
    const { manager, hazards, add, scan } = fixture();
    const first = add(64, 94), second = add(64, 94), third = add(130, 120);
    for (const owner of [first, second, third]) {
      for (let x = 50; x < 150; x++) for (const y of [83, 84, 93, 94, 97, 98, 110, 120, 124])
        expect(manager.trigger(x, y, owner, 1)).to.equal(scan(x, y, owner, 1));
      owner.x += 32; owner.y += 96; owner.laneIndex++;
      manager.synchronize(owner);
    }
    manager.removeByOwner(second); first.disabled = true; manager.synchronize(first);
    for (let x = 0; x < 200; x++) expect(manager.trigger(x, 216, null, 2)).to.equal(scan(x, 216, null, 2));
    hazards.result = Types.DISABLED; expect(manager.trigger(0, 0, null, 3)).to.equal(Types.DISABLED);
    manager.rebuildIndex(); expect(manager.snapshot().directionalTriggers).to.equal(2);
    manager.reset(); expect(manager.snapshot()).to.include({ owners: 0, directionalTriggers: 0, retainedCells: 0 });
  });

  it('keeps local candidate work independent of distant row occupancy', () => {
    for (const count of [1, 8, 32, 128, 1024]) {
      const { manager, add } = fixture();
      for (let index = 0; index < count; index++) add(100 + index * 32, 70, 0);
      for (let index = 0; index < 100; index++) manager.trigger(36, 70, null, index);
      expect(manager.snapshot().blockerCandidates).to.equal(0);
      for (let index = 0; index < 100; index++) manager.trigger(95, 70, null, index);
      expect(manager.snapshot().blockerCandidates).to.be.at.most(400);
      expect(manager.snapshot().queryAllocations).to.equal(0);
      expect(manager.snapshot().retainedCells).to.be.at.most(count * 4);
    }
  });

  it('exposes earlier owner movement immediately to subsequent sequential queries', () => {
    const { manager, add } = fixture(), owner = add(64, 70, 0);
    expect(manager.trigger(59, 70, null, 1)).to.equal(Types.BLOCKER_LEFT);
    owner.x = 128; manager.synchronize(owner);
    expect(manager.trigger(59, 70, null, 1)).to.equal(Types.NO_TRIGGER);
    expect(manager.trigger(123, 70, null, 1)).to.equal(Types.BLOCKER_LEFT);
  });
});
