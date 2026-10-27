import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const configuration = enabled => ({ enabled: true, mpe: { enabled, masterChannel: 1, memberChannels: [2], pitchBendRange: { semitones: 48, cents: 0 } } });
const transport = () => ({ panics: 0, pauses: 0, panic() { this.panics++; }, pause() { this.pauses++; },
  setClockOutput(port) { this.clockOutput = port; }, getState: () => ({ beat: 0, bpm: 120 }) });

const byteOutput = (id, accepted) => {
  const output = { id, send(data, options) { accepted.push([...data]); return true; }, channels: {} };
  for (const channel of [1, 2]) {
    const status = channel - 1;
    output.channels[channel] = {
      sendNoteOn(note, options = {}) { output.send([0x90 | status, note, options.rawAttack ?? 64], options); },
      sendNoteOff(note, options = {}) { output.send([0x80 | status, note, options.rawRelease ?? 64], options); },
      sendControlChange(cc, value, options = {}) { output.send([0xb0 | status, cc, value], options); },
      sendPitchBend(value, options = {}) {
        const bend = Math.round((value + 1) * 16383 / 2); output.send([0xe0 | status, bend & 127, bend >> 7], options);
      },
      sendPitchBendRange(semitones, cents = 0) {
        for (const [cc, value] of [[101, 0], [100, 0], [6, semitones], [38, cents], [101, 127], [100, 127]]) output.send([0xb0 | status, cc, value], {});
      }
    };
  }
  return output;
};

describe('activated MIDI output leases', function() {
  for (const enabled of [false, true]) it(`keeps enumeration and an unused unplug inert (MPE ${enabled})`, function() {
    withFakeClockAndPerformance(clock => {
      const aCalls = [], bCalls = [], a = makeOutput([1, 2], aCalls, 'a'), b = makeOutput([1, 2], bCalls, 'b');
      a.name = b.name = 'Identical instrument name';
      const scheduler = new MidiScheduler(configuration(enabled)), t = transport();
      const ports = createProcgenMidiPorts({ scheduler, transport: t, now: () => clock.now });
      ports.setNoteOutputs([a, b]);
      expect(aCalls).to.deep.equal([]); expect(bCalls).to.deep.equal([]);
      ports.setNoteOutput(a); ports.sendNote({ note: 60, pitchBend: enabled ? 0.2 : undefined, durationTicks: 0 });
      const aCount = aCalls.length;
      b.state = 'disconnected'; expect(ports.checkConnections()).to.equal(true);
      expect(aCalls).to.have.length(aCount); expect(bCalls).to.deep.equal([]); expect(t.panics).to.equal(0);
      expect(ports.getState().activeNoteOutputIds).to.deep.equal(['a']);
      ports.flush(); expect(bCalls).to.deep.equal([]);
      expect(aCalls.some(call => call.type === 'noteOff' && call.note === 60)).to.equal(true);
      ports.dispose(); scheduler.dispose(); expect(bCalls).to.deep.equal([]);
    });
  });

  it('retires a lost participating route, keeps independent notes sounding and requires explicit reconnect rearm', function() {
    withFakeClockAndPerformance(clock => {
      const aCalls = [], oldCalls = [], newCalls = [], a = makeOutput([1], aCalls, 'a');
      const old = makeOutput([1], oldCalls, 'b'), replacement = makeOutput([1], newCalls, 'b');
      const scheduler = new MidiScheduler(configuration(false)), t = transport();
      const ports = createProcgenMidiPorts({ scheduler, transport: t, now: () => clock.now });
      ports.setNoteOutputs([a, old]); ports.setNoteOutput(a);
      ports.setActiveNoteOutputs([{ outputId: 'b', laneIndex: 9 }]);
      ports.sendNote({ note: 60, durationTicks: 0 }); ports.sendNote({ note: 64, outputId: 'b', durationTicks: 0 });
      const epoch = ports.getState().outputRoutes.find(route => route.outputId === 'b').connectionEpoch;
      old.state = 'disconnected'; expect(ports.checkConnections()).to.equal(false);
      expect(aCalls.filter(call => call.type === 'noteOff')).to.deep.equal([]);
      expect(t.panics).to.equal(0); expect(t.pauses).to.equal(0);
      expect(ports.getState().lastRouteLoss).to.include({ outputId: 'b', reason: 'port-disconnected' });
      expect(ports.getState().lastRouteLoss.affectedLanes).to.deep.equal([9]);
      ports.setNoteOutputs([a, replacement]);
      expect(ports.sendNote({ note: 65, outputId: 'b', durationTicks: 0 })).to.equal(false);
      expect(newCalls).to.deep.equal([]);
      expect(ports.setActiveNoteOutputs([{ outputId: 'b', laneIndex: 9 }])).to.equal(false);
      ports.setActiveNoteOutputs([{ outputId: 'b', laneIndex: 9 }], { rearm: true });
      expect(ports.getState().outputRoutes.find(route => route.outputId === 'b').connectionEpoch).to.be.greaterThan(epoch);
      expect(ports.sendNote({ note: 67, outputId: 'b', durationTicks: 0 })).to.equal(true);
      expect(newCalls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([67]);
      expect([...scheduler._activeNotes.values()].map(voice => voice.note)).to.deep.equal([60, 67]);
      ports.dispose(); scheduler.dispose();
    });
  });

  it('keeps a separate clock destination outside note setup and reports rejected MPE activation', function() {
    withFakeClockAndPerformance(clock => {
      const aCalls = [], bCalls = [], a = makeOutput([1, 2], aCalls, 'a'), b = makeOutput([1, 2], bCalls, 'b');
      b.channels[2].sendPitchBendRange = () => false;
      const scheduler = new MidiScheduler(configuration(true)), t = transport();
      const ports = createProcgenMidiPorts({ scheduler, transport: t, now: () => clock.now });
      ports.setNoteOutputs([a, b]); ports.setClockOutput(b); ports.setNoteOutput(a);
      expect(t.clockOutput).to.equal(b); expect(bCalls).to.deep.equal([]);
      ports.setActiveNoteOutputs(['b']);
      const aCount = aCalls.length;
      expect(ports.sendNote({ note: 65, outputId: 'b', durationTicks: 0 })).to.equal(false);
      expect(ports.getState().outputRoutes.find(route => route.outputId === 'b').mpeReady).to.equal(false);
      expect(aCalls).to.have.length(aCount);
      ports.dispose(); scheduler.dispose();
    });
  });

  it('releases only an owned gate on a shared channel and leaves the second sender intact', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls, 'shared'), sounding = new Set([67]);
      output.channels[1].sendNoteOn = note => { calls.push({ type: 'on', note }); sounding.add(note); };
      output.channels[1].sendNoteOff = note => { calls.push({ type: 'off', note }); sounding.delete(note); };
      output.clear = () => { throw new Error('No submitted future queue belongs to this scheduler'); };
      const scheduler = new MidiScheduler(configuration(false)); scheduler.setOutput(output);
      scheduler.sendNote({ note: 60, durationTicks: 0 }); scheduler.allNotesOff();
      expect([...sounding]).to.deep.equal([67]); expect(calls.map(call => call.type)).to.deep.equal(['on', 'off']);
      expect(scheduler.lastCleanup).to.include({ releaseSubmitted: 1, uncertain: 0, queuedRemoved: 0 });
      scheduler.allNotesOff(); expect(calls.map(call => call.type)).to.deep.equal(['on', 'off']); scheduler.dispose();
    });
  });

  it('removes only application queued notes and permits whole-device cleanup as an explicit operation', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([1, 2], calls, 'shared'), scheduler = new MidiScheduler(configuration(false));
      scheduler.setOutput(output); scheduler.sendNote({ note: 60, timeMs: 1000, durationTicks: 0 });
      scheduler.allNotesOff(); expect(calls).to.deep.equal([]); expect(scheduler.lastCleanup.queuedRemoved).to.equal(1);
      clock.tick(1001); expect(calls).to.deep.equal([]);
      scheduler.allNotesOff({ wholeDevice: true });
      expect(calls.filter(call => call.type === 'allNotesOff').map(call => call.id)).to.deep.equal([1, 2]); scheduler.dispose();
    });
  });

  it('qualifies raw queue cancellation and orders uncertain cleanup after an irrevocable onset', function() {
    for (const canClear of [false, true]) withFakeClockAndPerformance(clock => {
      const calls = [], output = { id: 'raw', send(data, timestamp) { calls.push({ data, timestamp }); } };
      if (canClear) output.clear = () => true;
      const ports = createProcgenMidiPorts({ transport: transport(), now: () => clock.now }); ports.setNoteOutput(output);
      ports.sendNote({ note: 60, timeMs: 1000, durationTicks: 0 }); ports.flush();
      if (canClear) {
        expect(calls).to.have.length(1); expect(ports.getState().lastCleanup).to.include({ queuedRemoved: 1, uncertain: 0 });
      } else {
        expect(calls.at(-1)).to.deep.equal({ data: [0x80, 60, 0], timestamp: 1001 });
        expect(ports.getState().lastCleanup).to.include({ uncertain: 1, effectiveBoundary: 1001 });
      }
      ports.dispose();
    });
  });

  it('captures route epochs after allocation and resends an unchanged value after its controller binding changes', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1, 2], calls, 'mpe'), config = configuration(true);
      const scheduler = new MidiScheduler(config), ports = createProcgenMidiPorts({ scheduler, transport: transport(), now: () => 0 });
      ports.setNoteOutput(output); ports.configure({ recording: true });
      ports.sendNote({ note: 60, timbre: 99, durationTicks: 0 });
      scheduler.setConfig({ ...config, mpe: { ...config.mpe, timbreCc: 71 } });
      ports.sendNote({ note: 64, timbre: 99, durationTicks: 0 });
      expect(calls.filter(call => call.type === 'cc').map(call => call.cc)).to.deep.equal([74, 71]);
      const onset = ports.getRecording().find(event => event.data[0] === 0x91);
      expect(onset).to.include({ channel: 2, outputId: 'mpe' }); expect(onset.connectionEpoch).to.be.a('number'); expect(onset.routeRevision).to.be.a('number');
      ports.dispose(); scheduler.dispose();
    });
  });

  it('does not invent a release after an explicit onset rejection and continues after a failed cleanup', function() {
    withFakeClockAndPerformance(() => {
      const aCalls = [], bCalls = [], a = makeOutput([1], aCalls, 'a'), b = makeOutput([1], bCalls, 'b');
      const scheduler = new MidiScheduler(configuration(false)); scheduler.setOutputs([a, b]);
      a.channels[1].sendNoteOn = () => false;
      expect(scheduler.sendNote({ note: 60, outputId: 'a', durationTicks: 1 })).to.equal(false);
      expect(aCalls.filter(call => call.type === 'noteOff')).to.deep.equal([]);
      a.channels[1].sendNoteOn = () => true;
      scheduler.sendNote({ note: 60, outputId: 'a', durationTicks: 0 }); scheduler.sendNote({ note: 64, outputId: 'b', durationTicks: 0 });
      a.channels[1].sendNoteOff = () => { throw new Error('Disconnected'); };
      expect(() => scheduler.allNotesOff()).not.to.throw();
      expect(bCalls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([64]);
      expect(scheduler.lastCleanup).to.include({ releaseSubmitted: 1, uncertain: 1 }); scheduler.dispose();
    });
  });

  it('captures the adapter byte boundary including expanded RPN, rounded bend and default release velocity', function() {
    withFakeClockAndPerformance(() => {
      const accepted = [], output = byteOutput('bytes', accepted), original = output.send;
      const scheduler = new MidiScheduler(configuration(true)), ports = createProcgenMidiPorts({ scheduler, transport: transport(), now: () => 0 });
      ports.configure({ recording: true }); ports.setNoteOutput(output);
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 14, bytes: 42 });
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      ports.sendNote({ note: 60, velocity: 90, pitchBend: 0.5, durationTicks: 0 }); ports.flush();
      expect(accepted.some(data => data[0] === 0xe1 && data[1] === 127 && data[2] === 95)).to.equal(true);
      expect(accepted.some(data => data[0] === 0x81 && data[2] === 64)).to.equal(true);
      expect(ports.getRecording().map(event => event.data)).to.deep.equal(accepted);
      expect(ports.getRecording().every(event => event.encodingEvidence === 'adapter-byte-boundary')).to.equal(true);
      expect(output.send).to.equal(original);
      ports.dispose(); scheduler.dispose();
    });
  });

  it('retains an expanded setup prefix after a throw or false return, then supports explicit rearm', function() {
    for (const failure of ['throw', 'false']) withFakeClockAndPerformance(() => {
      const accepted = [], output = byteOutput('partial', accepted), send = output.send;
      output.send = function(data, options) {
        if (data[1] === 6) { if (failure === 'throw') throw new Error('range rejected'); return false; }
        return send.call(this, data, options);
      };
      const scheduler = new MidiScheduler(configuration(true)), ports = createProcgenMidiPorts({ scheduler, transport: transport(), now: () => 0 });
      ports.configure({ recording: true }); ports.setNoteOutput(output);
      expect(ports.sendNote({ note: 60, durationTicks: 0 })).to.equal(false);
      expect(accepted).to.deep.equal([[0xb0, 101, 0], [0xb0, 100, 0]]);
      expect(ports.getRecording().map(event => event.data)).to.deep.equal(accepted);
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 2, bytes: 6 });
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      const epoch = scheduler.getOutputRouteState('partial').connectionEpoch;
      output.send = send; ports.setNoteOutput(output, { rearm: true });
      expect(scheduler.getOutputRouteState('partial').connectionEpoch).to.be.greaterThan(epoch);
      expect(ports.sendNote({ note: 64, durationTicks: 0 })).to.equal(true);
      expect(scheduler.lastOutputError).to.equal(null);
      ports.dispose(); scheduler.dispose();
    });
  });

  it('admits a complete bank/program transaction before sending, and reselects a program after bank changes', function() {
    withFakeClockAndPerformance(() => {
      const accepted = [], output = byteOutput('bank', accepted), config = configuration(false);
      output.channels[1].sendProgramChange = (program, options) => output.send([0xc0, program], options);
      const scheduler = new MidiScheduler({ ...config, limits: { maxEventsPerSecond: 2 } }); scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, bankMsb: 1, bankLsb: 2, program: 3, durationTicks: 0 })).to.equal(false);
      expect(accepted).to.deep.equal([]);
      scheduler.setConfig(config);
      expect(scheduler.sendNote({ note: 60, bankMsb: 1, bankLsb: 2, program: 3, durationTicks: 0 })).to.equal(true);
      expect(accepted.slice(0, 4)).to.deep.equal([[0xb0, 0, 1], [0xb0, 32, 2], [0xc0, 3], [0x90, 60, 64]]);
      scheduler.sendNote({ note: 64, bankMsb: 4, bankLsb: 2, program: 3, durationTicks: 0 });
      expect(accepted.filter(data => data[0] === 0xc0)).to.deep.equal([[0xc0, 3], [0xc0, 3]]);
      scheduler.dispose();
    });
  });

  it('invalidates an accepted expression binding after a manually submitted channel control', function() {
    withFakeClockAndPerformance(() => {
      const accepted = [], output = byteOutput('manual', accepted), scheduler = new MidiScheduler(configuration(false));
      const ports = createProcgenMidiPorts({ scheduler, transport: transport(), now: () => 0 }); ports.setNoteOutput(output);
      ports.sendNote({ note: 60, timbre: 99, durationTicks: 0 });
      ports.sendEvent({ type: 'cc', channel: 1, controller: 74, value: 20 });
      ports.sendNote({ note: 64, timbre: 99, durationTicks: 0 });
      expect(accepted.filter(data => data[0] === 0xb0 && data[1] === 74).map(data => data[2])).to.deep.equal([99, 20, 99]);
      ports.dispose(); scheduler.dispose();
    });
  });

  it('rolls back deferred reservations when local admission throws at the onset frontier', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([1], calls, 'local'), scheduler = new MidiScheduler(configuration(false));
      output.supportsIndependentNoteGates = true;
      output.canAllocateVoice = () => { throw new Error('local admission unavailable'); };
      scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, timeMs: 1000, durationTicks: 1 })).to.equal(true);
      expect(calls).to.deep.equal([]); clock.tick(1000);
      expect(scheduler._ratePlanned).to.deep.equal([]); expect(calls).to.deep.equal([]);
      const reservation = scheduler.reserve({ on: { timeMs: 2000, count: 1, bytes: 3 } }, { outputId: 'local' }, 1000);
      expect(scheduler.sendNote({ note: 64, timeMs: 2000, durationTicks: 0 }, { rateReserved: true, reservationId: reservation.reservationId })).to.equal(true);
      clock.tick(1000);
      expect(scheduler._ratePlanned).to.deep.equal([]); expect(scheduler._activeNotes.size).to.equal(0);
      expect(scheduler._pendingNoteOns.size).to.equal(0); expect(calls).to.deep.equal([]); scheduler.dispose();
    });
  });

  it('does not admit attacks from an output callback and orders a safety release after callback retirement', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls, 'callback'), scheduler = new MidiScheduler(configuration(false));
      const attempts = [];
      output.channels[1].sendNoteOn = note => {
        attempts.push(scheduler.sendNote({ note: 72, durationTicks: 0 }));
        scheduler.allNotesOff(); calls.push({ type: 'noteOn', note }); return true;
      };
      scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, durationTicks: 0 })).to.equal(false);
      expect(attempts).to.deep.equal([false]);
      expect(calls.at(-1)).to.include({ type: 'noteOff', note: 60 });
      expect(scheduler._activeNotes.size).to.equal(0); expect(scheduler._ratePlanned).to.deep.equal([]); scheduler.dispose();
    });
  });

  it('keeps filtered sensing unknown, rejects malformed FE, and requires fresh evidence in a new source epoch', function() {
    withFakeClockAndPerformance(clock => {
      const t = transport(), ports = createProcgenMidiPorts({ transport: t, now: () => clock.now });
      ports.configure({ activeSensingVisibility: 'filtered' });
      expect(ports.getState().inputLiveness).to.include({ mode: 'unavailable', evidence: 'active-sensing-filtered' });
      expect(ports.receiveMidi([0xfe, 0])).to.equal(false);
      clock.tick(2000); expect(ports.getState().inputLiveness.mode).to.equal('unavailable');
      ports.configure({ activeSensingVisibility: 'observable' });
      clock.tick(2000); expect(ports.getState().inputLiveness.mode).to.equal('unobserved');
      ports.receiveMidi([0xfe]); expect(ports.getState().inputLiveness.mode).to.equal('armed');
      const oldEpoch = ports.getState().inputLiveness.connectionEpoch;
      ports.setInput({ id: 'replacement' });
      expect(ports.receiveMidi([0xfe], clock.now, { connectionEpoch: oldEpoch })).to.equal(false);
      expect(ports.getState().inputLiveness.mode).to.equal('unobserved'); expect(t.panics).to.equal(0); expect(t.pauses).to.equal(0);
      ports.dispose();
    });
  });
});
