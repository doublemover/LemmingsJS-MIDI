import { expect } from 'chai';
import { withGlobalLemmings, MidiEventRouter, EventHandler, makeRateSnapshot, makeRateRouter, makePlan, makeRouter, makeArpRouter } from '../helpers/midi-router-fixtures.js';

describe('MidiEventRouter 3', function() {
  it('handles repeat factor and repeat targets directly', function() {
    const { router } = makeRouter({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 100 }, panRange: { min: -50, max: 50 } }
    });
    expect(router._getRepeatFactor('x', 10, { enabled: false }, 120)).to.equal(0);
    expect(router._getRepeatFactor('x', Number.NaN, { maxRepeats: 1, windowBeats: 1 }, 120)).to.equal(0);

    const baseSpec = { note: 60, velocity: 64, durationTicks: 2, timbre: 50, pan: 0, pitchBend: 0.2 };
    const noteList = [60, 64];
    const amountCfg = { amount: 1, target: 'timbre' };
    const timbreResult = router._applyRepeatTarget(baseSpec, noteList, amountCfg, 0.5);
    expect(timbreResult.spec.timbre).to.not.equal(50);

    const panResult = router._applyRepeatTarget(baseSpec, noteList, { amount: 1, target: 'pan' }, 0.5);
    expect(panResult.spec.pan).to.not.equal(0);

    const attackResult = router._applyRepeatTarget(baseSpec, noteList, { amount: 1, target: 'attack' }, 0.5);
    expect(attackResult.spec.velocity).to.not.equal(64);

    const sustainResult = router._applyRepeatTarget(baseSpec, noteList, { amount: 1, target: 'sustain' }, 0.5);
    expect(sustainResult.spec.durationTicks).to.not.equal(2);
    const sustainDefault = router._applyRepeatTarget(
      { ...baseSpec, durationTicks: null },
      noteList,
      { amount: 1, target: 'sustain' },
      0.5
    );
    expect(sustainDefault.spec.durationTicks).to.be.at.least(1);

    const noTimbre = router._applyRepeatTarget({ ...baseSpec, timbre: null }, noteList, { amount: 1, target: 'timbre' }, 0.5);
    expect(noTimbre.spec.timbre).to.equal(null);
    const noPan = router._applyRepeatTarget({ ...baseSpec, pan: null }, noteList, { amount: 1, target: 'pan' }, 0.5);
    expect(noPan.spec.pan).to.equal(null);
  });

  it('reports priority saturation', function() {
    const bySfx = new Map([[2, { count: 1000, bytes: 10, priority: 2 }]]);
    const snapshot = makeRateSnapshot({ count: 1000, bytes: 10, bySfx }, {}, 1000);
    const usageShare = [
      { sfxId: 2, count: 1000, bytes: 10, priority: 2, percentCount: 1, percentBytes: 1 }
    ];
    const { router } = makeRateRouter({
      timing: { bpmBase: 60 },
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 2000, maxBytesPerSecond: 1000 }
    }, snapshot, usageShare);
    const plan = makePlan({ timeMs: 2000 });
    const saturated = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(saturated).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('defaults priorities when missing', function() {
    const snapshot = makeRateSnapshot(
      { count: 6, bytes: 0, bySfx: new Map([[2, { count: 1, bytes: 0 }]]) },
      {},
      1000
    );
    const usageShare = [{ sfxId: 2, count: 1, bytes: 0, percentCount: 1, percentBytes: 0 }];
    const { router } = makeRateRouter({
      timing: { bpmBase: 60 },
      limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 1000 }
    }, snapshot, usageShare);
    const plan = makePlan({ on: { count: 1 }, off: { timeMs: 2000 } });
    const ok = router._shouldSend({ sfxId: 1 }, {}, plan, 0);
    expect(ok).to.equal(true);
  });

  it('reports spacing limits when events arrive too quickly', function() {
    const snapshot = makeRateSnapshot({ count: 10, bytes: 0 }, {}, 1000);
    const { router } = makeRateRouter({
      timing: { bpmBase: 60 },
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 1000 }
    }, snapshot);
    const plan = makePlan({ on: { count: 1 }, off: { timeMs: 2000 } });
    router._lastAcceptedBySfx.set(1, 0);
    const spacing = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(spacing).to.equal(false);
    expect(router.getRateReport().reason).to.equal('spacing');
  });

  it('accounts for byte-heavy groups in share overage', function() {
    const bySfx = new Map([
      [2, { count: 1, bytes: 90, priority: 2 }],
      [1, { count: 1, bytes: 20, priority: 1 }]
    ]);
    const snapshot = makeRateSnapshot({ count: 20, bytes: 0, bySfx }, {}, 100);
    const usageShare = [{ sfxId: 1, count: 1, bytes: 20, priority: 1, percentCount: 1, percentBytes: 1 }];
    const { router } = makeRateRouter({
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 100 }
    }, snapshot, usageShare);
    const plan = makePlan({ timeMs: 2000 });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 1000 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('share-throttle');
  });

  it('resets arp indices when out of range', function() {
    const { router, sent } = makeArpRouter({ enabled: true, mode: 'up', length: 3 });
    router._arpStateBySfx.set('sfx:1', { index: 99, dir: 1, mode: 'up', length: 3, seqKey: '60,64,67' });
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    expect(sent[0].note).to.equal(60);
  });

  it('defaults arp length to the note list', function() {
    const { router, sent } = makeArpRouter(
      { enabled: true, mode: 'down' },
      { limits: { maxEventsPerSecond: 10000 } },
      [60, 64]
    );
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    expect(sent[0].note).to.equal(64);
  });

  it('builds context from game state and stage when available', function() {
    const { router, sent } = makeRouter({ limits: { maxEventsPerSecond: 1000 } }, {
      mapEvent: (event, context) => {
        expect(context.levelWidth).to.equal(200);
        expect(context.levelHeight).to.equal(100);
        expect(context.viewRect.w).to.equal(200);
        return { note: 60, velocity: 64, durationTicks: 0 };
      }
    });
    router.context = {
      game: { level: { width: 200, height: 100 } },
      stage: { getGameViewRect() { return { x: 0, w: 200 }; } }
    };
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    expect(sent.length).to.equal(1);
  });

  it('resolves arp keys with fallback coordinates', function() {
    const { router } = makeRouter();
    const key = router._resolveArpKey(
      { triggerType: 7, sfxId: 1, x: NaN },
      { arp: { independent: true } }
    );
    expect(key).to.equal('trigger:7:1:x:y');
  });

  it('emits performance measurements when enabled', function() {
    const originalPerf = globalThis.performance;
    let measures = 0;
    globalThis.performance = { now: () => 0, measure: () => { measures += 1; } };
    try {
      withGlobalLemmings({ performanceAPI: true }, () => {
        const { router } = makeRouter(
          { limits: { maxEventsPerSecond: 1000 } },
          { mapEvent: () => ({ note: 60, velocity: 64, durationTicks: 0 }) }
        );
        router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
        expect(measures).to.equal(1);
      });
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('swallows performance measurement errors', function() {
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => 0, measure: () => { throw new Error('boom'); } };
    try {
      withGlobalLemmings({ performanceAPI: true }, () => {
        const { router, sent } = makeRouter(
          { limits: { maxEventsPerSecond: 1000 } },
          { mapEvent: () => ({ note: 60, velocity: 64, durationTicks: 0 }) }
        );
        router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
        expect(sent.length).to.equal(1);
      });
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('dispose detaches and disposes scheduler', function() {
    const { router } = makeRouter();
    const bus = { onEvent: new EventHandler() };
    const calls = [];
    router.scheduler = { dispose() { calls.push('dispose'); } };
    router.attach(bus);
    router.dispose();
    expect(bus.onEvent.handlers.size).to.equal(0);
    expect(calls).to.eql(['dispose']);
  });

  it('computes tick duration and density helpers', function() {
    const { router } = makeRouter({ density: { windowTicks: 4 } });
    router.context = { game: { getGameTimer() { return { frameTime: 30 }; } } };
    expect(router._tickMsFromEvent({ tps: 25 })).to.equal(40);
    expect(router._tickMsFromEvent({ frameMs: 10 })).to.equal(10);
    expect(router._tickMsFromEvent({})).to.equal(30);

    expect(router._densityForEvent({})).to.equal(0);
    router._lastTickBySfx.set(1, 5);
    expect(router._densityForEvent({ sfxId: 1, tick: 5 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 9 })).to.equal(0);
  });

  it('resets schedule base when timing changes', function() {
    let cleared = 0;
    const { router } = makeRouter({}, {
      scheduler: {
        allNotesOff() { cleared += 1; },
        clearQueue() { cleared += 1; }
      }
    });
    router._nowMs = () => 1000;

    expect(router._resolveScheduleBase(NaN, 60, 1)).to.equal(null);
    const base = router._resolveScheduleBase(100, 60, 1);
    expect(base).to.equal(900);

    router._resolveScheduleBase(120, 30, 1);
    expect(cleared).to.equal(2);
  });
});
