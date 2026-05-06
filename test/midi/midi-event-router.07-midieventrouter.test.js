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

describe('MidiEventRouter 7', function() {
  it('shouldSend accounts for higher-priority traffic', function() {
    const bySfx = new Map([
      [2, { count: 2, bytes: 6, priority: 2 }]
    ]);
    const snapshot = makeRateSnapshot({ count: 2, bytes: 6, bySfx }, {}, 100);
    const usageShare = [{ sfxId: 2, count: 2, bytes: 6, priority: 2, percentCount: 1, percentBytes: 1 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('onEvent applies repeat amount and boost settings', function() {
    const { router } = makeRouter({
      enabled: true,
      timing: { bpmBase: 120 },
      repeat: { amount: 0.5, target: 'velocity', maxRepeats: 2, windowBeats: 1 },
      sfx: { '1': { note: 60 } }
    });
    const output = { channels: { 1: { sendNoteOn() {}, sendNoteOff() {}, sendPitchBend() {}, sendControlChange() {}, sendAllNotesOff() {}, sendPitchBendRange() {} } } };
    router.scheduler.setOutput(output);
    router._shouldSend = () => true;
    router.scheduler.sendNote = () => {};

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, timeMs: 0 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50, timeMs: 20 });

    const { router: boostRouter } = makeRouter({
      enabled: true,
      timing: { bpmBase: 120 },
      repeat: { velocityBoost: 0.2, durationBoost: 0.1, maxRepeats: 2, windowBeats: 1 },
      sfx: { '1': { note: 60 } }
    });
    boostRouter.scheduler.setOutput(output);
    boostRouter._shouldSend = () => true;
    boostRouter.scheduler.sendNote = () => {};
    boostRouter._onEvent({ sfxId: 1, tick: 1, tps: 50, timeMs: 0 });
  });

  it('onEvent fills defaults when repeat boosts are missing', function() {
    const { router, sent } = makeRouter({
      enabled: true,
      limits: null,
      timing: null,
      repeat: null,
      triggers: null,
      sfx: { '1': { note: 60, repeat: { maxRepeats: 2, windowBeats: 1 } } }
    }, { mapEvent: () => ({ note: 60 }) });
    router.context = { level: { width: 200, height: 100 } };
    router._nowMs = () => 0;

    router._onEvent({ sfxId: 1, tick: 1, triggerType: 5, timeMs: 0, tps: 50 });

    expect(sent.length).to.equal(1);
    expect(sent[0].velocity).to.equal(64);
    expect(sent[0].durationTicks).to.equal(1);
  });

  it('covers attach cleanup and tick defaults', function() {
    const { router: routerA, mapping } = makeRouter({ timing: { bpmBase: 10 } });
    const routerB = new MidiEventRouter({ timing: { bpmBase: 120 } });
    expect(routerA.mapping).to.equal(mapping);
    expect(routerB.mapping).to.be.instanceOf(MidiMapping);

    let onCalls = 0;
    let offCalls = 0;
    const onEvent = { on() { onCalls += 1; }, off() { offCalls += 1; } };
    const bus = { onEvent };
    routerA.attach(bus, {});
    routerA.attach(bus, {});
    routerA.detach();
    expect(onCalls).to.equal(2);
    expect(offCalls).to.equal(2);

    routerA.context = { game: { getGameTimer() { return { frameTime: 30, speedFactor: 1 }; } } };
    expect(routerA._tickMsFromEvent({ tps: 50 })).to.equal(20);
    expect(routerA._tickMsFromEvent({ frameMs: 40 })).to.equal(40);
    expect(routerA._tickMsFromEvent({})).to.equal(30);
    routerA.context = {};
    expect(routerA._tickMsFromEvent({})).to.equal(60);
    expect(routerA._getBpm()).to.equal(20);
  });

  it('covers density and schedule base resets', function() {
    const { router } = makeRouter({ density: { windowTicks: 4 } });
    expect(router._densityForEvent({})).to.equal(0);
    router._lastTickBySfx.set(1, 5);
    expect(router._densityForEvent({ sfxId: 1, tick: 5 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 9 })).to.equal(0);
    expect(router._densityForEvent({ sfxId: 1, tick: 7 })).to.be.closeTo(0.5, 0.01);

    const originalPerf = globalThis.performance;
    globalThis.performance = undefined;
    const now = router._nowMs();
    globalThis.performance = originalPerf;
    expect(Number.isFinite(now)).to.equal(true);

    router.scheduler = null;
    expect(router._resolveScheduleBase(NaN, 0, 0)).to.equal(null);

    router._clockFrameMs = 10;
    router._clockSpeedFactor = 1;
    router._nowMs = () => 1000;
    router._resolveScheduleBase(100, 20, 1);

    let cleared = 0;
    router.scheduler = { allNotesOff() { cleared += 1; }, clearQueue() { cleared += 1; } };
    router._resolveScheduleBase(200, 21, 2);
    expect(cleared).to.equal(2);
  });

  it('covers repeat target fallbacks and plan entries', function() {
    const { router, mapping } = makeRouter({ repeat: { maxRepeats: 2, spacingTicks: 2 } });
    const bpm = 60;
    expect(router._getRepeatFactor('sfx:1', 0, mapping.config.repeat, bpm)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', 1000, mapping.config.repeat, bpm)).to.be.greaterThan(0);

    const spec = { note: 60, velocity: 64, durationTicks: 2, pitchBend: 0.2, releaseVelocity: 64 };
    const notes = [60, 64];
    const noAmount = router._applyRepeatTarget(spec, notes, { target: 'velocity', amount: 'bad' }, 1);
    expect(noAmount.spec).to.equal(spec);
    const zeroAmount = router._applyRepeatTarget(spec, notes, { target: 'velocity', amount: 0 }, 1);
    expect(zeroAmount.spec).to.equal(spec);

    router._applyRepeatTarget(spec, notes, { target: 'accent', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'duration', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'note', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, timbre: 10 }, notes, { target: 'timbre', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, pan: 0 }, notes, { target: 'pan', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, pitchBend: 0.5 }, notes, { target: 'pitchBend', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, pitchBend: NaN }, notes, { target: 'pitchBend', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'attack', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'decay', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'sustain', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'release', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'unknown', amount: 0.5 }, 1);

    const { router: mpeRouter } = makeRouter({ mpe: { enabled: true } });
    mpeRouter.scheduler.tickMs = 10;
    const planA = mpeRouter._planEntries({ note: 60, durationTicks: NaN }, 1000, 2);
    const planB = mpeRouter._planEntries({ note: 60, durationTicks: 1 }, 1000, 1);
    expect(planA.off.count).to.equal(0);
    expect(planB.off.count).to.equal(2);
  });

  it('shouldSend enforces hard caps', function() {
    const snapshot = makeRateSnapshot({ count: 10, bytes: 0 }, {}, 100);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 11, maxBytesPerSecond: 100 } },
      snapshot
    );
    const plan = makePlan({ on: { count: 2 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('shouldSend throttles on byte budgets and priorities', function() {
    const bySfx = new Map([
      [1, { count: 1, bytes: 0, priority: 1 }],
      [2, { count: 1, bytes: 5, priority: 2 }]
    ]);
    const snapshot = makeRateSnapshot({ count: 2, bytes: 5, bySfx }, {}, 5);
    const usageShare = [
      { sfxId: 1, count: 1, bytes: 0, priority: 1, percentCount: 0.5, percentBytes: 0 },
      { sfxId: 2, count: 1, bytes: 5, priority: 2, percentCount: 0.5, percentBytes: 1 }
    ];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 5 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1 }, off: { timeMs: 500 } });
    const ok = router._shouldSend({ sfxId: 3, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('setMapping accepts MidiMapping instances', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 90 } });
    let configured = null;
    const { router } = makeRouter({}, {
      scheduler: { setConfig(cfg) { configured = cfg; } }
    });
    router.setMapping(mapping);
    expect(router.mapping).to.equal(mapping);
    expect(configured).to.equal(mapping.config);
  });

  it('returns zero density when window ticks are disabled', function() {
    const { router } = makeRouter({ density: null });
    expect(router._densityForEvent({ sfxId: 1, tick: 10 })).to.equal(0);
  });

  it('resolves arpeggio keys to unknown when sfxId is missing', function() {
    const { router } = makeRouter();
    const key = router._resolveArpKey({}, {});
    expect(key).to.equal('sfx:unknown');
  });

  it('merges trigger config into sfx overrides on events', function() {
    let captured = null;
    const { router, sent } = makeRouter({
      enabled: true,
      limits: { maxEventsPerSecond: 1000 },
      sfx: { '1': { velocity: 10 } },
      triggers: { '7': { velocity: 20 } }
    }, {
      mapEvent: (event, context, density, sfx) => {
        captured = sfx;
        return { note: 60, velocity: sfx.velocity, durationTicks: 1 };
      }
    });
    router.scheduler.output = {};

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, triggerType: 7 });

    expect(captured.velocity).to.equal(20);
    expect(sent.length).to.equal(1);
  });

  it('returns zero repeat factors when repeats are disabled or invalid', function() {
    const { router } = makeRouter();
    const repeatCfg = { maxRepeats: 0, windowBeats: 0 };
    expect(router._getRepeatFactor('sfx:1', NaN, repeatCfg, 0)).to.equal(0);
  });
});
