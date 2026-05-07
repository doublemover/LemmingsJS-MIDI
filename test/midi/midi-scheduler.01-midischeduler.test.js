import { expect } from 'chai';
import { withConsoleStub } from '../helpers/console.js';
import { withGlobalLemmings } from '../helpers/lemmings.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

describe('MidiScheduler 1', function() {
  it('schedules note offs and converts signed pan', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    withFakeClockAndPerformance((clock) => {
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
    });
  });

  it('routes notes and panic to registered track outputs', function() {
    const projectCalls = [];
    const trackCalls = [];
    const projectOutput = makeOutput([1], projectCalls, 'project-out');
    const trackOutput = makeOutput([1], trackCalls, 'track-out');
    withFakeClockAndPerformance((clock) => {
      const scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(projectOutput);
      scheduler.setOutputs([projectOutput, trackOutput]);
      scheduler.setTickMs(10);

      const ok = scheduler.sendNote({
        note: 60,
        velocity: 64,
        durationTicks: 2,
        outputId: 'track-out'
      });

      expect(ok).to.equal(true);
      expect(projectCalls.some(call => call.type === 'noteOn')).to.equal(false);
      expect(trackCalls.some(call => call.type === 'noteOn' && call.note === 60)).to.equal(true);
      expect(trackCalls.some(call => call.type === 'noteOff' && call.note === 60)).to.equal(true);

      clock.tick(25);
      expect(scheduler._activeNotes.size).to.equal(0);

      projectCalls.length = 0;
      trackCalls.length = 0;
      expect(scheduler.sendNote({ note: 62, durationTicks: 0, outputId: 'missing-out' })).to.equal(false);
      expect(projectCalls.length).to.equal(0);
      expect(trackCalls.length).to.equal(0);

      scheduler.sendNote({ note: 64, durationTicks: 0 });
      scheduler.sendNote({ note: 65, durationTicks: 0, outputId: 'track-out' });
      scheduler.allNotesOff();
      expect(projectCalls.some(call => call.type === 'allNotesOff')).to.equal(true);
      expect(trackCalls.some(call => call.type === 'allNotesOff')).to.equal(true);
    });
  });

  it('preserves routing metadata on unreserved planned sends', function() {
    const calls = [];
    const output = makeOutput([1], calls, 'out-1');
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(output);
    scheduler.setOutputs([output]);
    scheduler.setTickMs(10);
    const sendTimeMs = scheduler._nowMs() + 1000;

    const ok = scheduler.sendNote(
      {
        note: 60,
        velocity: 64,
        durationTicks: 2,
        timeMs: sendTimeMs,
        trackId: 'lead',
        outputId: 'out-1',
        voiceBudget: 4
      },
      {
        sfxId: 3,
        priority: 2,
        triggerType: 'skill'
      }
    );

    expect(ok).to.equal(true);
    expect(scheduler._ratePlanned).to.have.lengthOf(2);
    for (const entry of scheduler._ratePlanned) {
      expect(entry).to.include({
        sfxId: 3,
        priority: 2,
        triggerType: 'skill',
        trackId: 'lead',
        outputId: 'out-1',
        voiceBudget: 4
      });
    }
    expect(scheduler._ratePlanned.map(entry => entry.phase)).to.deep.equal(['on', 'off']);
  });

  it('swaps attack and release velocity when reversing', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(output);
    scheduler.setTickMs(10);

    const ok = scheduler.sendNote({
      note: 60,
      velocity: 80,
      releaseVelocity: 20,
      durationTicks: 1,
      reverse: true
    });

    expect(ok).to.equal(true);
    const noteOn = calls.find(c => c.type === 'noteOn');
    const noteOff = calls.find(c => c.type === 'noteOff');
    expect(noteOn.opts.rawAttack).to.equal(20);
    expect(noteOff.opts.rawRelease).to.equal(80);
  });

  it('steals the oldest note when active count is exceeded', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    withFakeClockAndPerformance((clock) => {
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
    });
  });

  it('steals the oldest note on a track when its voice budget is exceeded', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    withFakeClockAndPerformance((clock) => {
      const scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output);

      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0, trackId: 'lead', voiceBudget: 1 });
      clock.tick(1);
      scheduler.sendNote({ note: 62, velocity: 64, durationTicks: 0, trackId: 'pad', voiceBudget: 1 });
      clock.tick(1);
      scheduler.sendNote({ note: 64, velocity: 64, durationTicks: 0, trackId: 'lead', voiceBudget: 1 });

      const noteOffs = calls.filter(c => c.type === 'noteOff').map(c => c.note);
      expect(noteOffs).to.deep.equal([60]);
      expect([...scheduler._activeNotes.values()].map(info => info.note).sort()).to.deep.equal([62, 64]);
      expect(scheduler._countActiveNotesForTrack('lead')).to.equal(1);
      expect(scheduler._countActiveNotesForTrack('pad')).to.equal(1);
    });
  });

  it('initializes MPE channels and reuses the oldest member', function() {
    const calls = [];
    const output = makeOutput([1, 2, 3], calls);
    withFakeClockAndPerformance((clock) => {
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
    });
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
    scheduler._noteOffTimerId = setTimeout(() => {}, 10);
    scheduler.allNotesOff();

    const allNotes = calls.filter(c => c.type === 'allNotesOff').map(c => c.id).sort();
    expect(allNotes).to.eql([1, 2, 3]);
    expect(scheduler._activeNotes.size).to.equal(0);
    expect(scheduler._activeByChannel.size).to.equal(0);
    expect(scheduler._noteOffTimerId).to.equal(0);
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

  it('normalizes invalid limit values and channel configuration', function() {
    const scheduler = new MidiScheduler({
      limits: {
        maxActiveNotes: 'bad',
        maxEventsPerSecond: Number.NaN,
        maxBytesPerSecond: -1
      },
      defaultChannel: 0,
      mpe: {
        enabled: true,
        masterChannel: 20,
        memberChannels: [2, 2, 0, 17, 'x']
      }
    });

    expect(scheduler._maxActiveNotes).to.equal(32);
    expect(scheduler._maxMessagesPerSecond).to.equal(1000);
    expect(scheduler._maxBytesPerSecond).to.equal(3906.25);
    expect(scheduler._allocateChannel()).to.equal(2);
  });

  it('stops active channels and clears scheduled note offs', function() {
    const calls = [];
    const output = makeOutput([1, 2], calls);
    withFakeClockAndPerformance((clock) => {
      const scheduler = new MidiScheduler({
        mpe: { enabled: true, memberChannels: [2] }
      });
      scheduler.setOutput(output);
      scheduler.setTickMs(10);
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 2 });
      expect(scheduler._noteOffs.length).to.be.greaterThan(0);
      scheduler._stopActiveChannel(2);
      expect(scheduler._noteOffs.length).to.equal(0);
    });
  });

  it('processes note offs safely without output', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._noteOffs.push({ timeMs: 0, channel: 1, note: 60, token: 1, mpe: false });
    scheduler.output = null;
    scheduler._processNoteOffs();
    expect(scheduler._noteOffs.length).to.equal(1);
  });

  it('keeps note off entries sorted by time', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    let armed = 0;
    scheduler._armNoteOffTimer = () => { armed += 1; };
    scheduler._noteOffs = [{ timeMs: 20 }, { timeMs: 40 }];
    scheduler._scheduleNoteOff({ timeMs: 10 });
    expect(scheduler._noteOffs.map(entry => entry.timeMs)).to.eql([10, 20, 40]);
    expect(armed).to.equal(1);
  });

  it('clears active MPE channels when processing note offs', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: true } });
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    try {
      scheduler.output = { channels: {} };
      scheduler._activeNotes.set('a', { note: 60, channel: 2, mpe: true });
      scheduler._activeByChannel.set(2, { note: 60, token: 'a', mpe: true });
      scheduler._noteOffs = [{ timeMs: 0, channel: 2, note: 60, token: 'a', mpe: true }];
      scheduler._processNoteOffs();
      expect(scheduler._activeByChannel.size).to.equal(0);
      expect(scheduler._activeNotes.size).to.equal(0);
    } finally {
      globalThis.performance = originalPerf;
    }
  });

  it('drops the oldest MPE note and clears channel state', function() {
    const calls = [];
    const output = makeOutput([2], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, memberChannels: [2] } });
    scheduler.setOutput(output);

    scheduler._activeNotes.set('token', { note: 60, channel: 2, mpe: true, startedAt: 0 });
    scheduler._activeByChannel.set(2, { note: 60, token: 'token', mpe: true, startedAt: 0 });

    scheduler._stealOldestNote();

    expect(scheduler._activeNotes.size).to.equal(0);
    expect(scheduler._activeByChannel.size).to.equal(0);
    expect(calls.some(c => c.type === 'noteOff')).to.equal(true);
  });

  it('reinitializes MPE when config changes with output attached', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1 } });
    let initCalls = 0;
    scheduler._initMpe = () => { initCalls += 1; };
    scheduler.setOutput(output);
    scheduler.setConfig(null);
    scheduler.setConfig({});
    expect(initCalls).to.be.greaterThan(0);
  });

  it('falls back to Date.now when performance is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const original = globalThis.performance;
    delete globalThis.performance;
    try {
      const now = scheduler._nowMs();
      expect(now).to.be.a('number');
    } finally {
      globalThis.performance = original;
    }
  });

  it('skips init when output is missing and ignores missing channels', function() {
    const calls = [];
    const scheduler = new MidiScheduler({
      mpe: { enabled: true, masterChannel: 1, memberChannels: [2] }
    });
    scheduler._initMpe();
    scheduler.setOutput(makeOutput([1], calls));
    const bendRangeCalls = calls.filter(c => c.type === 'bendRange');
    expect(bendRangeCalls.length).to.equal(1);
  });

  it('skips stopping channels when output is missing', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._activeByChannel.set(1, { note: 60, token: 1 });
    scheduler._stopActiveChannel(1);
    expect(scheduler._activeByChannel.size).to.equal(1);
  });

  it('skips stealing when oldest token is invalid', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(makeOutput([1], calls));
    scheduler._activeNotes.set('token', { note: 60, channel: 1, mpe: false, startedAt: NaN });
    scheduler._stealOldestNote();
    expect(scheduler._activeNotes.size).to.equal(1);
  });

  it('returns null when active note info is missing', function() {
    const calls = [];
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(makeOutput([1], calls));
    const map = new Map([['token', { note: 60, channel: 1, mpe: false, startedAt: 0 }]]);
    map.get = () => null;
    scheduler._activeNotes = map;
    scheduler._stealOldestNote();
    expect(scheduler._activeNotes.size).to.equal(1);
  });

  it('allocates MPE channels and falls back to master', function() {
    const calls = [];
    const output = makeOutput([1, 2, 3], calls);
    const scheduler = new MidiScheduler({
      mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3] }
    });
    scheduler.setOutput(output);
    scheduler._activeByChannel.set(2, { note: 60, token: 1, startedAt: 5 });
    const free = scheduler._allocateChannel();
    expect(free).to.equal(3);

    scheduler._activeByChannel.set(3, { note: 62, token: 2, startedAt: 10 });
    scheduler._activeNotes.set(1, { note: 60, channel: 2, mpe: true, startedAt: 5 });
    scheduler._activeNotes.set(2, { note: 62, channel: 3, mpe: true, startedAt: 10 });
    const reused = scheduler._allocateChannel();
    expect(reused).to.equal(2);

    const masterOnly = new MidiScheduler({ mpe: { enabled: true, masterChannel: 9 } });
    expect(masterOnly._allocateChannel()).to.equal(9);
  });

  it('aggregates rate entries by sfx id', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler._rateSent = [
      { timeMs: -1, count: 1, bytes: 3, sfxId: 1 },
      { timeMs: -1, count: 2, bytes: 6, sfxId: 1 }
    ];
    const snapshot = scheduler.getRateSnapshot(0);
    expect(snapshot.past.bySfx.get(1).count).to.equal(3);
  });

  it('compacts stale rate entries in place and removes planned phases', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const keptSent = { timeMs: 900, count: 2, bytes: 6, sfxId: 1 };
    const future = { timeMs: 1200, count: 1, bytes: 3, token: 7, phase: 'off' };
    scheduler._rateSent = [
      { timeMs: -5000, count: 1, bytes: 3 },
      keptSent
    ];
    scheduler._ratePlanned = [
      { timeMs: 800, count: 1, bytes: 3, token: 7, phase: 'on' },
      future
    ];

    scheduler._pruneRateEntries(1000);

    expect(scheduler._rateSent).to.include(keptSent);
    expect(scheduler._rateSent.some(entry => entry.timeMs === 800)).to.equal(true);
    expect(scheduler._ratePlanned).to.deep.equal([future]);

    scheduler._removePlannedRateEntries(7, 'off');
    expect(scheduler._ratePlanned).to.have.lengthOf(0);
  });

  it('estimateMessages accounts for pitch bend without MPE', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    const estimate = scheduler.estimateMessages({ note: 60, pitchBend: 0.5 });
    expect(estimate.messages).to.equal(2);
  });

  it('checkByteRate ignores safe usage', function() {
    const scheduler = new MidiScheduler({ limits: { maxBytesPerSecond: 1000 } });
    scheduler.getRateSnapshot = () => ({ past: { bytes: 1 }, next: { bytes: 1 } });
    const logs = [];
    const restoreConsole = withConsoleStub({ error: msg => logs.push(msg) });
    scheduler._checkByteRate(0);
    restoreConsole();
    expect(logs.length).to.equal(0);
  });

  it('sends pitch bend reset when MPE is enabled', function() {
    const calls = [];
    const output = makeOutput([2], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: true, memberChannels: [2] } });
    scheduler.setOutput(output);
    const ok = scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 0, pitchBend: 0 });
    expect(ok).to.equal(true);
    expect(calls.some(c => c.type === 'pitchBend' && c.value === 0)).to.equal(true);
  });

  it('allocates a default channel when MPE is disabled', function() {
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 5 });
    expect(scheduler._allocateChannel()).to.equal(5);
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

  it('dispose stops active channels', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(output);
    scheduler._activeByChannel.set(1, { note: 60, token: 1, mpe: false });
    scheduler._activeNotes.set(1, { note: 60, channel: 1, mpe: false });

    scheduler.dispose();

    expect(calls.some(c => c.type === 'noteOff' && c.id === 1 && c.note === 60)).to.equal(true);
  });

  it('tracks rate snapshots and clears queued events', function() {
    const calls = [];
    const output = makeOutput([1], calls);
    withFakeClockAndPerformance((clock) => {
      const scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output);
      scheduler.setTickMs(10);
      scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 1, timeMs: 500 });
      scheduler._activeByChannel.set(1, { note: 60, token: 'token', mpe: false });
      scheduler._activeNotes.set('token', { note: 60, channel: 1, mpe: false });
      const snapshot = scheduler.getRateSnapshot(0);
      expect(snapshot.next.count).to.be.greaterThan(0);
      scheduler.clearQueue();
      expect(scheduler._ratePlanned.length).to.equal(0);
      expect(scheduler._activeByChannel.size).to.equal(0);
      expect(scheduler._activeNotes.size).to.equal(0);
    }, { performanceValue: (clock) => ({ now: () => clock.now, measure: () => {} }) });
  });
});
