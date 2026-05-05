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

describe('MidiEventRouter 8', function() {
  it('applies repeat defaults when velocity and duration are missing', function() {
    const { router } = makeRouter();
    const baseSpec = { note: 60 };
  
    const velocity = router._applyRepeatTarget(
      baseSpec,
      [60],
      { amount: 0.5, target: 'velocity' },
      1
    ).spec.velocity;
    expect(velocity).to.equal(96);
  
    const duration = router._applyRepeatTarget(
      baseSpec,
      [60],
      { amount: 0.5, target: 'duration' },
      1
    ).spec.durationTicks;
    expect(duration).to.equal(2);
  
    const release = router._applyRepeatTarget(
      baseSpec,
      [60],
      { amount: 0.5, target: 'release' },
      1
    ).spec.releaseVelocity;
    expect(release).to.equal(96);
  });

  it('defaults repeat targets when ranges and velocity are missing', function() {
    const router = new MidiEventRouter(new MidiMapping({
      position: { timbreRange: null, panRange: null }
    }));
    const baseSpec = { note: 60, timbre: 10, pan: 0 };
    const notes = [60];
  
    const timbre = router._applyRepeatTarget(
      baseSpec,
      notes,
      { amount: 0.5, target: 'timbre' },
      1
    ).spec.timbre;
    expect(timbre).to.be.within(0, 127);
    expect(timbre).to.not.equal(10);
  
    const pan = router._applyRepeatTarget(
      baseSpec,
      notes,
      { amount: 0.5, target: 'pan' },
      1
    ).spec.pan;
    expect(pan).to.be.within(-127, 127);
  
    const attack = router._applyRepeatTarget(
      { note: 60 },
      notes,
      { amount: 0.5, target: 'attack' },
      1
    ).spec.velocity;
    expect(attack).to.equal(96);
  });

  it('replaces mappings when setMapping receives a plain object', function() {
    const { router } = makeRouter();
    router.setMapping({ enabled: true });
    expect(router.mapping).to.be.instanceOf(MidiMapping);
    expect(router.mapping.config.enabled).to.equal(true);
  });

  it('clamps notes to defaults when no note range is configured', function() {
    const { router } = makeRouter({ noteRange: null, position: {} });
    const adjusted = router._applyRepeatTarget(
      { note: 60 },
      [200],
      { amount: 1, target: 'note' },
      1
    );
    expect(adjusted.activeNotes[0]).to.equal(127);
  });

  it('reuses MidiMapping instances in setMapping', function() {
    const mapping = new MidiMapping({ enabled: false });
    const { router } = makeRouter();
    router.setMapping(mapping);
    expect(router.mapping).to.equal(mapping);
  });

  it('uses repeat fallbacks when window beats and max repeats are missing', function() {
    const { router } = makeRouter();
    const bpm = router._getBpm();
    const repeatCfg = { maxRepeats: 1, windowBeats: 1 };
    router._getRepeatFactor('sfx:1', 0, repeatCfg, bpm);
    const factor = router._getRepeatFactor('sfx:1', 100, repeatCfg, bpm);
    expect(factor).to.equal(1);
  
    const fallback = router._getRepeatFactor('sfx:2', 50, { spacingTicks: 2 }, bpm);
    expect(fallback).to.equal(0);
  
    const emptyWindow = router._getRepeatFactor('sfx:3', 60, { maxRepeats: 2 }, bpm);
    expect(emptyWindow).to.equal(0);
  });

  it('replaces null mappings with defaults', function() {
    const { router } = makeRouter();
    router.setMapping(null);
    expect(router.mapping).to.be.instanceOf(MidiMapping);
  });

  it('uses repeat spacing fallbacks and default targets', function() {
    const { router } = makeRouter({
      noteRange: { min: null, max: null },
      position: null
    });
    const bpm = router._getBpm();
    router._getRepeatFactor('sfx:1', 0, { maxRepeats: 2, spacingTicks: 2 }, bpm);
    const factor = router._getRepeatFactor('sfx:1', 100, { maxRepeats: 2, spacingTicks: 2 }, bpm);
    expect(factor).to.be.greaterThan(0);
  
    const baseSpec = { velocity: 50, note: 200 };
    const adjusted = router._applyRepeatTarget(baseSpec, [200], { amount: 0.5 }, 1);
    expect(adjusted.spec.velocity).to.be.greaterThan(50);
    expect(adjusted.activeNotes[0]).to.equal(200);
  
    const noteAdjusted = router._applyRepeatTarget(
      baseSpec,
      [200],
      { amount: 0.5, target: 'note' },
      1
    );
    expect(noteAdjusted.activeNotes[0]).to.equal(127);
  
    const timbreAdjusted = router._applyRepeatTarget(
      { ...baseSpec, timbre: 10 },
      [60],
      { amount: 0.5, target: 'timbre' },
      1
    );
    expect(timbreAdjusted.spec.timbre).to.be.within(0, 127);
  });
});
