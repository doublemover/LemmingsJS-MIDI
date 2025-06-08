import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingStateType.js';
import { Lemming } from '../js/Lemming.js';

describe('Lemming extra', function() {
  it('getClickDistance computes distance and detects outside', function() {
    const lem = new Lemming(10, 10);
    expect(lem.getClickDistance(10, 5)).to.equal(0);
    expect(lem.getClickDistance(0, 0)).to.equal(-1);
  });

  it('setCountDown prevents overlap', function() {
    const lem = new Lemming();
    expect(lem.setCountDown({})).to.equal(true);
    const first = lem.countdown;
    expect(first).to.be.greaterThan(0);
    expect(lem.setCountDown({})).to.equal(false);
    expect(lem.countdown).to.equal(first);
  });

  it('process returns OUT_OF_LEVEL when no action', function() {
    const lem = new Lemming(-1, 0);
    lem.action = null;
    const level = { width: 1, height: 1 };
    const res = lem.process(level);
    expect(res).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });
});
