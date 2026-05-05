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

describe('MidiEventRouter 5', function() {
  it('returns repeat targets unchanged for missing numeric fields', function() {
    const { router } = makeRouter();
    const base = { note: 60, velocity: 64, durationTicks: 1 };
    const none = router._applyRepeatTarget(base, [60], { amount: 1, target: 'timbre' }, 1);
    expect(none.spec.timbre).to.equal(undefined);
    const pan = router._applyRepeatTarget(base, [60], { amount: 1, target: 'pan' }, 1);
    expect(pan.spec.pan).to.equal(undefined);
    const bend = router._applyRepeatTarget(base, [60], { amount: 1, target: 'pitchBend' }, 1);
    expect(bend.spec.pitchBend).to.equal(undefined);
  });

  it('drops events when available bytes are exhausted', function() {
    const bySfx = new Map([[2, { count: 1, bytes: 100, priority: 2 }]]);
    const snapshot = makeRateSnapshot({ count: 6, bytes: 100, bySfx }, { count: 0, bytes: 0 }, 100);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } },
      snapshot
    );
    const plan = makePlan();
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('handles share reports without current entries', function() {
    const bySfx = new Map([[2, { count: 5, bytes: 0, priority: 1 }]]);
    const snapshot = makeRateSnapshot({ count: 6, bytes: 0, bySfx }, { count: 0, bytes: 0 }, 100);
    const usageShare = [{ sfxId: 2, count: 5, bytes: 0, priority: 1, percentCount: 1, percentBytes: 0 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 }, off: { timeMs: 2000 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(true);
  });

  it('sends notes when ticks are missing and notes are empty', function() {
    const { router, sent } = makeRouter(
      { limits: { maxEventsPerSecond: 1000 } },
      { mapEvent: () => ({ note: 60, notes: [], velocity: 64, durationTicks: 0 }) }
    );
    router._nowMs = () => 10;
  
    router._onEvent({ sfxId: 1, timeMs: NaN });
    expect(sent.length).to.equal(1);
  });

  it('constructs mapping from plain config objects', function() {
    const router = new MidiEventRouter({ enabled: false });
    expect(router.mapping).to.be.instanceOf(MidiMapping);
    const routerWithMapping = new MidiEventRouter(new MidiMapping());
    expect(routerWithMapping.mapping).to.be.instanceOf(MidiMapping);
  });

  it('attach removes existing listeners when re-attaching', function() {
    let offCalls = 0;
    const busA = { onEvent: { on() {}, off() { offCalls += 1; } } };
    const busB = { onEvent: { on() {}, off() {} } };
    const { router } = makeRouter();
    router.attach(busA);
    router.attach(busB);
    expect(offCalls).to.equal(1);
  });

  it('tickMsFromEvent falls back to defaults without timers', function() {
    const { router } = makeRouter();
    router.context = {};
    expect(router._tickMsFromEvent({})).to.equal(60);
  });

  it('tickMsFromEvent ignores invalid timing payloads', function() {
    const { router } = makeRouter();
    router.context = { game: { getGameTimer() { return { frameTime: 33 }; } } };
    expect(router._tickMsFromEvent({ tps: 0, frameMs: -10 })).to.equal(33);
    router.context = { game: { getGameTimer() { return { frameTime: 0 }; } } };
    expect(router._tickMsFromEvent({ tps: -20, frameMs: Number.NaN })).to.equal(60);
  });

  it('nowMs uses performance when available', function() {
    const { router } = makeRouter();
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => 456 };
    try {
      expect(router._nowMs()).to.equal(456);
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('resets schedule base when speed changes without frame changes', function() {
    let cleared = 0;
    const { router } = makeRouter({}, {
      scheduler: {
        allNotesOff() { cleared += 1; },
        clearQueue() { cleared += 1; }
      }
    });
    router._nowMs = () => 1000;
    router._resolveScheduleBase(100, 60, 1);
    router._resolveScheduleBase(120, 60, 2);
    expect(cleared).to.equal(2);
    router._resolveScheduleBase(140, NaN, NaN);
  });

  it('getBpm returns scaled values above the minimum', function() {
    const { router } = makeRouter({ timing: { bpmBase: 120 } });
    router.context = { game: { getGameTimer() { return { speedFactor: 2 }; } } };
    expect(router._getBpm()).to.equal(240);
  });

  it('resolveArpKey falls back when independence is disabled', function() {
    const { router } = makeRouter();
    expect(router._resolveArpKey({ triggerType: 3, sfxId: 2 }, { arp: { independent: false } }))
      .to.equal('sfx:2');
  });

  it('getRepeatFactor returns zero for invalid repeat windows', function() {
    const { router } = makeRouter();
    expect(router._getRepeatFactor('sfx:1', 10, { maxRepeats: 0, windowBeats: 1 }, 120)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', NaN, { maxRepeats: 2, windowBeats: 1 }, 120)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', 10, { maxRepeats: 2, windowBeats: 1 }, 0)).to.equal(0);
  });

  it('applyRepeatTarget handles accent targets and zero factors', function() {
    const { router } = makeRouter();
    const baseSpec = { note: 60, velocity: 64, durationTicks: 2, releaseVelocity: 64 };
    const unchanged = router._applyRepeatTarget(baseSpec, [60], { amount: 1, target: 'velocity' }, 0);
    expect(unchanged.spec.velocity).to.equal(64);
    const accent = router._applyRepeatTarget(baseSpec, [60], { amount: 0.5, target: 'accent' }, 1);
    expect(accent.spec.velocity).to.be.greaterThan(64);
  });

  it('planEntries uses default off messages without MPE', function() {
    const { router } = makeRouter({ mpe: { enabled: false } });
    router.scheduler.tickMs = 10;
    const plan = router._planEntries({ note: 60, durationTicks: 1 }, 1000, 1);
    expect(plan.off.count).to.equal(1);
  });

  it('shouldSend ignores plans outside the next window', function() {
    const snapshot = makeRateSnapshot();
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 10, maxBytesPerSecond: 1000 } },
      snapshot
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 }, off: { timeMs: 5000, count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 1000);
    expect(ok).to.equal(true);
  });

  it('shouldSend accounts for higher and same priority entries', function() {
    const bySfx = new Map([
      [1, { count: 2, bytes: 6, priority: 1 }],
      [2, { count: 2, bytes: 6, priority: 2 }]
    ]);
    const snapshot = makeRateSnapshot({ count: 4, bytes: 12, bySfx }, {}, 1000);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 10, maxBytesPerSecond: 1000 } },
      snapshot
    );
    const plan = makePlan({ timeMs: 1000, on: { count: 1, bytes: 3 }, off: { timeMs: 1000 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 1000 }, plan, 1000);
    expect(ok).to.equal(true);
  });

  it('tickMsFromEvent uses frameMs and timer fallbacks', function() {
    const { router } = makeRouter();
    expect(router._tickMsFromEvent({ frameMs: 33 })).to.equal(33);
    router.context = { game: { getGameTimer() { return { frameTime: 42 }; } } };
    expect(router._tickMsFromEvent({})).to.equal(42);
  });

  it('density handles zero and window limits', function() {
    const { router } = makeRouter({ density: { windowTicks: 4 } });
    router._lastTickBySfx.set(1, 10);
    expect(router._densityForEvent({ sfxId: 1, tick: 10 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 12 })).to.be.closeTo(0.5, 0.01);
    expect(router._densityForEvent({ sfxId: 1, tick: 20 })).to.equal(0);
    expect(router._densityForEvent({ sfxId: 2, tick: 1 })).to.equal(0);
  });

  it('resolveScheduleBase resets on frame or speed changes', function() {
    const { router } = makeRouter();
    router.scheduler = {};
    router._nowMs = () => 1000;
    expect(router._resolveScheduleBase(NaN, 0, 0)).to.equal(null);
    router._resolveScheduleBase(100, 60, 1);
  
    router.scheduler = { allNotesOff() { this.off = true; }, clearQueue() { this.clear = true; } };
    router._resolveScheduleBase(110, 120, 1);
    expect(router.scheduler.off).to.equal(true);
    router._resolveScheduleBase(120, 120, 2);
    expect(router.scheduler.clear).to.equal(true);
    router._resolveScheduleBase(140, NaN, NaN);
  });

  it('getEventPriority uses sfx priority and priority lists', function() {
    const { router } = makeRouter({ limits: { prioritySfx: [5] } });
    expect(router._getEventPriority({ sfxId: 1 }, { priority: 3 })).to.equal(3);
    expect(router._getEventPriority({ sfxId: 5 }, {})).to.equal(2);
  });

  it('resolveArpKey builds independent trigger keys', function() {
    const { router } = makeRouter();
    const sfx = { arp: { independent: true } };
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, objectId: 3 }, sfx))
      .to.equal('trigger:1:2:object:3');
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, lemmingId: 4 }, sfx))
      .to.equal('trigger:1:2:lemming:4');
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, x: 3, y: 4 }, sfx))
      .to.equal('trigger:1:2:3:4');
  });

  it('getRepeatFactor uses spacingTicks and history', function() {
    const { router } = makeRouter();
    const repeatCfg = { maxRepeats: 2, spacingTicks: 1 };
    const bpm = 120;
    const first = router._getRepeatFactor('sfx:1', 0, repeatCfg, bpm);
    const second = router._getRepeatFactor('sfx:1', 100, repeatCfg, bpm);
    expect(first).to.equal(0);
    expect(second).to.be.greaterThan(0);
  });
});
