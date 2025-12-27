import { expect } from 'chai';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { SoundEventTypes } from '../js/game/SoundEvents.js';

const makeLevel = () => ({ width: 10, height: 10 });

describe('Lemming core', function() {
  it('reports direction and countdown time', function() {
    const lem = new Lemming(0, 0, 1);
    expect(lem.getDirection()).to.equal('right');
    lem.lookRight = false;
    expect(lem.getDirection()).to.equal('left');
    lem.countdown = 32;
    expect(lem.getCountDownTime()).to.equal(6);
  });

  it('setCountDown respects existing countdown', function() {
    const lem = new Lemming(0, 0, 1);
    expect(lem.setCountDown({})).to.equal(true);
    expect(lem.countdown).to.equal(80);
    expect(lem.setCountDown({})).to.equal(false);
  });

  it('processes out-of-level and missing action states', function() {
    const events = [];
    globalThis.lemmings = {
      game: {
        soundEvents: { emitSfx(type, id, payload) { events.push({ type, id, payload }); } },
        lemmingManager: { miniMap: { addDeath() { events.push({ type: 'death' }); } } }
      }
    };

    const lem = new Lemming(-1, 5, 2);
    const state = lem.process(makeLevel());
    expect(state).to.equal(LemmingStateType.OUT_OF_LEVEL);
    expect(events.some(e => e.type === SoundEventTypes.LEMMING_FELL_OFF)).to.equal(true);

    const lem2 = new Lemming(1, 1, 3);
    const state2 = lem2.process(makeLevel());
    expect(state2).to.equal(LemmingStateType.OUT_OF_LEVEL);
    expect(events.some(e => e.type === 'death')).to.equal(true);

    delete globalThis.lemmings;
  });

  it('processes countdown actions and main actions', function() {
    const lem = new Lemming(1, 1, 1);
    const level = makeLevel();
    lem.countdownAction = {
      process() { return LemmingStateType.NO_STATE_TYPE; },
      draw() {}
    };
    lem.action = {
      process() { return LemmingStateType.WALKING; },
      draw() {}
    };
    expect(lem.process(level)).to.equal(LemmingStateType.WALKING);

    let called = false;
    lem.countdownAction = {
      process() { called = true; return LemmingStateType.SPLATTING; },
      draw() {}
    };
    expect(lem.process(level)).to.equal(LemmingStateType.SPLATTING);
    expect(called).to.equal(true);
  });
});
