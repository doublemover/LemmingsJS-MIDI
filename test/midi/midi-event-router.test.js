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
      repeat: { maxRepeats: 2, windowBeats: 4, velocityBoost: 0.5, durationBoost: 0.5 },
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
});
