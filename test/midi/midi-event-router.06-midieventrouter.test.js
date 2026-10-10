import { expect } from 'chai';
import { MidiEventRouter, MidiMapping, makeRateSnapshot, makeRateScheduler, makeRateRouter, makePlan, makeRouter } from '../helpers/midi-router-fixtures.js';

describe('MidiEventRouter 6', function() {
  it('applyRepeatTarget covers additional targets', function() {
    const { router } = makeRouter({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 100 }, panRange: { min: -50, max: 50 } }
    });
    const baseSpec = { note: 60, velocity: 64, durationTicks: 4, timbre: 10, pan: 5, pitchBend: 0.2, releaseVelocity: 30 };
    const baseNotes = [60, 64];

    const duration = router._applyRepeatTarget(baseSpec, baseNotes, { amount: 1, target: 'duration' }, 1);
    expect(duration.spec.durationTicks).to.be.greaterThan(4);
    const note = router._applyRepeatTarget(baseSpec, baseNotes, { amount: 1, target: 'note' }, 1);
    expect(note.activeNotes[0]).to.not.equal(60);
    const timbre = router._applyRepeatTarget({ ...baseSpec, timbre: 10 }, baseNotes, { amount: 1, target: 'timbre' }, 1);
    expect(timbre.spec.timbre).to.be.greaterThan(10);
    const pan = router._applyRepeatTarget({ ...baseSpec, pan: 5 }, baseNotes, { amount: 1, target: 'pan' }, 1);
    expect(pan.spec.pan).to.be.a('number');
    const bend = router._applyRepeatTarget({ ...baseSpec, pitchBend: 0.5 }, baseNotes, { amount: 1, target: 'pitchBend' }, 1);
    expect(bend.spec.pitchBend).to.be.a('number');
    const attack = router._applyRepeatTarget(baseSpec, baseNotes, { amount: 1, target: 'attack' }, 1);
    expect(attack.spec.velocity).to.be.greaterThan(64);
    const sustain = router._applyRepeatTarget(baseSpec, baseNotes, { amount: 1, target: 'sustain' }, 1);
    expect(sustain.spec.durationTicks).to.be.greaterThan(4);
    const release = router._applyRepeatTarget(baseSpec, baseNotes, { amount: 1, target: 'release' }, 1);
    expect(release.spec.releaseVelocity).to.be.greaterThan(0);

    const ignored = router._applyRepeatTarget({ ...baseSpec, timbre: null }, baseNotes, { amount: 1, target: 'timbre' }, 1);
    expect(ignored.spec.timbre).to.equal(null);
    const unchanged = router._applyRepeatTarget(baseSpec, baseNotes, { amount: 0, target: 'velocity' }, 1);
    expect(unchanged.spec).to.equal(baseSpec);
  });



  it('shouldSend rejects when count exceeds the hard max', function() {
    const snapshot = makeRateSnapshot({ count: 6, bytes: 0 }, {}, 1000);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 6, maxBytesPerSecond: 1000 } },
      snapshot
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 }, off: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('shouldSend handles priority saturation', function() {
    const bySfx = new Map([[2, { count: 5, bytes: 10, priority: 2 }]]);
    const snapshot = makeRateSnapshot({ count: 5, bytes: 10, bySfx }, {}, 100);
    const usageShare = [{ sfxId: 2, count: 5, bytes: 10, priority: 2, percentCount: 1, percentBytes: 1 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('shouldSend rejects when available bytes are exhausted', function() {
    const bySfx = new Map([[2, { count: 1, bytes: 10, priority: 2 }]]);
    const snapshot = makeRateSnapshot({ count: 1, bytes: 10, bySfx }, {}, 10);
    const usageShare = [{ sfxId: 2, count: 1, bytes: 10, priority: 2, percentCount: 1, percentBytes: 1 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 10 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('shouldSend rejects when spacing is violated', function() {
    const bySfx = new Map([[1, { count: 1, bytes: 3, priority: 1 }]]);
    const snapshot = makeRateSnapshot({ count: 1, bytes: 3, bySfx }, {}, 1000);
    const usageShare = [{ sfxId: 1, count: 1, bytes: 3, priority: 1, percentCount: 1, percentBytes: 0 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 1, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 1000 } },
      snapshot,
      usageShare
    );
    router._lastAcceptedBySfx.set(1, 1000);
    const plan = makePlan({ timeMs: 1000, on: { count: 1, bytes: 3 }, off: { timeMs: 1000 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 1000 }, plan, 1000);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('spacing');
  });

  it('shouldSend rejects when share budgets are exceeded', function() {
    const bySfx = new Map([[1, { count: 2, bytes: 6, priority: 1 }]]);
    const snapshot = makeRateSnapshot({ count: 2, bytes: 6, bySfx }, {}, 100);
    const usageShare = [{ sfxId: 1, count: 2, bytes: 6, priority: 1, percentCount: 1, percentBytes: 0 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('share-throttle');
  });

  it('covers setup helpers and schedule resets', function() {
    const { router, mapping } = makeRouter({ timing: { bpmBase: 100 } });
    expect(router.mapping).to.equal(mapping);

    const routerAlt = new MidiEventRouter({ timing: { bpmBase: 90 } });
    expect(routerAlt.mapping).to.be.instanceof(MidiMapping);

    let offCalls = 0;
    const busA = { onEvent: { on() {}, off() { offCalls += 1; } } };
    const busB = { onEvent: { on() {}, off() { offCalls += 1; } } };
    router.attach(busA);
    router.attach(busB);
    router.detach();
    expect(offCalls).to.be.greaterThan(0);

    router.context = { game: { getGameTimer() { return { frameTime: 33, speedFactor: 1.5 }; } } };
    expect(router._tickMsFromEvent({ tps: 50 })).to.equal(20);
    expect(router._tickMsFromEvent({ frameMs: 40 })).to.equal(40);
    expect(router._tickMsFromEvent({})).to.equal(33);

    router.mapping.config.density = { windowTicks: 4 };
    router._lastTickBySfx.set(1, 10);
    expect(router._densityForEvent({ sfxId: 1, tick: 10 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 14 })).to.equal(0);
    expect(router._densityForEvent({ sfxId: 1, tick: 12 })).to.be.greaterThan(0);

    router.scheduler = {
      allNotesOff() { this.called = true; },
      clearQueue() { this.cleared = true; }
    };
    router._clockFrameMs = 60;
    router._clockSpeedFactor = 1;
    const base = router._resolveScheduleBase(100, 30, 0.5);
    expect(base).to.be.a('number');
    expect(router._resolveScheduleBase(NaN, 30, 0.5)).to.equal(null);
  });

  it('covers priority, bpm, and arp keys', function() {
    const { router } = makeRouter({ limits: { prioritySfx: [2] }, timing: { bpmBase: 120 } });
    router.context = { game: { getGameTimer() { return { speedFactor: 2 }; } } };
    expect(router._getEventPriority({ sfxId: 2 }, {})).to.equal(2);
    expect(router._getEventPriority({ sfxId: 3 }, { priority: 5 })).to.equal(5);
    expect(router._getEventPriority({ sfxId: 3 }, {})).to.equal(1);
    expect(router._getBpm()).to.equal(240);

    const sfx = { arp: { independent: true } };
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, objectId: 9 }, sfx)).to.include('object:9');
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, lemmingId: 3 }, sfx)).to.include('lemming:3');
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, x: 1, y: 2 }, sfx)).to.include('trigger:1:2');
    expect(router._resolveArpKey({ sfxId: 2 }, {})).to.include('sfx:2');
  });

  it('covers repeat factors and targets', function() {
    const { router } = makeRouter({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 127 }, panRange: { min: -127, max: 127 } }
    });
    const repeatCfg = { maxRepeats: 2, windowBeats: 1 };
    expect(router._getRepeatFactor('a', NaN, repeatCfg, 120)).to.equal(0);
    router._getRepeatFactor('a', 0, repeatCfg, 120);
    const factor = router._getRepeatFactor('a', 100, repeatCfg, 120);
    expect(factor).to.be.greaterThan(0);

    const spec = { note: 60, velocity: 64, durationTicks: 4, timbre: 10, pan: 0, pitchBend: 0.1, releaseVelocity: 50 };
    const notes = [60, 64];
    expect(router._applyRepeatTarget(spec, notes, { target: 'velocity' }, 0).spec).to.equal(spec);
    expect(router._applyRepeatTarget(spec, notes, { target: 'velocity' }, 0.5).spec).to.equal(spec);
    expect(router._applyRepeatTarget(spec, notes, { amount: 0, target: 'velocity' }, 1).spec).to.equal(spec);

    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'velocity' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'duration' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'note' }, 0.5);
    router._applyRepeatTarget({ ...spec, timbre: NaN }, notes, { amount: 1, target: 'timbre' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'timbre' }, 0.5);
    router._applyRepeatTarget({ ...spec, pan: NaN }, notes, { amount: 1, target: 'pan' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'pan' }, 0.5);
    router._applyRepeatTarget({ ...spec, pitchBend: NaN }, notes, { amount: 1, target: 'pitchBend' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'pitchBend' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'attack' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'decay' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'sustain' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'release' }, 0.5);
    router._applyRepeatTarget(spec, notes, { amount: 1, target: 'unknown' }, 0.5);
  });

  it('plans entries and handles shouldSend under limits', function() {
    const snapshot = makeRateSnapshot();
    const scheduler = {
      ...makeRateScheduler(snapshot),
      tickMs: 50,
      estimateMessages() { return { messages: 2, bytes: 6 }; }
    };
    const { router } = makeRouter(
      { limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 1000 } },
      { scheduler }
    );
    const plan = router._planEntries({ durationTicks: NaN }, -2000, 1);
    expect(plan.off.count).to.equal(0);
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: -2000 }, plan, 0);
    expect(ok).to.equal(true);
  });


});
