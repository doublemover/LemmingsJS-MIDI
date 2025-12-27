import { expect } from 'chai';
import { Lemmings } from './helpers/lemmings.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

globalThis.lemmings = { game: { showDebug: false } };

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

  it('draw() writes to GameDisplay', function() {
    const trig = new Trigger(TriggerTypes.EXIT_LEVEL, 2, 3, 5, 7);
    const mockDisplay = { calls: [], drawRect(...args) { this.calls.push(args); } };
    trig.draw(mockDisplay);
    expect(mockDisplay.calls).to.have.lengthOf(1);
    expect(mockDisplay.calls[0]).to.eql([2, 3, 3, 4, 255, 0, 0]);
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

  it('wraps disabledUntilTick and skips arrow debug draw', function() {
    const trig = new Trigger(TriggerTypes.ONEWAY_LEFT, 0, 0, 1, 1);
    trig.disabledUntilTick = Number.MAX_SAFE_INTEGER;
    expect(trig.disabledUntilTick).to.equal(0);
    const mockDisplay = { calls: [], drawRect(...args) { this.calls.push(args); } };
    trig.draw(mockDisplay);
    expect(mockDisplay.calls.length).to.equal(0);
  });
});
