import { expect } from 'chai';
import { MidiEventRouter, MidiMapping, EventHandler, defaultSpec, makeSchedulerStub, makeRateSnapshot, makeRateScheduler, makeRouter, makeArpRouter } from '../helpers/midi-router-fixtures.js';

describe('MidiEventRouter 2', function() {
  it('bounds repeat-history key growth for independent triggers', function() {
    const { router } = makeRouter(
      {
        repeat: { maxRepeats: 2, windowBeats: 8 },
        limits: { maxEventsPerSecond: 1000 },
        triggers: { '5': { repeat: { maxRepeats: 2, windowBeats: 8 } } }
      },
      { defaultMapEvent: true }
    );
    router._nowMs = () => 1000;

    for (let i = 0; i < 700; i += 1) {
      router._onEvent({ sfxId: 1, tick: i + 1, tps: 60, triggerType: 5, timeMs: i * 10 + 1 + i });
      router._onEvent({ sfxId: 1, tick: i + 1, tps: 60, triggerType: 5 + i, timeMs: i * 10 + 2 + i });
    }

    expect(router._repeatHistoryByKey.size).to.be.at.most(512);
  });

  it('caps repeat-history entry count per key to maxRepeats + 1', function() {
    const { router } = makeRouter();
    const cfg = { maxRepeats: 2, windowBeats: 10 };
    for (let i = 0; i < 20; i += 1) {
      router._getRepeatFactor('sfx:42', i * 10, cfg, 120);
    }
    expect(router._repeatHistoryByKey.get('sfx:42')).to.have.length(3);
  });

  it('reverses direction for updown arps at bounds', function() {
    const { router, sent } = makeArpRouter({ enabled: true, mode: 'updown', length: 3 });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 4, tps: 50 });

    expect(sent.map(entry => entry.note)).to.eql([60, 64, 67, 64]);
  });

  it('applies custom arp step patterns when preset is custom', function() {
    const { router, sent } = makeArpRouter({
      enabled: true,
      mode: 'up',
      length: 3,
      pattern: { preset: 'custom', steps: ['up', 'hold', 'down'] }
    });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 4, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 5, tps: 50 });

    expect(sent.map(entry => entry.note)).to.eql([60, 64, 64, 60, 64]);
  });

  it('resets custom arp step state when the pattern changes', function() {
    const { router, sent } = makeArpRouter({
      enabled: true,
      mode: 'up',
      length: 3,
      pattern: { preset: 'custom', steps: ['up'] }
    });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: {
        enabled: true,
        mode: 'up',
        length: 3,
        pattern: { preset: 'custom', steps: ['down'] }
      }
    });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });

    expect(sent.map(entry => entry.note)).to.eql([60, 64, 60]);
  });

  it('resets arpeggio state when the mode changes', function() {
    const { router, sent } = makeArpRouter({ enabled: true, mode: 'up', length: 3 });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'down', length: 3 }
    });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(sent.length).to.equal(2);
  });

  it('resets scheduling when speed changes', function() {
    const sent = [];
    const scheduler = makeSchedulerStub(sent);
    let allOffCalls = 0;
    scheduler.allNotesOff = () => { allOffCalls += 1; };
    const { router } = makeRouter({ limits: { maxEventsPerSecond: 1000 } }, {
      scheduler,
      mapEvent: () => defaultSpec()
    });
    router._nowMs = () => 1000;

    router._onEvent({ sfxId: 1, tick: 1, timeMs: 0, frameMs: 60, speedFactor: 1 });
    router._onEvent({ sfxId: 1, tick: 2, timeMs: 60, frameMs: 120, speedFactor: 0.5 });

    expect(allOffCalls).to.equal(1);
  });

  it('scales repeat intensity within a beat window', function() {
    const { router, sent } = makeRouter({
      repeat: {
        maxRepeats: 2,
        windowBeats: 4,
        amount: null,
        velocityBoost: 0.5,
        durationBoost: 0.5
      },
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 1000 }
    }, { mapEvent: () => ({ note: 60, velocity: 40, durationTicks: 2 }) });

    router._nowMs = () => 1000;
    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 2 });

    expect(sent.length).to.equal(2);
    expect(sent[1].velocity).to.be.greaterThan(sent[0].velocity);
    expect(sent[1].durationTicks).to.be.greaterThan(sent[0].durationTicks);
  });

  it('applies repeat targets when amount is configured', function() {
    const { router, sent } = makeRouter({
      repeat: {
        maxRepeats: 4,
        windowBeats: 1,
        amount: 1,
        target: 'note'
      },
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 1000 }
    }, { mapEvent: () => ({ note: 60, velocity: 40, durationTicks: 1 }) });

    let now = 0;
    router._nowMs = () => now;
    router._onEvent({ sfxId: 1, tick: 1 });
    now = 100;
    router._onEvent({ sfxId: 1, tick: 2 });

    expect(sent.length).to.equal(2);
    expect(sent[1].note).to.be.greaterThan(sent[0].note);
  });

  it('drops events when byte limits are exceeded', function() {
    const sent = [];
    const baseSnapshot = makeRateSnapshot({ count: 1, bytes: 3 }, { count: 0, bytes: 0 }, 3);
    const usageShare = [{ sfxId: 99, count: 1, bytes: 3, priority: 1, percentCount: 1, percentBytes: 1 }];
    const scheduler = {
      ...makeRateScheduler((now = 0) => ({ ...baseSnapshot, now }), usageShare),
      output: {},
      tickMs: 60,
      setTickMs() {},
      estimateMessages() { return { messages: 1, bytes: 3 }; },
      sendNote() { sent.push(true); }
    };
    const { router } = makeRouter(
      { limits: { maxEventsPerSecond: 1000, maxBytesPerSecond: 3 } },
      {
        scheduler,
        mapEvent: () => ({ note: 60, velocity: 64, durationTicks: 1 })
      }
    );

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });

    expect(sent.length).to.equal(0);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('attaches and detaches from sound buses', function() {
    const { router } = makeRouter();
    const busA = { onEvent: new EventHandler() };
    const busB = { onEvent: new EventHandler() };
    router.attach(busA);
    expect(busA.onEvent.handlers.size).to.equal(1);
    router.attach(busB);
    expect(busA.onEvent.handlers.size).to.equal(0);
    expect(busB.onEvent.handlers.size).to.equal(1);
    router.detach();
    expect(busB.onEvent.handlers.size).to.equal(0);
  });

  it('accepts plain mapping configs and resets context defaults', function() {
    let configured = null;
    const { router } = makeRouter({}, {
      scheduler: { setConfig(cfg) { configured = cfg; } }
    });
    router.setMapping({ timing: { bpmBase: 90 } });
    expect(router.mapping).to.be.instanceOf(MidiMapping);
    expect(configured).to.equal(router.mapping.config);

    const bus = { onEvent: new EventHandler() };
    router.attach(bus, null);
    expect(router.context).to.eql({});
    router.detach();
  });

  it('keeps MidiMapping instances when setting mapping', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 100 } });
    const { router } = makeRouter();
    router.setMapping(mapping);
    expect(router.mapping).to.equal(mapping);
  });
});
