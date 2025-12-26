import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';

const makeChannel = (id, calls) => ({
  sendNoteOn(note, opts) { calls.push({ type: 'noteOn', id, note, opts }); },
  sendNoteOff(note) { calls.push({ type: 'noteOff', id, note }); },
  sendPitchBend(value) { calls.push({ type: 'pitchBend', id, value }); },
  sendControlChange(cc, value) { calls.push({ type: 'cc', id, cc, value }); },
  sendPitchBendRange(semitones, cents) {
    calls.push({ type: 'bendRange', id, semitones, cents });
  },
  sendAllNotesOff() { calls.push({ type: 'allNotesOff', id }); }
});

const makeOutput = (ids, calls) => ({
  channels: Object.fromEntries(ids.map(id => [id, makeChannel(id, calls)]))
});

describe('MidiScheduler', function() {
  it('schedules note offs and converts signed pan', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => clock.now };
    try {
      const scheduler = new MidiScheduler({
        mpe: { enabled: false },
        position: { panRange: { min: -127, max: 127 } }
      });
      scheduler.setOutput(output);
      scheduler.setTickMs(10);

      const ok = scheduler.sendNote({
        note: 60,
        velocity: 64,
        durationTicks: 2,
        pan: -127
      });

      expect(ok).to.equal(true);
      expect(calls.some(c => c.type === 'cc' && c.cc === 10 && c.value === 0)).to.equal(true);

      clock.tick(25);

      expect(calls.some(c => c.type === 'noteOff' && c.note === 60)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(0);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });

  it('steals the oldest note when active count is exceeded', function() {       
    const calls = [];
    const output = makeOutput([1], calls);
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => clock.now };
    try {
      const scheduler = new MidiScheduler({
        mpe: { enabled: false },
        limits: { maxActiveNotes: 1 }
      });
      scheduler.setOutput(output);

      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
      clock.tick(1);
      scheduler.sendNote({ note: 62, velocity: 64, durationTicks: 0 });

      const noteOffs = calls.filter(c => c.type === 'noteOff').map(c => c.note);
      expect(noteOffs).to.include(60);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });

  it('initializes MPE channels and reuses the oldest member', function() {
    const calls = [];
    const output = makeOutput([1, 2, 3], calls);
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => clock.now };
    try {
      const scheduler = new MidiScheduler({
        mpe: {
          enabled: true,
          masterChannel: 1,
          memberChannels: [2, 3],
          pitchBendRange: { semitones: 12, cents: 0 },
          timbreCc: 74
        }
      });
      scheduler.setOutput(output);

      const bendRangeChannels = calls
        .filter(c => c.type === 'bendRange')
        .map(c => c.id)
        .sort();
      expect(bendRangeChannels).to.eql([1, 2, 3]);

      calls.length = 0;
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0, pitchBend: 0.5, timbre: 80 });
      clock.tick(1);
      scheduler.sendNote({ note: 62, velocity: 64, durationTicks: 0, pitchBend: 0, timbre: 90 });
      clock.tick(1);
      scheduler.sendNote({ note: 64, velocity: 64, durationTicks: 0, pitchBend: -0.5, timbre: 100 });

      const noteOff = calls.find(c => c.type === 'noteOff' && c.id === 2 && c.note === 60);
      expect(noteOff).to.be.ok;
      const timbreCalls = calls.filter(c => c.type === 'cc' && c.cc === 74);
      expect(timbreCalls.length).to.be.greaterThan(0);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });

  it('clamps unsigned pan values to 0-127', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({
      mpe: { enabled: false },
      position: { panRange: { min: 0, max: 127 } }
    });
    scheduler.setOutput(output);

    const ok = scheduler.sendNote({
      note: 60,
      velocity: 64,
      durationTicks: 0,
      pan: -10
    });

    expect(ok).to.equal(true);
    const panCall = calls.find(c => c.type === 'cc' && c.cc === 10);
    expect(panCall.value).to.equal(0);
  });

  it('allNotesOff resets active state when MPE is enabled', function() {
    const calls = [];
    const output = makeOutput([1, 2, 3], calls);
    const scheduler = new MidiScheduler({
      mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3] }
    });
    scheduler.setOutput(output);

    scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
    scheduler.allNotesOff();

    const allNotes = calls.filter(c => c.type === 'allNotesOff').map(c => c.id).sort();
    expect(allNotes).to.eql([1, 2, 3]);
    expect(scheduler._activeNotes.size).to.equal(0);
    expect(scheduler._activeByChannel.size).to.equal(0);
  });
});
