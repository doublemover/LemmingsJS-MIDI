import { expect } from 'chai';
import { createProcgenMidiPorts, decodeProcgenMidi, encodeProcgenMidi } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { exportProcgenMidi, selectBalancedProcgenRecording } from '../js/app/procgen/workstation/ProcgenMidiExport.js';
import { MidiScheduler } from '../js/midi/MidiScheduler.js';
import { withFakeClockAndPerformance } from './support/timers.js';
import { makeOutput } from './support/midi-output.js';
import { parseSmf } from './support/smf.js';

function fixture(clock = () => 1000) {
  const output = { id: 'notes', messages: [], clears: 0, send(data, timestamp) { this.messages.push({ data, timestamp }); }, clear() { this.clears++; } };
  const scheduler = { tickMs: 60, setOutput(value) { this.output = value; }, setOutputs(value) { this.outputs = value; }, allNotesOff() { this.panics = (this.panics || 0) + 1; }, setTickMs(value) { this.tickMs = value; }, sendNote(spec, meta) { this.note = { spec, meta }; return true; } };
  const transport = { pause() { this.pauses = (this.pauses || 0) + 1; }, panic() { this.panics = (this.panics || 0) + 1; }, receiveMidi(data, timestamp) { this.received = { data, timestamp }; }, setClockOutput(port) { this.clock = port; }, getState: () => ({ beat: 2, bpm: 120 }) };
  const monitored = [], learned = [], recorded = [];
  const ports = createProcgenMidiPorts({ transport, scheduler, now: clock,
    onMonitor: event => monitored.push(event), onLearn: event => learned.push(event), onRecord: event => recorded.push(event) });
  ports.setNoteOutput(output);
  return { ports, output, transport, scheduler, monitored, learned, recorded };
}

describe('ProcGen workstation MIDI ports', () => {
  it('fails unrepresentable SMF tempo rather than silently retiming recorded source', () => {
    for (const bpm of [0, 1, NaN, Infinity, 120000001]) expect(() => exportProcgenMidi([], { bpm })).to.throw('representable');
    expect(() => exportProcgenMidi([{ type: 'tempo', beat: 4, bpm: 1 }])).to.throw('representable');
    expect(exportProcgenMidi([], { bpm: 120 })).to.be.instanceOf(Uint8Array);
  });

  it('rejects normalized MPE reconfiguration before setup can exceed an active route grant', () => {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 1 });
      const output = makeOutput([1, 2, 3], calls, 'scope'), otherCalls = [], other = makeOutput([1, 2, 3], otherCalls, 'other');
      const ports = createProcgenMidiPorts({ scheduler, now: () => clock.now });
      try {
        ports.setNoteOutputs([output, other]);
        ports.setActiveNoteOutputs([{ outputId: 'scope', channels: [1] }, { outputId: 'other', channels: [1, 2, 3] }]);
        expect(calls).to.have.length(0);
        const candidate = { mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } };
        const state = ports.configure({ schedulerConfig: candidate });
        expect(state.lastConfigurationFailure).to.include({ reason: 'mpe-channel-scope', retained: true });
        expect(state.outputRoutes.find(route => route.outputId === 'scope').configurationFailure).to.equal('mpe-channel-scope');
        expect(scheduler.config.mpe.enabled).to.equal(false); expect(calls).to.have.length(0); expect(otherCalls).to.have.length(0);
        expect(scheduler.setConfig(candidate)).to.equal(false); expect(calls).to.have.length(0);
        expect(scheduler._sendOutput(output, 2, 'sendNoteOn', [60])).to.equal(false);
        expect(ports.sendNote({ outputId: 'other', note: 65, durationMs: 20 })).to.equal(true);
        ports.setActiveNoteOutputs([{ outputId: 'scope', channels: [1, 2] }, { outputId: 'other', channels: [1, 2, 3] }], { rearm: true });
        calls.length = 0; ports.configure({ schedulerConfig: candidate });
        expect(scheduler.config.mpe.enabled).to.equal(true);
        expect(ports.sendNote({ outputId: 'scope', note: 60, durationMs: 20 })).to.equal(true);
        expect(calls.filter(call => call.type === 'noteOn').map(call => call.id)).to.deep.equal([2]);
        calls.length = 0;
        ports.configure({ schedulerConfig: { mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3] } } });
        expect(calls).to.have.length(0); expect(scheduler.config.mpe.memberChannels).to.deep.equal([2]);
        expect(ports.sendNote({ outputId: 'other', note: 66, durationMs: 20 })).to.equal(true);
      } finally { ports.dispose(); scheduler.dispose(); }
    });
  });

  it('retires queued work when narrowing a grant and never admits an incompatible active zone', () => {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false } }), output = makeOutput([1, 2, 16, 15], calls, 'scope');
      const ports = createProcgenMidiPorts({ scheduler, now: () => clock.now });
      try {
        ports.setNoteOutputs([output]); ports.setActiveNoteOutputs([{ outputId: 'scope', channels: [1, 2] }]);
        expect(ports.sendNote({ outputId: 'scope', channel: 2, note: 60, timeMs: 100, durationMs: 20 })).to.equal(true);
        ports.setActiveNoteOutputs([{ outputId: 'scope', channels: [1] }], { rearm: true }); calls.length = 0;
        clock.tick(120); expect(calls.filter(call => call.type === 'noteOn')).to.have.length(0);
        for (const mpe of [{ enabled: true }, { enabled: true, masterChannel: 16, memberChannels: [15] },
          { enabled: true, masterChannel: 1, memberChannels: [2] }]) {
          expect(ports.configure({ schedulerConfig: { mpe } }).lastConfigurationFailure).not.to.equal(null);
          expect(calls).to.have.length(0);
        }
      } finally { ports.dispose(); scheduler.dispose(); }
    });
  });
  it('monitors and learns input with Thru off by default; never echoes realtime when enabled', () => {
    const f = fixture(); f.ports.learnNext(); f.ports.receiveMidi([0xb2, 74, 91], 99);
    expect(f.output.messages).to.have.length(0); expect(f.learned[0]).to.include({ type: 'cc', channel: 3, controller: 74, value: 91 });
    expect(f.ports.getState().learning).to.equal(false);
    f.ports.configure({ thru: true }); f.ports.receiveMidi([0x90, 60, 90], 100);
    f.ports.receiveMidi([0xf8], 101); f.ports.receiveMidi([0xfa], 102); f.ports.receiveMidi([0xf2, 1, 0], 103);
    expect(f.output.messages).to.deep.equal([{ data: [0x90, 60, 90], timestamp: 100 }]);
    expect(f.monitored).to.have.length(5); f.ports.dispose();
  });

  it('sends bank before program, sustain, pitch bend, channel and poly pressure with native timestamps', () => {
    const f = fixture();
    for (const event of [{ type: 'bank', msb: 3, lsb: 9 }, { type: 'program', value: 17 },
      { type: 'sustain', value: true }, { type: 'bend', value: 8191 }, { type: 'pressure', value: 50 }, { type: 'polyPressure', note: 60, value: 40 }]) {
      expect(f.ports.sendEvent({ ...event, channel: 2, timestamp: 1050 })).to.equal(true);
    }
    expect(f.output.messages.map(event => event.data)).to.deep.equal([
      [0xb1, 0, 3], [0xb1, 32, 9], [0xc1, 17], [0xb1, 64, 127], [0xe1, 127, 127], [0xd1, 50], [0xa1, 60, 40]
    ]);
    expect(f.output.messages.every(event => event.timestamp === 1050)).to.equal(true); f.ports.dispose();
  });

  it('uses the existing note scheduler for WebMidi outputs and millisecond gates', () => {
    const f = fixture(); const port = { ...f.output, channels: { 1: {} } }; f.ports.setNoteOutput(port, { rearm: true });
    f.ports.sendNote({ note: 60, velocity: 91, timeMs: 1020, durationMs: 250, channel: 1 }, { beat: 2 });
    expect(f.scheduler.output).to.equal(port); expect(f.scheduler.tickMs).to.equal(60);
    expect(f.scheduler.note.spec).to.include({ durationTicks: 250 / 60, timeMs: 1020 });
    f.ports.sendEvent({ type: 'cc', controller: 1, value: 70, timestamp: 1200 });
    expect(port.messages.at(-1).timestamp).to.deep.equal({ time: 1200 }); f.ports.dispose();
  });

  it('records timestamped notes and gates in musical beats and bounds the recording', () => {
    const f = fixture(); f.ports.configure({ recording: true });
    f.ports.sendNote({ note: 60, velocity: 100, durationMs: 500, timeMs: 1000 }, { beat: 2 });
    const events = f.ports.getRecording();
    expect(events.map(event => event.beat)).to.deep.equal([2, 3]);
    expect(events.map(event => event.data)).to.deep.equal([[0x90, 60, 100], [0x80, 60, 0]]);
    events[0].data[1] = 22; expect(f.ports.getRecording()[0].data[1]).to.equal(60);
    f.ports.recordTempo(90, 4); expect(f.ports.getRecording().at(-1)).to.include({ type: 'tempo', bpm: 90, beat: 4 });
    f.ports.clearRecording(); expect(f.ports.getRecording()).to.have.length(0); f.ports.dispose();
    const bounded = createProcgenMidiPorts({ maxRecordedEvents: 1 }); bounded.configure({ recording: true });
    bounded.receiveMidi([0x90, 60, 100]); bounded.receiveMidi([0x80, 60, 0]);
    expect(bounded.getState()).to.include({ recordedEvents: 1, droppedRecords: 1 }); bounded.dispose();
  });

  it('releases its owned note and reports a shared sustain instead of resetting the channel', () => {
    const f = fixture(); f.ports.sendEvent({ type: 'noteOn', note: 60, channel: 3 });
    f.ports.sendEvent({ type: 'sustain', value: true, channel: 3 }); f.ports.panic();
    expect(f.output.messages.map(event => event.data)).to.deep.equal([[0x92, 60, 100], [0xb2, 64, 127], [0x82, 60, 0]]);
    expect(f.ports.getState().lastCleanup).to.include({ sharedPedalHeld: true, uncertain: 1 });
    expect(f.output.clears).to.equal(0); expect(f.transport.panics).to.equal(1);
    f.ports.setNoteOutput(null); expect(f.transport.pauses || 0).to.equal(0); f.ports.dispose();
  });

  it('detaches input listeners, stops on disconnection, and does not restart on reconnection', () => {
    const f = fixture(); const listeners = new Set();
    const input = { id: 'input', state: 'connected', addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } };
    f.ports.setInput(input); expect(listeners.size).to.equal(1);
    [...listeners][0]({ data: [0xd0, 60], receivedTime: 35 }); expect(f.monitored[0]).to.include({ type: 'pressure', timestamp: 35 });
    input.state = 'disconnected'; expect(f.ports.checkConnections()).to.equal(false); expect(listeners.size).to.equal(0);
    input.state = 'connected'; expect(f.ports.checkConnections()).to.equal(true);
    expect(f.ports.getState().inputId).to.equal(null); f.ports.dispose();
    f.ports.setInput(input); expect(listeners.size).to.equal(0);
  });
  it('arms sensing only after FE, refreshes on ordinary traffic and releases only owned Thru notes on observed loss', () => {
    let time = 0; const f = fixture(() => time);
    f.ports.configure({ thru: true, recording: true });
    time = 1000; f.ports.checkConnections(); expect(f.ports.getState().inputLiveness.mode).to.equal('unobserved');
    f.ports.receiveMidi([0xfe], time); expect(f.ports.getState().inputLiveness.mode).to.equal('armed');
    time = 1100; f.ports.receiveMidi([0x90, 60, 100], time);
    time = 1250; f.ports.receiveMidi([0xb0, 1, 5], time);
    time = 1500; f.ports.checkConnections(); expect(f.ports.getState().inputLiveness.mode).to.equal('armed');
    time = 1551; f.ports.checkConnections();
    expect(f.ports.getState().inputLiveness).to.include({ mode: 'expired', reason: 'sensing-expired' });
    expect(f.ports.getState()).to.include({ recordingComplete: false, incompleteReason: 'input-sensing-terminated' });
    expect(f.ports.getRecording().some(event => event.type === 'safety-termination' && event.reason === 'sensing-expired')).to.equal(true);
    expect(f.output.messages.map(message => message.data)).to.deep.equal([[0x90, 60, 100], [0xb0, 1, 5], [0x80, 60, 0]]);
    expect(f.transport.panics || 0).to.equal(0);
    expect(f.ports.receiveMidi([0x90, 61, 100], 1200)).to.equal(false);
    time = 1560; f.ports.receiveMidi([0xfe], time); expect(f.ports.getState().inputLiveness.mode).to.equal('armed');
    expect(f.ports.receiveMidi([0x90, 62, 100], 1200)).to.equal(false);
    f.ports.dispose();
  });
  it('reports host observation gaps separately and keeps System Reset under an input policy', () => {
    let time = 0; const f = fixture(() => time); f.ports.configure({ thru: true });
    f.ports.receiveMidi([0xfe], time); f.ports.receiveMidi([0x90, 64, 90], time);
    time = 1000; f.ports.checkConnections();
    expect(f.ports.getState().inputLiveness).to.include({ mode: 'unavailable', reason: 'host-suspended' });
    expect(f.output.messages.at(-1).data).to.deep.equal([0x80, 64, 0]);
    time = 1100; f.ports.receiveMidi([0x90, 65, 90], time); f.ports.receiveMidi([0xff], time);
    expect(f.output.messages.at(-1).data).to.deep.equal([0x90, 65, 90]);
    f.ports.configure({ systemResetPolicy: 'release-owned' }); f.ports.receiveMidi([0xff], time);
    expect(f.output.messages.at(-1).data).to.deep.equal([0x80, 65, 0]);
    expect(f.output.messages.some(message => message.data[0] === 0xff)).to.equal(false);
    f.ports.dispose();
  });
  it('runs an owned sensing watchdog even when the workstation render loop is idle', () => withFakeClockAndPerformance(clock => {
    const f = fixture(() => clock.now); f.ports.configure({ thru: true });
    f.ports.receiveMidi([0xfe], clock.now); f.ports.receiveMidi([0x90, 67, 90], clock.now);
    clock.tick(301);
    expect(f.ports.getState().inputLiveness.mode).to.equal('expired');
    expect(f.output.messages.at(-1).data).to.deep.equal([0x80, 67, 0]);
    f.ports.dispose();
  }));
  it('does not let a queued message from a replaced input rearm the new connection epoch', () => {
    let time = 0; const f = fixture(() => time), listeners = [];
    const port = id => ({ id, state: 'connected', addEventListener(_type, listener) { listeners.push(listener); }, removeEventListener() {} });
    f.ports.setInput(port('first')); const oldListener = listeners[0];
    oldListener({ data: [0xfe], receivedTime: 0 }); expect(f.ports.getState().inputLiveness.mode).to.equal('armed');
    f.ports.setInput(port('second')); expect(f.ports.getState().inputLiveness).to.include({ mode: 'unobserved', connectionEpoch: 2 });
    oldListener({ data: [0xfe], receivedTime: 0 }); expect(f.ports.getState().inputLiveness.mode).to.equal('unobserved');
    listeners[1]({ data: [0xfe], receivedTime: 0 }); expect(f.ports.getState().inputLiveness.mode).to.equal('armed');
    f.ports.dispose();
  });

  it('round trips expression bytes and treats velocity zero as note off', () => {
    for (const data of [[0xe0, 0, 0], [0xa3, 61, 82], [0xd2, 40], [0xc1, 6], [0xb0, 64, 127]]) {
      const event = decodeProcgenMidi(data); delete event.data;
      expect(encodeProcgenMidi(event)[0]).to.deep.equal(data);
    }
    expect(decodeProcgenMidi([0x90, 60, 0]).type).to.equal('noteOff');
  });

  it('routes per-lane notes and expression to separate outputs without fallback for a missing destination', () => {
    const f = fixture(), other = { ...f.output, id: 'other', messages: [], clears: 0 };
    f.ports.setNoteOutputs([f.output, other]);
    expect(f.ports.sendNote({ note: 60, durationMs: 100, outputId: 'other' }, { laneIndex: 2 })).to.equal(true);
    expect(f.output.messages).to.have.length(0); expect(other.messages.map(event => event.data[0])).to.deep.equal([0x90, 0x80]);
    f.ports.sendEvent({ type: 'cc', controller: 74, value: 9, outputId: 'other' });
    expect(other.messages.at(-1).data).to.deep.equal([0xb0, 74, 9]);
    expect(f.ports.sendNote({ note: 60, outputId: 'missing' })).to.equal(false);
    f.ports.flush(); expect(other.clears).to.be.greaterThan(0); expect(other.messages.at(-1).data).to.deep.equal([0x80, 60, 0]);
    f.ports.dispose();
  });

  it('removes an unused discovered output without reporting active route loss', () => {
    const f = fixture(), other = { ...f.output, id: 'other', state: 'connected', messages: [], clears: 0 };
    f.ports.setNoteOutputs([f.output, other]);
    other.state = 'disconnected';
    expect(f.ports.checkConnections()).to.equal(true);
    expect(f.transport.panics || 0).to.equal(0);
    expect(f.ports.getState().noteOutputIds).to.deep.equal(['notes']);
    f.ports.dispose();
  });

  it('preserves shared scheduler timing and configuration for per-lane WebMidi destinations', () => {
    const f = fixture(), first = { ...f.output, channels: {} }, second = { ...first, id: 'second' };
    f.scheduler.config = { limits: { maxEventsPerSecond: 99 } };
    f.ports.setNoteOutputs([first, second]); f.ports.setNoteOutput(first, { rearm: true }); f.ports.sendNote({ note: 70, outputId: 'second', durationMs: 120 });
    expect(f.scheduler.outputs).to.deep.equal([first, second]);
    expect(f.scheduler.note.spec).to.include({ outputId: 'second', durationTicks: 2 });
    expect(f.scheduler.config.limits.maxEventsPerSecond).to.equal(99); expect(f.scheduler.tickMs).to.equal(60); f.ports.dispose();
  });

  it('captures accepted browser-synth performance specs, including program and expression, without a MIDI port', () => {
    const f = fixture(); f.ports.setNoteOutput(null); f.ports.configure({ recording: true });
    f.ports.recordOutput({ note: 67, velocity: 88, program: 22, pan: 63, pitchBend: -1, timbre: 100, durationMs: 250, timeMs: 1050, channel: 4 },
      { beat: 2.1, bpm: 120, source: 'game', laneId: 'lane-a' });
    expect(f.ports.getRecording().map(event => event.data)).to.deep.equal([
      [0xc3, 22], [0xe3, 0, 0], [0xb3, 74, 100], [0xb3, 10, 63], [0x93, 67, 88], [0x83, 67, 0]
    ]);
    const events = parseSmf(exportProcgenMidi(f.ports.getRecording()));
    expect(events.find(event => event.status === 0x93)).to.include({ tick: 1008 });
    expect(events.find(event => event.status === 0x83)).to.include({ tick: 1248 }); f.ports.dispose();
  });

  it('removes canceled future notes from recordings and closes notes sounding at panic', () => {
    const f = fixture(); f.ports.configure({ recording: true });
    f.ports.recordOutput({ note: 60, durationMs: 500, timeMs: 1000 }, { beat: 2 });
    f.ports.recordOutput({ note: 70, durationMs: 500, timeMs: 1100 }, { beat: 2.2 });
    f.ports.flush();
    const notes = f.ports.getRecording().filter(event => (event.data[0] & 0xe0) === 0x80);
    expect(notes.map(event => event.data)).to.deep.equal([[0x90, 60, 100], [0x80, 60, 0]]);
    expect(notes.map(event => event.beat)).to.deep.equal([2, 2]); f.ports.dispose();
  });

  it('uses the existing shared rate reservation for native port notes', () => {
    const f = fixture(); let plan;
    f.scheduler.evaluateAndReserve = value => { plan = value; return { ok: false }; };
    expect(f.ports.sendNote({ note: 60, program: 1, durationMs: 200 })).to.equal(false);
    expect(plan).to.deep.equal({ on: { timeMs: 1000, count: 2, bytes: 5 }, off: { timeMs: 1200, count: 1, bytes: 3 } });
    expect(f.output.messages).to.have.length(0); f.ports.dispose();
  });

  it('keeps only accepted raw and bank messages after partial device rejection', () => {
    withFakeClockAndPerformance(clock => {
      const scheduler = new MidiScheduler({ mpe: { enabled: false } }), accepted = [];
      const output = { id: 'raw', send(data) {
        if (data[0] === 0x90 || data[1] === 32) return false;
        accepted.push(data); return true;
      } };
      const transport = { pause() {}, panic() {}, getState: () => ({ beat: 0, bpm: 120 }) };
      const ports = createProcgenMidiPorts({ scheduler, transport, now: () => clock.now });
      try {
        ports.setNoteOutput(output);
        expect(ports.sendEvent({ type: 'bank', msb: 1, lsb: 2, timestamp: 0 })).to.equal(false);
        expect(scheduler.getRateSnapshot(0).past.count).to.equal(1);
        expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
        expect(ports.getState().activeNoteOutputIds).to.deep.equal([]);
        ports.setNoteOutput(output, { rearm: true });
        expect(ports.sendNote({ note: 60, program: 8, durationMs: 100 })).to.equal(false);
        expect(accepted).to.deep.equal([[0xb0, 0, 1], [0xc0, 8]]);
        expect(scheduler.getRateSnapshot(0).past).to.include({ count: 2, bytes: 5 });
        expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      } finally { ports.dispose(); scheduler.dispose(); }
    });
  });

  it('records allocated MPE channels, accepted expression, and release only when submitted', () => {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3] } });
      const output = makeOutput([1, 2, 3], calls, 'mpe');
      const ports = createProcgenMidiPorts({ scheduler, now: () => clock.now, transport: { pause() {}, panic() {}, getState: () => ({ beat: clock.now / 500, bpm: 120 }) } });
      try {
        ports.setNoteOutput(output); calls.length = 0; ports.configure({ recording: true });
        expect(ports.sendNote({ note: 60, velocity: 100, releaseVelocity: 37, pitchBend: 0.6, durationMs: 100, timeMs: 0 })).to.equal(true);
        expect(ports.sendNote({ note: 64, velocity: 90, durationMs: 100, timeMs: 0 })).to.equal(true);
        const onset = ports.getRecording().filter(event => event.data[0] >= 0x90 && event.data[0] < 0xa0);
        expect(onset.map(event => event.data[0])).to.deep.equal([0x91, 0x92]);
        expect(ports.getRecording().some(event => (event.data[0] & 0xf0) === 0x80)).to.equal(false);
        expect(ports.getRecording().filter(event => event.evidence === 'api-accepted').every(event => event.submittedMs === 0)).to.equal(true);
        clock.tick(100);
        expect(ports.getRecording().filter(event => (event.data[0] & 0xf0) === 0x80).map(event => event.data)).to.deep.equal([
          [0x81, 60, 37], [0x82, 64, 90]
        ]);
        const physical = calls.filter(call => call.type !== 'bendRange');
        expect(physical.filter(call => call.type === 'noteOn').map(call => call.id)).to.deep.equal([2, 3]);
      } finally { ports.dispose(); scheduler.dispose(); }
    });
  });

  it('does not record canceled or rejected future onsets and preserves reverse attack velocity', () => {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false }, defaultChannel: 5 });
      const output = makeOutput([5], calls, 'main');
      const ports = createProcgenMidiPorts({ scheduler, now: () => clock.now, transport: { pause() {}, panic() {}, getState: () => ({ beat: 0, bpm: 120 }) } });
      try {
        ports.setNoteOutput(output); ports.configure({ recording: true });
        expect(ports.sendNote({ note: 60, velocity: 110, releaseVelocity: 30, reverse: true, durationMs: 20 })).to.equal(true);
        expect(ports.getRecording().find(event => (event.data[0] & 0xf0) === 0x90).data).to.deep.equal([0x94, 60, 30]);
        clock.tick(20);
        expect(ports.getRecording().find(event => (event.data[0] & 0xf0) === 0x80).data).to.deep.equal([0x84, 60, 110]);
        const beforeFuture = ports.getRecording().length;
        expect(ports.sendNote({ note: 61, durationMs: 20, timeMs: 100 })).to.equal(true);
        expect(ports.getRecording()).to.have.length(beforeFuture);
        scheduler.allNotesOff(); clock.tick(120);
        expect(ports.getRecording().some(event => event.data[1] === 61 && (event.data[0] & 0xf0) === 0x90)).to.equal(false);
        output.channels[5].sendNoteOn = () => false;
        expect(ports.sendNote({ note: 62, durationMs: 20 })).to.equal(false);
        expect(ports.getRecording().some(event => event.data[1] === 62 && (event.data[0] & 0xf0) === 0x90)).to.equal(false);
      } finally { ports.dispose(); scheduler.dispose(); }
    });
  });

  it('keeps input and Thru observations separate for an output-only export', () => {
    const f = fixture(); f.ports.configure({ recording: true, thru: true });
    f.ports.receiveMidi([0x90, 60, 100], 1000);
    f.ports.receiveMidi([0x80, 60, 0], 1500);
    expect(f.ports.getRecording()).to.have.length(4);
    expect(f.ports.getRecording({ direction: 'output' }).map(event => event.data)).to.deep.equal([[0x90, 60, 100], [0x80, 60, 0]]);
    expect(parseSmf(exportProcgenMidi(f.ports.getRecording({ direction: 'output' }))).filter(event => event.status === 0x90)).to.have.length(1);
    f.ports.dispose();
  });

  it('marks a capped or stopped recording incomplete without an orphaned finite rendered onset', () => {
    const f = fixture(); f.ports.configure({ recording: true }); f.ports.clearRecording();
    f.ports.recordTempo(120, 0);
    f.ports.dispose();
    const capped = createProcgenMidiPorts({ maxRecordedEvents: 2, now: () => 0 });
    capped.configure({ recording: true }); capped.recordTempo(120, 0);
    expect(capped.recordOutput({ note: 60, durationMs: 100 })).to.equal(false);
    expect(capped.getRecording().filter(event => (event.data[0] & 0xf0) === 0x90)).to.have.length(0);
    expect(capped.getState()).to.include({ recording: false, recordingComplete: false, incompleteReason: 'recording-cap-reached' });
    capped.dispose();
    const stopped = createProcgenMidiPorts({ now: () => 0 });
    stopped.configure({ recording: true }); stopped.receiveMidi([0x90, 60, 100], 0); stopped.configure({ recording: false });
    expect(stopped.getState()).to.include({ recordingComplete: false, incompleteReason: 'open-notes-at-stop' });
    stopped.dispose();
  });

  it('reports zero-cap pressure immediately and flushes without re-emitting immutable historical receipts', () => {
    const states = [], retained = [];
    const ports = createProcgenMidiPorts({ maxRecordedEvents: 0, onState: state => states.push(state) });
    ports.configure({ recording: true }); ports.receiveMidi([0x90, 60, 100]);
    expect(ports.getState()).to.include({ recording: false, recordingComplete: false, droppedRecords: 1, firstLostSequence: 1 });
    expect(states.at(-1).incompleteReason).to.equal('recording-cap-reached'); ports.dispose();
    const longTake = createProcgenMidiPorts({ onRecord: event => retained.push(event) });
    longTake.configure({ recording: true });
    for (let index = 0; index < 1000; index++) longTake.receiveMidi([0xb0, 1, index % 128]);
    expect(Object.isFrozen(retained[0])).to.equal(true); expect(Object.isFrozen(retained[0].data)).to.equal(true);
    expect(() => Object.defineProperty(retained[0], 'data', { get() { throw new Error('historical event replayed'); } })).to.throw(TypeError);
    const count = retained.length;
    expect(() => longTake.flush()).not.to.throw(); expect(retained).to.have.length(count); longTake.dispose();
  });

  it('keeps exact retained and lost ranges when a finite note transaction cannot fit', () => {
    const ports = createProcgenMidiPorts({ maxRecordedEvents: 2, now: () => 10 });
    ports.configure({ recording: true }); ports.recordTempo(120, 0, 10);
    expect(ports.recordOutput({ note: 60, durationMs: 100 })).to.equal(false);
    expect(ports.getState()).to.include({ recording: false, droppedRecords: 2, firstLostSequence: 2 });
    expect(ports.getState().retainedRange).to.deep.equal({ firstSequence: 1, lastSequence: 1, firstTimestamp: 10, lastTimestamp: 10 });
    expect(ports.getState().droppedCategories.output).to.equal(2);
    ports.dispose();
  });
});

describe('ProcGen Standard MIDI File export', () => {
  it('exports only observed balanced notes and labels the partial window in the MIDI file', () => {
    const captured = [
      { data: [0x90, 60, 100], outputId: 'a', beat: 0 },
      { data: [0x90, 60, 90], outputId: 'a', beat: 1 },
      { data: [0x80, 60, 0], outputId: 'a', beat: 2 },
      { data: [0x80, 60, 0], outputId: 'b', beat: 2 },
      { data: [0x90, 62, 100], outputId: 'a', beat: 3 }
    ];
    const selected = selectBalancedProcgenRecording(captured);
    expect(selected.events.map(event => event.data)).to.deep.equal([[0x90, 60, 100], [0x80, 60, 0]]);
    expect(selected).to.include({ omittedOnsets: 2, omittedReleases: 1 });
    const bytes = exportProcgenMidi(selected.events, { manifest: { complete: false, reason: 'recording-cap-reached' } });
    const parsed = parseSmf(bytes);
    expect(parsed.filter(event => (event.status & 0xf0) === 0x90 || (event.status & 0xf0) === 0x80).map(event => event.status)).to.deep.equal([0x90, 0x80]);
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(parsed.find(event => event.status === 0xff && event.type === 0x01).data))))
      .to.deep.equal({ complete: false, reason: 'recording-cap-reached' });
  });
  it('exports valid type-0 header, tempo, time signature, delta times, byte order and end track', () => {
    const bytes = exportProcgenMidi([
      { type: 'bank', msb: 1, lsb: 3, channel: 2, beat: 0 }, { type: 'program', value: 17, channel: 2, beat: 0 },
      { type: 'noteOn', note: 60, velocity: 100, channel: 2, beat: 1 }, { type: 'tempo', bpm: 60, beat: 2 },
      { type: 'noteOff', note: 60, channel: 2, beat: 3 }, { data: [0xf8], beat: 3 }
    ], { bpm: 120, beatsPerBar: 7, beatUnit: 8 });
    expect(Array.from(bytes.slice(0, 14))).to.deep.equal([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]);
    const length = new DataView(bytes.buffer).getUint32(18); expect(length).to.equal(bytes.length - 22);
    const events = parseSmf(bytes);
    expect(events[0]).to.deep.equal({ tick: 0, status: 255, type: 81, data: [7, 161, 32] });
    expect(events[1].data).to.deep.equal([7, 3, 24, 8]);
    expect(events.slice(2, 5).map(event => [event.status, ...event.data])).to.deep.equal([[0xb1, 0, 1], [0xb1, 32, 3], [0xc1, 17]]);
    expect(events[5]).to.deep.equal({ tick: 480, status: 0x91, data: [60, 100] });
    expect(events[6]).to.deep.equal({ tick: 960, status: 255, type: 81, data: [15, 66, 64] });
    expect(events.at(-1)).to.deep.equal({ tick: 1440, status: 255, type: 47, data: [] });
  });
  it('refuses missing or unrepresentable beat mappings instead of silently exporting tick zero', () => {
    for (const beat of [undefined, null, '', '2', NaN, Infinity, -1]) expect(() => exportProcgenMidi([{ type: 'noteOn', note: 60, velocity: 100, beat }])).to.throw('unmapped');
    expect(() => exportProcgenMidi([{ type: 'noteOn', note: 60, velocity: 100, beat: Number.MAX_SAFE_INTEGER }])).to.throw('exact SMF');
    const events = parseSmf(exportProcgenMidi([{ type: 'noteOn', note: 60, velocity: 100, beat: 0 }]));
    expect(events.find(event => event.status === 0x90).tick).to.equal(0);
  });

  it('sorts events stably and supports recordings larger than JavaScript argument limits', () => {
    const events = Array.from({ length: 40000 }, (_, index) => ({ beat: index / 24, data: [0xb0, 1, index % 128] }));
    const bytes = exportProcgenMidi(events); expect(bytes.length).to.be.greaterThan(160000);
    expect(parseSmf(bytes)).to.have.length(40003);
  });
});
