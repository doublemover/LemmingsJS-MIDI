import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { validProcgenMidiChannelBytes } from '../../js/app/procgen/workstation/ProcgenMidiBytes.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const configuration = (limits = {}) => ({ mpe: { enabled: false }, limits });
const plan = (count = 1) => ({ on: { timeMs: 0, count, bytes: count * 3 } });
const fixture = (limits = {}) => {
  const messages = [], output = { id: 'a', state: 'connected', channels: {}, send(data) { messages.push([...data]); return true; } };
  output.channels[1] = {
    sendControlChange(cc, value) { return output.send([0xb0, cc, value]); },
    sendNoteOn(note, options = {}) { return output.send([0x90, note, options.rawAttack ?? 64]); },
    sendNoteOff(note, options = {}) { return output.send([0x80, note, options.rawRelease ?? 64]); }
  };
  const scheduler = new MidiScheduler(configuration(limits)), ports = createProcgenMidiPorts({ scheduler, now: () => 0 });
  ports.setNoteOutput(output); ports.configure({ recording: true });
  return { scheduler, ports, output, messages, dispose() { ports.dispose(); scheduler.dispose(); } };
};

describe('MIDI reservation and encoded dispatch transactions', function() {
  it('rechecks an evaluated plan after intervening traffic and refuses closed reservation reuse', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture({ maxEventsPerSecond: 1 }), evaluated = f.scheduler.canSchedule(plan(), 0);
      const first = f.scheduler.reserve(plan(), { outputId: 'a' }, 0);
      expect(f.scheduler.reserveEvaluation(evaluated, plan(), { outputId: 'a' }, 0)).to.include({ ok: false, reason: 'count-limit' });
      const inspected = f.scheduler.inspectReservation(first.reservationId); expect(inspected).to.include({ state: 'pending', outputId: 'a' });
      expect(inspected.phases.on).to.deep.equal({ count: 1, bytes: 3 }); expect(Object.isFrozen(inspected.phases.on)).to.equal(true);
      f.scheduler._releaseReservation(first.reservationId);
      expect(f.scheduler.reserveEvaluation(first, plan(), { outputId: 'a' }, 0)).to.include({ ok: false, reason: 'closed-reservation' });
      expect(f.scheduler.inspectReservation(first.reservationId).state).to.equal('not-pending'); f.dispose();
    });
  });

  it('binds an evaluation to its route epoch before creating its reservation', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(), evaluated = f.scheduler.canSchedule(plan(), 0);
      f.scheduler.setOutput({ id: 'a', channels: f.output.channels });
      expect(f.scheduler.reserveEvaluation(evaluated, plan(), { outputId: 'a' }, 0)).to.include({ ok: false, reason: 'stale-route-evaluation' });
      expect(f.scheduler.getRateSnapshot(0).next.count).to.equal(0); f.dispose();
    });
  });

  it('rejects wrong-endpoint and excessive commits without consuming the rightful owner capacity', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.scheduler.setOutputs([f.output, { id: 'b' }]);
      const reservation = f.scheduler.reserve(plan(), { outputId: 'a' }, 0), id = reservation.reservationId;
      expect(f.scheduler._commitReservationMessage(id, 'on', 3, { outputId: 'b' }, 0)).to.equal(false);
      expect(f.scheduler.getOutputPressure(0, 'a').lastReservationIssue.reason).to.equal('wrong-endpoint');
      expect(f.scheduler._commitReservationCost(id, 'on', 2, 6, { outputId: 'a' }, 0)).to.equal(false);
      expect(f.scheduler.lastReservationIssue.reason).to.equal('cost-exceeded'); expect(f.scheduler.inspectReservation(id).phases.on.count).to.equal(1);
      expect(f.scheduler._commitReservationMessage(id, 'on', 3, { outputId: 'a' }, 0)).to.equal(true);
      expect(f.scheduler._commitReservationMessage(id, 'on', 3, { outputId: 'a' }, 0)).to.equal(false);
      expect(f.scheduler.getRateSnapshot(0).past).to.include({ count: 1, bytes: 3 }); f.dispose();
    });
  });

  it('cannot use event metadata to spend another endpoint reservation or bypass its own quota', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture({ maxEventsPerSecond: 1 }), other = { id: 'b', send(data) { f.messages.push([...data]); } };
      f.ports.setNoteOutputs([f.output, other]); f.ports.setActiveNoteOutputs([{ outputId: 'b' }]);
      const a = f.scheduler.reserve(plan(), { outputId: 'a' }, 0);
      expect(f.ports.sendEvent({ type: 'cc', controller: 1, value: 10, outputId: 'b' })).to.equal(true);
      expect(f.ports.sendEvent({ type: 'cc', controller: 2, value: 20, outputId: 'b', reservationId: a.reservationId })).to.equal(false);
      expect(f.scheduler.inspectReservation(a.reservationId).phases.on.count).to.equal(1); expect(f.messages).to.deep.equal([[0xb0, 1, 10]]); f.dispose();
    });
  });

  it('admits both ordinary bank selectors atomically and retains only their accepted prefix', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture({ maxEventsPerSecond: 1 });
      expect(f.ports.sendEvent({ type: 'bank', msb: 3, lsb: 5 })).to.equal(false); expect(f.messages).to.deep.equal([]);
      f.ports.configure({ schedulerConfig: configuration({ maxEventsPerSecond: 10 }) });
      const send = f.output.send; f.output.send = function(data) { return data[1] === 32 ? false : send.call(this, data); };
      expect(f.ports.sendEvent({ type: 'bank', msb: 3, lsb: 5 })).to.equal(false);
      expect(f.messages).to.deep.equal([[0xb0, 0, 3]]); expect(f.scheduler.getRateSnapshot(0).past).to.include({ count: 1, bytes: 3 });
      expect(f.scheduler.getRateSnapshot(0).next.count).to.equal(0); f.dispose();
    });
  });

  it('rejects malformed final channel packets and invalid schedule fields before activating a discovered output', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      const ports = createProcgenMidiPorts({ scheduler, now: () => 0 }), output = makeOutput([1, 2], calls, 'unused'); ports.setNoteOutputs([output]);
      for (const data of [[], [0x90, 60], [0x90, 60, 128], [0xc0, 3, 4], [0xf8], [0x90, -1, 1], [0x90, 60, NaN], new Array(100000)]) {
        expect(validProcgenMidiChannelBytes(data)).to.equal(false); expect(ports.sendEvent({ data, outputId: 'unused' })).to.equal(false);
      }
      for (const timeMs of [NaN, Infinity, -1]) {
        expect(ports.sendNote({ note: 60, timeMs, outputId: 'unused' })).to.equal(false);
        expect(ports.sendEvent({ type: 'cc', controller: 1, value: 1, timeMs, outputId: 'unused' })).to.equal(false);
      }
      expect(ports.sendNote({ note: 60, durationMs: -1, outputId: 'unused' })).to.equal(false);
      expect(calls).to.deep.equal([]); expect(ports.getState().activeNoteOutputIds).to.deep.equal([]); ports.dispose(); scheduler.dispose();
    });
  });

  for (const outcome of ['throw', 'false']) it('charges an accepted ordinary controller prefix before a helper ' + outcome + ' without admitting its onset', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.output.channels[1].sendControlChange = (cc, value) => {
        f.output.send([0xb0, cc, value]); if (outcome === 'throw') throw new Error('after accepted control'); return false;
      };
      expect(f.ports.sendNote({ note: 60, timbre: 99 })).to.equal(false);
      expect(f.messages).to.deep.equal([[0xb0, 74, 99]]); expect(f.ports.getRecording().map(event => event.data)).to.deep.equal(f.messages);
      expect(f.scheduler.getRateSnapshot(0).past).to.include({ count: 1, bytes: 3 }); expect(f.scheduler.getRateSnapshot(0).next.count).to.equal(0); f.dispose();
    });
  });

  it('does not invent a release for an onset that throws before submitting any byte', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.output.channels[1].sendNoteOn = () => { throw new Error('before submission'); };
      expect(f.ports.sendNote({ note: 60 })).to.equal(false); expect(f.messages).to.deep.equal([]);
      expect(f.ports.getRecording()).to.deep.equal([]); expect(f.scheduler.getRateSnapshot(0).past.count).to.equal(0); f.dispose();
    });
  });

  for (const outcome of ['throw', 'false']) it('releases and charges an onset accepted before its helper ' + outcome, function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.output.channels[1].sendNoteOn = note => {
        f.output.send([0x90, note, 64]); if (outcome === 'throw') throw new Error('after onset'); return false;
      };
      expect(f.ports.sendNote({ note: 60 })).to.equal(false);
      expect(f.messages).to.deep.equal([[0x90, 60, 64], [0x80, 60, 64]]);
      expect(f.ports.getRecording().map(event => event.data)).to.deep.equal(f.messages);
      expect(f.scheduler.getRateSnapshot(0).past).to.include({ count: 2, bytes: 6 }); expect(f.scheduler._activeNotes.size).to.equal(0); f.dispose();
    });
  });

  it('holds in-flight ownership uncertain until late accepted submission can be compensated', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(), events = []; f.scheduler.setCapture({ record(stage, fields) { events.push({ stage, ...fields }); return events.length; } });
      f.output.channels[1].sendNoteOn = note => { f.scheduler.allNotesOff(); f.output.send([0x90, note, 64]); return false; };
      expect(f.ports.sendNote({ note: 60 })).to.equal(false); expect(f.messages).to.deep.equal([[0x90, 60, 64], [0x80, 60, 64]]);
      expect(events.some(event => event.stage === 'voice-terminal' && event.evidence === 'submission-in-progress')).to.equal(true);
      expect(events.filter(event => event.stage === 'voice-terminal').at(-1).state).to.equal('release-submitted');
      expect(f.scheduler.getRateSnapshot(0).past).to.include({ count: 2, bytes: 6 }); f.dispose();
    });
  });
});
