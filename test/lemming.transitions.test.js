import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/SolidLayer.js';
import '../js/LemmingStateType.js';
import '../js/Lemming.js';
import { Level } from '../js/Level.js';

class SeqAction {
  constructor(name, next) { this.name = name; this.next = next; }
  getActionName() { return this.name; }
  triggerLemAction() { return true; }
  process(level, lem) { lem.frameIndex++; if (this.name === 'explode') lem.disable(); return this.next; }
}

describe('Lemming sequential transitions', function() {
  beforeEach(function() { globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: false } }; });
  afterEach(function() { delete globalThis.lemmings; });
  it('walk -> climb -> float -> explode', function() {
    const level = new Level(20, 20);
    const lem = new Lemmings.Lemming(5, 5, 0);

    const actions = {};
    actions[Lemmings.LemmingStateType.WALKING] = new SeqAction('walk', Lemmings.LemmingStateType.CLIMBING);
    actions[Lemmings.LemmingStateType.CLIMBING] = new SeqAction('climb', Lemmings.LemmingStateType.FLOATING);
    actions[Lemmings.LemmingStateType.FLOATING] = new SeqAction('float', Lemmings.LemmingStateType.EXPLODING);
    actions[Lemmings.LemmingStateType.EXPLODING] = new SeqAction('explode', Lemmings.LemmingStateType.NO_STATE_TYPE);

    lem.setAction(actions[Lemmings.LemmingStateType.WALKING]);
    expect(lem.frameIndex).to.equal(0);
    expect(lem.state).to.equal(0);

    let next = lem.process(level);
    expect(next).to.equal(Lemmings.LemmingStateType.CLIMBING);
    expect(lem.frameIndex).to.equal(1);

    lem.setAction(actions[next]);
    expect(lem.frameIndex).to.equal(0);
    expect(lem.state).to.equal(0);

    next = lem.process(level);
    expect(next).to.equal(Lemmings.LemmingStateType.FLOATING);
    expect(lem.frameIndex).to.equal(1);

    lem.setAction(actions[next]);
    expect(lem.frameIndex).to.equal(0);
    expect(lem.state).to.equal(0);

    next = lem.process(level);
    expect(next).to.equal(Lemmings.LemmingStateType.EXPLODING);
    expect(lem.frameIndex).to.equal(1);

    lem.setAction(actions[next]);
    expect(lem.frameIndex).to.equal(0);
    expect(lem.state).to.equal(0);

    next = lem.process(level);
    expect(next).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.frameIndex).to.equal(1);
    expect(lem.disabled).to.be.true;
  });
});
