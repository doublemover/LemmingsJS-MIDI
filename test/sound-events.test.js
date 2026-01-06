import { expect } from 'chai';
import { withGlobalLemmings } from './helpers/lemmings.js';
import { SoundEventBus, getSoundBus } from '../js/game/SoundEvents.js';

describe('SoundEventBus', function() {
  it('skips emit when event is missing or queue is disabled', function() {
    const bus = new SoundEventBus(null);
    bus.emit(null);
    expect(bus.flush()).to.have.length(0);

    bus._queueLimit = 0;
    bus.emit({ type: 'x' });
    expect(bus.flush()).to.have.length(0);
  });

  it('emits payloads with timing data and triggers listeners', function() {
    const timer = {
      getGameTicks() { return 5; },
      frameTime: 40,
      speedFactor: 2,
      tps: 25
    };
    const bus = new SoundEventBus(timer);
    const seen = [];
    bus.onEvent.on(event => seen.push(event));

    bus.emit({ type: 'custom', sfxId: 7, extra: true });

    const payload = seen[0];
    expect(payload.tick).to.equal(5);
    expect(payload.timeMs).to.equal(200);
    expect(payload.frameMs).to.equal(40);
    expect(payload.speedFactor).to.equal(2);
    expect(payload.tps).to.equal(25);
    expect(payload.extra).to.equal(true);
  });

  it('falls back to defaults when timer data is missing', function() {
    const timer = { TIME_PER_FRAME_MS: 50 };
    const bus = new SoundEventBus(timer);
    bus.emit({ type: 'a' });
    const payload = bus.flush()[0];
    expect(payload.tick).to.equal(0);
    expect(payload.frameMs).to.equal(50);
    expect(payload.speedFactor).to.equal(1);
    expect(payload.tps).to.equal(null);
  });

  it('emitSfx forwards to emit', function() {
    const bus = new SoundEventBus(null);
    bus.emitSfx('type', 2, { data: 1 });
    const payload = bus.flush()[0];
    expect(payload.type).to.equal('type');
    expect(payload.sfxId).to.equal(2);
    expect(payload.data).to.equal(1);
  });
});

describe('getSoundBus', function() {
  it('returns the global sound bus when available', function() {
    const bus = new SoundEventBus(null);
    withGlobalLemmings({ game: { soundEvents: bus } }, () => {
      expect(getSoundBus()).to.equal(bus);
    });
  });

  it('falls back to lemmings global when globalThis is missing', function() {
    const bus = new SoundEventBus(null);
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'lemmings');
    let access = 0;
    Object.defineProperty(globalThis, 'lemmings', {
      configurable: true,
      get() {
        access += 1;
        if (access === 1) return null;
        return { game: { soundEvents: bus } };
      }
    });
    try {
      expect(getSoundBus()).to.equal(bus);
    } finally {
      if (prev) {
        Object.defineProperty(globalThis, 'lemmings', prev);
      } else {
        delete globalThis.lemmings;
      }
    }
  });
});
