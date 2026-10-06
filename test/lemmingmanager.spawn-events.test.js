import { expect } from 'chai';
import { withActionStubs } from './helpers/lemming-actions.js';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { getAppContext } from '../js/core/dependencies.js';
import { makeManager } from './helpers/lemming-manager.js';
import { SoundEventBus, SoundEventTypes, SoundEffectIds } from '../js/game/SoundEvents.js';
import { TimeTravelController } from '../js/game/TimeTravelController.js';

describe('actual lemming spawn events', function() {
  useGlobalLemmings({ bench: false, extraLemmings: 0, game: { showDebug: false } });

  beforeEach(function() {
    this.restoreActions = withActionStubs();
  });

  afterEach(function() {
    this.restoreActions();
  });

  const connectSound = (manager) => {
    const timer = { tick: 0, frameTime: 60, speedFactor: 1, getGameTicks() { return this.tick; } };
    const bus = new SoundEventBus(timer);
    manager.runtime = { soundEvents: bus };
    return { timer, bus };
  };

  it('emits at real release ticks, independently of the one-time hatch opening', function() {
    const { manager } = makeManager({ releaseCount: 2, releaseRate: 100 });
    manager.releaseTickIndex = 0;
    const { timer, bus } = connectSound(manager);
    for (let tick = 1; tick <= 12; tick += 1) {
      timer.tick = tick;
      manager.addNewLemmings();
    }
    const events = bus.flush();
    const spawns = events.filter(event => event.type === SoundEventTypes.LEMMING_SPAWN);
    expect(spawns.map(event => event.tick)).to.deep.equal([4, 8]);
    expect(spawns.map(event => event.timeMs)).to.deep.equal([240, 480]);
    expect(spawns.map(event => event.lemmingId)).to.deep.equal([0, 1]);
    expect(spawns[0]).to.include({ sfxId: SoundEffectIds.SPAWN, x: 24, y: 14 });
    expect(events.filter(event => event.type === SoundEventTypes.ENTRANCE_OPEN)).to.have.length(1);
    expect(manager.spawnTotal).to.equal(2);
    bus.dispose();
  });

  it('records one event per real extra lemming and none for history object acquisition', function() {
    getAppContext().extraLemmings = 2;
    const { manager } = makeManager();
    const { bus } = connectSound(manager);
    const recorded = [];
    bus.setHistoryStore({ recordSoundEvent: event => recorded.push(event) });
    manager.addLemming(7, 9);
    expect(recorded.map(event => event.lemmingId)).to.deep.equal([0, 1, 2]);
    expect(recorded.every(event => event.type === SoundEventTypes.LEMMING_SPAWN)).to.equal(true);
    expect(recorded.every(event => event.x === 7 && event.y === 9)).to.equal(true);
    manager._acquireLemming(7, 9, 3);
    expect(recorded).to.have.length(3);
    bus.dispose();
  });

  it('replays recorded spawn events through existing reverse handling without spawning', function() {
    const { manager } = makeManager();
    const { timer, bus } = connectSound(manager);
    manager.addLemming(7, 9);
    const soundEvents = bus.flush();
    const game = { soundEvents: bus, getGameTimer: () => timer };
    const travel = new TimeTravelController(game, null);
    timer.tick = 10;
    travel._emitReverseEvents({ soundEvents });
    expect(bus.flush()[0]).to.include({
      type: SoundEventTypes.LEMMING_SPAWN,
      sfxId: SoundEffectIds.SPAWN,
      reverse: true,
      tick: 10,
      timeMs: 600
    });
    expect(manager.spawnTotal).to.equal(1);
    travel.dispose();
    bus.dispose();
  });
});
