import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';

const makeChannel = (id, calls) => ({
  sendNoteOn(note, opts) { calls.push({ type: 'noteOn', id, note, opts }); },
  sendNoteOff(note, opts) { calls.push({ type: 'noteOff', id, note, opts }); },
  sendPitchBend(value, opts) { calls.push({ type: 'pitchBend', id, value, opts }); },
  sendControlChange(cc, value, opts) { calls.push({ type: 'cc', id, cc, value, opts }); },
  sendPitchBendRange(semitones, cents) { calls.push({ type: 'bendRange', id, semitones, cents }); },
  sendAllNotesOff() { calls.push({ type: 'allNotesOff', id }); }
});

const makeOutput = (ids, calls) => ({
  channels: Object.fromEntries(ids.map(id => [id, makeChannel(id, calls)]))
});

describe('MidiScheduler coverage', function() {
  it('initializes MPE when output is already set', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(output);
    scheduler.setConfig({ mpe: { enabled: true, masterChannel: 1, memberChannels: [] } });
    expect(calls.some(call => call.type === 'bendRange')).to.equal(true);
  });

  it('skips MPE init when output or channels are missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true, memberChannels: [2] } });
    scheduler.setOutput({ channels: {} });
    scheduler._initMpe();
    expect(scheduler._memberChannels).to.eql([2]);
  });

  it('uses Date.now when performance is unavailable', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const originalPerformance = globalThis.performance;
    const originalDateNow = Date.now;
    Date.now = () => 1234;
    globalThis.performance = undefined;
    try {
      expect(scheduler._nowMs()).to.equal(1234);
    } finally {
      Date.now = originalDateNow;
      globalThis.performance = originalPerformance;
    }
  });

  it('steals an MPE note and clears channel state', function() {
    const calls = [];
    const output = makeOutput([2], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, memberChannels: [2] } });
    scheduler.setOutput(output);
    scheduler._activeNotes.set(1, { note: 60, channel: 2, mpe: true, startedAt: 0 });
    scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 0 });
    scheduler._stealOldestNote();
    expect(scheduler._activeByChannel.size).to.equal(0);
    expect(calls.some(call => call.type === 'pitchBend')).to.equal(true);
  });

  it('aggregates unknown sfx ids in rate snapshots', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._rateSent = [{ timeMs: -1, count: 1, bytes: 3 }];
    const snapshot = scheduler.getRateSnapshot(0);
    expect(snapshot.past.bySfx.has('unknown')).to.equal(true);
  });

  it('computes usage share for upcoming windows', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._ratePlanned = [{ timeMs: 10, count: 2, bytes: 6, sfxId: 7, priority: 3 }];
    const share = scheduler.getUsageShare('next', 0);
    expect(share[0].sfxId).to.equal(7);
    expect(share[0].percentCount).to.equal(1);
  });

  it('handles zero totals in usage share', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._ratePlanned = [{ timeMs: 10, count: 0, bytes: 0, sfxId: 9 }];
    const share = scheduler.getUsageShare('next', 0);
    expect(share[0].priority).to.equal(1);
    expect(share[0].percentCount).to.equal(0);
    expect(share[0].percentBytes).to.equal(0);
  });

  it('defaults usage share priority when missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.getRateSnapshot = () => ({
      past: { count: 1, bytes: 3, bySfx: new Map([[7, { count: 1, bytes: 3 }]]) },
      next: { count: 0, bytes: 0, bySfx: new Map() }
    });
    const share = scheduler.getUsageShare('past', 0);
    expect(share[0].priority).to.equal(1);
  });

  it('estimateMessages returns zero when note is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const estimate = scheduler.estimateMessages({});
    expect(estimate.messages).to.equal(0);
  });

  it('sendNote handles undefined durations', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(output);
    scheduler.setTickMs(10);
    scheduler.sendNote({ note: 60, velocity: 64 });
    expect(scheduler._noteOffs.length).to.equal(0);
  });

  it('orders scheduled note offs by time', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._scheduleNoteOff({ timeMs: 1000, token: 1 });
    scheduler._scheduleNoteOff({ timeMs: 500, token: 2 });
    expect(scheduler._noteOffs[0].timeMs).to.equal(500);
  });

  it('processes note offs and clears mpe channel mappings', function() {
    const calls = [];
    const output = makeOutput([2], calls);
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => clock.now };
    try {
      const scheduler = new MidiScheduler({ mpe: { enabled: true } });
      scheduler.setOutput(output);
      scheduler._activeNotes.set(1, { note: 60, channel: 2, mpe: true, startedAt: 0 });
      scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 0 });
      scheduler._noteOffs.push({ timeMs: 0, channel: 2, note: 60, token: 1, mpe: true });
      scheduler._processNoteOffs();
      expect(scheduler._activeByChannel.size).to.equal(0);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });

  it('handles allNotesOff when output is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._noteOffs.push({ timeMs: 1, token: 1 });
    scheduler.allNotesOff();
    expect(scheduler._noteOffs.length).to.equal(1);
  });

  it('clears queues even when channels are absent', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 1 });
    scheduler.setOutput({ channels: {} });
    scheduler._activeByChannel.set(1, { note: 60, token: 1, startedAt: 0 });
    scheduler._noteOffs.push({ timeMs: 1, token: 1 });
    scheduler._noteOffTimerId = setTimeout(() => {}, 10);
    scheduler.allNotesOff();
    expect(scheduler._noteOffs.length).to.equal(0);
    expect(scheduler._activeByChannel.size).to.equal(0);
    expect(scheduler._noteOffTimerId).to.equal(0);
  });

  it('sends all-notes-off using MPE master defaults', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1 } });
    scheduler.setOutput(output);
    scheduler.allNotesOff();
    expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true);
  });

  it('falls back to the MPE master channel when unset', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 0, memberChannels: [] } });
    scheduler.setOutput(output);
    scheduler.allNotesOff();
    expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true);
  });

  it('setConfig handles null configs and triggers init with output', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(makeOutput([1], calls));
    let initCalls = 0;
    scheduler._initMpe = () => { initCalls += 1; };
    scheduler.setConfig(null);
    expect(initCalls).to.equal(1);
    expect(scheduler.config).to.eql({});
  });

  it('handles missing active channels in stop/steal logic', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._stopActiveChannel(1);

    scheduler.setOutput(makeOutput([1], []));
    scheduler._activeNotes = {
      size: 1,
      entries: () => [[1, { startedAt: Infinity }]]
    };
    scheduler._stealOldestNote();

    scheduler._activeNotes = {
      size: 1,
      entries: () => [[1, { startedAt: 0 }]],
      get: () => undefined
    };
    scheduler._stealOldestNote();
  });

  it('allocates channels across mpe and default paths', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 3 });
    expect(scheduler._allocateChannel()).to.equal(3);

    scheduler.setConfig({ mpe: { enabled: true, masterChannel: 9, memberChannels: [2] } });
    scheduler._memberChannels = [2];
    expect(scheduler._allocateChannel()).to.equal(2);

    scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 0 });
    let stopped = null;
    scheduler._stopActiveChannel = ch => { stopped = ch; };
    const ch = scheduler._allocateChannel();
    expect(ch).to.equal(2);
    expect(stopped).to.equal(2);
  });

  it('estimates messages with pitch bend and controllers', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const estimate = scheduler.estimateMessages({
      note: 60,
      pitchBend: 0.5,
      timbre: 10,
      pan: 5,
      durationTicks: 2
    });
    expect(estimate.messages).to.equal(5);
  });

  it('sends notes with pan conversion and rate logging', function() {
    const calls = [];
    const output = makeOutput([1, 2], calls);
    const scheduler = new MidiScheduler({
      mpe: { enabled: true, masterChannel: 1, memberChannels: [2], timbreCc: 74 },
      position: { panRange: { min: -127, max: 127 } }
    });
    scheduler.setOutput(output);
    scheduler._maxBytesPerSecond = 1;
    scheduler._rateSent = [{ timeMs: 1999, count: 1, bytes: 3 }];
    const originalConsole = console.error;
    const errors = [];
    console.error = msg => errors.push(msg);
    scheduler.sendNote({
      note: 60,
      velocity: 64,
      durationTicks: 1,
      pitchBend: 0,
      timbre: 30,
      pan: 20,
      timeMs: 2000
    }, { sfxId: 1 });
    console.error = originalConsole;
    expect(calls.some(call => call.type === 'noteOff')).to.equal(true);
  });

  it('sends notes without signed pan conversion when disabled', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({
      mpe: { enabled: false },
      position: { panRange: { min: 0, max: 127 } },
      defaultChannel: 1
    });
    scheduler.setOutput(output);
    scheduler._maxActiveNotes = 1;
    scheduler._activeNotes.set(1, { note: 60, channel: 1, startedAt: 0 });
    let stolen = false;
    scheduler._stealOldestNote = () => { stolen = true; };
    scheduler.sendNote({ note: 62, velocity: 64, durationTicks: 0, pan: 80, timeMs: 0 });
    expect(stolen).to.equal(true);
    expect(calls.some(call => call.type === 'cc')).to.equal(true);
  });

  it('arms timers and processes note offs with missing outputs', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerformance = globalThis.performance;
    globalThis.performance = undefined;
    try {
      scheduler._noteOffTimerId = setTimeout(() => {}, 10);
      scheduler._noteOffs.push({ timeMs: 0, token: 1 });
      scheduler._armNoteOffTimer();
      expect(scheduler._noteOffTimerId).to.not.equal(0);
      scheduler.output = null;
      scheduler._processNoteOffs();
      expect(scheduler._noteOffTimerId).to.equal(0);
    } finally {
      globalThis.performance = originalPerformance;
      clock.uninstall();
    }
  });

  it('allNotesOff handles mpe channel lists and dispose clears active channels', function() {
    const calls = [];
    const output = makeOutput([1, 2], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
    scheduler.setOutput(output);
    scheduler.allNotesOff();
    expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true);

    scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 0 });
    let stopped = false;
    scheduler._stopActiveChannel = () => { stopped = true; };
    scheduler.dispose();
    expect(stopped).to.equal(true);
  });

  it('setConfig skips init when no output is present', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    let initCalls = 0;
    scheduler._initMpe = () => { initCalls += 1; };
    scheduler.setConfig({ mpe: { enabled: true } });
    expect(initCalls).to.equal(0);
  });

  it('initMpe skips missing channels and defaults master channel', function() {
    const calls = [];
    const scheduler = new MidiScheduler({
      mpe: { enabled: true, memberChannels: [2], pitchBendRange: { semitones: 2, cents: 0 } }
    });
    scheduler.setOutput(makeOutput([1], calls));
    calls.length = 0;
    scheduler._initMpe();
    const bendRange = calls.filter(call => call.type === 'bendRange');
    expect(bendRange).to.have.length(1);
    expect(bendRange[0].id).to.equal(1);
  });

  it('nowMs prefers performance when available', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => 555 };
    try {
      expect(scheduler._nowMs()).to.equal(555);
    } finally {
      globalThis.performance = originalPerformance;
    }
  });

  it('stopActiveChannel exits when output is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true } });
    scheduler._activeByChannel.set(2, { note: 60, token: 1 });
    scheduler._activeNotes.set(1, { note: 60, channel: 2, mpe: true });
    scheduler.output = null;
    scheduler._stopActiveChannel(2);
    expect(scheduler._activeByChannel.has(2)).to.equal(true);
  });

  it('stealOldestNote exits when output is missing or no oldest token', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true } });
    scheduler._activeNotes.set(1, { note: 60, channel: 2, mpe: true, startedAt: 0 });
    scheduler.output = null;
    scheduler._stealOldestNote();
    expect(scheduler._activeNotes.size).to.equal(1);

    const calls = [];
    scheduler.output = makeOutput([2], calls);
    scheduler._activeNotes = new Map([[1, { note: 60, channel: 2, mpe: true, startedAt: NaN }]]);
    scheduler._stealOldestNote();
    expect(scheduler._activeNotes.size).to.equal(1);
  });

  it('stealOldestNote keeps channel map for non-mpe notes', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(makeOutput([1], calls));
    scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: false, startedAt: 0 });
    scheduler._activeByChannel.set(1, { note: 60, token: 1, startedAt: 0 });
    scheduler._stealOldestNote();
    expect(calls.some(call => call.type === 'pitchBend')).to.equal(false);
    expect(scheduler._activeByChannel.has(1)).to.equal(true);
  });

  it('allocateChannel falls back to the master channel', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 9, memberChannels: [] } });
    scheduler._memberChannels = [];
    expect(scheduler._allocateChannel()).to.equal(9);
  });

  it('allocates channel 1 when the MPE master is falsy', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 0, memberChannels: [] } });
    scheduler._memberChannels = [];
    expect(scheduler._allocateChannel()).to.equal(1);
  });

  it('allocates default channel 1 when unspecified', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    expect(scheduler._allocateChannel()).to.equal(1);
  });

  it('estimateMessages accounts for MPE mode', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true } });
    const estimate = scheduler.estimateMessages({ note: 60, pitchBend: 0.5, durationTicks: 0 });
    expect(estimate.messages).to.equal(2);
  });

  it('checkByteRate logs when over the throughput limit', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._maxBytesPerSecond = 1;
    scheduler._rateSent = [{ timeMs: 1999, count: 1, bytes: 3 }];
    const errors = [];
    const originalError = console.error;
    console.error = msg => errors.push(msg);
    try {
      scheduler._checkByteRate(2000);
    } finally {
      console.error = originalError;
    }
    expect(errors.length).to.equal(1);
  });

  it('sendNote records performance measurements when enabled', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 1 });
    scheduler.setOutput(makeOutput([1], calls));
    const originalPerf = globalThis.performance;
    const originalLemmings = globalThis.lemmings;
    let measures = 0;
    globalThis.performance = { now: () => 1, measure: () => { measures += 1; } };
    globalThis.lemmings = { performanceAPI: true };
    try {
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
      expect(measures).to.equal(1);
    } finally {
      globalThis.performance = originalPerf;
      globalThis.lemmings = originalLemmings;
    }
  });

  it('scheduleNoteOff appends entries already in order', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._noteOffs = [{ timeMs: 10 }, { timeMs: 20 }];
    scheduler._scheduleNoteOff({ timeMs: 30 });
    expect(scheduler._noteOffs.map(entry => entry.timeMs)).to.eql([10, 20, 30]);
  });

  it('armNoteOffTimer uses performance timing when available', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    try {
      scheduler._noteOffs = [{ timeMs: 5 }];
      scheduler._armNoteOffTimer();
      expect(scheduler._noteOffTimerId).to.not.equal(0);
    } finally {
      globalThis.performance = originalPerf;
      clock.uninstall();
    }
  });

  it('processNoteOffs uses Date.now and skips non-mpe cleanup', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.output = makeOutput([1], calls);
    const originalPerf = globalThis.performance;
    const originalDateNow = Date.now;
    globalThis.performance = undefined;
    Date.now = () => 0;
    try {
      scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: false, startedAt: 0 });
      scheduler._noteOffs = [{ timeMs: 0, channel: 1, note: 60, token: 1, mpe: false }];
      scheduler._processNoteOffs();
      expect(scheduler._activeNotes.size).to.equal(0);
    } finally {
      Date.now = originalDateNow;
      globalThis.performance = originalPerf;
    }
  });

  it('allNotesOff uses default channel when MPE is disabled', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 3 });
    scheduler.setOutput(makeOutput([3], calls));
    scheduler.allNotesOff();
    const allNotes = calls.filter(call => call.type === 'allNotesOff').map(call => call.id);
    expect(allNotes).to.eql([3]);
  });

  it('allNotesOff falls back to channel 1 when default is falsy', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 0 });
    scheduler.setOutput(makeOutput([1], calls));
    scheduler.allNotesOff();
    const allNotes = calls.filter(call => call.type === 'allNotesOff').map(call => call.id);
    expect(allNotes).to.eql([1]);
  });

  it('dispose stops active channels before clearing state', function() {        
    const scheduler = new MidiScheduler({ mpe: { enabled: true } });
    let stopped = 0;
    scheduler._stopActiveChannel = () => { stopped += 1; };
    scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 0 });    
    scheduler.dispose();
    expect(stopped).to.equal(1);
  });

  it('covers config fallbacks and early returns', function() {
    const scheduler = new MidiScheduler();
    scheduler.setConfig(undefined);
    expect(scheduler.config).to.eql({});

    scheduler._initMpe();
    scheduler.setConfig({ mpe: {} });
    expect(scheduler._memberChannels).to.eql([]);

    scheduler._stopActiveChannel(99);
    scheduler.output = makeOutput([1], []);
    scheduler._activeNotes.clear();
    scheduler._stealOldestNote();
  });

  it('covers oldest token and missing info branches', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(makeOutput([1], calls));
    scheduler._activeNotes = new Map([[1, { note: 60, channel: 1, mpe: false, startedAt: NaN }]]);
    scheduler._stealOldestNote();
    expect(scheduler._activeNotes.size).to.equal(1);

    scheduler._activeNotes = {
      size: 1,
      entries: () => [[1, { note: 60, channel: 1, mpe: true, startedAt: 0 }]],
      get: () => undefined
    };
    scheduler._stealOldestNote();
    expect(calls.length).to.equal(0);
  });

  it('covers perfEnabled permutations and pan handling', function() {
    const calls = [];
    const scheduler = new MidiScheduler({
      mpe: { enabled: false },
      defaultChannel: 1,
      position: { panRange: { min: 0, max: 127 } }
    });
    scheduler.setOutput(makeOutput([1], calls));
    const originalPerf = globalThis.performance;
    const originalLemmings = globalThis.lemmings;
    try {
      globalThis.lemmings = undefined;
      scheduler.sendNote({ note: 60, pan: 10, durationTicks: NaN });

      globalThis.lemmings = { perfMetrics: true };
      globalThis.performance = undefined;
      scheduler.sendNote({ note: 60, pan: 10, durationTicks: NaN });

      globalThis.lemmings = { performanceAPI: true };
      globalThis.performance = { now: () => 1 };
      scheduler.sendNote({ note: 60, pan: 10, durationTicks: NaN });

      globalThis.performance = { now: () => 1, measure: () => {} };
      scheduler.sendNote({ note: 60, pan: 10, durationTicks: NaN });

      let measures = 0;
      scheduler.setConfig({
        position: { panRange: { min: -127, max: 127 } },
        defaultChannel: 1,
        mpe: { enabled: false }
      });
      globalThis.performance = { now: () => 1, measure: () => { measures += 1; } };
      scheduler.sendNote({ note: 60, pan: -10, durationTicks: 1 });
      expect(measures).to.equal(1);
    } finally {
      globalThis.performance = originalPerf;
      globalThis.lemmings = originalLemmings;
    }
  });

  it('records last MIDI output message on window', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 1 });
    scheduler.setOutput(makeOutput([1], calls));
    const originalWindow = globalThis.window;
    globalThis.window = {};
    try {
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
      expect(globalThis.window.lastMidiOutputMessage.type).to.equal('noteOn');
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('covers additional scheduler branch paths', function() {
    const scheduler = new MidiScheduler(null);
    scheduler.setConfig(null);
    scheduler._initMpe();

    scheduler.setOutput({ channels: {} });
    scheduler.setConfig({ mpe: { enabled: true } });

    const calls = [];
    scheduler.setOutput(makeOutput([1], calls));
    scheduler.setConfig({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });

    scheduler._stealOldestNote();
    scheduler._stopActiveChannel(99);

    scheduler._rateSent = [{ timeMs: 0, count: 1, bytes: 3, sfxId: 1 }];
    const snapshot = scheduler.getRateSnapshot(1);
    expect(snapshot.past.bySfx.get(1).priority).to.equal(1);

    scheduler.setConfig({ mpe: { enabled: false } });
    const estimate = scheduler.estimateMessages({ note: 60, pitchBend: 0.5 });
    expect(estimate.messages).to.equal(2);

    scheduler._maxBytesPerSecond = 1000;
    const originalError = console.error;
    let errorCount = 0;
    console.error = () => { errorCount += 1; };
    try {
      scheduler._checkByteRate(0);
    } finally {
      console.error = originalError;
    }
    expect(errorCount).to.equal(0);

    const originalPerf = globalThis.performance;
    const originalLemmings = globalThis.lemmings;
    globalThis.performance = { now: () => 1, measure: () => {} };
    delete globalThis.lemmings;
    try {
      scheduler.sendNote({ note: 60, durationTicks: NaN, pan: 0 });
    } finally {
      globalThis.performance = originalPerf;
      globalThis.lemmings = originalLemmings;
    }

    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    globalThis.performance = { now: () => 0 };
    try {
      scheduler.output = makeOutput([1], []);
      scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: false, startedAt: 0 });
      scheduler._noteOffs = [{ timeMs: 0, token: 1, channel: 1, note: 60, mpe: false }];
      scheduler._armNoteOffTimer();
      scheduler._processNoteOffs();
    } finally {
      clock.uninstall();
      globalThis.performance = originalPerf;
    }

    const scheduler2 = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
    scheduler2.setOutput(makeOutput([1], []));
    scheduler2._noteOffTimerId = 1;
    scheduler2.allNotesOff();
  });

  it('uses Date.now in timers when performance is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const originalPerf = globalThis.performance;
    globalThis.performance = undefined;
    try {
      scheduler._noteOffs = [{ timeMs: 5, token: 1 }];
      scheduler._armNoteOffTimer();
      expect(scheduler._noteOffTimerId).to.not.equal(0);

      scheduler.output = makeOutput([1], []);
      scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: true, startedAt: 0 });
      scheduler._activeByChannel.set(1, { note: 60, token: 1, startedAt: 0 });
      scheduler._noteOffs = [{ timeMs: 0, channel: 1, note: 60, token: 1, mpe: true }];
      scheduler._processNoteOffs();
      expect(scheduler._activeByChannel.size).to.equal(0);
    } finally {
      globalThis.performance = originalPerf;
      clock.uninstall();
    }
  });

  it('clears mpe channels and timers when outputs are missing', function() {    
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
    scheduler.setOutput(makeOutput([1], calls));
    scheduler._noteOffTimerId = setTimeout(() => {}, 10);
    scheduler._noteOffs.push({ timeMs: 1, token: 1 });
    scheduler.allNotesOff();
    expect(scheduler._noteOffTimerId).to.equal(0);
    expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true);     
  });

  it('covers allocation fallbacks and rate helpers', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 9 });
    expect(scheduler._allocateChannel()).to.equal(9);

    scheduler.setConfig({ mpe: { enabled: true, masterChannel: 7, memberChannels: [] } });
    scheduler._memberChannels = [];
    expect(scheduler._allocateChannel()).to.equal(7);

    scheduler._rateSent = [
      { timeMs: 0, count: 1, bytes: 3, sfxId: 1 },
      { timeMs: 0, count: 2, bytes: 6, sfxId: 1 }
    ];
    const snapshot = scheduler.getRateSnapshot(1);
    expect(snapshot.past.bySfx.get(1).count).to.equal(3);

    const estimate = scheduler.estimateMessages({ note: 60, pitchBend: 0.5 });
    expect(estimate.messages).to.equal(2);
  });

  it('covers stopActiveChannel and cleanup branches', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
    scheduler.setOutput(makeOutput([1, 2], calls));
    scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 0 });
    scheduler._activeNotes.set(1, { note: 60, channel: 2, mpe: true, startedAt: 0 });
    scheduler._stopActiveChannel(2);
    expect(calls.some(call => call.type === 'noteOff')).to.equal(true);

    scheduler._activeNotes.set(2, { note: 61, channel: 2, mpe: true, startedAt: 0 });
    scheduler._stealOldestNote();

    scheduler.output = null;
    scheduler._stopActiveChannel(99);
    scheduler._stealOldestNote();

    scheduler.output = { channels: {} };
    scheduler._noteOffTimerId = 1;
    scheduler.allNotesOff();
    expect(scheduler._noteOffTimerId).to.equal(0);

    scheduler._activeByChannel.set(1, { note: 60, token: 1, startedAt: 0 });
    scheduler.dispose();
  });
});
