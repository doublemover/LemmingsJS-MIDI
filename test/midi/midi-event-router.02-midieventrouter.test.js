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

describe('MidiEventRouter 2', function() {
  it('bounds repeat-history key growth for independent triggers', function() {
    const { router } = makeRouter(
      {
        repeat: { maxRepeats: 2, windowBeats: 8 },
        limits: { maxEventsPerSecond: 1000 },
        triggers: { '5': { repeat: { maxRepeats: 2, windowBeats: 8 } } }
      },
      { defaultMapEvent: true }
    );
    router._nowMs = () => 1000;
  
    for (let i = 0; i < 700; i += 1) {
      router._onEvent({ sfxId: 1, tick: i + 1, tps: 60, triggerType: 5, timeMs: i * 10 + 1 + i });
      router._onEvent({ sfxId: 1, tick: i + 1, tps: 60, triggerType: 5 + i, timeMs: i * 10 + 2 + i });
    }
  
    expect(router._repeatHistoryByKey.size).to.be.at.most(512);
  });

  it('caps repeat-history entry count per key to maxRepeats + 1', function() {
    const { router } = makeRouter();
    const cfg = { maxRepeats: 2, windowBeats: 10 };
    for (let i = 0; i < 20; i += 1) {
      router._getRepeatFactor('sfx:42', i * 10, cfg, 120);
    }
    expect(router._repeatHistoryByKey.get('sfx:42')).to.have.length(3);
  });

  it('reverses direction for updown arps at bounds', function() {
    const { router, sent } = makeArpRouter({ enabled: true, mode: 'updown', length: 3 });
  
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 4, tps: 50 });
  
    expect(sent.map(entry => entry.note)).to.eql([60, 64, 67, 64]);
  });

  it('applies custom arp step patterns when preset is custom', function() {
    const { router, sent } = makeArpRouter({
      enabled: true,
      mode: 'up',
      length: 3,
      pattern: { preset: 'custom', steps: ['up', 'hold', 'down'] }
    });
  
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 4, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 5, tps: 50 });
  
    expect(sent.map(entry => entry.note)).to.eql([60, 64, 64, 60, 64]);
  });

  it('resets custom arp step state when the pattern changes', function() {
    const { router, sent } = makeArpRouter({
      enabled: true,
      mode: 'up',
      length: 3,
      pattern: { preset: 'custom', steps: ['up'] }
    });
  
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: {
        enabled: true,
        mode: 'up',
        length: 3,
        pattern: { preset: 'custom', steps: ['down'] }
      }
    });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });
  
    expect(sent.map(entry => entry.note)).to.eql([60, 64, 60]);
  });

  it('resets arpeggio state when the mode changes', function() {
    const { router, sent } = makeArpRouter({ enabled: true, mode: 'up', length: 3 });
  
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'down', length: 3 }
    });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
  
    expect(sent.length).to.equal(2);
  });

  it('resets scheduling when speed changes', function() {
    const sent = [];
    const scheduler = makeSchedulerStub(sent);
    let allOffCalls = 0;
    scheduler.allNotesOff = () => { allOffCalls += 1; };
    const { router } = makeRouter({ limits: { maxEventsPerSecond: 1000 } }, {
      scheduler,
      mapEvent: () => defaultSpec()
    });
    router._nowMs = () => 1000;
  
    router._onEvent({ sfxId: 1, tick: 1, timeMs: 0, frameMs: 60, speedFactor: 1 });
    router._onEvent({ sfxId: 1, tick: 2, timeMs: 60, frameMs: 120, speedFactor: 0.5 });
  
    expect(allOffCalls).to.equal(1);
  });

  it('scales repeat intensity within a beat window', function() {
    const { router, sent } = makeRouter({
      repeat: {
        maxRepeats: 2,
        windowBeats: 4,
        amount: null,
        velocityBoost: 0.5,
        durationBoost: 0.5
      },
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 1000 }
    }, { mapEvent: () => ({ note: 60, velocity: 40, durationTicks: 2 }) });
  
    router._nowMs = () => 1000;
    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 2 });
  
    expect(sent.length).to.equal(2);
    expect(sent[1].velocity).to.be.greaterThan(sent[0].velocity);
    expect(sent[1].durationTicks).to.be.greaterThan(sent[0].durationTicks);
  });

  it('applies repeat targets when amount is configured', function() {
    const { router, sent } = makeRouter({
      repeat: {
        maxRepeats: 4,
        windowBeats: 1,
        amount: 1,
        target: 'note'
      },
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 1000 }
    }, { mapEvent: () => ({ note: 60, velocity: 40, durationTicks: 1 }) });
  
    let now = 0;
    router._nowMs = () => now;
    router._onEvent({ sfxId: 1, tick: 1 });
    now = 100;
    router._onEvent({ sfxId: 1, tick: 2 });
  
    expect(sent.length).to.equal(2);
    expect(sent[1].note).to.be.greaterThan(sent[0].note);
  });

  it('drops events when byte limits are exceeded', function() {
    const sent = [];
    const baseSnapshot = makeRateSnapshot({ count: 1, bytes: 3 }, { count: 0, bytes: 0 }, 3);
    const usageShare = [{ sfxId: 99, count: 1, bytes: 3, priority: 1, percentCount: 1, percentBytes: 1 }];
    const scheduler = {
      ...makeRateScheduler((now = 0) => ({ ...baseSnapshot, now }), usageShare),
      output: {},
      tickMs: 60,
      setTickMs() {},
      estimateMessages() { return { messages: 1, bytes: 3 }; },
      sendNote() { sent.push(true); }
    };
    const { router } = makeRouter(
      { limits: { maxEventsPerSecond: 1000, maxBytesPerSecond: 3 } },
      {
        scheduler,
        mapEvent: () => ({ note: 60, velocity: 64, durationTicks: 1 })
      }
    );
  
    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
  
    expect(sent.length).to.equal(0);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('attaches and detaches from sound buses', function() {
    const { router } = makeRouter();
    const busA = { onEvent: new EventHandler() };
    const busB = { onEvent: new EventHandler() };
    router.attach(busA);
    expect(busA.onEvent.handlers.size).to.equal(1);
    router.attach(busB);
    expect(busA.onEvent.handlers.size).to.equal(0);
    expect(busB.onEvent.handlers.size).to.equal(1);
    router.detach();
    expect(busB.onEvent.handlers.size).to.equal(0);
  });

  it('accepts plain mapping configs and resets context defaults', function() {
    let configured = null;
    const { router } = makeRouter({}, {
      scheduler: { setConfig(cfg) { configured = cfg; } }
    });
    router.setMapping({ timing: { bpmBase: 90 } });
    expect(router.mapping).to.be.instanceOf(MidiMapping);
    expect(configured).to.equal(router.mapping.config);
  
    const bus = { onEvent: new EventHandler() };
    router.attach(bus, null);
    expect(router.context).to.eql({});
    router.detach();
  });

  it('keeps MidiMapping instances when setting mapping', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 100 } });
    const { router } = makeRouter();
    router.setMapping(mapping);
    expect(router.mapping).to.equal(mapping);
  });
});
