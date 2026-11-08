import { expect } from 'chai';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMidiControllerMutations } from '../../js/midi/protocol/MidiControllerMutations.js';
import { decodeUmpPacket } from '../../js/midi/protocol/UmpPacketCodec.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const address = { endpointId: 'device', connectionEpoch: 1, group: 0, channel: 1, kind: 'assignable', bank: 1, index: 2 };
const descriptor = { absolute: true, relative: true, significantBits: 32 };
const words = (value, relative = true, target = address) => [((4 << 28) | target.group << 24 | (target.kind === 'registered' ? relative ? 4 : 2 : relative ? 5 : 3) << 20 |
  (target.channel - 1) << 16 | target.bank << 8 | target.index) >>> 0, value >>> 0];
const bind = (owner, rawValue, extra = {}) => owner.bind({ address, descriptor, rawValue, authority: 'local-authored', sourceRef: 'authored-parameter/v1', ...extra });
const apply = (owner, value, extra = {}) => {
  const plan = owner.prepare(words(value, extra.relative !== false, extra.address || address), { endpointId: 'device', connectionEpoch: 1, ...extra });
  return plan.ok ? owner.commit(plan) : plan;
};

describe('ordered authoritative controller mutations', () => {
  it('preserves the saturating +10/-10 counterexample rather than sum coalescing', () => {
    const owner = createMidiControllerMutations(); expect(bind(owner, 4294967293).ok).to.equal(true);
    expect(apply(owner, 10).rawValue).to.equal(4294967295); expect(apply(owner, -10).rawValue).to.equal(4294967285);
    expect(owner.read(address).rawValue).not.to.equal(4294967293); owner.dispose();
  });
  it('retains thousands of sub-step increments and exposes the declared low-resolution value', () => {
    const owner = createMidiControllerMutations(); bind(owner, 0, { descriptor: { ...descriptor, significantBits: 7 } });
    for (let i = 0; i < 2000; i++) expect(apply(owner, 223696).ok).to.equal(true);
    expect(owner.read(address)).to.include({ rawValue: 447392000, parameterValue: 13, rawRemainder: 11184384, receiverValue: null }); owner.dispose();
  });
  it('decodes signed extremes and zero exactly without interpreting -1 as an absolute maximum', () => {
    const owner = createMidiControllerMutations(); bind(owner, 0x80000000);
    expect(apply(owner, -1).rawValue).to.equal(0x7fffffff); expect(apply(owner, -2147483648).rawValue).to.equal(0);
    expect(apply(owner, 2147483647).rawValue).to.equal(2147483647); expect(apply(owner, 0).rawValue).to.equal(2147483647);
    expect(decodeUmpPacket(words(-1)).controllerValue).to.include({ signed: true, bits: 32, value: -1 }); owner.dispose();
  });
  it('preserves ordered absolute resets, alternating encoders and fast direction changes', () => {
    const owner = createMidiControllerMutations(); bind(owner, 100);
    for (const [value, relative, expected] of [[10, true, 110], [-20, true, 90], [1000, false, 1000], [30, true, 1030], [-40, true, 990]]) {
      expect(apply(owner, value, { relative }).rawValue).to.equal(expected);
    }
    const plans = [owner.prepare(words(5), { ...address, sequence: 6 }), owner.prepare(words(-5), { ...address, sequence: 7 })];
    expect(owner.commit(plans[1]).rawValue).to.equal(985); expect(owner.commit(plans[0]).reason).to.equal('stale-controller-mutation'); owner.dispose();
  });
  it('records replayable absolute packets separately from the original relative diagnostics', () => {
    const owner = createMidiControllerMutations(); bind(owner, 1234); const source = words(10), original = [...source];
    const plan = owner.prepare(source, address); expect(source).to.deep.equal(original); expect(plan.rawGestureWords).to.deep.equal(source);
    expect(decodeUmpPacket(plan.absoluteWords)).to.include({ status: 'assignableController', semantics: 'absolute' });
    expect(Object.isFrozen(plan.absoluteWords)).to.equal(true); expect(owner.commit(plan).operation).to.equal('set');
    for (let loop = 0; loop < 2; loop++) { const replay = owner.prepare(plan.absoluteWords, address); expect(owner.commit(replay).rawValue).to.equal(1244); }
    owner.dispose();
  });
  it('never manufactures a baseline and preserves the previous authoritative value after refusal', () => {
    const owner = createMidiControllerMutations(); expect(apply(owner, 1).reason).to.equal('unknown-controller-baseline');
    bind(owner, 50); const before = owner.read(address);
    expect(apply(owner, 1, { connectionEpoch: 2 }).reason).to.equal('unknown-controller-baseline');
    expect(apply(owner, 1, { baselineRevision: before.revision + 1 }).reason).to.equal('stale-controller-baseline');
    expect(owner.read(address)).to.deep.equal(before); owner.dispose();
  });
  it('fences delayed reports, descriptor replacement and one-shot mutation plans', () => {
    const owner = createMidiControllerMutations(), first = bind(owner, 100), pending = owner.prepare(words(10), address);
    const newer = bind(owner, 200, { expectedRevision: first.revision, authority: 'device-report', sourceRef: 'report/2' }); expect(newer.ok).to.equal(true);
    expect(owner.commit(pending).reason).to.equal('stale-controller-mutation');
    expect(bind(owner, 20, { expectedRevision: first.revision }).reason).to.equal('stale-controller-baseline');
    const next = owner.prepare(words(1), address); expect(owner.commit(next).ok).to.equal(true); expect(owner.commit(next).reason).to.equal('unknown-controller-mutation'); owner.dispose();
  });
  it('declares step, enum and saturation policy without rounding away the raw accumulator', () => {
    const owner = createMidiControllerMutations(); bind(owner, 0, { descriptor: { ...descriptor, significantBits: 7, step: 4, quantization: 'nearest' } });
    expect(apply(owner, 3 * 33554432 + 1)).to.include({ parameterValue: 4, rawRemainder: -33554431 });
    const revision = owner.read(address).revision;
    bind(owner, 80, { expectedRevision: revision, descriptor: { ...descriptor, minimumRaw: 50, maximumRaw: 100, enumValues: [60, 80, 100] } });
    expect(apply(owner, 100)).to.include({ rawValue: 100, parameterValue: 100 }); expect(apply(owner, -100)).to.include({ rawValue: 50, parameterValue: 60, rawRemainder: -10 }); owner.dispose();
  });
  it('keeps endpoint/epoch/group/channel/kind/bank/index namespaces independent', () => {
    const owner = createMidiControllerMutations(); bind(owner, 10);
    for (const patch of [{ endpointId: 'second' }, { connectionEpoch: 2 }, { group: 1 }, { channel: 2 }, { kind: 'registered' }, { bank: 2 }, { index: 3 }]) {
      const target = { ...address, ...patch }; bind(owner, 20, { address: target });
      expect(owner.read(target).rawValue).to.equal(20); expect(owner.read(address).rawValue).to.equal(10);
    }
    expect(owner.invalidateEndpoint('device')).to.equal(7); expect(owner.diagnostics().entries).to.equal(1); owner.dispose();
  });
  it('rejects capacity pressure visibly without evicting an authoritative live baseline', () => {
    const owner = createMidiControllerMutations({ maximumEntries: 1 }); bind(owner, 10);
    expect(bind(owner, 20, { address: { ...address, index: 3 } }).reason).to.equal('controller-state-capacity');
    expect(owner.read(address).rawValue).to.equal(10); expect(owner.diagnostics()).to.include({ entries: 1, rejected: 1 });
    owner.clear(); expect(owner.read(address).known).to.equal(false); owner.dispose(); expect(apply(owner, 1).reason).to.equal('controller-owner-disposed');
  });
  it('rejects unsupported forms, malformed packets and old sequence/time without state changes', () => {
    const owner = createMidiControllerMutations(); bind(owner, 100, { descriptor: { ...descriptor, relative: false } });
    expect(apply(owner, 1).reason).to.equal('controller-operation-unsupported');
    expect(owner.prepare([0x45b00100, 1], address).reason).to.equal('not-a-controller-mutation');
    expect(owner.prepare([0x40508102, 1], address).reason).to.equal('invalid-controller-packet');
    expect(apply(owner, 120, { relative: false, timestamp: 20, sequence: 5 }).ok).to.equal(true);
    expect(apply(owner, 130, { relative: false, timestamp: 19, sequence: 6 }).reason).to.equal('out-of-order-controller-mutation');
    expect(apply(owner, 130, { relative: false, timestamp: 21, sequence: 5 }).reason).to.equal('out-of-order-controller-mutation'); owner.dispose();
  });
  it('validates all bounded descriptor fields before retaining caller state', () => {
    for (const bad of [{ significantBits: 0 }, { step: 0 }, { enumValues: 0 }, { enumValues: new Array(2) }, { enumValues: [3, 2] }, { quantization: 'guess' }]) {
      const owner = createMidiControllerMutations(); expect(() => bind(owner, 0, { descriptor: { ...descriptor, ...bad } })).to.throw(RangeError); expect(owner.diagnostics().entries).to.equal(0);
    }
    const owner = createMidiControllerMutations(); expect(() => bind(owner, 0, { authority: 'last-submitted' })).to.throw(RangeError);
    expect(() => bind(owner, 0, { address: { ...address, index: 128 } })).to.throw(RangeError); owner.dispose();
  });
});

const portFixture = () => {
  const sent = [], browser = { window: {}, performance: { now: () => 0 }, console };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/vendor/webmidi.js', import.meta.url), 'utf8'), browser);
  const output = new browser.window.Output({ id: 'bytes', state: 'connected', send(data) { sent.push([...data]); return true; } });
  const scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxNotesPerSecond: 10000, maxBytesPerSecond: 100000 } });
  const ports = createProcgenMidiPorts({ scheduler, now: () => 0 }); ports.setNoteOutput(output);
  ports.configure({ protocolLowering: { groupMap: { 0: 'preserve' }, relativeControllers: 'resolve-verified-baseline' }, recording: true });
  const target = () => ({ outputId: 'bytes', connectionEpoch: ports.getState().outputRoutes.find(route => route.outputId === 'bytes').connectionEpoch, address });
  const baseline = rawValue => ports.bindControllerBaseline({ ...target(), descriptor, rawValue, authority: 'local-authored', sourceRef: 'authored/controller' });
  return { ports, scheduler, output, sent, target, baseline, close() { ports.dispose(); scheduler.dispose(); } };
};

describe('explicit verified controller lowering on real port owners', () => {
  it('requires explicit baselines and submits resolved absolute data entry with raw diagnostics', () => withFakeClockAndPerformance(() => {
    const f = portFixture(); try {
      expect(f.ports.sendEvent({ umpWords: words(10) })).to.equal(false); expect(f.ports.getState().lastLowering.reason).to.equal('unknown-controller-baseline'); expect(f.sent).to.deep.equal([]);
      expect(f.baseline(4294967293).ok).to.equal(true); expect(f.ports.sendEvent({ umpWords: words(10), intentId: 'physical-cause-1' })).to.equal(true);
      expect(f.ports.sendEvent({ umpWords: words(-10), intentId: 'physical-cause-2' })).to.equal(true);
      expect(f.ports.getControllerBaseline(f.target()).rawValue).to.equal(4294967285);
      expect(f.sent.flatMap(data => data[1])).not.to.include(96); expect(f.sent.flatMap(data => data[1])).not.to.include(97);
      const recorded = f.ports.getRecording().filter(event => event.rawRelativeGesture);
      expect(recorded).to.have.length(12); for (const event of recorded) { expect(event.controllerOperation).to.equal('set'); expect(decodeUmpPacket(event.umpWords).semantics).to.equal('absolute'); expect(event.intentId).to.match(/^physical-cause-/); }
      expect(f.ports.getState().lastLowering.controllerResolution).to.include({ operation: 'set', receiverValue: null, rawValue: 4294967285 });
    } finally { f.close(); }
  }));
  it('updates the same baseline for explicit absolute interleaves and invalidates it on Panic/program change', () => withFakeClockAndPerformance(() => {
    const f = portFixture(); try {
      f.baseline(100); expect(f.ports.sendEvent({ umpWords: words(1000, false) })).to.equal(true);
      expect(f.ports.sendEvent({ umpWords: words(10) })).to.equal(true); expect(f.ports.getControllerBaseline(f.target()).rawValue).to.equal(1010);
      f.ports.sendEvent({ type: 'program', value: 2 }); expect(f.ports.getControllerBaseline(f.target()).known).to.equal(false);
      f.baseline(200); expect(f.scheduler.sendNote({ note: 60, velocity: 80, channel: 1, program: 5, outputId: 'bytes', durationTicks: 0 })).to.equal(true);
      expect(f.ports.getControllerBaseline(f.target()).known).to.equal(false);
      f.baseline(300); f.ports.panic(); expect(f.ports.getControllerBaseline(f.target()).known).to.equal(false);
    } finally { f.close(); }
  }));
  it('rejects stale connection baselines and forgets uncertain partial submissions', () => withFakeClockAndPerformance(() => {
    const f = portFixture(); try {
      expect(f.ports.bindControllerBaseline({ ...f.target(), connectionEpoch: -1, descriptor, rawValue: 0, authority: 'local-authored', sourceRef: 'stale' }).reason).to.equal('route-epoch-mismatch');
      f.baseline(100); let writes = 0; f.output.send = () => ++writes < 2;
      expect(f.ports.sendEvent({ umpWords: words(10) })).to.equal(false); expect(f.ports.getControllerBaseline(f.target()).known).to.equal(false);
      expect(f.ports.getState().lastLowering).to.include({ ok: false, submittedMessages: 1, reason: 'partial-submission' });
    } finally { f.close(); }
  }));
});
