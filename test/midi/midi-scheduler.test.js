import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';

const makeChannel = (id, calls) => ({
  sendNoteOn(note, opts) { calls.push({ type: 'noteOn', id, note, opts }); },
  sendNoteOff(note, opts) { calls.push({ type: 'noteOff', id, note, opts }); },
  sendPitchBend(value, opts) { calls.push({ type: 'pitchBend', id, value, opts }); },
  sendControlChange(cc, value, opts) { calls.push({ type: 'cc', id, cc, value, opts }); },
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

      expect(calls.some(c => c.type === 'noteOff' && c.note === 60)).to.equal(true);

      clock.tick(25);
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

  it('handles invalid sendNote inputs and tick updates', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    expect(scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 1 })).to.equal(false);

    const calls = [];
    const output = makeOutput([3], calls);
    scheduler.setOutput(output);
    scheduler.setTickMs(-1);
    expect(scheduler.tickMs).to.equal(60);
    scheduler.setTickMs(5);
    expect(scheduler.tickMs).to.equal(5);

    expect(scheduler.sendNote(null)).to.equal(false);
    expect(scheduler.sendNote({ note: NaN })).to.equal(false);

    scheduler.output = { channels: {} };
    expect(scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 })).to.equal(false);
  });

  it('allocates default channels when MPE is disabled', function() {
    const calls = [];
    const output = makeOutput([4], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 4 });
    scheduler.setOutput(output);
    scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
    const noteOn = calls.find(c => c.type === 'noteOn');
    expect(noteOn.id).to.equal(4);
  });

  it('stops active channels and clears scheduled note offs', function() {
    const calls = [];
    const output = makeOutput([1, 2], calls);
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => clock.now };
    try {
      const scheduler = new MidiScheduler({
        mpe: { enabled: true, memberChannels: [2] }
      });
      scheduler.setOutput(output);
      scheduler.setTickMs(10);
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 2 });
      expect(scheduler._noteOffs.length).to.be.greaterThan(0);
      scheduler._stopActiveChannel(2);
      expect(scheduler._noteOffs.length).to.equal(0);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });

  it('processes note offs safely without output', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._noteOffs.push({ timeMs: 0, channel: 1, note: 60, token: 1, mpe: false });
    scheduler.output = null;
    scheduler._processNoteOffs();
    expect(scheduler._noteOffs.length).to.equal(1);
  });

  it('dispose clears timers and output', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(output);
    scheduler._noteOffTimerId = setTimeout(() => {}, 10);
    scheduler.dispose();
    expect(scheduler.output).to.equal(null);
    expect(scheduler._noteOffs.length).to.equal(0);
  });

  it('tracks rate snapshots and clears queued events', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => clock.now, measure: () => {} };
    try {
      const scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output);
      scheduler.setTickMs(10);
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 1, timeMs: 500 });
      const snapshot = scheduler.getRateSnapshot(0);
      expect(snapshot.next.count).to.be.greaterThan(0);
      scheduler.clearQueue();
      expect(scheduler._ratePlanned.length).to.equal(0);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });
});
