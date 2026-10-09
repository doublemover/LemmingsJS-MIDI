import { expect } from 'chai';
import { MidiEventRouter, MidiMapping, toMidiFlagTriggerType, defaultSpec, makeRateSnapshot, makeRateScheduler, makeRateRouter, makePlan, makeRouter, makeArpRouter } from '../helpers/midi-router-fixtures.js';

describe('MidiEventRouter 1', function() {
  it('computes density and tick duration', function() {
    const densities = [];
    const { router, sent } = makeRouter({ density: { windowTicks: 10 } }, {
      mapEvent: (event, context, density) => {
        densities.push(density);
        return defaultSpec();
      }
    });

    let now = 0;
    router._nowMs = () => now;
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(router.scheduler.tickMs).to.equal(20);
    expect(densities[0]).to.equal(0);
    expect(densities[1]).to.be.closeTo(0.9, 0.01);
    expect(sent.length).to.equal(2);
  });

  it('passes reverse flags to the scheduler', function() {
    const { router, sent } = makeRouter(new MidiMapping(), { defaultMapEvent: true });

    router._onEvent({ sfxId: 1, tick: 1, reverse: true });

    expect(sent[0].reverse).to.equal(true);
  });

  it('ignores events when disabled or output is missing', function() {
    const cases = [
      {
        name: 'disabled mapping',
        config: { enabled: false },
        output: true,
        events: [{ sfxId: 1, tick: 1 }]
      },
      {
        name: 'missing output',
        config: { enabled: true },
        output: false,
        events: [{ sfxId: 1, tick: 1 }, {}]
      }
    ];

    for (const testCase of cases) {
      const { router, sent } = makeRouter(testCase.config, {
        defaultMapEvent: true,
        output: testCase.output
      });
      for (const event of testCase.events) {
        router._onEvent(event);
      }
      expect(sent.length, testCase.name).to.equal(0);
    }
  });

  it('requires explicit trigger mapping for midi flag trigger events', function() {
    const triggerType = toMidiFlagTriggerType(3);
    const { router, sent } = makeRouter({
      enabled: true,
      triggers: {}
    }, {
      mapEvent: (event, _context, _density, sfx) => {
        if (!sfx || Object.keys(sfx).length === 0) return null;
        return { note: 65, velocity: 80, durationTicks: 2 };
      }
    });

    router._onEvent({ sfxId: 0, triggerType, tick: 1, x: 10, y: 10 });
    expect(sent).to.have.length(0);

    router.mapping.config.triggers[String(triggerType)] = { note: 67, velocity: 100, durationTicks: 2 };
    router._onEvent({ sfxId: 0, triggerType, tick: 2, x: 12, y: 12 });
    expect(sent).to.have.length(1);
    expect(sent[0].note).to.equal(65);
  });

  it('schedules ahead when event time is behind', function() {
    const { router, sent } = makeRouter({
      timing: { scheduleAheadMs: 50 },
      limits: { maxEventsPerSecond: 1000 }
    }, { defaultMapEvent: true });
    router._nowMs = () => 1000;
    router._resolveScheduleBase = () => 900;

    router._onEvent({ sfxId: 1, tick: 1, timeMs: 0 });

    expect(sent[0].timeMs).to.equal(1050);
  });

  it('enforces per-tick and per-second limits', function() {
    const { router, sent } = makeRouter({
      mpe: { enabled: false },
      limits: { maxEventsPerTick: 1, maxEventsPerSecond: 2 }
    }, { defaultMapEvent: true });

    let now = 0;
    router._nowMs = () => now;

    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 1 });
    expect(sent.length).to.equal(1);

    router._onEvent({ sfxId: 1, tick: 2 });
    expect(sent.length).to.equal(1);

    now = 1100;
    router._onEvent({ sfxId: 1, tick: 3 });
    expect(sent.length).to.equal(2);
  });

  it('rejects events when higher-priority bytes saturate the window', function() {
    const bySfx = new Map([[2, { count: 0, bytes: 9, priority: 2 }]]);
    const snapshot = makeRateSnapshot(
      { count: 11, bytes: 9, bySfx },
      { count: 0, bytes: 0 },
      9
    );
    const { router } = makeRateRouter({
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 9 }
    }, snapshot);
    const plan = makePlan();
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('allows events when spacing and budgets are available', function() {
    const snapshot = makeRateSnapshot(
      { count: 9, bytes: 100 },
      { count: 0, bytes: 0 },
      1000
    );
    const { router } = makeRateRouter({
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 1000 }
    }, snapshot);
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(true);
  });

  it('rejects events when past plus next plus proposed traffic exceeds the reservation budget', function() {
    const snapshot = makeRateSnapshot(
      { count: 1, bytes: 3, bySfx: new Map([[2, { count: 1, bytes: 3, priority: 1 }]]) },
      { count: 1, bytes: 3, bySfx: new Map([[1, { count: 1, bytes: 3, priority: 1 }]]) }
    );
    const { router } = makeRateRouter({
      limits: { maxEventsPerSecond: 3, hardMaxEventsPerSecond: 3 }
    }, snapshot);
    const plan = makePlan({ timeMs: 0, on: { count: 2, bytes: 6 } });
    const ok = router._shouldSend({ sfxId: 3, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('exposes the scheduler rate snapshot', function() {
    const snapshot = { next: { count: 0, bytes: 0, bySfx: new Map() } };
    const { router } = makeRouter({}, { scheduler: makeRateScheduler(snapshot) });
    expect(router.getRateSnapshot()).to.equal(snapshot);
  });

  it('steps through arpeggio notes across events', function() {
    const { router, sent } = makeArpRouter({ enabled: true, mode: 'up', length: 3 });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(sent[0].note).to.equal(60);
    expect(sent[1].note).to.equal(64);
  });

  it('handles single-note arps without advancing', function() {
    const { router, sent } = makeArpRouter(
      { enabled: true, mode: 'up', length: 1 },
      {},
      [60]
    );

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(sent.length).to.equal(2);
    expect(sent[0].note).to.equal(60);
    expect(sent[1].note).to.equal(60);
  });

  it('handles downward arps with independent trigger keys', function() {
    const { router, sent } = makeArpRouter(
      { enabled: true, mode: 'down', length: 3 },
      { triggers: { '5': { arp: { independent: true } } } }
    );

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, triggerType: 5, objectId: 100 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50, triggerType: 5, objectId: 100 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50, triggerType: 5, objectId: 200 });

    expect(sent[0].note).to.equal(67);
    expect(sent[1].note).to.equal(64);
    expect(sent[2].note).to.equal(67);
  });

  it('bounds independent arp cache growth', function() {
    const { router } = makeRouter(
      { limits: { maxEventsPerSecond: 1000 }, triggers: { '5': { arp: { independent: true } } } },
      {
        mapEvent: () => ({
          notes: [60, 64],
          note: 60,
          velocity: 64,
          durationTicks: 1,
          arp: { enabled: true, mode: 'up', length: 2 }
        })
      }
    );

    for (let i = 0; i < 300; i += 1) {
      router._onEvent({ sfxId: 1, tick: i + 1, tps: 50, triggerType: 5, objectId: i });
    }

    expect(router._arpStateBySfx.size).to.be.at.most(256);
    expect(router._arpStateBySfx.has('trigger:5:1:object:0')).to.equal(false);
    expect(router._arpStateBySfx.has('trigger:5:1:object:299')).to.equal(true);
  });
});
