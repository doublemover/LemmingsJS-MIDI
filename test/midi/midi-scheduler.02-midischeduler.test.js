import { expect } from 'chai';
import { withConsoleStub } from '../helpers/console.js';
import { withGlobalLemmings } from '../helpers/lemmings.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

describe('MidiScheduler 2', function() {
  it('reserves proposed messages against past and future traffic', function() {
    const scheduler = new MidiScheduler({
      mpe: { enabled: false },
      limits: {
        maxEventsPerSecond: 4,
        maxBytesPerSecond: 999
      }
    });
    scheduler._rateSent = [
      { timeMs: 500, count: 2, bytes: 6, sfxId: 1, priority: 1 }
    ];
    scheduler._ratePlanned = [
      { timeMs: 1200, count: 1, bytes: 3, sfxId: 2, priority: 1 }
    ];

    const rejected = scheduler.canSchedule(
      { on: { timeMs: 1000, count: 2, bytes: 6 } },
      1000,
      { maxMessagesPerSecond: 4 }
    );
    expect(rejected.ok).to.equal(false);
    expect(rejected.reason).to.equal('count-limit');

    const reserved = scheduler.reserve(
      { on: { timeMs: 1000, count: 1, bytes: 3 } },
      { sfxId: 3, priority: 1 },
      1000,
      { maxMessagesPerSecond: 4 }
    );
    expect(reserved.ok).to.equal(true);
    expect(reserved.reservationId).to.be.a('number');
    const snapshot = scheduler.getRateSnapshot(1000);
    expect(snapshot.past.count + snapshot.next.count).to.equal(4);
    expect(snapshot.next.bySfx.get(3).count).to.equal(1);
  });

  it('preserves routing metadata on reserved rate entries', function() {
    const scheduler = new MidiScheduler({
      mpe: { enabled: false },
      limits: {
        maxEventsPerSecond: 8,
        maxBytesPerSecond: 999
      }
    });

    const reserved = scheduler.reserve(
      { on: { timeMs: 1000, count: 1, bytes: 3 } },
      {
        sfxId: 3,
        priority: 2,
        triggerType: 'skill',
        trackId: 'lead',
        outputId: 'out-1',
        voiceBudget: 4
      },
      1000,
      { maxMessagesPerSecond: 8 }
    );

    expect(reserved.ok).to.equal(true);
    expect(reserved.reservationId).to.be.a('number');
    expect(scheduler._ratePlanned[0]).to.include({
      reservationId: reserved.reservationId,
      sfxId: 3,
      priority: 2,
      triggerType: 'skill',
      trackId: 'lead',
      outputId: 'out-1',
      voiceBudget: 4
    });
  });

  it('logs when byte rate limits are exceeded', function() {
    const scheduler = new MidiScheduler({ limits: { maxBytesPerSecond: 1 } });
    const logs = [];
    const restoreConsole = withConsoleStub({ error: msg => logs.push(msg) });
    scheduler.getRateSnapshot = () => ({
      past: { bytes: 2 },
      next: { bytes: 0 }
    });
    scheduler._lastRateErrorMs = -2000;
    scheduler._checkByteRate(0);
    restoreConsole();
    expect(logs.length).to.equal(1);
  });

  it('logs when message rate limits are exceeded', function() {
    const scheduler = new MidiScheduler({
      limits: {
        maxEventsPerSecond: 1,
        maxBytesPerSecond: 999999
      }
    });
    const logs = [];
    const restoreConsole = withConsoleStub({ error: msg => logs.push(msg) });
    scheduler.getRateSnapshot = () => ({
      past: { count: 2, bytes: 0 },
      next: { count: 0, bytes: 0 }
    });
    scheduler._lastRateErrorMs = -2000;
    scheduler._checkByteRate(0);
    restoreConsole();
    expect(logs.length).to.equal(1);
    expect(logs[0]).to.match(/messages\/sec/i);
  });

  it('swallows performance measurement errors', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => 0, measure: () => { throw new Error('boom'); } };
    try {
      withGlobalLemmings({ performanceAPI: true }, () => {
        const scheduler = new MidiScheduler({ mpe: { enabled: false } });
        scheduler.setOutput(output);
        const ok = scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
        expect(ok).to.equal(true);
      });
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('computes usage share for rate snapshots', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._rateSent = [
      { timeMs: 900, count: 2, bytes: 6, sfxId: 1, priority: 1 }
    ];
    const shares = scheduler.getUsageShare('past', 1000);
    expect(shares.length).to.equal(1);
    expect(shares[0].sfxId).to.equal(1);
    expect(shares[0].percentCount).to.equal(1);
  });

  it('counts pitch bend messages when MPE is disabled', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const estimate = scheduler.estimateMessages({ note: 60, pitchBend: 0.5, durationTicks: 0 });
    expect(estimate.messages).to.equal(2);
  });
});
