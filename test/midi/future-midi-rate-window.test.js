import { expect } from 'chai';
import { futureMidiRatePeak } from '../../js/midi/scheduler/FutureMidiRateWindow.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const entry = (timeMs, count, outputId = 'a', budgetScope = 'link:one') => ({ timeMs, count, bytes: count * 3, outputId, budgetScope });

describe('future MIDI transport rate windows', () => {
  it('counts both reserved onsets and releases in the actual future window', () => {
    const result = futureMidiRatePeak([entry(0, 99), entry(5000, 32), entry(5060, 32)], { now: 0, windowMs: 1000, scope: 'a' });
    expect(result).to.deep.equal({ peakMessages: 99, peakBytes: 297 });
    expect(futureMidiRatePeak([entry(5000, 32), entry(5060, 32)], { now: 0, windowMs: 1000, scope: 'a' }).peakMessages).to.equal(64);
  });
  it('preserves the existing conservative boundary and groups same-time work', () => {
    expect(futureMidiRatePeak([entry(5000, 2), entry(6000, 3), entry(6000, 4)], { now: 0, windowMs: 1000 }).peakMessages).to.equal(9);
    expect(futureMidiRatePeak([entry(5000, 2), entry(6001, 7)], { now: 0, windowMs: 1000 }).peakMessages).to.equal(7);
  });
  it('keeps endpoint and shared-link accounting distinct, including conservative aggregates', () => {
    const rows = [entry(5000, 2), entry(5000, 4, 'b'), entry(5000, 8, 'c', 'link:two'), { ...entry(5000, 1), conservativeAllScopes: true }];
    expect(futureMidiRatePeak(rows, { now: 0, windowMs: 1000, scope: 'a' }).peakMessages).to.equal(3);
    expect(futureMidiRatePeak(rows, { now: 0, windowMs: 1000, scope: { scope: 'link:one' } }).peakMessages).to.equal(7);
  });
  it('rejects a future release burst before any note is submitted and preserves its sounding owner', () => withFakeClockAndPerformance(clock => {
    const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxEventsPerSecond: 8, maxBytesPerSecond: 1000 } });
    scheduler.setOutput(makeOutput([1], calls)); scheduler.setTickMs(10);
    expect(scheduler.sendNote({ note: 60 })).to.equal(true);
    let admitted = 0;
    for (let index = 0; index < 10; index++) if (scheduler.sendNote({ note: 64 + index, timeMs: 5000, durationTicks: 10 })) admitted++;
    expect(admitted).to.equal(4); expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
    clock.tick(5200);
    expect(calls.filter(call => call.type === 'noteOn' && call.note !== 60)).to.have.length(4);
    expect(scheduler._pendingNoteOns.size).to.equal(0); scheduler.dispose();
  }));
});
