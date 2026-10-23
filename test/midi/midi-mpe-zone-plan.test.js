import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createMpeZonePlan } from '../../js/midi/scheduler/MpeZonePlan.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const mpe = extra => ({ enabled: true, masterChannel: 1, memberChannels: [2], ...extra });
const byteOutput = (rejectAt = -1) => {
  const messages = [], attempts = [], port = { id: 'zone', state: 'connected', channels: {}, send(data) {
    attempts.push([...data]); if (attempts.length - 1 === rejectAt) return false; messages.push([...data]); return true;
  } };
  for (const channel of [1, 2, 3, 15, 16]) {
    const status = channel - 1, cc = (controller, value) => port.send([0xb0 | status, controller, value]);
    port.channels[channel] = {
      sendControlChange: cc,
      sendPitchBendRange(semitones, cents) { for (const [controller, value] of [[101, 0], [100, 0], [6, semitones], [38, cents], [101, 127], [100, 127]]) cc(controller, value); },
      sendPitchBend(value) { const bend = Math.round((value + 1) * 16383 / 2); port.send([0xe0 | status, bend & 127, bend >> 7]); },
      sendProgramChange(program) { port.send([0xc0 | status, program]); },
      sendNoteOn(note, options = {}) { port.send([0x90 | status, note, options.rawAttack ?? 64]); },
      sendNoteOff(note, options = {}) { port.send([0x80 | status, note, options.rawRelease ?? 64]); }
    };
  }
  return { port, messages, attempts };
};

describe('qualified legacy MPE zones', function() {
  it('validates contiguous lower and upper zones with distinct manager and member pitch ranges', function() {
    const lower = createMpeZonePlan(mpe({ memberChannels: [3, 2] }));
    expect(lower).to.include({ ok: true, zone: 'lower', managerChannel: 1, configuration: 'manual', verified: false });
    expect(lower.memberChannels).to.deep.equal([2, 3]); expect(lower.memberRange).to.deep.equal({ semitones: 48, cents: 0 });
    expect(lower.managerRange).to.deep.equal({ semitones: 2, cents: 0 });
    const upper = createMpeZonePlan(mpe({ masterChannel: 16, memberChannels: [14, 15], pitchBendRange: { semitones: 12, cents: 25 } }));
    expect(upper).to.include({ ok: true, zone: 'upper' }); expect(upper.memberChannels).to.deep.equal([15, 14]);
    expect(upper.memberRange).to.deep.equal({ semitones: 12, cents: 25 }); expect(Object.isFrozen(upper.memberChannels)).to.equal(true);
  });

  it('rejects malformed, overlapping, reserved and unsupported zones without sending setup', function() {
    withFakeClockAndPerformance(() => {
      const cases = [[{ memberChannels: [] }, 'empty-mpe-zone'], [{ masterChannel: 4 }, 'invalid-mpe-channel'],
        [{ memberChannels: [2, 4] }, 'noncontiguous-mpe-zone'], [{ memberChannels: [3] }, 'noncontiguous-mpe-zone'],
        [{ memberChannels: [2, 2] }, 'invalid-mpe-channel'], [{ memberChannels: [17] }, 'invalid-mpe-channel'],
        [{ memberChannels: Array.from({ length: 14 }, (_, index) => index + 2), oppositeZoneMemberCount: 1 }, 'overlapping-mpe-zones'],
        [{ oppositeZoneMemberCount: 16 }, 'invalid-opposite-mpe-zone'], [{ pitchBendRange: { semitones: 97 } }, 'invalid-mpe-pitch-range'],
        [{ masterPitchBendRange: { semitones: 2, cents: -1 } }, 'invalid-mpe-pitch-range'], [{ configuration: 'ci-profile' }, 'unsupported-mpe-configuration'],
        [{ voicePolicy: 'share' }, 'unsupported-mpe-voice-policy'], [{ receiverMpe: false }, 'receiver-mpe-unsupported']];
      for (const [extra, reason] of cases) {
        const f = byteOutput(), scheduler = new MidiScheduler({ mpe: mpe(extra) }); scheduler.setOutput(f.port);
        expect(scheduler.getOutputRouteState('zone').mpeFailure, reason).to.equal(reason);
        expect(scheduler.sendNote({ note: 60, pitchBend: 0.5 })).to.equal(false); expect(f.messages).to.deep.equal([]); scheduler.dispose();
      }
      expect(createMpeZonePlan(mpe(), new Set([2])).reason).to.equal('reserved-mpe-channel');
      expect(createMpeZonePlan(mpe({ memberChannels: Array.from({ length: 7 }, (_, index) => index + 2), oppositeZoneMemberCount: 7 })).ok).to.equal(true);
    });
  });

  it('sends requested zone configuration before distinct ranges without claiming receiver verification', function() {
    withFakeClockAndPerformance(() => {
      const f = byteOutput(), scheduler = new MidiScheduler({ mpe: mpe({ configuration: 'send-zone', pitchBendRange: { semitones: 24, cents: 0 } }) });
      scheduler.setOutput(f.port);
      expect(f.messages.slice(0, 5)).to.deep.equal([[0xb0, 101, 0], [0xb0, 100, 6], [0xb0, 6, 1], [0xb0, 101, 127], [0xb0, 100, 127]]);
      expect(f.messages).to.include.deep.members([[0xb0, 6, 2], [0xb1, 6, 24]]);
      expect(f.messages.some(data => data[1] === 121)).to.equal(false);
      expect(scheduler.getOutputRouteState('zone')).to.include({ mpeReady: true, mpeEvidence: 'zone-configuration-api-accepted', expressiveCapacity: 1,
        voicePolicy: 'steal-oldest' });
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 19, bytes: 57 });
      expect(scheduler.getOutputRouteState('zone').mpeZone.verified).to.equal(false); scheduler.dispose();
      const manual = byteOutput(), assumed = new MidiScheduler({ mpe: mpe() }); assumed.setOutput(manual.port);
      expect(manual.messages.some(data => data[1] === 100 && data[2] === 6)).to.equal(false);
      expect(assumed.getOutputRouteState('zone').mpeEvidence).to.equal('manual-zone-api-accepted'); assumed.dispose();
    });
  });

  it('admits the complete requested setup before sending any byte and retains every accepted failure prefix', function() {
    withFakeClockAndPerformance(() => {
      const bounded = byteOutput(), denied = new MidiScheduler({ mpe: mpe({ configuration: 'send-zone' }), limits: { maxEventsPerSecond: 18 } });
      denied.setOutput(bounded.port); expect(bounded.messages).to.deep.equal([]); expect(denied.getOutputRouteState('zone').mpeFailure).to.equal('setup-count-limit'); denied.dispose();
      for (let rejected = 0; rejected < 19; rejected++) {
        const f = byteOutput(rejected), scheduler = new MidiScheduler({ mpe: mpe({ configuration: 'send-zone' }) }); scheduler.setOutput(f.port);
        expect(f.messages, 'prefix ' + rejected).to.have.length(rejected);
        expect(scheduler.getRateSnapshot(0).past.count).to.equal(rejected); expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
        expect(scheduler.getOutputRouteState('zone').mpeReady).to.equal(false);
        expect(scheduler.sendNote({ note: 60 })).to.equal(false);
        expect(scheduler.rearmOutput('zone')).to.equal(true); expect(scheduler.sendNote({ note: 60 })).to.equal(true); scheduler.dispose();
      }
    });
  });

  it('retires the old member before a valid opposite-zone transaction and never resurrects old addresses', function() {
    withFakeClockAndPerformance(clock => {
      const f = byteOutput(), scheduler = new MidiScheduler({ mpe: mpe() }); scheduler.setOutput(f.port); f.messages.length = 0;
      scheduler.sendNote({ note: 60 }); scheduler.sendNote({ note: 62, timeMs: 500 }); f.messages.length = 0;
      scheduler.setConfig({ mpe: mpe({ masterChannel: 16, memberChannels: [15], configuration: 'send-zone' }) });
      expect(f.messages[0]).to.deep.equal([0x81, 60, 64]); expect(f.messages[1][0]).to.equal(0xe1);
      expect(f.messages[2]).to.deep.equal([0xbf, 101, 0]);
      scheduler.sendNote({ note: 64 }); scheduler.sendNote({ note: 67 }); clock.tick(600);
      expect(f.messages.filter(data => (data[0] & 0xf0) === 0x90)).to.deep.equal([[0x9e, 64, 64], [0x9e, 67, 64]]);
      expect(scheduler._activeByChannel.get('zone:15').note).to.equal(67); scheduler.dispose();
    });
  });

  it('invalidates a zone when newly reserved ensemble channels collide with its members', function() {
    withFakeClockAndPerformance(() => {
      const f = byteOutput(), scheduler = new MidiScheduler({ mpe: mpe() }); scheduler.setOutput(f.port); scheduler.sendNote({ note: 60 });
      scheduler.setConfig({ mpe: mpe(), ensemble: { enabled: true, roles: [{ track: { channel: 2 } }] } });
      expect(scheduler.getOutputRouteState('zone').mpeFailure).to.equal('reserved-mpe-channel');
      expect(scheduler._activeNotes.size).to.equal(0); expect(scheduler.sendNote({ note: 64 })).to.equal(false); scheduler.dispose();
    });
  });

  it('supports explicit reject capacity without stealing held voices and rejects a queued onset at its dispatch time', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: mpe({ voicePolicy: 'reject' }) }); scheduler.setOutput(makeOutput([1, 2], calls)); calls.length = 0;
      expect(scheduler.sendNote({ note: 60 })).to.equal(true); expect(scheduler.sendNote({ note: 64 })).to.equal(false);
      expect(scheduler.sendNote({ note: 67, timeMs: 100 })).to.equal(true); clock.tick(100);
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([60]);
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
      expect(scheduler.getOutputPressure().reason).to.equal('mpe-capacity'); expect(scheduler._pendingNoteOns.size).to.equal(0);
      expect(scheduler.getRateSnapshot().next.count).to.equal(0); scheduler.dispose();
    });
  });

  it('makes same-time stealing deterministic and identifies the displaced actor in terminal receipts', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], events = [], scheduler = new MidiScheduler({ mpe: mpe() }); scheduler.setOutput(makeOutput([1, 2], calls)); calls.length = 0;
      scheduler.setCapture({ isActive: () => true, record(stage, fields) { events.push({ stage, ...fields }); return events.length; } });
      scheduler.sendNote({ note: 60, timeMs: 100 }, { lemmingId: 'first' }); scheduler.sendNote({ note: 64, timeMs: 100 }, { lemmingId: 'second' });
      expect(calls).to.deep.equal([]); clock.tick(100);
      expect(calls.filter(call => ['noteOn', 'noteOff'].includes(call.type)).map(call => [call.type, call.note])).to.deep.equal([
        ['noteOn', 60], ['noteOff', 60], ['noteOn', 64]
      ]);
      expect(events.find(event => event.stage === 'voice-terminal' && event.reason === 'mpe-channel-steal')).to.include({ lemmingId: 'first', state: 'release-submitted' });
      scheduler.dispose();
    });
  });

  it('addresses ordinary bank/program selection to the manager and permits explicit Mode 4 member programs', function() {
    withFakeClockAndPerformance(() => {
      for (const programPolicy of ['zone', 'member-mode4']) {
        const f = byteOutput(), scheduler = new MidiScheduler({ mpe: mpe({ programPolicy }) }); scheduler.setOutput(f.port); f.messages.length = 0;
        expect(scheduler.sendNote({ note: 60, bankMsb: 2, bankLsb: 3, program: 4 })).to.equal(true);
        const channel = programPolicy === 'zone' ? 0 : 1;
        expect(f.messages.slice(0, 3)).to.deep.equal([[0xb0 | channel, 0, 2], [0xb0 | channel, 32, 3], [0xc0 | channel, 4]]);
        expect(f.messages.at(-1)).to.deep.equal([0x91, 60, 64]); scheduler.dispose();
      }
    });
  });

  it('clears rejected MPE evidence when the route explicitly switches to ordinary MIDI', function() {
    withFakeClockAndPerformance(() => {
      const f = byteOutput(), scheduler = new MidiScheduler({ mpe: mpe({ memberChannels: [] }) }); scheduler.setOutput(f.port);
      expect(scheduler.getOutputRouteState('zone')).to.include({ mpeReady: false, mpeFailure: 'empty-mpe-zone' });
      scheduler.setConfig({ mpe: { enabled: false }, defaultChannel: 1 });
      expect(scheduler.getOutputRouteState('zone')).to.include({ mpeReady: null, mpeFailure: null, mpeEvidence: null, mpeZone: null });
      expect(scheduler.sendNote({ note: 60 })).to.equal(true); expect(f.messages.at(-1)).to.deep.equal([0x90, 60, 64]); scheduler.dispose();
    });
  });
});
