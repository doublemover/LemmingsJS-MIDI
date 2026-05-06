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
