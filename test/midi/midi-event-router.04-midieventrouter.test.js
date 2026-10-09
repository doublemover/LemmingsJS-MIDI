import { expect } from 'chai';
import { MidiEventRouter, makeRateSnapshot, makeRateScheduler, makeRateRouter, makePlan, makeRouter } from '../helpers/midi-router-fixtures.js';

describe('MidiEventRouter 4', function() {
  it('computes priorities, bpm, and arp keys', function() {
    const { router } = makeRouter({
      limits: { prioritySfx: [5] },
      timing: { bpmBase: 10 }
    });
    router.context = { game: { getGameTimer() { return { speedFactor: 2 }; } } };

    expect(router._getEventPriority({ sfxId: 5 }, {})).to.equal(2);
    expect(router._getEventPriority({ sfxId: 1 }, { priority: 3 })).to.equal(3);
    expect(router._getEventPriority({ sfxId: 2 }, {})).to.equal(1);
    expect(router._getBpm()).to.equal(20);

    const arpCfg = { arp: { independent: true } };
    expect(router._resolveArpKey({ triggerType: 7, sfxId: 1, objectId: 10 }, arpCfg))
      .to.equal('trigger:7:1:object:10');
    expect(router._resolveArpKey({ triggerType: 7, sfxId: 1, lemmingId: 5 }, arpCfg))
      .to.equal('trigger:7:1:lemming:5');
    expect(router._resolveArpKey({ triggerType: 7, sfxId: 1, x: 1, y: 2 }, arpCfg))
      .to.equal('trigger:7:1:1:2');
    expect(router._resolveArpKey({ sfxId: 2 }, {})).to.equal('sfx:2');
  });

  it('computes repeat factors and applies multiple targets', function() {
    const { router } = makeRouter({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 127 }, panRange: { min: -127, max: 127 } }
    });

    const repeatCfg = { maxRepeats: 2, windowBeats: 1, amount: 0.5, target: 'velocity' };
    expect(router._getRepeatFactor('sfx:1', 0, repeatCfg, 60)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', 500, repeatCfg, 60)).to.equal(0.5);

    const baseSpec = { note: 60, velocity: 64, durationTicks: 4, releaseVelocity: 64 };
    const notes = [60, 64];
    const velocity = router._applyRepeatTarget(baseSpec, notes, repeatCfg, 0.5).spec;
    expect(velocity.velocity).to.be.greaterThan(64);

    const duration = router._applyRepeatTarget(baseSpec, notes, { amount: 0.5, target: 'duration' }, 1).spec;
    expect(duration.durationTicks).to.be.greaterThan(4);

    const note = router._applyRepeatTarget(baseSpec, notes, { amount: 0.5, target: 'note' }, 1);
    expect(note.activeNotes[0]).to.be.greaterThan(60);

    const timbre = router._applyRepeatTarget({ ...baseSpec, timbre: 10 }, notes, { amount: 0.5, target: 'timbre' }, 1).spec;
    expect(timbre.timbre).to.be.greaterThan(10);

    const pan = router._applyRepeatTarget({ ...baseSpec, pan: 0 }, notes, { amount: 0.5, target: 'pan' }, 1).spec;
    expect(pan.pan).to.not.equal(0);

    const bend = router._applyRepeatTarget({ ...baseSpec, pitchBend: 0.2 }, notes, { amount: 0.5, target: 'pitchBend' }, 1).spec;
    expect(bend.pitchBend).to.be.greaterThan(0.2);

    const attack = router._applyRepeatTarget(baseSpec, notes, { amount: 0.5, target: 'attack' }, 1).spec;
    expect(attack.velocity).to.be.greaterThan(64);

    const sustain = router._applyRepeatTarget(baseSpec, notes, { amount: 0.5, target: 'sustain' }, 1).spec;
    expect(sustain.durationTicks).to.be.greaterThan(4);

    const release = router._applyRepeatTarget(baseSpec, notes, { amount: 0.5, target: 'release' }, 1).spec;
    expect(release.releaseVelocity).to.be.greaterThan(64);

    const noAmount = router._applyRepeatTarget(baseSpec, notes, { target: 'velocity' }, 1);
    expect(noAmount.spec.velocity).to.equal(64);
  });

  it('plans entries with mpe-aware off messages', function() {
    const { router } = makeRouter({ mpe: { enabled: true } });
    router.scheduler.tickMs = 10;
    const plan = router._planEntries({ note: 60, durationTicks: 2 }, 100, 2);
    expect(plan.on.count).to.equal(4);
    expect(plan.off.count).to.equal(4);
    const zero = router._planEntries({ note: 60, durationTicks: 0 }, 100, 1);
    expect(zero.off.count).to.equal(0);
  });

  it('drops events when hard count limits are exceeded', function() {
    const snapshot = makeRateSnapshot({ count: 7, bytes: 0 }, { count: 0, bytes: 0 }, 1000);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 6 } },
      snapshot
    );
    const plan = makePlan();
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('drops events when higher priority consumes the budget', function() {
    const bySfx = new Map([[2, { count: 5, bytes: 0, priority: 2 }]]);
    const snapshot = makeRateSnapshot({ count: 5, bytes: 0, bySfx }, { count: 0, bytes: 0 }, 1000);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 1000 } },
      snapshot
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('drops events when spacing or share budgets are exceeded', function() {
    const scheduler = makeRateScheduler(
      makeRateSnapshot({ count: 1, bytes: 0 }, { count: 0, bytes: 0 }, 100)
    );
    const { router } = makeRouter({
      limits: { maxEventsPerSecond: 1, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 100 },
      timing: { bpmBase: 60 }
    }, { scheduler });
    const maxPerSecond = Math.min(
      Math.max(router.mapping.config?.limits?.maxEventsPerSecond ?? 1000, 1),
      1000
    );
    router._lastAcceptedBySfx.set(1, 0);
    const spacingPlan = makePlan({ on: { count: maxPerSecond, bytes: 3 } });
    const spacingOk = router._shouldSend(
      { sfxId: 1, priority: 1 },
      { timeMs: 0 },
      spacingPlan,
      0
    );
    expect(spacingOk).to.equal(false);
    expect(router.getRateReport().reason).to.equal('spacing');

    const bySfx = new Map([[1, { count: 4, bytes: 0, priority: 1 }]]);
    router.scheduler.getRateSnapshot = () => (
      makeRateSnapshot({ count: 4, bytes: 0, bySfx }, { count: 0, bytes: 0 }, 100)
    );
    router.scheduler.getUsageShare = () => ([
      { sfxId: 1, count: 4, bytes: 0, priority: 1, percentCount: 1, percentBytes: 0 }
    ]);
    router._lastAcceptedBySfx.delete(1);
    const sharePlan = makePlan({ timeMs: 2000, on: { count: 1, bytes: 3 } });
    const shareOk = router._shouldSend(
      { sfxId: 1, priority: 1 },
      { timeMs: 2000 },
      sharePlan,
      2000
    );
    expect(shareOk).to.equal(false);
    expect(router.getRateReport().reason).to.equal('share-throttle');
  });

  it('handles rate limits and early exits', function() {
    const { router, sent } = makeRouter({ enabled: false });
    router._onEvent({ sfxId: 1, tick: 1 });
    expect(sent.length).to.equal(0);

    router.setMapping({ enabled: true, limits: { maxEventsPerSecond: 1000 } });
    router.scheduler.output = null;
    router._onEvent({ sfxId: 1, tick: 1 });
    expect(sent.length).to.equal(0);

    router.scheduler.output = {};
    router.mapping.mapEvent = () => null;
    router._onEvent({ sfxId: 1, tick: 1 });
    expect(sent.length).to.equal(0);

    router.mapping.mapEvent = () => ({ note: 1, velocity: 1, durationTicks: 1 });
    router.setMapping({ enabled: true, limits: { maxEventsPerSecond: 1 } });
    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 2 });
    expect(sent.length).to.equal(0);
  });

  it('forwards output updates and handles unknown repeat targets', function() {
    let seen = null;
    const { router } = makeRouter({}, { scheduler: { setOutput(output) { seen = output; } } });
    const output = { channels: {} };
    router.setOutput(output);
    expect(seen).to.equal(output);

    const spec = { note: 60, velocity: 64, durationTicks: 2 };
    const result = router._applyRepeatTarget(
      spec,
      [60],
      { amount: 0.5, target: 'unknown-target' },
      1
    );
    expect(result.spec).to.deep.equal(spec);
  });

  it('forwards usage share queries to the scheduler', function() {
    const { router } = makeRouter({}, { scheduler: { getUsageShare: window => [{ window }] } });
    const share = router.getUsageShare('next');
    expect(share[0].window).to.equal('next');
  });

  it('covers tick defaults and density edge cases', function() {
    const { router, mapping } = makeRouter({ density: { windowTicks: 0 } });
    router.context = {};

    expect(router._tickMsFromEvent({})).to.equal(60);
    expect(router._densityForEvent({ sfxId: 1, tick: 1 })).to.equal(0);

    router.mapping.config.density.windowTicks = 5;
    expect(router._densityForEvent({ sfxId: null, tick: 1 })).to.equal(0);
    router._lastTickBySfx.set(1, 5);
    expect(router._densityForEvent({ sfxId: 1, tick: 5 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 20 })).to.equal(0);
  });

  it('falls back to Date.now when performance is missing', function() {
    const { router } = makeRouter();
    const originalPerf = globalThis.performance;
    const originalDateNow = Date.now;
    Date.now = () => 123;
    globalThis.performance = undefined;
    try {
      expect(router._nowMs()).to.equal(123);
    } finally {
      Date.now = originalDateNow;
      globalThis.performance = originalPerf;
    }
  });

  it('reuses schedule base and respects spacing tick repeats', function() {
    const { router, mapping } = makeRouter({ repeat: { maxRepeats: 2, spacingTicks: 2 } });
    router._nowMs = () => 1000;
    const base = router._resolveScheduleBase(100, 60, 1);
    expect(base).to.equal(900);
    const again = router._resolveScheduleBase(200, 60, 1);
    expect(again).to.equal(base);

    const factorA = router._getRepeatFactor('sfx:1', 1000, mapping.config.repeat, 60);
    const factorB = router._getRepeatFactor('sfx:1', 1100, mapping.config.repeat, 60);
    expect(factorA).to.equal(0);
    expect(factorB).to.be.greaterThan(0);
  });
});
