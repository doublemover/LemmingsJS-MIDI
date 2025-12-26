import { expect } from 'chai';
import {
  SoundEventBus,
  SoundEventTypes,
  SoundEffectIds,
  getSoundBus
} from '../js/game/SoundEvents.js';

describe('SoundEventBus', function() {
  it('emits payloads with timer context and queues them', function() {
    const timer = {
      getGameTicks: () => 5,
      frameTime: 50,
      speedFactor: 2,
      tps: 20
    };
    const bus = new SoundEventBus(timer);
    const events = [];
    bus.onEvent.on(evt => events.push(evt));

    bus.emit({
      type: SoundEventTypes.LEVEL_START,
      sfxId: SoundEffectIds.LEVEL_START,
      x: 3
    });

    expect(events.length).to.equal(1);
    const payload = events[0];
    expect(payload.tick).to.equal(5);
    expect(payload.timeMs).to.equal(250);
    expect(payload.frameMs).to.equal(50);
    expect(payload.speedFactor).to.equal(2);
    expect(payload.tps).to.equal(20);
    expect(payload.type).to.equal(SoundEventTypes.LEVEL_START);
    expect(payload.sfxId).to.equal(SoundEffectIds.LEVEL_START);

    const flushed = bus.flush();
    expect(flushed.length).to.equal(1);
    expect(bus.flush().length).to.equal(0);
  });

  it('skips enqueueing when the queue is full and no listeners exist', function() {
    const bus = new SoundEventBus({ getGameTicks: () => 0, frameTime: 60 });
    bus._queueLimit = 1;
    bus.emitSfx(SoundEventTypes.SKILL_SELECT, SoundEffectIds.SKILL_SELECT);
    bus.emitSfx(SoundEventTypes.SKILL_ASSIGN, SoundEffectIds.SKILL_ASSIGN);
    expect(bus._queue.length).to.equal(1);
  });
});

describe('getSoundBus', function() {
  it('returns the global game sound bus when available', function() {
    const bus = new SoundEventBus({ getGameTicks: () => 0, frameTime: 60 });
    globalThis.lemmings = { game: { soundEvents: bus } };
    expect(getSoundBus()).to.equal(bus);
    delete globalThis.lemmings;
  });
});
