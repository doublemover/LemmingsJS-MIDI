import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingStateType.js';
import { Lemming } from '../js/Lemming.js';

describe('Lemming core behavior', function() {
  beforeEach(function() {
    globalThis.lemmings = {
      game: { lemmingManager: { miniMap: { calls: [], addDeath(...args) { this.calls.push(args); } } } }
    };
  });

  afterEach(function() {
    delete globalThis.lemmings;
  });

  it('getClickDistance and setCountDown', function() {
    const lem = new Lemming(10, 10);
    expect(lem.getClickDistance(10, 5)).to.equal(0);
    expect(lem.getClickDistance(0, 0)).to.equal(-1);

    expect(lem.setCountDown({})).to.equal(true);
    const first = lem.countdown;
    expect(first).to.be.greaterThan(0);
    expect(lem.setCountDown({})).to.equal(false);
    expect(lem.countdown).to.equal(first);
  });

  it('render draws countdown and main actions', function() {
    const calls = [];
    const main = { draw() { calls.push('main'); }, process() { return Lemmings.LemmingStateType.NO_STATE_TYPE; } };
    const countdown = { draw() { calls.push('cd'); }, process() { return Lemmings.LemmingStateType.NO_STATE_TYPE; } };
    const lem = new Lemming();
    lem.action = main;
    lem.countdownAction = countdown;
    lem.render({});
    expect(calls).to.deep.equal(['cd', 'main']);
  });

  it('process handles transitions and bounds', function() {
    const level = { width: 20, height: 10 };
    const main = { process() { return Lemmings.LemmingStateType.WALKING; } };
    const countdown = { process() { return Lemmings.LemmingStateType.CLIMBING; } };
    const lem = new Lemming(5, 5);
    lem.action = main;
    lem.countdownAction = countdown;
    expect(lem.process(level)).to.equal(Lemmings.LemmingStateType.CLIMBING);

    lem.countdownAction = { process() { return Lemmings.LemmingStateType.NO_STATE_TYPE; } };
    expect(lem.process(level)).to.equal(Lemmings.LemmingStateType.WALKING);

    lem.action = null;
    expect(lem.process(level)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);

    const lem2 = new Lemming(-1, 5);
    lem2.action = main;
    expect(lem2.process(level)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
    expect(globalThis.lemmings.game.lemmingManager.miniMap.calls.length).to.equal(2);
  });

  it('remove clears state', function() {
    const lem = new Lemming();
    lem.action = { draw() {}, process() {} };
    lem.countdownAction = { draw() {}, process() {} };
    lem.hasExploded = true;
    lem.id = 123;
    lem.remove();
    expect(lem.action).to.equal(null);
    expect(lem.countdownAction).to.equal(null);
    expect(lem.removed).to.equal(true);
    expect(lem.hasExploded).to.equal(false);
    expect(lem.id).to.equal(null);
    expect(lem.isRemoved()).to.equal(true);
  });
});
