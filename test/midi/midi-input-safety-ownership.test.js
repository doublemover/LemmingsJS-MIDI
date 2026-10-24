import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const fixture = ({ now = () => performance.now(), onInputSafety = () => {}, id = 'notes', consumers = {} } = {}) => {
  const messages = [], safety = [], output = { id, state: 'connected', channels: {}, send(data) { messages.push([...data]); return true; } };
  output.channels[1] = {
    sendNoteOn(note, options = {}) { return output.send([0x90, note, options.rawAttack ?? 64]); },
    sendNoteOff(note, options = {}) { return output.send([0x80, note, options.rawRelease ?? 64]); }
  };
  const input = { id: id + '-input', state: 'connected' }, scheduler = new MidiScheduler({ mpe: { enabled: false } });
  const transport = { panics: 0, clockStatus: 'lost', panic() { this.panics++; }, receiveMidi() {}, getState() { return { beat: 0, bpm: 120, clockStatus: this.clockStatus }; } };
  const ports = createProcgenMidiPorts({ scheduler, transport, now, ...consumers, onInputSafety(event) { safety.push(event); onInputSafety(event); } });
  ports.setNoteOutput(output); ports.setInput(input); ports.configure({ thru: true }); safety.length = 0;
  return { ports, scheduler, output, input, transport, messages, safety, dispose() { ports.dispose(); scheduler.dispose(); } };
};
const offMessages = messages => messages.filter(data => (data[0] & 0xf0) === 0x80);

describe('source-owned MIDI input safety', function() {
  for (const replacement of ['scheduler', 'ports-note', 'raw']) it('transfers a Thru gate to an accepted ' + replacement + ' replacement before cable-liveness cleanup', function() {
    withFakeClockAndPerformance(clock => {
      const f = fixture(); f.ports.receiveMidi([0xfe]); f.ports.receiveMidi([0x90, 60, 80]);
      if (replacement === 'scheduler') f.scheduler.sendNote({ note: 60 });
      else if (replacement === 'ports-note') f.ports.sendNote({ note: 60 });
      else f.ports.sendEvent({ type: 'noteOn', note: 60, velocity: 64 });
      expect(f.ports.receiveMidi([0x80, 60, 0])).to.equal(true);
      clock.tick(301); expect(offMessages(f.messages)).to.deep.equal([]);
      expect(f.ports.getState().inputLiveness.mode).to.equal('expired');
      f.ports.flush(); expect(offMessages(f.messages)).to.have.length(1); f.dispose();
    });
  });

  it('keeps the old Thru owner when a replacement attack is rejected', function() {
    withFakeClockAndPerformance(clock => {
      const f = fixture(); f.ports.receiveMidi([0xfe]); f.ports.receiveMidi([0x90, 60, 80]);
      const send = f.output.send; f.output.send = function(data) { return data[0] === 0x90 && data[2] === 64 ? false : send.call(this, data); };
      expect(f.ports.sendNote({ note: 60 })).to.equal(false); clock.tick(301);
      expect(f.messages).to.deep.equal([[0x90, 60, 80], [0x80, 60, 0]]); f.dispose();
    });
  });

  it('keeps a Thru release on the gate original destination after default selection changes', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(), otherMessages = [], other = { id: 'other', state: 'connected', send(data) { otherMessages.push([...data]); } };
      f.ports.setNoteOutputs([f.output, other]); f.ports.setActiveNoteOutputs([{ outputId: f.output.id, laneIndices: [0] }]);
      f.ports.receiveMidi([0x90, 60, 80]); f.ports.setNoteOutput(other); f.ports.receiveMidi([0x80, 60, 0]);
      expect(f.messages).to.deep.equal([[0x90, 60, 80], [0x80, 60, 0]]); expect(otherMessages).to.deep.equal([]); f.dispose();
    });
  });

  it('defers callback-triggered input cleanup until the replacement submission has a result', async function() {
    await withFakeClockAndPerformance(async () => {
      const f = fixture(); f.ports.receiveMidi([0x90, 60, 80]);
      const send = f.output.send; f.output.send = function(data) {
        const result = send.call(this, data); if (data[0] === 0x90 && data[2] === 64) f.ports.setInput({ id: 'replacement' }); return result;
      };
      expect(f.ports.sendNote({ note: 60 })).to.equal(true); await Promise.resolve();
      expect(f.messages).to.deep.equal([[0x90, 60, 80], [0x90, 60, 64]]); expect(f.scheduler._activeNotes.size).to.equal(1); f.dispose();
    });
  });

  it('orders a compensating source release after a Thru attack whose input changed inside submission', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(), send = f.output.send; f.output.send = function(data) {
        const result = send.call(this, data); if (data[0] === 0x90) f.ports.setInput({ id: 'replacement' }); return result;
      };
      f.ports.receiveMidi([0x90, 60, 80]); expect(f.messages).to.deep.equal([[0x90, 60, 80], [0x80, 60, 0]]);
      f.ports.flush(); expect(offMessages(f.messages)).to.have.length(1); f.dispose();
    });
  });

  it('records a synthetic source termination once and preserves connected-port and musical-clock evidence', function() {
    withFakeClockAndPerformance(clock => {
      const f = fixture(); f.ports.configure({ recording: true }); f.ports.receiveMidi([0xfe]); f.ports.receiveMidi([0x90, 60, 80]);
      clock.tick(301); f.ports.checkConnections(); clock.tick(1000);
      expect(f.safety).to.have.length(1); expect(f.safety[0]).to.include({ reason: 'sensing-expired', evidence: 'active-sensing-timeout', sourceRoute: f.input.id, connectionEpoch: 1 });
      expect(f.safety[0].data).to.deep.equal([]); expect(Object.isFrozen(f.safety[0])).to.equal(true);
      const state = f.ports.getState(); expect(state.inputPortConnected).to.equal(true); expect(state.clockStatus).to.equal('lost');
      const records = f.ports.getRecording(); expect(records.filter(event => event.type === 'safety-termination')).to.have.length(1);
      expect(records.filter(event => event.direction === 'input' && event.type === 'noteOff')).to.deep.equal([]);
      expect(records.find(event => event.source === 'input-safety')).to.include({ reason: 'sensing-expired', evidence: 'api-accepted' }); f.dispose();
    });
  });

  it('leaves a silent second source unobserved while the armed source expires', function() {
    withFakeClockAndPerformance(clock => {
      const a = fixture({ id: 'a' }), b = fixture({ id: 'b' });
      a.ports.receiveMidi([0xfe]); a.ports.receiveMidi([0x90, 60, 80]); b.ports.receiveMidi([0x90, 61, 80]); clock.tick(1000);
      expect(offMessages(a.messages)).to.have.length(1); expect(offMessages(b.messages)).to.deep.equal([]);
      expect(a.ports.getState().inputLiveness.mode).to.equal('expired'); expect(b.ports.getState().inputLiveness.mode).to.equal('unobserved');
      expect(a.transport.panics + b.transport.panics).to.equal(0); a.dispose(); b.dispose();
    });
  });

  it('marks a host observation gap as uncertainty and restores sensing visibility per source', function() {
    withFakeClockAndPerformance(() => {
      let observed = 0; const f = fixture({ now: () => observed });
      f.ports.receiveMidi([0xfe]); f.ports.receiveMidi([0x90, 60, 80]); observed = 1000; f.ports.checkConnections();
      expect(f.ports.getState().inputLiveness).to.include({ mode: 'unavailable', reason: 'host-suspended', evidence: 'host-observation-gap' });
      expect(f.ports.getState().inputPortConnected).to.equal(true); expect(f.ports.getState().lastInputSafety.reason).to.equal('host-suspended');
      expect(f.ports.receiveMidi([0xb0, 1, 99], 10)).to.equal(false);
      f.ports.setInput({ id: 'new-input' }); expect(f.ports.getState().inputLiveness.activeSensingVisibility).to.equal('unknown');
      f.ports.configure({ activeSensingVisibility: 'backend-consumed' }); f.ports.setInput({ id: 'another-input' });
      expect(f.ports.getState().inputLiveness).to.include({ mode: 'unavailable', activeSensingVisibility: 'backend-consumed' }); f.dispose();
    });
  });

  it('retires only source gestures under observed System Reset without echoing reset or releasing another actor', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.ports.configure({ recording: true, systemResetPolicy: 'release-owned' }); f.ports.receiveMidi([0x90, 60, 80]); f.scheduler.sendNote({ note: 65 });
      f.ports.receiveMidi([0xff]); expect(offMessages(f.messages)).to.deep.equal([[0x80, 60, 0]]);
      expect(f.messages.some(data => data[0] === 0xff)).to.equal(false); expect(f.scheduler._activeNotes.size).to.equal(1);
      expect(f.ports.getRecording().find(event => event.type === 'safety-termination')).to.include({ reason: 'system-reset-observed', evidence: 'observed-system-reset' });
      expect(f.ports.getRecording().some(event => event.direction === 'input' && event.data[0] === 0xff)).to.equal(true); f.dispose();
    });
  });

  it('rejects a mismatched ingress source and handles simultaneous input/output loss in one observation', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); expect(f.ports.receiveMidi([0xfe], 0, { sourceRoute: 'other-input' })).to.equal(false);
      f.ports.receiveMidi([0x90, 60, 80]); f.input.state = 'disconnected'; f.output.state = 'disconnected';
      expect(f.ports.checkConnections()).to.equal(false); const state = f.ports.getState();
      expect(state.inputLiveness).to.include({ mode: 'unavailable', reason: 'port-disconnected', evidence: 'port-disconnected' });
      expect(state.activeNoteOutputIds).to.deep.equal([]); expect(state.lastInputSafety.sourceRoute).to.equal(f.input.id); f.dispose();
    });
  });

  it('allows a safety consumer to change selection without replaying the stale triggering input packet', function() {
    withFakeClockAndPerformance(() => {
      let f, observed = 0, replacement = false;
      f = fixture({ now: () => observed, onInputSafety(event) { if (f && event.reason === 'sensing-expired') { replacement = true; f.ports.setInput({ id: 'next' }); } } });
      f.ports.receiveMidi([0xfe]); f.ports.receiveMidi([0x90, 60, 80]); observed = 301;
      expect(f.ports.receiveMidi([0xb0, 1, 99], 301, { connectionEpoch: 1, sourceRoute: f.input.id })).to.equal(false);
      expect(replacement).to.equal(true); expect(f.ports.getState().inputId).to.equal('next');
      expect(f.messages.some(data => data[0] === 0xb0)).to.equal(false); f.dispose();
    });
  });

  it('qualifies source cleanup past an irrevocable future onset and reports a shared pedal separately', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.ports.configure({ recording: true }); f.ports.receiveMidi([0xb0, 64, 127]); f.ports.receiveMidi([0x90, 60, 80], 1000);
      f.ports.setInput({ id: 'next' });
      const release = f.ports.getRecording().find(event => event.source === 'input-safety'); expect(release.timestamp).to.equal(1001);
      expect(f.ports.getState().lastCleanup).to.include({ releaseSubmitted: 1, uncertain: 2, effectiveBoundary: 1001, sharedPedalHeld: true });
      expect(f.ports.getState().lastInputSafety.cleanup).to.include({ sourceRoute: f.input.id, connectionEpoch: 1, effectiveBoundary: 1001 }); f.dispose();
    });
  });

  it('reports an unacknowledged source release without fabricating an accepted off', function() {
    withFakeClockAndPerformance(clock => {
      const f = fixture(); f.ports.configure({ recording: true }); f.ports.receiveMidi([0xfe]); f.ports.receiveMidi([0x90, 60, 80]);
      const send = f.output.send; f.output.send = function(data) { return data[0] === 0x80 ? false : send.call(this, data); }; clock.tick(301);
      expect(f.ports.getState().lastInputSafety.cleanup).to.include({ releaseSubmitted: 0, uncertain: 1 });
      expect(f.ports.getRecording().some(event => event.source === 'input-safety')).to.equal(false); expect(offMessages(f.messages)).to.deep.equal([]); f.dispose();
    });
  });

  it('contains consumer exceptions and preserves immutable ingress and submission evidence', function() {
    withFakeClockAndPerformance(clock => {
      const f = fixture({ consumers: { onState() { throw new Error('UI failed'); }, onMonitor(event) { event.data[1] = 99; },
        onRecord(event) { event.data[1] = 77; } }, onInputSafety() { throw new Error('gesture failed'); } });
      f.ports.configure({ recording: true }); f.ports.learnNext(() => { throw new Error('learn failed'); });
      expect(f.ports.receiveMidi([0xfe])).to.equal(true); expect(f.ports.receiveMidi([0x90, 60, 80])).to.equal(true);
      expect(f.messages).to.deep.equal([[0x90, 60, 80]]); expect(f.ports.getState().activeNoteOutputIds).to.deep.equal(['notes']);
      clock.tick(301); expect(offMessages(f.messages)).to.deep.equal([[0x80, 60, 0]]);
      expect(f.ports.getRecording().filter(event => event.type === 'noteOn').every(event => event.note === 60)).to.equal(true);
      expect(f.ports.getState().lastCallbackError.message).to.equal('UI failed'); f.dispose();
    });
  });

  for (const consumer of ['monitor', 'record', 'learn']) it('does not forward a stale packet after its ' + consumer + ' consumer replaces the source', function() {
    withFakeClockAndPerformance(() => {
      let f;
      const replace = () => { if (f) f.ports.setInput({ id: 'new-source' }); };
      f = fixture({ consumers: consumer === 'monitor' ? { onMonitor: replace } : consumer === 'record' ? { onRecord: replace } : {} });
      f.ports.configure({ recording: true }); if (consumer === 'learn') f.ports.learnNext(replace);
      expect(f.ports.receiveMidi([0x90, 60, 80])).to.equal(false);
      expect(f.messages).to.deep.equal([]); expect(f.ports.getState().inputId).to.equal('new-source'); f.dispose();
    });
  });
});
