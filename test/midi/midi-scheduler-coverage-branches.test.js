import { expect } from 'chai';
import { withConsoleStub } from '../helpers/console.js';
import { withGlobalLemmings, withMissingGlobalLemmings } from '../helpers/lemmings.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withPatchedGlobals } from '../support/globals.js';
import { withFakeClock, withFakeClockAndPerformance } from '../support/timers.js';

describe('MidiScheduler coverage: branch paths and fallbacks', function() {
  it('sendNote records performance measurements when enabled', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 1 });
    scheduler.setOutput(makeOutput([1], calls));
    const originalPerf = globalThis.performance;
    let measures = 0;
    globalThis.performance = { now: () => 1, measure: () => { measures += 1; } };
    try {
      withGlobalLemmings({ performanceAPI: true }, () => {
        scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
        expect(measures).to.equal(1);
      });
    } finally {
      globalThis.performance = originalPerf;
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
    withFakeClockAndPerformance(() => {
      scheduler._noteOffs = [{ timeMs: 5 }];
      scheduler._armNoteOffTimer();
      expect(scheduler._noteOffTimerId).to.not.equal(0);
    }, { performanceValue: { now: () => 0 } });
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
    try {
      withMissingGlobalLemmings(() => {
        scheduler.sendNote({ note: 60, pan: 10, durationTicks: NaN });
      });

      withGlobalLemmings({ perfMetrics: true }, () => {
        globalThis.performance = undefined;
        scheduler.sendNote({ note: 60, pan: 10, durationTicks: NaN });
      });

      withGlobalLemmings({ performanceAPI: true }, () => {
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
      });
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('records last MIDI output message on window', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 1 });
    scheduler.setOutput(makeOutput([1], calls));
    withPatchedGlobals({ window: {} }, () => {
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0 });
      expect(globalThis.window.lastMidiOutputMessage.type).to.equal('noteOn');
    });
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
    let errorCount = 0;
    const restoreConsole = withConsoleStub({ error: () => { errorCount += 1; } });
    try {
      scheduler._checkByteRate(0);
    } finally {
      restoreConsole();
    }
    expect(errorCount).to.equal(0);

    withPatchedGlobals({ performance: { now: () => 1, measure: () => {} } }, () => {
      withMissingGlobalLemmings(() => {
        scheduler.sendNote({ note: 60, durationTicks: NaN, pan: 0 });
      });
    });

    withFakeClockAndPerformance(() => {
      scheduler.output = makeOutput([1], []);
      scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: false, startedAt: 0 });
      scheduler._noteOffs = [{ timeMs: 0, token: 1, channel: 1, note: 60, mpe: false }];
      scheduler._armNoteOffTimer();
      scheduler._processNoteOffs();
    }, { performanceValue: { now: () => 0 } });

    const scheduler2 = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
    scheduler2.setOutput(makeOutput([1], []));
    scheduler2._noteOffTimerId = 1;
    scheduler2.allNotesOff();
  });

  it('uses Date.now in timers when performance is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    withFakeClock(() => {
      withPatchedGlobals({ performance: undefined }, () => {
        scheduler._noteOffs = [{ timeMs: 5, token: 1 }];
        scheduler._armNoteOffTimer();
        expect(scheduler._noteOffTimerId).to.not.equal(0);

        scheduler.output = makeOutput([1], []);
        scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: true, startedAt: 0 });
        scheduler._activeByChannel.set(1, { note: 60, token: 1, startedAt: 0 });
        scheduler._noteOffs = [{ timeMs: 0, channel: 1, note: 60, token: 1, mpe: true }];
        scheduler._processNoteOffs();
        expect(scheduler._activeByChannel.size).to.equal(0);
      });
    });
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
