import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const config = { enabled: true, mpe: { enabled: false }, position: { mappings: [], viewPan: false },
  density: { velocityBoost: 0, durationScale: 0 }, timing: { scheduleAheadMs: 0 },
  limits: { maxEventsPerSecond: 64, hardMaxEventsPerSecond: 64, maxBytesPerSecond: 100000, maxEventsPerTick: 32 },
  sfx: { '1': { note: 60, durationTicks: 1 } } };
const fixture = () => {
  const calls = [], scheduler = new MidiScheduler(config);
  scheduler.setOutput(makeOutput([1], calls));
  return { scheduler, calls };
};
const send = (scheduler, laneIndex = 0, laneCount = 1, note = 60) => scheduler.sendNote(
  { note, channel: 1, durationTicks: 1 }, { laneIndex, laneCount });

describe('Shared MIDI output budget', function() {
  for (const laneCount of [1, 4, 8]) {
    it('divides one bounded output budget across ' + laneCount + ' busy lanes', function() {
      withFakeClockAndPerformance(clock => {
        const { scheduler, calls } = fixture(), accepted = [];
        for (let lane = 0; lane < laneCount; lane += 1) {
          let count = 0;
          for (let index = 0; index < 40; index += 1) if (send(scheduler, lane, laneCount, 40 + lane * 4 + index % 4)) count += 1;
          accepted.push(count);
        }
        expect(accepted).to.deep.equal(Array(laneCount).fill(32 / laneCount));
        expect(scheduler.getOutputPressure().throttled).to.equal(true);
        clock.tick(200);
        expect(scheduler._activeNotes.size).to.equal(0);
        expect(scheduler._pendingNoteOns.size).to.equal(0);
        expect(calls.filter(call => call.type === 'noteOn').length).to.equal(32);
        expect(calls.filter(call => call.type === 'noteOff').length).to.equal(32);
        scheduler.dispose();
      });
    });
  }

  it('retains actual sent history after an advanced-clock speed transition', function() {
    withFakeClockAndPerformance(clock => {
      const { scheduler } = fixture();
      for (let index = 0; index < 20; index += 1) send(scheduler, 0, 1, 40 + index);
      clock.tick(200);
      expect(scheduler.getRateSnapshot().past.count).to.equal(40);
      scheduler.allNotesOff({ preserveRateHistory: true });
      scheduler.clearQueue({ preserveRateHistory: true });
      expect(scheduler.getRateSnapshot().past.count).to.equal(40);
      let accepted = 0;
      for (let index = 0; index < 40; index += 1) if (send(scheduler, 0, 1, 40 + index)) accepted += 1;
      expect(accepted).to.equal(12);
      scheduler.dispose();
    });
  });

  it('rotates oversized chords so all 64 busy lanes are heard in bounded real time', function() {
    withFakeClockAndPerformance(clock => {
      const router = new MidiEventRouter({ ...config, sfx: { '1': { notes: [60, 64, 67, 72], durationTicks: 1 } } }), calls = [], heard = new Set();
      router.setOutput(makeOutput([1], calls));
      const original = router.scheduler.sendNote.bind(router.scheduler);
      router.scheduler.sendNote = (spec, meta) => { const ok = original(spec, meta); if (ok) heard.add(meta.laneIndex); return ok; };
      for (let second = 0; second < 32; second += 1) {
        for (let lane = 0; lane < 64; lane += 1) router._onEvent({ sfxId: 1, tick: second, laneIndex: lane, laneCount: 64 });
        clock.tick(1001);
      }
      expect(heard.size).to.equal(64);
      expect(router.scheduler._rateLaneActivity.size).to.be.at.most(64);
      router.dispose();
    });
  });

  it('keeps high lane indices distinct up to the procgen lane bound', function() {
    withFakeClockAndPerformance(() => {
      const { scheduler } = fixture();
      const plan = { on: { timeMs: 0, count: 1, bytes: 3 } };
      scheduler.reserve(plan, { laneIndex: 1023, laneCount: 1024 }, 0);
      expect(scheduler._rateLaneCount).to.equal(1024);
      expect(scheduler._rateLaneActivity.has(1023)).to.equal(true);
      expect(scheduler._rateLaneActivity.has(63)).to.equal(false);
      scheduler.dispose();
    });
  });

  it('charges future note-ons before dispatch instead of allowing a delayed burst', function() {
    withFakeClockAndPerformance(clock => {
      const { scheduler, calls } = fixture();
      let accepted = 0;
      for (let index = 0; index < 100; index += 1) if (scheduler.sendNote({ note: 40 + index % 32, timeMs: 5000, durationTicks: 1 })) accepted += 1;
      expect(accepted).to.be.at.most(64);
      expect(scheduler._pendingNoteOns.size).to.be.at.most(32);
      clock.tick(5100);
      expect(calls.filter(call => call.type === 'noteOn').length).to.be.at.most(32);
      scheduler.dispose();
    });
  });

  it('lends idle lane capacity and restores a returning busy lane share', function() {
    withFakeClockAndPerformance(clock => {
      const { scheduler } = fixture();
      let initial = 0, borrowed = 0, returned = 0;
      for (let index = 0; index < 40; index += 1) if (send(scheduler, 0, 4, 40 + index % 8)) initial += 1;
      clock.tick(200);
      for (let index = 0; index < 40; index += 1) if (send(scheduler, 0, 4, 40 + index % 8)) borrowed += 1;
      expect(initial).to.equal(8);
      expect(borrowed).to.equal(24);
      expect(send(scheduler, 1, 4)).to.equal(false);
      clock.tick(1100);
      for (let index = 0; index < 40; index += 1) if (send(scheduler, 1, 4, 60 + index % 8)) returned += 1;
      expect(returned).to.be.greaterThan(0);
      expect(scheduler.getOutputPressure().messages).to.be.at.most(64);
      scheduler.dispose();
    });
  });

  it('keeps real-time output history through speed changes and returning to normal speed', function() {
    withFakeClockAndPerformance(clock => {
      const router = new MidiEventRouter(config), calls = [];
      router.setOutput(makeOutput([1], calls));
      for (let tick = 0; tick < 100; tick += 1) {
        const speedFactor = tick < 20 ? 1 : tick < 80 ? 8 : 1;
        router._onEvent({ sfxId: 1, type: 'test', tick, timeMs: clock.now, frameMs: 60 / speedFactor,
          speedFactor, tps: 1000 / (60 / speedFactor), laneIndex: 0, laneCount: 1 });
      }
      expect(calls.filter(call => call.type === 'noteOn').length).to.be.at.most(32);
      expect(router.scheduler.getOutputPressure().throttled).to.equal(true);
      clock.tick(1200);
      router._onEvent({ sfxId: 1, tick: 100, timeMs: clock.now, frameMs: 60, speedFactor: 1 });
      expect(calls.filter(call => call.type === 'noteOn').length).to.be.greaterThan(0);
      router.dispose();
      expect(router.scheduler._activeNotes.size).to.equal(0);
    });
  });

  it('charges expanded chords and preserves game events when output is thinned', function() {
    withFakeClockAndPerformance(() => {
      const router = new MidiEventRouter({ ...config, sfx: { '1': { notes: [60, 64, 67, 72], durationTicks: 1 } } }), calls = [];
      router.setOutput(makeOutput([1], calls));
      for (let lane = 0; lane < 4; lane += 1) for (let tick = 0; tick < 20; tick += 1) {
        router._onEvent({ sfxId: 1, tick, laneIndex: lane, laneCount: 4 });
      }
      expect(calls.filter(call => call.type === 'noteOn').length).to.be.at.most(32);
      expect(router.getOutputPressure().throttled).to.equal(true);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      router.dispose();
    });
  });

  it('never throttles sustain release or Panic and clears pending ownership', function() {
    withFakeClockAndPerformance(() => {
      const { scheduler, calls } = fixture();
      for (let index = 0; index < 80; index += 1) send(scheduler);
      scheduler.allNotesOff();
      expect(calls.some(call => call.type === 'cc' && call.cc === 64 && call.value === 0)).to.equal(true);
      expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(0);
      expect(scheduler._pendingNoteOns.size).to.equal(0);
      expect(scheduler._noteOffs).to.deep.equal([]);
      scheduler.dispose();
    });
  });
});
