import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { EventHandler } from '../../js/util/EventHandler.js';

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
    setTickMs(ms) { this.tickMs = ms; },
    estimateMessages(spec) {
      const off = spec.durationTicks > 0 ? 1 : 0;
      return { messages: 1 + off, bytes: 3 * (1 + off) };
    },
    getRateSnapshot(now = 0) {
      return {
        now,
        past: sumWindow(planned, now - 1000, now),
        next: sumWindow(planned, now, now + 1000),
        maxBytesPerSecond: 3906
      };
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
      const timeMs = spec.timeMs ?? 0;
      const durationMs = (spec.durationTicks ?? 0) * this.tickMs;
      planned.push({ timeMs, count: 1, bytes: 3, sfxId: meta.sfxId, priority: meta.priority });
      if (durationMs > 0) {
        planned.push({ timeMs: timeMs + durationMs, count: 1, bytes: 3, sfxId: meta.sfxId, priority: meta.priority });
      }
    },
    setConfig() {},
    setOutput() {},
    dispose() {}
  };
};

describe('MidiEventRouter', function() {
  it('computes density and tick duration', function() {
    const mapping = new MidiMapping({ density: { windowTicks: 10 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);

    const densities = [];
    router.mapping.mapEvent = (event, context, density) => {
      densities.push(density);
      return { note: 60, velocity: 64, durationTicks: 1 };
    };

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
    const router = new MidiEventRouter(new MidiMapping());
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 1 });

    router._onEvent({ sfxId: 1, tick: 1, reverse: true });

    expect(sent[0].reverse).to.equal(true);
  });

  it('enforces per-tick and per-second limits', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerTick: 1, maxEventsPerSecond: 2 }
    });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 1 });

    let now = 0;
    router._nowMs = () => now;

    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 1 });
    expect(sent.length).to.equal(1);

    router._onEvent({ sfxId: 1, tick: 2 });
    expect(sent.length).to.equal(1);

    now = 1000;
    router._onEvent({ sfxId: 1, tick: 3 });
    expect(sent.length).to.equal(2);
  });

  it('rejects events when higher-priority bytes saturate the window', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 9 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[2, { count: 0, bytes: 9, priority: 2 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 11, bytes: 9, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 9
        };
      },
      getUsageShare() { return []; }
    };
    const plan = {
      on: { timeMs: 0, count: 0, bytes: 0 },
      off: { timeMs: 0, count: 0, bytes: 0 }
    };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('allows events when spacing and budgets are available', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 10, bytes: 100, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = {
      on: { timeMs: 0, count: 1, bytes: 3 },
      off: { timeMs: 0, count: 0, bytes: 0 }
    };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(true);
  });

  it('exposes the scheduler rate snapshot', function() {
    const mapping = new MidiMapping();
    const router = new MidiEventRouter(mapping);
    const snapshot = { next: { count: 0, bytes: 0, bySfx: new Map() } };
    router.scheduler = { getRateSnapshot: () => snapshot };
    expect(router.getRateSnapshot()).to.equal(snapshot);
  });

  it('steps through arpeggio notes across events', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'up', length: 3 }
    });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(sent[0].note).to.equal(60);
    expect(sent[1].note).to.equal(64);
  });

  it('handles single-note arps without advancing', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({
      notes: [60],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'up', length: 1 }
    });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });

    expect(sent.length).to.equal(2);
    expect(sent[0].note).to.equal(60);
    expect(sent[1].note).to.equal(60);
  });

  it('handles downward arps with independent trigger keys', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 1000 },
      triggers: { '5': { arp: { independent: true } } }
    });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'down', length: 3 }
    });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, triggerType: 5, objectId: 100 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50, triggerType: 5, objectId: 100 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50, triggerType: 5, objectId: 200 });

    expect(sent[0].note).to.equal(67);
    expect(sent[1].note).to.equal(64);
    expect(sent[2].note).to.equal(67);
  });

  it('reverses direction for updown arps at bounds', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'updown', length: 3 }
    });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 3, tps: 50 });
    router._onEvent({ sfxId: 1, tick: 4, tps: 50 });

    expect(sent.map(entry => entry.note)).to.eql([60, 64, 67, 64]);
  });

  it('resets arpeggio state when the mode changes', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({
      notes: [60, 64, 67],
      note: 60,
      velocity: 64,
      durationTicks: 1,
      arp: { enabled: true, mode: 'up', length: 3 }
    });

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
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    const scheduler = makeSchedulerStub(sent);
    let allOffCalls = 0;
    scheduler.allNotesOff = () => { allOffCalls += 1; };
    router.scheduler = scheduler;
    router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 1 });
    router._nowMs = () => 1000;

    router._onEvent({ sfxId: 1, tick: 1, timeMs: 0, frameMs: 60, speedFactor: 1 });
    router._onEvent({ sfxId: 1, tick: 2, timeMs: 60, frameMs: 120, speedFactor: 0.5 });

    expect(allOffCalls).to.equal(1);
  });

  it('scales repeat intensity within a beat window', function() {
    const mapping = new MidiMapping({
      repeat: {
        maxRepeats: 2,
        windowBeats: 4,
        amount: null,
        velocityBoost: 0.5,
        durationBoost: 0.5
      },
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({ note: 60, velocity: 40, durationTicks: 2 });

    router._nowMs = () => 1000;
    router._onEvent({ sfxId: 1, tick: 1 });
    router._onEvent({ sfxId: 1, tick: 2 });

    expect(sent.length).to.equal(2);
    expect(sent[1].velocity).to.be.greaterThan(sent[0].velocity);
    expect(sent[1].durationTicks).to.be.greaterThan(sent[0].durationTicks);
  });

  it('applies repeat targets when amount is configured', function() {
    const mapping = new MidiMapping({
      repeat: {
        maxRepeats: 4,
        windowBeats: 1,
        amount: 1,
        target: 'note'
      },
      timing: { bpmBase: 120 },
      limits: { maxEventsPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({ note: 60, velocity: 40, durationTicks: 1 });

    let now = 0;
    router._nowMs = () => now;
    router._onEvent({ sfxId: 1, tick: 1 });
    now = 100;
    router._onEvent({ sfxId: 1, tick: 2 });

    expect(sent.length).to.equal(2);
    expect(sent[1].note).to.be.greaterThan(sent[0].note);
  });

  it('drops events when byte limits are exceeded', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 1000, maxBytesPerSecond: 3 }
    });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = {
      output: {},
      tickMs: 60,
      setTickMs() {},
      estimateMessages() { return { messages: 1, bytes: 3 }; },
      getRateSnapshot(now = 0) {
        return {
          now,
          past: { count: 0, bytes: 0, bySfx: new Map() },
          next: { count: 1, bytes: 3, bySfx: new Map() },
          maxBytesPerSecond: 3
        };
      },
      getUsageShare() {
        return [{ sfxId: 99, count: 1, bytes: 3, priority: 1, percentCount: 1, percentBytes: 1 }];
      },
      sendNote() { sent.push(true); }
    };
    router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 1 });

    router._onEvent({ sfxId: 1, tick: 1, tps: 50 });

    expect(sent.length).to.equal(0);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('attaches and detaches from sound buses', function() {
    const router = new MidiEventRouter();
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

  it('emits performance measurements when enabled', function() {
    const originalPerf = globalThis.performance;
    const originalLemmings = globalThis.lemmings;
    let measures = 0;
    globalThis.performance = { now: () => 0, measure: () => { measures += 1; } };
    globalThis.lemmings = { performanceAPI: true };
    try {
      const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
      const router = new MidiEventRouter(mapping);
      const sent = [];
      router.scheduler = makeSchedulerStub(sent);
      router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 0 });
      router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
      expect(measures).to.equal(1);
    } finally {
      globalThis.performance = originalPerf;
      globalThis.lemmings = originalLemmings;
    }
  });

  it('swallows performance measurement errors', function() {
    const originalPerf = globalThis.performance;
    const originalLemmings = globalThis.lemmings;
    globalThis.performance = { now: () => 0, measure: () => { throw new Error('boom'); } };
    globalThis.lemmings = { performanceAPI: true };
    try {
      const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
      const router = new MidiEventRouter(mapping);
      const sent = [];
      router.scheduler = makeSchedulerStub(sent);
      router.mapping.mapEvent = () => ({ note: 60, velocity: 64, durationTicks: 0 });
      router._onEvent({ sfxId: 1, tick: 1, tps: 50 });
      expect(sent.length).to.equal(1);
    } finally {
      globalThis.performance = originalPerf;
      globalThis.lemmings = originalLemmings;
    }
  });

  it('dispose detaches and disposes scheduler', function() {
    const router = new MidiEventRouter();
    const bus = { onEvent: new EventHandler() };
    const calls = [];
    router.scheduler = { dispose() { calls.push('dispose'); } };
    router.attach(bus);
    router.dispose();
    expect(bus.onEvent.handlers.size).to.equal(0);
    expect(calls).to.eql(['dispose']);
  });

  it('computes tick duration and density helpers', function() {
    const mapping = new MidiMapping({ density: { windowTicks: 4 } });
    const router = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping();
    const router = new MidiEventRouter(mapping);
    let cleared = 0;
    router.scheduler = {
      allNotesOff() { cleared += 1; },
      clearQueue() { cleared += 1; }
    };
    router._nowMs = () => 1000;

    expect(router._resolveScheduleBase(NaN, 60, 1)).to.equal(null);
    const base = router._resolveScheduleBase(100, 60, 1);
    expect(base).to.equal(900);

    router._resolveScheduleBase(120, 30, 1);
    expect(cleared).to.equal(2);
  });

  it('computes priorities, bpm, and arp keys', function() {
    const mapping = new MidiMapping({
      limits: { prioritySfx: [5] },
      timing: { bpmBase: 10 }
    });
    const router = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 127 }, panRange: { min: -127, max: 127 } }
    });
    const router = new MidiEventRouter(mapping);

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
    const mapping = new MidiMapping({ mpe: { enabled: true } });
    const router = new MidiEventRouter(mapping);
    router.scheduler.tickMs = 10;
    const plan = router._planEntries({ note: 60, durationTicks: 2 }, 100, 2);
    expect(plan.on.count).to.equal(4);
    expect(plan.off.count).to.equal(4);
    const zero = router._planEntries({ note: 60, durationTicks: 0 }, 100, 1);
    expect(zero.off.count).to.equal(0);
  });

  it('drops events when hard count limits are exceeded', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 6 } });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 7, bytes: 0, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 0, bytes: 0 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('drops events when higher priority consumes the budget', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[2, { count: 5, bytes: 0, priority: 2 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 5, bytes: 0, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('drops events when spacing or share budgets are exceeded', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 1, hardMaxEventsPerSecond: 100, maxBytesPerSecond: 100 },
      timing: { bpmBase: 60 }
    });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 1, bytes: 0, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() { return []; }
    };
    const maxPerSecond = Math.min(
      Math.max(router.mapping.config?.limits?.maxEventsPerSecond ?? 1000, 1),
      1000
    );
    router._lastAcceptedBySfx.set(1, 0);
    const spacingPlan = {
      on: { timeMs: 0, count: maxPerSecond, bytes: 3 },
      off: { timeMs: 0, count: 0, bytes: 0 }
    };
    const spacingOk = router._shouldSend(
      { sfxId: 1, priority: 1 },
      { timeMs: 0 },
      spacingPlan,
      0
    );
    expect(spacingOk).to.equal(false);
    expect(router.getRateReport().reason).to.equal('spacing');

    const bySfx = new Map([[1, { count: 4, bytes: 0, priority: 1 }]]);
    router.scheduler.getRateSnapshot = () => ({
      next: { count: 4, bytes: 0, bySfx },
      past: { count: 0, bytes: 0, bySfx: new Map() },
      maxBytesPerSecond: 100
    });
    router.scheduler.getUsageShare = () => ([
      { sfxId: 1, count: 4, bytes: 0, priority: 1, percentCount: 1, percentBytes: 0 }
    ]);
    router._lastAcceptedBySfx.delete(1);
    const sharePlan = {
      on: { timeMs: 2000, count: 1, bytes: 3 },
      off: { timeMs: 2000, count: 0, bytes: 0 }
    };
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
    const mapping = new MidiMapping({ enabled: false });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
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
    const router = new MidiEventRouter();
    let seen = null;
    router.scheduler = { setOutput(output) { seen = output; } };
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
    const router = new MidiEventRouter();
    router.scheduler = { getUsageShare: window => [{ window }] };
    const share = router.getUsageShare('next');
    expect(share[0].window).to.equal('next');
  });

  it('covers tick defaults and density edge cases', function() {
    const mapping = new MidiMapping({ density: { windowTicks: 0 } });
    const router = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping();
    const router = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping({ repeat: { maxRepeats: 2, spacingTicks: 2 } });
    const router = new MidiEventRouter(mapping);
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

  it('returns repeat targets unchanged for missing numeric fields', function() {
    const router = new MidiEventRouter(new MidiMapping());
    const base = { note: 60, velocity: 64, durationTicks: 1 };
    const none = router._applyRepeatTarget(base, [60], { amount: 1, target: 'timbre' }, 1);
    expect(none.spec.timbre).to.equal(undefined);
    const pan = router._applyRepeatTarget(base, [60], { amount: 1, target: 'pan' }, 1);
    expect(pan.spec.pan).to.equal(undefined);
    const bend = router._applyRepeatTarget(base, [60], { amount: 1, target: 'pitchBend' }, 1);
    expect(bend.spec.pitchBend).to.equal(undefined);
  });

  it('drops events when available bytes are exhausted', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[2, { count: 1, bytes: 100, priority: 2 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 6, bytes: 100, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 0, bytes: 0 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('handles share reports without current entries', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[2, { count: 5, bytes: 0, priority: 1 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 6, bytes: 0, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() {
        return [{ sfxId: 2, count: 5, bytes: 0, priority: 1, percentCount: 1, percentBytes: 0 }];
      }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 2000, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(true);
  });

  it('sends notes when ticks are missing and notes are empty', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const sent = [];
    router.scheduler = makeSchedulerStub(sent);
    router.mapping.mapEvent = () => ({ note: 60, notes: [], velocity: 64, durationTicks: 0 });
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
    const router = new MidiEventRouter();
    router.attach(busA);
    router.attach(busB);
    expect(offCalls).to.equal(1);
  });

  it('tickMsFromEvent falls back to defaults without timers', function() {
    const router = new MidiEventRouter();
    router.context = {};
    expect(router._tickMsFromEvent({})).to.equal(60);
  });

  it('nowMs uses performance when available', function() {
    const router = new MidiEventRouter();
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => 456 };
    try {
      expect(router._nowMs()).to.equal(456);
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('resets schedule base when speed changes without frame changes', function() {
    const router = new MidiEventRouter(new MidiMapping());
    let cleared = 0;
    router.scheduler = {
      allNotesOff() { cleared += 1; },
      clearQueue() { cleared += 1; }
    };
    router._nowMs = () => 1000;
    router._resolveScheduleBase(100, 60, 1);
    router._resolveScheduleBase(120, 60, 2);
    expect(cleared).to.equal(2);
    router._resolveScheduleBase(140, NaN, NaN);
  });

  it('getBpm returns scaled values above the minimum', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 120 } });
    const router = new MidiEventRouter(mapping);
    router.context = { game: { getGameTimer() { return { speedFactor: 2 }; } } };
    expect(router._getBpm()).to.equal(240);
  });

  it('resolveArpKey falls back when independence is disabled', function() {
    const router = new MidiEventRouter();
    expect(router._resolveArpKey({ triggerType: 3, sfxId: 2 }, { arp: { independent: false } }))
      .to.equal('sfx:2');
  });

  it('getRepeatFactor returns zero for invalid repeat windows', function() {
    const router = new MidiEventRouter();
    expect(router._getRepeatFactor('sfx:1', 10, { maxRepeats: 0, windowBeats: 1 }, 120)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', NaN, { maxRepeats: 2, windowBeats: 1 }, 120)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', 10, { maxRepeats: 2, windowBeats: 1 }, 0)).to.equal(0);
  });

  it('applyRepeatTarget handles accent targets and zero factors', function() {
    const router = new MidiEventRouter(new MidiMapping());
    const baseSpec = { note: 60, velocity: 64, durationTicks: 2, releaseVelocity: 64 };
    const unchanged = router._applyRepeatTarget(baseSpec, [60], { amount: 1, target: 'velocity' }, 0);
    expect(unchanged.spec.velocity).to.equal(64);
    const accent = router._applyRepeatTarget(baseSpec, [60], { amount: 0.5, target: 'accent' }, 1);
    expect(accent.spec.velocity).to.be.greaterThan(64);
  });

  it('planEntries uses default off messages without MPE', function() {
    const router = new MidiEventRouter(new MidiMapping({ mpe: { enabled: false } }));
    router.scheduler.tickMs = 10;
    const plan = router._planEntries({ note: 60, durationTicks: 1 }, 1000, 1);
    expect(plan.off.count).to.equal(1);
  });

  it('shouldSend ignores plans outside the next window', function() {
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 10, maxBytesPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 0, bytes: 0, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 5000, count: 1, bytes: 3 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, {}, plan, 1000);
    expect(ok).to.equal(true);
  });

  it('shouldSend accounts for higher and same priority entries', function() {   
    const mapping = new MidiMapping({ limits: { maxEventsPerSecond: 10, maxBytesPerSecond: 1000 } });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([
      [1, { count: 2, bytes: 6, priority: 1 }],
      [2, { count: 2, bytes: 6, priority: 2 }]
    ]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 4, bytes: 12, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 1000, count: 1, bytes: 3 }, off: { timeMs: 1000, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 1000 }, plan, 1000);
    expect(ok).to.equal(true);
  });

  it('tickMsFromEvent uses frameMs and timer fallbacks', function() {
    const router = new MidiEventRouter();
    expect(router._tickMsFromEvent({ frameMs: 33 })).to.equal(33);
    router.context = { game: { getGameTimer() { return { frameTime: 42 }; } } };
    expect(router._tickMsFromEvent({})).to.equal(42);
  });

  it('density handles zero and window limits', function() {
    const router = new MidiEventRouter(new MidiMapping({ density: { windowTicks: 4 } }));
    router._lastTickBySfx.set(1, 10);
    expect(router._densityForEvent({ sfxId: 1, tick: 10 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 12 })).to.be.closeTo(0.5, 0.01);
    expect(router._densityForEvent({ sfxId: 1, tick: 20 })).to.equal(0);
    expect(router._densityForEvent({ sfxId: 2, tick: 1 })).to.equal(0);
  });

  it('resolveScheduleBase resets on frame or speed changes', function() {
    const router = new MidiEventRouter(new MidiMapping());
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
    const mapping = new MidiMapping({ limits: { prioritySfx: [5] } });
    const router = new MidiEventRouter(mapping);
    expect(router._getEventPriority({ sfxId: 1 }, { priority: 3 })).to.equal(3);
    expect(router._getEventPriority({ sfxId: 5 }, {})).to.equal(2);
  });

  it('resolveArpKey builds independent trigger keys', function() {
    const router = new MidiEventRouter();
    const sfx = { arp: { independent: true } };
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, objectId: 3 }, sfx))
      .to.equal('trigger:1:2:object:3');
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, lemmingId: 4 }, sfx))
      .to.equal('trigger:1:2:lemming:4');
    expect(router._resolveArpKey({ triggerType: 1, sfxId: 2, x: 3, y: 4 }, sfx))
      .to.equal('trigger:1:2:3:4');
  });

  it('getRepeatFactor uses spacingTicks and history', function() {
    const router = new MidiEventRouter();
    const repeatCfg = { maxRepeats: 2, spacingTicks: 1 };
    const bpm = 120;
    const first = router._getRepeatFactor('sfx:1', 0, repeatCfg, bpm);
    const second = router._getRepeatFactor('sfx:1', 100, repeatCfg, bpm);
    expect(first).to.equal(0);
    expect(second).to.be.greaterThan(0);
  });

  it('applyRepeatTarget covers additional targets', function() {
    const mapping = new MidiMapping({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 100 }, panRange: { min: -50, max: 50 } }
    });
    const router = new MidiEventRouter(mapping);
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
    const router = new MidiEventRouter(new MidiMapping({ mpe: { enabled: true } }));
    router.scheduler.tickMs = 10;
    const plan = router._planEntries({ note: 60, durationTicks: 2 }, 1000, 2);
    expect(plan.off.count).to.equal(4);
    const zero = router._planEntries({ note: 60, durationTicks: NaN }, 1000, 1);
    expect(zero.off.count).to.equal(0);
  });

  it('shouldSend rejects when count exceeds the hard max', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 6, maxBytesPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 6, bytes: 0, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 0, count: 1, bytes: 3 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('shouldSend handles priority saturation', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[2, { count: 5, bytes: 10, priority: 2 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 5, bytes: 10, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() {
        return [{ sfxId: 2, count: 5, bytes: 10, priority: 2, percentCount: 1, percentBytes: 1 }];
      }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('shouldSend rejects when available bytes are exhausted', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 5, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 10 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[2, { count: 1, bytes: 10, priority: 2 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 1, bytes: 10, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 10
        };
      },
      getUsageShare() {
        return [{ sfxId: 2, count: 1, bytes: 10, priority: 2, percentCount: 1, percentBytes: 1 }];
      }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('shouldSend rejects when spacing is violated', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 1, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[1, { count: 1, bytes: 3, priority: 1 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 1, bytes: 3, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() {
        return [{ sfxId: 1, count: 1, bytes: 3, priority: 1, percentCount: 1, percentBytes: 0 }];
      }
    };
    router._lastAcceptedBySfx.set(1, 1000);
    const plan = { on: { timeMs: 1000, count: 1, bytes: 3 }, off: { timeMs: 1000, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 1000 }, plan, 1000);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('spacing');
  });

  it('shouldSend rejects when share budgets are exceeded', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([[1, { count: 2, bytes: 6, priority: 1 }]]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 2, bytes: 6, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() {
        return [{ sfxId: 1, count: 2, bytes: 6, priority: 1, percentCount: 1, percentBytes: 0 }];
      }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('share-throttle');
  });

  it('covers setup helpers and schedule resets', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 100 } });
    const router = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping({ limits: { prioritySfx: [2] }, timing: { bpmBase: 120 } });
    const router = new MidiEventRouter(mapping);
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
    const router = new MidiEventRouter(new MidiMapping({
      noteRange: { min: 0, max: 127 },
      position: { timbreRange: { min: 0, max: 127 }, panRange: { min: -127, max: 127 } }
    }));
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
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      tickMs: 50,
      estimateMessages() { return { messages: 2, bytes: 6 }; },
      getRateSnapshot() {
        return {
          next: { count: 0, bytes: 0, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = router._planEntries({ durationTicks: NaN }, -2000, 1);
    expect(plan.off.count).to.equal(0);
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: -2000 }, plan, 0);
    expect(ok).to.equal(true);
  });

  it('shouldSend rejects when hard max is exceeded', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 1, hardMaxEventsPerSecond: 1, maxBytesPerSecond: 1000 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map();
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 2, bytes: 0, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 1000
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 0, bytes: 0 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('shouldSend accounts for higher-priority traffic', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([
      [2, { count: 2, bytes: 6, priority: 2 }]
    ]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 2, bytes: 6, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() {
        return [{ sfxId: 2, count: 2, bytes: 6, priority: 2, percentCount: 1, percentBytes: 1 }];
      }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 3 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('onEvent applies repeat amount and boost settings', function() {
    const mapping = new MidiMapping({
      enabled: true,
      timing: { bpmBase: 120 },
      repeat: { amount: 0.5, target: 'velocity', maxRepeats: 2, windowBeats: 1 },
      sfx: { '1': { note: 60 } }
    });
    const router = new MidiEventRouter(mapping);
    const output = { channels: { 1: { sendNoteOn() {}, sendNoteOff() {}, sendPitchBend() {}, sendControlChange() {}, sendAllNotesOff() {}, sendPitchBendRange() {} } } };
    router.scheduler.setOutput(output);
    router._shouldSend = () => true;
    router.scheduler.sendNote = () => {};

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, timeMs: 0 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50, timeMs: 20 });

    const boostMapping = new MidiMapping({
      enabled: true,
      timing: { bpmBase: 120 },
      repeat: { velocityBoost: 0.2, durationBoost: 0.1, maxRepeats: 2, windowBeats: 1 },
      sfx: { '1': { note: 60 } }
    });
    const boostRouter = new MidiEventRouter(boostMapping);
    boostRouter.scheduler.setOutput(output);
    boostRouter._shouldSend = () => true;
    boostRouter.scheduler.sendNote = () => {};
    boostRouter._onEvent({ sfxId: 1, tick: 1, tps: 50, timeMs: 0 });
  });

  it('covers attach cleanup and tick defaults', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 10 } });
    const routerA = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping({ density: { windowTicks: 4 } });
    const router = new MidiEventRouter(mapping);
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
    const mapping = new MidiMapping({ repeat: { maxRepeats: 2, spacingTicks: 2 } });
    const router = new MidiEventRouter(mapping);
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

    const mpeRouter = new MidiEventRouter(new MidiMapping({ mpe: { enabled: true } }));
    mpeRouter.scheduler.tickMs = 10;
    const planA = mpeRouter._planEntries({ note: 60, durationTicks: NaN }, 1000, 2);
    const planB = mpeRouter._planEntries({ note: 60, durationTicks: 1 }, 1000, 1);
    expect(planA.off.count).to.equal(0);
    expect(planB.off.count).to.equal(2);
  });

  it('shouldSend enforces hard caps', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 11, maxBytesPerSecond: 100 }
    });
    const router = new MidiEventRouter(mapping);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 10, bytes: 0, bySfx: new Map() },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 100
        };
      },
      getUsageShare() { return []; }
    };
    const plan = { on: { timeMs: 0, count: 2, bytes: 0 }, off: { timeMs: 0, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('shouldSend throttles on byte budgets and priorities', function() {
    const mapping = new MidiMapping({
      limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 5 }
    });
    const router = new MidiEventRouter(mapping);
    const bySfx = new Map([
      [1, { count: 1, bytes: 0, priority: 1 }],
      [2, { count: 1, bytes: 5, priority: 2 }]
    ]);
    router.scheduler = {
      getRateSnapshot() {
        return {
          next: { count: 2, bytes: 5, bySfx },
          past: { count: 0, bytes: 0, bySfx: new Map() },
          maxBytesPerSecond: 5
        };
      },
      getUsageShare() {
        return [
          { sfxId: 1, count: 1, bytes: 0, priority: 1, percentCount: 0.5, percentBytes: 0 },
          { sfxId: 2, count: 1, bytes: 5, priority: 2, percentCount: 0.5, percentBytes: 1 }
        ];
      }
    };
    const plan = { on: { timeMs: 0, count: 1, bytes: 0 }, off: { timeMs: 500, count: 0, bytes: 0 } };
    const ok = router._shouldSend({ sfxId: 3, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });
});
