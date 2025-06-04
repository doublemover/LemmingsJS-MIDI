import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Trigger } from '../js/Trigger.js';
import { TriggerTypes } from '../js/TriggerTypes.js';

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
});
