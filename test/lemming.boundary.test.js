import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingStateType.js';
import { Lemming } from '../js/Lemming.js';

describe('Lemming state boundary checks', function () {
  beforeEach(function () {
    globalThis.lemmings = {
      game: { lemmingManager: { miniMap: { calls: [], addDeath(...a) { this.calls.push(a); } } } }
    };
  });
  afterEach(function () { delete globalThis.lemmings; });

  it('renderDebug sets pixel only with action', function () {
    const lem = new Lemming(4, 8);
    const calls = [];
    const display = { setDebugPixel: (x, y) => calls.push([x, y]) };

    lem.renderDebug(display);
    expect(calls).to.deep.equal([]);

    lem.action = {};
    lem.renderDebug(display);
    expect(calls).to.deep.equal([[4, 8]]);
  });

  it('process clamps bottom death position', function () {
    const level = { width: 20, height: 10 };
    const lem = new Lemming(3, 27);
    lem.action = { process() { return Lemmings.LemmingStateType.WALKING; } };

    const res = lem.process(level);
    expect(res).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
    expect(globalThis.lemmings.game.lemmingManager.miniMap.calls[0]).to.deep.equal([3, 4]);
  });

  it('process returns whatever the action provides', function () {
    const level = { width: 10, height: 10 };
    const lem = new Lemming(2, 2);
    let ran = false;
    lem.action = { process() { ran = true; } };

    const res = lem.process(level);
    expect(ran).to.be.true;
    expect(res).to.equal(undefined);
  });
});
