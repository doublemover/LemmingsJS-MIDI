import { expect } from 'chai';
import fs from 'node:fs';
import vm from 'node:vm';
import { lowerMidi2ChannelVoice, scaleMidiResolution } from '../../js/midi/protocol/MidiProtocolLowering.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const policy = { groupMap: { 0: 'preserve' } };
const packet = (opcode, value, { group = 0, channel = 1, index = 0, detail = 0 } = {}) =>
  [((4 << 28) | (group << 24) | (opcode << 20) | ((channel - 1) << 16) | (index << 8) | detail) >>> 0, value >>> 0];
const note = (opcode, noteIndex, velocity = 32768, pitch = null) => packet(opcode, velocity * 65536 + (pitch == null ? 0 : pitch * 512),
  { index: noteIndex, detail: pitch == null ? 0 : 3 });
const fixture = (limits = {}) => {
  const messages = [], output = { id: 'bytes', state: 'connected', send(data) { messages.push([...data]); return true; } };
  const scheduler = new MidiScheduler({ mpe: { enabled: false }, limits });
  const ports = createProcgenMidiPorts({ scheduler, now: () => 0 });
  ports.setNoteOutput(output); ports.configure({ protocolLowering: policy, recording: true });
  return { ports, scheduler, output, messages, dispose() { ports.dispose(); scheduler.dispose(); } };
};

describe('explicit MIDI 2 to MIDI 1 endpoint lowering', function() {
  for (const kind of ['bank', 'ump-bank', 'raw-note']) it(`does not submit an old ${kind} plan when reservation callbacks replace its route`, () => {
    const f = fixture({ maxEventsPerSecond: 100 }), replacement = { id: f.output.id, send(data) { f.messages.push(['replacement', ...data]); return true; } };
    const reserve = f.scheduler.evaluateAndReserve; let replaced = false;
    f.scheduler.evaluateAndReserve = function(...args) {
      const result = reserve.apply(this, args);
      if (!replaced) { replaced = true; f.ports.setNoteOutput(replacement, { rearm: true }); }
      return result;
    };
    try {
      const result = kind === 'bank' ? f.ports.sendEvent({ type: 'bank', msb: 6, lsb: 7 }) : kind === 'ump-bank' ? f.ports.sendEvent({ umpWords: [0x40c00001, 0x05000607] }) :
        f.ports.sendNote({ note: 60, bankMsb: 6, bankLsb: 7, program: 5, durationMs: 100 });
      expect(result).to.equal(false); expect(f.messages).to.deep.equal([]);
      expect(f.scheduler.getRateSnapshot(0).next.count).to.equal(0);
    } finally { f.dispose(); }
  });
  it('matches normative scaling extrema, center and asymmetric reference values', function() {
    for (const [input, bits16, bits32] of [[0, 0, 0], [5, 2560, 167772160], [64, 32768, 2147483648],
      [70, 35888, 2352005900], [96, 49412, 3238268993], [120, 61895, 4056358001], [127, 65535, 4294967295]]) {
      expect(scaleMidiResolution(input, 7, 16)).to.equal(bits16); expect(scaleMidiResolution(input, 7, 32)).to.equal(bits32);
    }
    for (let value = 0; value < 128; value++) for (const destination of [16, 32]) {
      expect(scaleMidiResolution(scaleMidiResolution(value, 7, destination), destination, 7)).to.equal(value);
    }
    for (let value = 0; value < 16384; value++) expect(scaleMidiResolution(scaleMidiResolution(value, 14, 32), 32, 14)).to.equal(value);
    expect(scaleMidiResolution(0xffff, 16, 7, { zeroExtension: true })).to.equal(127);
    expect(scaleMidiResolution(127, 7, 16, { zeroExtension: true })).to.equal(0xfe00);
    expect(() => scaleMidiResolution(-1, 32, 7)).to.throw(RangeError);
  });

  it('preserves Note On semantics for all low velocity boundaries and keeps source words immutable', function() {
    for (const velocity of [0, 1, 127, 255, 511, 512, 32768, 65535]) {
      const words = note(9, 60, velocity), before = [...words], lowered = lowerMidi2ChannelVoice(words, policy);
      expect(lowered.messages).to.deep.equal([[0x90, 60, Math.max(1, Math.floor(velocity / 512))]]);
      expect(words).to.deep.equal(before); expect(Object.isFrozen(lowered.sourceWords)).to.equal(true);
      expect(Object.isFrozen(lowered.messages[0])).to.equal(true);
    }
    const off = lowerMidi2ChannelVoice(note(8, 0, 0), policy, { ownedAddress: { note: 60, channel: 1 } });
    expect(off.messages).to.deep.equal([[0x80, 60, 0]]);
  });

  it('encodes RPN and NRPN data entry asymmetrically, including every low seven-bit boundary', function() {
    for (const [value, msb, lsb] of [[0x12345678, 9, 13], [0x00fc0000, 0, 63]]) {
      const lowered = lowerMidi2ChannelVoice(packet(2, value), policy);
      expect(lowered.messages).to.deep.equal([[0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, msb], [0xb0, 38, lsb], [0xb0, 101, 127], [0xb0, 100, 127]]);
    }
    for (let low = 0; low < 128; low++) {
      const lowered = lowerMidi2ChannelVoice(packet(2, (9 * 128 + low) * 262144), policy);
      expect(lowered.messages[2]).to.deep.equal([0xb0, 6, 9]); expect(lowered.messages[3]).to.deep.equal([0xb0, 38, low]);
    }
    expect(lowerMidi2ChannelVoice(packet(3, 0x12345678, { index: 3, detail: 5 }), policy).messages.slice(0, 4))
      .to.deep.equal([[0xb0, 99, 3], [0xb0, 98, 5], [0xb0, 6, 9], [0xb0, 38, 13]]);
    expect(lowerMidi2ChannelVoice(packet(2, 0x00020000, { detail: 1 }), policy).messages[3]).to.deep.equal([0xb0, 38, 1]);
    expect(lowerMidi2ChannelVoice(packet(2, 0x00020000), policy).messages[3]).to.deep.equal([0xb0, 38, 0]);
    expect(lowerMidi2ChannelVoice(packet(2, 0x12345678, { detail: 2 }), policy).messages[3]).to.deep.equal([0xb0, 38, 0]);
    expect(lowerMidi2ChannelVoice(packet(2, 0x00020000, { index: 1, detail: 1 }), policy).messages[3]).to.deep.equal([0xb0, 38, 0]);
  });

  it('requires an explicit group map and reports unsupported semantics instead of a silent success', function() {
    expect(lowerMidi2ChannelVoice(note(9, 60), {}).reason).to.equal('unmapped-group');
    expect(lowerMidi2ChannelVoice(packet(9, 0x80000000, { group: 3, index: 60 }), { groupMap: { 3: 5 } }).messages).to.deep.equal([[0x94, 60, 64]]);
    for (const opcode of [4, 5]) expect(lowerMidi2ChannelVoice(packet(opcode, 0xffffffff), policy).reason).to.equal('relative-controller-unavailable');
    expect(lowerMidi2ChannelVoice(packet(2, 0, { detail: 7 }), policy).reason).to.equal('per-note-sensitivity-unavailable');
    expect(lowerMidi2ChannelVoice(packet(2, 0, { detail: 1 }), { ...policy, supportedRegisteredControllers: [0] }).reason).to.equal('registered-controller-unavailable');
    expect(lowerMidi2ChannelVoice(packet(6, 0x80000000), policy).reason).to.equal('per-note-pitch-unavailable');
    expect(lowerMidi2ChannelVoice([0x40903c00], policy).reason).to.equal('invalid-midi2-channel-packet');
    expect(lowerMidi2ChannelVoice([0x40903c00, -1], policy).reason).to.equal('invalid-midi2-channel-packet');
    expect(lowerMidi2ChannelVoice(note(8, 0), policy, { ownedAddress: { channel: 2, note: 60 } }).reason).to.equal('owned-address-mismatch');
  });

  it('keeps bank/program ordering and pitch bend extrema and validates the bytes with the vendored independent parser', function() {
    const browser = { window: {}, performance: { now: () => 0 }, console };
    vm.runInNewContext(fs.readFileSync(new URL('../../js/vendor/webmidi.js', import.meta.url), 'utf8'), browser);
    const program = lowerMidi2ChannelVoice([0x40c00001, 0x05000607], policy);
    expect(program.messages).to.deep.equal([[0xb0, 0, 6], [0xb0, 32, 7], [0xc0, 5]]);
    const vectors = [[0, [0xe0, 0, 0]], [0x80000000, [0xe0, 0, 64]], [0xffffffff, [0xe0, 127, 127]]];
    const messages = [...program.messages];
    for (const [value, expected] of vectors) { const plan = lowerMidi2ChannelVoice(packet(0xe, value), policy); expect(plan.messages).to.deep.equal([expected]); messages.push(...plan.messages); }
    for (const data of messages) {
      const parsed = new browser.window.Message(Uint8Array.from(data));
      expect(parsed.channel).to.equal(1); expect(parsed.command).to.equal(data[0] >> 4);
      expect(Array.from(parsed.dataBytes)).to.deep.equal(data.slice(1)); expect(parsed.dataBytes.every(value => value >= 0 && value < 128)).to.equal(true);
    }
  });

  it('submits regenerated sounding pitch, rejects a conflicting actor, and releases by source index', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture();
      expect(f.ports.sendEvent({ umpWords: note(9, 0, 32768, 60) })).to.equal(true);
      expect(f.messages).to.deep.equal([[0x90, 60, 64]]);
      expect(f.ports.sendEvent({ umpWords: note(9, 1, 32768, 60) })).to.equal(false);
      expect(f.ports.getState().lastLowering.reason).to.equal('voice-address-collision');
      expect(f.ports.sendEvent({ umpWords: packet(0xa, 0x80000000) })).to.equal(true);
      expect(f.messages.at(-1)).to.deep.equal([0xa0, 60, 64]);
      expect(f.ports.sendEvent({ umpWords: note(8, 0, 0) })).to.equal(true);
      expect(f.messages.at(-1)).to.deep.equal([0x80, 60, 0]);
      expect(f.ports.getRecording()[0].sourceUmp).to.deep.equal(note(9, 0, 32768, 60));
      f.dispose();
    });
  });

  it('makes a chosen retrigger approximation explicit and cannot release the replacement through the old actor index', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture(); f.ports.configure({ protocolLowering: { ...policy, samePitchPolicy: 'retrigger' } });
      f.ports.sendEvent({ umpWords: note(9, 0, 32768, 60) }); f.ports.sendEvent({ umpWords: note(9, 1, 32768, 60) });
      expect(f.messages).to.deep.equal([[0x90, 60, 64], [0x80, 60, 64], [0x90, 60, 64]]);
      expect(f.ports.getState().lastLowering.losses.some(loss => loss.reason === 'previous-voice-retriggered')).to.equal(true);
      expect(f.ports.sendEvent({ umpWords: note(8, 0) })).to.equal(false);
      expect(f.ports.sendEvent({ umpWords: note(8, 1) })).to.equal(true);
      expect(f.messages.at(-1)[0]).to.equal(0x80); f.dispose();
    });
  });

  it('admits every bank/program byte together and retains only an accepted prefix on failure', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture({ maxEventsPerSecond: 2 });
      expect(f.ports.sendEvent({ umpWords: [0x40c00001, 0x05000607] })).to.equal(false); expect(f.messages).to.deep.equal([]);
      f.ports.configure({ schedulerConfig: { mpe: { enabled: false }, limits: { maxEventsPerSecond: 10 } } });
      const send = f.output.send; f.output.send = function(data) { return data[1] === 32 ? false : send.call(this, data); };
      expect(f.ports.sendEvent({ umpWords: [0x40c00001, 0x05000607] })).to.equal(false);
      expect(f.messages).to.deep.equal([[0xb0, 0, 6]]);
      expect(f.scheduler.getRateSnapshot(0).past).to.include({ count: 1, bytes: 3 });
      expect(f.scheduler.getRateSnapshot(0).next.count).to.equal(0);
      expect(f.ports.getState().lastLowering).to.include({ submittedMessages: 1, reason: 'partial-submission' }); f.dispose();
    });
  });

  it('qualifies fractional pitch loss and invalidates source ownership after stop and policy changes', function() {
    withFakeClockAndPerformance(() => {
      const f = fixture();
      expect(f.ports.sendEvent({ umpWords: note(9, 0, 32768, 60.5) })).to.equal(false);
      expect(f.ports.getState().lastLowering.reason).to.equal('fractional-pitch-unavailable');
      f.ports.configure({ protocolLowering: { ...policy, pitchPolicy: 'round' } });
      expect(f.ports.sendEvent({ umpWords: note(9, 0, 32768, 60.5) })).to.equal(true);
      expect(f.messages.at(-1)).to.deep.equal([0x90, 61, 64]);
      expect(f.ports.getState().lastLowering.losses[0]).to.include({ reason: 'rounded-pitch', source: 60.5, destination: 61 });
      f.ports.flush(); expect(f.ports.sendEvent({ umpWords: note(8, 0) })).to.equal(false); f.dispose();
    });
  });

  it('captures actual vendored WebMidi RPN, attack and release bytes at its native adapter boundary', function() {
    withFakeClockAndPerformance(() => {
      const browser = { window: {}, performance: { now: () => 0 }, console }, accepted = [];
      vm.runInNewContext(fs.readFileSync(new URL('../../js/vendor/webmidi.js', import.meta.url), 'utf8'), browser);
      const output = new browser.window.Output({ id: 'vendored', state: 'connected', send(data) { accepted.push(Array.from(data)); } });
      const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      const ports = createProcgenMidiPorts({ scheduler, now: () => 0 }); ports.configure({ recording: true }); ports.setNoteOutput(output);
      expect(ports.sendNote({ note: 60, velocity: 80, pitchBend: 0.5, durationTicks: 0 })).to.equal(true); ports.flush();
      expect(ports.getRecording().map(event => event.data)).to.deep.equal(accepted);
      expect(accepted).to.include.deep.members([[0xe1, 127, 95], [0x81, 60, 64]]);
      expect(scheduler.getRateSnapshot(0).past.count).to.equal(accepted.length); ports.dispose(); scheduler.dispose();
    });
  });
});
