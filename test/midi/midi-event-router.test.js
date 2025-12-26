import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';

const makeSchedulerStub = (sent) => ({
  output: {},
  setTickMs(ms) { this.tickMs = ms; },
  sendNote(spec) { sent.push(spec); },
  setConfig() {},
  setOutput() {},
  dispose() {}
});

describe('MidiEventRouter', function() {
  it('computes density and tick duration', function() {
    const mapping = new MidiMapping({ density: { windowTicks: 10 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);

    const densities = [];
    router.mapping.mapEvent = (event, context, density) => {
      densities.push(density);
      return { note: 60, velocity: 64, durationTicks: 1 };
    };

    let now = 0;
    router._nowMs = () => now;
    router._resetRateLimit();

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(router.scheduler.tickMs).to.equal(20);
    expect(densities[0]).to.equal(0);
    expect(densities[1]).to.be.closeTo(0.9, 0.01);
    expect(sent.length).to.equal(2);
  });

  it('enforces per-tick and per-second limits', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerTick: 1, maxEventsPerSecond: 1 }
    });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 1 });

    let now = 0;
    router._nowMs = () => now;
    router._resetRateLimit();

    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 1 });
    expect(sent.length).to.equal(1);

    router._onEvent({ sfxId: 1, tick: 2 });
    expect(sent.length).to.equal(1);

    now = 1000;
    router._onEvent({ sfxId: 1, tick: 3 });
    expect(sent.length).to.equal(2);
  });
});
