import { expect } from 'chai';
import { ActionFallSystem } from '../js/actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../js/actions/ActionFloatingSystem.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { SoundEventBus, SoundEventTypes, SoundEffectIds } from '../js/game/SoundEvents.js';

const setup = (System) => {
  const action = new System(null);
  const timer = { frameTime: 17, speedFactor: 1, getGameTicks: () => 13 };
  const bus = new SoundEventBus(timer);
  action.setRuntime({ soundEvents: bus });
  const lem = { id: 7, x: 20, y: 10, frameIndex: 0, state: 6, hasParachute: false };
  return { action, bus, lem };
};

describe('safe lemming landing events', function() {
  it('emits a plain event at the exact successful fall landing tick and final position', function() {
    const { action, bus, lem } = setup(ActionFallSystem);
    expect(action.process({ hasGroundAt: (x, y) => y === 12 }, lem)).to.equal(LemmingStateType.WALKING);
    const events = bus.flush();
    expect(events).to.have.length(1);
    expect(events[0]).to.include({
      type: SoundEventTypes.LEMMING_LAND, sfxId: SoundEffectIds.LAND,
      lemmingId: 7, x: 20, y: 12, tick: 13, timeMs: 221, frameMs: 17, speedFactor: 1
    });
    bus.dispose();
  });

  it('does not report a landing while falling, opening a parachute, splatting, or already grounded', function() {
    const { action, bus, lem } = setup(ActionFallSystem);
    action.process({ hasGroundAt: () => false }, lem);
    lem.state = 17; lem.hasParachute = true;
    expect(action.process({ hasGroundAt: () => true }, lem)).to.equal(LemmingStateType.FLOATING);
    lem.hasParachute = false; lem.state = Lemming.LEM_MAX_FALLING + 1;
    expect(action.process({ hasGroundAt: () => true }, lem)).to.equal(LemmingStateType.SPLATTING);
    lem.state = 0;
    expect(action.process({ hasGroundAt: () => true }, lem)).to.equal(LemmingStateType.WALKING);
    expect(bus.flush()).to.deep.equal([]);
    bus.dispose();
  });

  it('emits a safe floating landing independently of fall-distance state', function() {
    const { action, bus, lem } = setup(ActionFloatingSystem);
    lem.state = 0;
    expect(action.process({ hasGroundAt: () => false }, lem)).to.equal(LemmingStateType.NO_STATE_TYPE);
    const groundY = lem.y + 1;
    expect(action.process({ hasGroundAt: (x, y) => y === groundY }, lem)).to.equal(LemmingStateType.WALKING);
    const events = bus.flush();
    expect(events).to.have.length(1);
    expect(events[0]).to.include({ type: SoundEventTypes.LEMMING_LAND, sfxId: SoundEffectIds.LAND, lemmingId: 7, y: groundY, tick: 13, timeMs: 221 });
    bus.dispose();
  });
});
