import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

useGlobalLemmings({ game: { showDebug: false } });

describe('Trigger', function() {
  it('handles disable delay correctly', function() {
    const trig = new Trigger(TriggerTypes.EXIT_LEVEL, 0, 0, 10, 10, 2);
    let res = trig.trigger(5, 5, 0);
    expect(res).to.equal(TriggerTypes.EXIT_LEVEL);
    expect(trig.disabledUntilTick).to.equal(2);

    res = trig.trigger(5, 5, 1);
    expect(res).to.equal(TriggerTypes.DISABLED);
    expect(trig.disabledUntilTick).to.equal(2);

    res = trig.trigger(5, 5, 2);
    expect(res).to.equal(TriggerTypes.EXIT_LEVEL);
    expect(trig.disabledUntilTick).to.equal(4);
  });

  it('records trigger cooldown when history is present', function() {
    const calls = [];
    const trig = new Trigger(TriggerTypes.EXIT_LEVEL, 0, 0, 10, 10, 2);
    trig.runtime = {
      history: {
        recordTriggerCooldown(trigger, prev, next) {
          calls.push({ trigger, prev, next });
        }
      }
    };
    trig.trigger(1, 1, 0);
    expect(calls).to.have.length(1);
    expect(calls[0].prev).to.equal(0);
    expect(calls[0].next).to.equal(2);
  });

  it('draw() writes to GameDisplay', function() {
    const trig = new Trigger(TriggerTypes.EXIT_LEVEL, 2, 3, 5, 7);
    const mockDisplay = { calls: [], drawRect(...args) { this.calls.push(args); } };
    trig.draw(mockDisplay);
    expect(mockDisplay.calls).to.have.lengthOf(1);
    expect(mockDisplay.calls[0]).to.eql([2, 3, 2, 3, 255, 0, 0]);
  });

  it('invokes owner handler and returns NO_TRIGGER when outside bounds', function() {
    let called = false;
    const owner = { onTrigger() { called = true; } };
    const trig = new Trigger(TriggerTypes.TRAP, 0, 0, 2, 2, 0, 1, owner);
    const inside = trig.trigger(1, 1, 0, { id: 1 });
    expect(inside).to.equal(TriggerTypes.TRAP);
    expect(called).to.equal(true);
    const outside = trig.trigger(5, 5, 0);
    expect(outside).to.equal(TriggerTypes.NO_TRIGGER);
  });

  it('treats right and bottom trigger bounds as exclusive', function() {
    const trig = new Trigger(TriggerTypes.TRAP, 10, 20, 13, 24);
    expect(trig.trigger(10, 20, 0)).to.equal(TriggerTypes.TRAP);
    expect(trig.trigger(12, 23, 1)).to.equal(TriggerTypes.TRAP);
    expect(trig.trigger(13, 23, 2)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(trig.trigger(12, 24, 2)).to.equal(TriggerTypes.NO_TRIGGER);
  });

  it('wraps disabledUntilTick and skips arrow debug draw', function() {
    const trig = new Trigger(TriggerTypes.ONEWAY_LEFT, 0, 0, 1, 1);
    trig.disabledUntilTick = Number.MAX_SAFE_INTEGER;
    expect(trig.disabledUntilTick).to.equal(0);
    const mockDisplay = { calls: [], drawRect(...args) { this.calls.push(args); } };
    trig.draw(mockDisplay);
    expect(mockDisplay.calls.length).to.equal(0);
  });
});
