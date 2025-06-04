import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/Frame.js';
import { Trigger } from '../js/Trigger.js';
import { TriggerManager } from '../js/TriggerManager.js';
import { TriggerTypes } from '../js/TriggerTypes.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('TriggerManager', function () {
  it('handles bucketed triggers and removal', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);

    const a = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5, 0, -1, { id: 'a' });
    const b = new Trigger(TriggerTypes.FRYING, 20, 1, 23, 5, 0, -1, { id: 'b' });
    const c = new Trigger(TriggerTypes.DROWN, 20, 20, 22, 22, 0, -1, { id: 'c' });
    tm.addRange([a, b, c]);

    expect(tm._grid[0].has(a)).to.be.true;
    expect(tm._grid[1].has(b)).to.be.true;
    expect(tm._grid[3].has(c)).to.be.true;

    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(21, 2)).to.equal(TriggerTypes.FRYING);
    expect(tm.trigger(21, 21)).to.equal(TriggerTypes.DROWN);
    expect(tm.trigger(2, 21)).to.equal(TriggerTypes.NO_TRIGGER);

    tm.removeByOwner(a.owner);
    expect(tm._grid[0].has(a)).to.be.false;
    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.NO_TRIGGER);
  });

  it('reuses debug frame', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5);
    tm.add(tr);

    const g = {
      drawRectCalls: [],
      drawFrameCalls: [],
      drawRect (...args) { this.drawRectCalls.push(args); },
      drawFrame (frame, x, y) { this.drawFrameCalls.push({ frame, x, y }); }
    };

    tm.renderDebug(g);
    const first = tm._debugFrame;
    expect(g.drawFrameCalls[0].frame).to.equal(first);

    g.drawFrameCalls = [];
    tm.renderDebug(g);
    expect(g.drawFrameCalls[0].frame).to.equal(first);
    expect(tm._debugFrame).to.equal(first);
  });
});
