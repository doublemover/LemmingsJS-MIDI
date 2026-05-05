import { expect } from 'chai';
import { withGlobalLemmings } from '../helpers/lemmings.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { toMidiFlagTriggerType } from '../../js/midi/MidiFlagTriggers.js';

const defaultSpec = () => ({ note: 60, velocity: 64, durationTicks: 1 });

const sumPlanEntries = (plan, now = 0, windowMs = 1000) => {
  const entries = Array.isArray(plan?.entries)
    ? plan.entries
    : [plan?.on, plan?.off].filter(Boolean);
  let count = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry?.timeMs)) continue;
    if (entry.timeMs < now - windowMs || entry.timeMs >= now + windowMs) continue;
    const entryCount = Math.max(0, Math.trunc(entry.count || 0));
    const entryBytes = Math.max(0, Math.trunc(entry.bytes || entryCount * 3));
    count += entryCount;
    bytes += entryBytes;
  }
  return { count, bytes };
};

const planBudgetFromSnapshot = (snapshot, plan, now = 0) => {
  const proposed = sumPlanEntries(plan, now);
  return {
    snapshot,
    proposed,
    combined: {
      count: (snapshot?.past?.count || 0) + (snapshot?.next?.count || 0) + proposed.count,
      bytes: (snapshot?.past?.bytes || 0) + (snapshot?.next?.bytes || 0) + proposed.bytes
    }
  };
};

const canScheduleFromSnapshot = (snapshot, plan, now = 0, options = {}) => {
  const maxMessagesPerSecond = Math.max(1, options.maxMessagesPerSecond ?? snapshot?.maxMessagesPerSecond ?? 1000);
  const maxBytesPerSecond = Math.max(1, options.maxBytesPerSecond ?? snapshot?.maxBytesPerSecond ?? 3906);
  const budget = planBudgetFromSnapshot(snapshot, plan, now);
  const overMessages = budget.combined.count > maxMessagesPerSecond;
  const overBytes = budget.combined.bytes > maxBytesPerSecond;
  return {
    ok: !overMessages && !overBytes,
    reason: overBytes ? 'byte-limit' : (overMessages ? 'count-limit' : null),
    maxMessagesPerSecond,
    maxBytesPerSecond,
    ...budget
  };
};

const makeSchedulerStub = (sent) => {
  const planned = [];
  const sumWindow = (entries, start, end) => {
    let count = 0;
    let bytes = 0;
    const bySfx = new Map();
    for (const entry of entries) {
      if (entry.timeMs < start || entry.timeMs >= end) continue;
      count += entry.count;
      bytes += entry.bytes;
      const curr = bySfx.get(entry.sfxId) || { count: 0, bytes: 0, priority: entry.priority ?? 1 };
      curr.count += entry.count;
      curr.bytes += entry.bytes;
      bySfx.set(entry.sfxId, curr);
    }
    return { count, bytes, bySfx };
  };
  return {
    output: {},
    tickMs: 60,
    config: {},
    setTickMs(ms) { this.tickMs = ms; },
    estimateMessages(spec) {
      if (!spec || !Number.isFinite(spec.note)) return { messages: 0, bytes: 0 };
      const mpeEnabled = !!this.config?.mpe?.enabled;
      let messages = 1;
      if (mpeEnabled) {
        messages += 1;
      } else if (spec.pitchBend != null && Number.isFinite(spec.pitchBend) && spec.pitchBend !== 0) {
        messages += 1;
      }
      if (spec.timbre != null && Number.isFinite(spec.timbre)) messages += 1;
      if (spec.pan != null && Number.isFinite(spec.pan)) messages += 1;
      if (spec.durationTicks && spec.durationTicks > 0) {
        messages += 1;
        if (mpeEnabled) messages += 1;
      }
      return { messages, bytes: 3 * messages };
    },
    getRateSnapshot(now = 0) {
      return {
        now,
        past: sumWindow(planned, now - 1000, now),
        next: sumWindow(planned, now, now + 1000),
        maxMessagesPerSecond: 1000,
        maxBytesPerSecond: 3906
      };
    },
    getPlanBudget(plan, now = 0) {
      return planBudgetFromSnapshot(this.getRateSnapshot(now), plan, now);
    },
    canSchedule(plan, now = 0, options = {}) {
      return canScheduleFromSnapshot(this.getRateSnapshot(now), plan, now, options);
    },
    reserve(plan, meta = {}, now = 0, options = {}) {
      const check = this.canSchedule(plan, now, options);
      if (!check.ok) return check;
      const reservationId = planned.length + 1;
      const entries = Array.isArray(plan?.entries)
        ? plan.entries
        : [
          plan?.on ? { ...plan.on, phase: 'on' } : null,
          plan?.off ? { ...plan.off, phase: 'off' } : null
        ].filter(Boolean);
      for (const entry of entries) {
        planned.push({
          timeMs: entry.timeMs,
          count: Math.max(0, Math.trunc(entry.count || 0)),
          bytes: Math.max(0, Math.trunc(entry.bytes || 0)),
          sfxId: meta.sfxId,
          priority: meta.priority,
          reservationId,
          phase: entry.phase ?? null
        });
      }
      return { ...check, ok: true, reservationId };
    },
    getUsageShare(window = 'past', now = 0) {
      const data = window === 'next'
        ? sumWindow(planned, now, now + 1000)
        : sumWindow(planned, now - 1000, now);
      const total = data.count || 0;
      const totalBytes = data.bytes || 0;
      const shares = [];
      for (const [sfxId, entry] of data.bySfx.entries()) {
        shares.push({
          sfxId,
          count: entry.count,
          bytes: entry.bytes,
          priority: entry.priority ?? 1,
          percentCount: total ? entry.count / total : 0,
          percentBytes: totalBytes ? entry.bytes / totalBytes : 0
        });
      }
      shares.sort((a, b) => b.count - a.count);
      return shares;
    },
    sendNote(spec, meta = {}) {
      sent.push(spec);
      if (meta.rateReserved === true) return;
      const timeMs = spec.timeMs ?? 0;
      const durationMs = (spec.durationTicks ?? 0) * this.tickMs;
      planned.push({ timeMs, count: 1, bytes: 3, sfxId: meta.sfxId, priority: meta.priority });
      if (durationMs > 0) {
        planned.push({ timeMs: timeMs + durationMs, count: 1, bytes: 3, sfxId: meta.sfxId, priority: meta.priority });
      }
    },
    setConfig(config) { this.config = config || {}; },
    setOutput() {},
    dispose() {}
  };
};

const makeRateSnapshot = (next = {}, past = {}, maxBytesPerSecond = 1000) => ({
  next: { count: 0, bytes: 0, bySfx: new Map(), ...next },
  past: { count: 0, bytes: 0, bySfx: new Map(), ...past },
  maxBytesPerSecond
});

const makeRateScheduler = (snapshot, usageShare = []) => ({
  getRateSnapshot(now = 0) {
    return typeof snapshot === 'function' ? snapshot(now) : snapshot;
  },
  getPlanBudget(plan, now = 0) {
    return planBudgetFromSnapshot(this.getRateSnapshot(now), plan, now);
  },
  canSchedule(plan, now = 0, options = {}) {
    return canScheduleFromSnapshot(this.getRateSnapshot(now), plan, now, options);
  },
  reserve(plan, meta = {}, now = 0, options = {}) {
    const check = this.canSchedule(plan, now, options);
    return check.ok ? { ...check, reservationId: 1 } : check;
  },
  getUsageShare() { return usageShare; }
});

const makeRateRouter = (config, snapshot, usageShare = []) => (
  makeRouter(config, { scheduler: makeRateScheduler(snapshot, usageShare) })
);

const makePlan = ({ timeMs = 0, on = {}, off = {} } = {}) => ({
  on: { timeMs, count: 0, bytes: 0, ...on },
  off: { timeMs, count: 0, bytes: 0, ...off }
});

const makeRouter = (config = {}, options = {}) => {
  const sent = options.sent ?? [];
  const mapping = config instanceof MidiMapping ? config : new MidiMapping(config);
  const router = new MidiEventRouter(mapping);
  router.scheduler = options.scheduler ?? makeSchedulerStub(sent);
  router.scheduler.setConfig?.(mapping.config);
  if (options.output === false) router.scheduler.output = null;
  if (options.mapEvent) {
    router.mapping.mapEvent = options.mapEvent;
  } else if (options.defaultMapEvent) {
    router.mapping.mapEvent = () => defaultSpec();
  }
  return { router, sent, mapping };
};

const makeArpRouter = (arp, overrides = {}, notes = [60, 64, 67]) => (
  makeRouter({ limits: { maxEventsPerSecond: 1000 }, ...overrides }, {
    mapEvent: () => ({
      notes,
      note: notes[0],
      velocity: 64,
      durationTicks: 1,
      arp
    })
  })
);

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

  it('planEntries accounts for duration and MPE off messages', function() {
    const { router } = makeRouter({ mpe: { enabled: true } });
    router.scheduler.tickMs = 10;
    const plan = router._planEntries({ note: 60, durationTicks: 2 }, 1000, 2);
    expect(plan.off.count).to.equal(4);
    const zero = router._planEntries({ note: 60, durationTicks: NaN }, 1000, 1);
    expect(zero.off.count).to.equal(0);
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

  it('shouldSend rejects when hard max is exceeded', function() {
    const bySfx = new Map();
    const snapshot = makeRateSnapshot({ count: 2, bytes: 0, bySfx }, {}, 1000);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 1, hardMaxEventsPerSecond: 1, maxBytesPerSecond: 1000 } },
      snapshot
    );
    const plan = makePlan();
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });
});
