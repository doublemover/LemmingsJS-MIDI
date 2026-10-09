import { withGlobalLemmings } from './lemmings.js';
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

export { withGlobalLemmings, MidiEventRouter, MidiMapping, EventHandler, toMidiFlagTriggerType, defaultSpec, sumPlanEntries, planBudgetFromSnapshot, canScheduleFromSnapshot, makeSchedulerStub, makeRateSnapshot, makeRateScheduler, makeRateRouter, makePlan, makeRouter, makeArpRouter };
