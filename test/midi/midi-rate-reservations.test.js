import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

describe('owned MIDI rate reservations', function() {
  it('does not charge a missing channel or a canceled future phrase', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxEventsPerSecond: 1 } });
      scheduler.setOutput(makeOutput([1], calls));
      expect(scheduler.sendNote({ note: 60, channel: 2, timeMs: 10000, durationTicks: 0 })).to.equal(false);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      expect(scheduler.sendNote({ note: 60, channel: 1, timeMs: 10000, durationTicks: 0, phraseVoiceKey: 'future' })).to.equal(true);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(1);
      expect(scheduler.cancelGamePhrase('future')).to.equal(true);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      expect(scheduler.getRateSnapshot(0).past.count).to.equal(0);
      expect(scheduler.sendNote({ note: 64, channel: 1, durationTicks: 0 })).to.equal(true);
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([64]);
      clock.tick(10001);
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([64]);
      scheduler.dispose();
    });
  });

  it('retains accepted setup cost but releases the rejected remainder', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler({ mpe: { enabled: false } });
      output.channels[1].sendProgramChange = program => { calls.push({ type: 'program', program }); return true; };
      output.channels[1].sendControlChange = () => false;
      scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, program: 8, timbre: 80, durationTicks: 0 })).to.equal(false);
      expect(scheduler._ratePlanned).to.have.length(0);
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 1, bytes: 2 });
      expect(calls.map(call => call.type)).to.deep.equal(['program']);
      output.channels[1].sendControlChange = (cc, value) => { calls.push({ type: 'cc', cc, value }); return true; };
      expect(scheduler.sendNote({ note: 60, program: 8, timbre: 80, durationTicks: 0 })).to.equal(true);
      expect(calls.filter(call => call.type === 'program')).to.have.length(2);
      scheduler.dispose();
    });
  });

  it('keeps a sent onset while canceling only its unsent release', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(makeOutput([1], calls)); scheduler.setTickMs(10);
      expect(scheduler.sendNote({ note: 60, timeMs: 100, durationTicks: 20, phraseVoiceKey: 'cue' })).to.equal(true);
      clock.tick(100);
      expect(scheduler.getRateSnapshot(100).past.count).to.equal(1);
      expect(scheduler.getRateSnapshot(100).next.count).to.equal(1);
      expect(scheduler.cancelGamePhrase('cue')).to.equal(true);
      expect(scheduler.getRateSnapshot(100).past.count).to.equal(2);
      expect(scheduler.getRateSnapshot(100).next.count).to.equal(0);
      expect(scheduler.cancelGamePhrase('cue')).to.equal(false);
      clock.tick(201);
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(1);
      scheduler.dispose();
    });
  });

  it('does not promote an elapsed reservation to sent history without dispatch', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const reservation = scheduler.reserve({ on: { timeMs: 1000, count: 1, bytes: 3 } }, {}, 0);
    expect(reservation.ok).to.equal(true);
    expect(scheduler.getRateSnapshot(1500).past.count).to.equal(0);
    expect(scheduler.getRateSnapshot(1500).next.count).to.equal(1);
    expect(scheduler._releaseReservation(reservation.reservationId)).to.equal(1);
    expect(scheduler._releaseReservation(reservation.reservationId)).to.equal(0);
    expect(scheduler.getRateSnapshot(1500).next.count).to.equal(0);
  });

  it('refunds only the rejected share of an externally reserved chord', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(makeOutput([1], calls));
      const reservation = scheduler.reserve({ on: { timeMs: 100, count: 2, bytes: 6 } }, {}, 0);
      expect(reservation.ok).to.equal(true);
      const common = { rateReserved: true, reservationId: reservation.reservationId, reservationPartCount: 2 };
      expect(scheduler.sendNote({ note: 60, channel: 2, timeMs: 100 }, { ...common, reservationPartIndex: 0 })).to.equal(false);
      expect(scheduler.sendNote({ note: 64, channel: 1, timeMs: 100 }, { ...common, reservationPartIndex: 1 })).to.equal(true);
      scheduler._releaseReservation(reservation.reservationId, true);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(1);
      expect(scheduler._ratePlanned[0].token).to.be.a('number');
      scheduler.clearQueue();
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      scheduler.dispose();
    });
  });

  it('does not count an unsupported onset as accepted traffic', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler({ mpe: { enabled: false } });
      delete output.channels[1].sendNoteOn;
      scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, durationTicks: 10 })).to.equal(false);
      expect(scheduler.getRateSnapshot(0).past.count).to.equal(0);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.dispose();
    });
  });

  it('retires outstanding work for a replaced endpoint while retaining sent cost', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false } });
      const old = makeOutput([1], calls, 'old'), replacement = makeOutput([1], calls, 'next');
      scheduler.setOutput(old);
      scheduler.sendNote({ note: 60, durationTicks: 0 });
      const reserved = scheduler.reserve({ on: { timeMs: 1000, count: 1, bytes: 3 } }, { outputId: 'old' }, 0);
      expect(reserved.ok).to.equal(true);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(1);
      scheduler.setOutput(replacement);
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      expect(scheduler.getRateSnapshot(0).past.count).to.equal(2);
      scheduler.dispose();
    });
  });
});
