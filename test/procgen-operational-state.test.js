import { expect } from 'chai';
import { createProcgenOperationalSnapshot } from '../js/app/procgen/workstation/ProcgenOperationalState.js';

const base = () => ({ identity: 'document:1', simulation: { available: true, preparing: false, paused: false, requestedSpeed: 3, achievedTicksPerSecond: 25, tickDurationMs: 60 },
  transport: { playing: true, clockSource: 'internal', clockStatus: 'internal', linked: true, bpm: 360, baseBpm: 120, gameSpeed: 3 },
  output: { selectedBackend: 'synth', enabled: true, status: 'live', audio: { status: 'ready', contextState: 'running', enabled: true } },
  lanes: [{ id: 'lane-1', mode: 'physical', gain: 1 }], physical: { prepared: true, routingUnavailable: false, accepted: 1, rejected: 0, degraded: 0 }, midi: {} });
const hardware = () => { const value = base(); value.output = { selectedBackend: 'midi', enabled: true, status: 'live', outputId: 'A', selectedOutputId: 'A', selectedOutputName: 'Keyboard', midiPermission: 'granted', discoveredOutputCount: 2 };
  value.midi = { outputRoutes: [{ outputId: 'A', name: 'Keyboard', active: true, available: true, authorized: true }], inputId: 'clock-input', clockOutputId: 'clock-output' }; return value; };

describe('read-only operational blocker and recovery policy', () => {
  it('keeps simulation, musical authority, browser context and named note/clock roles independent', () => {
    const input = hardware(); input.simulation.paused = true; input.transport.linked = false; const result = createProcgenOperationalSnapshot(input);
    expect(result.simulation.state).to.equal('paused'); expect(result.transport.state).to.equal('playing'); expect(result.noteOutput).to.include({ state: 'active', selectedId: 'A', activeId: 'A' });
    expect(result.audioContext.state).to.equal('not-selected'); expect(result.clockAuthority).to.include({ inputId: 'clock-input', outputId: 'clock-output' }); expect(result.blockedReason.code).to.equal('ready');
    expect(Object.isFrozen(result)).to.equal(true); expect(Object.isFrozen(result.noteOutput)).to.equal(true);
  });
  it('covers paused/running, linked/unlinked, local/hardware and stopped/playing without implying acoustic delivery', () => {
    let cases = 0;
    for (const paused of [true, false]) for (const linked of [true, false]) for (const midi of [true, false]) for (const playing of [true, false]) {
      const input = midi ? hardware() : base(); input.simulation.paused = paused; input.transport.linked = linked; input.transport.playing = playing;
      const before = JSON.stringify(input), result = createProcgenOperationalSnapshot(input); expect(JSON.stringify(input)).to.equal(before);
      expect(result.simulation.state).to.equal(paused ? 'paused' : 'running'); expect(result.transport.state).to.equal(playing ? 'playing' : 'stopped'); expect(result.transport.linked).to.equal(linked);
      expect(result.blockedReason.code).to.equal(playing ? 'ready' : 'transport-paused'); expect(result.evidence).to.include('no acoustic'); cases++;
    }
    expect(cases).to.equal(16);
  });
  const cases = [
    ['world-preparing', value => { value.simulation.preparing = true; }, 'none'],
    ['audio-off', value => { value.output.enabled = false; value.output.status = 'off'; }, 'listen'],
    ['audio-suspended', value => { value.output.enabled = false; value.output.audio.contextState = 'suspended'; }, 'listen'],
    ['audio-preparing', value => { value.output.audio.status = 'unlocking'; }, 'none'],
    ['audio-budget', value => { value.output.audio.status = 'resource-limited'; }, 'listen'],
    ['audio-error', value => { value.output.status = 'error'; }, 'listen'],
    ['lanes-muted', value => { value.lanes = [{ mute: true, gain: 1 }]; }, 'inspect-mix'],
    ['output-thinning', value => { value.midi.pressure = { throttled: true, reason: 'wire-budget', dropped: 5 }; }, 'inspect-midi'],
    ['instrument-routing', value => { value.physical.routingUnavailable = true; }, 'inspect-physical'],
    ['instrument-preparing', value => { value.physical.prepared = false; }, 'none'],
    ['no-source-events', value => { value.physical.accepted = 0; }, 'lesson'],
    ['clock-waiting', value => { value.transport.clockSource = 'external'; value.transport.clockStatus = 'waiting'; }, 'inspect-clock'],
    ['clock-lost', value => { value.transport.clockSource = 'external'; value.transport.clockStatus = 'clock-lost'; value.transport.reason = 'clock-lost'; }, 'inspect-clock'],
    ['controller-observation', value => { value.midi.inputId = 'controller'; value.midi.inputLiveness = { mode: 'unavailable', reason: 'host-observation-gap' }; }, 'inspect-midi'],
    ['storage-error', value => { value.storage = { error: new Error('quota') }; }, 'export'],
    ['recovery-error', value => { value.recovery = { state: 'unavailable' }; }, 'export']
  ];
  for (const [code, edit, action] of cases) it('reports ' + code + ' with its exact available recovery', () => {
    const input = base(); edit(input); const result = createProcgenOperationalSnapshot(input); expect(result.blockedReason.code).to.equal(code); expect(result.recoveryAction.id).to.equal(action);
  });
  it('keeps storage, owned cleanup and lost clock above ordinary silence or thinning', () => {
    const input = hardware(); input.midi.outputRoutes[0].ownedVoiceAdmissionReady = false; input.transport.reason = 'clock-lost'; input.midi.pressure = { throttled: true }; input.output.enabled = false;
    expect(createProcgenOperationalSnapshot(input).blockedReason.code).to.equal('owned-cleanup-unconfirmed'); input.storage = { error: new Error('quota') }; expect(createProcgenOperationalSnapshot(input).blockedReason.code).to.equal('storage-error');
  });
  it('distinguishes discovery, review, activation, missing destination and permission failure', () => {
    const input = hardware(); input.output.enabled = false; input.output.outputId = null; input.midi.outputRoutes[0].active = false;
    expect(createProcgenOperationalSnapshot(input).blockedReason.code).to.equal('midi-inactive'); input.output.selectedOutputId = null; expect(createProcgenOperationalSnapshot(input).recoveryAction.id).to.equal('review-output');
    input.output.discoveredOutputCount = 0; expect(createProcgenOperationalSnapshot(input).recoveryAction.id).to.equal('discover');
    input.output.selectedOutputId = 'A'; input.output.midiPermission = 'denied'; input.output.status = 'error'; input.output.failureKind = 'permission-denied'; expect(createProcgenOperationalSnapshot(input).blockedReason.code).to.equal('midi-permission-denied');
    input.output.midiPermission = 'granted'; input.output.failureKind = 'destination-missing'; input.midi.outputRoutes[0].available = false; expect(createProcgenOperationalSnapshot(input).blockedReason.code).to.equal('output-lost');
  });
  it('reports API send and permission revocation failures without calling them a disconnected port', () => {
    for (const [kind, code] of [['api-send', 'midi-api-error'], ['permission-revoked', 'midi-permission-revoked']]) {
      const input = hardware(); input.output.failureKind = kind; input.output.enabled = false; input.output.status = 'error'; expect(createProcgenOperationalSnapshot(input).blockedReason.code).to.equal(code);
    }
  });
  it('names an empty authorized MIDI catalog without implying device loss or activating a fallback', () => {
    const input = hardware(); Object.assign(input.output, { enabled: false, outputId: null, selectedOutputId: null, discoveredOutputCount: 0 });
    const result = createProcgenOperationalSnapshot(input); expect(result.blockedReason.code).to.equal('midi-no-destinations'); expect(result.recoveryAction.id).to.equal('discover'); expect(result.noteOutput.activeId).to.equal(null);
  });
  it('keeps controller connectivity separate from liveness and turns Stage review into explicit exit', () => {
    const input = hardware(); input.midi.inputPortConnected = true; input.midi.inputLiveness = { mode: 'unobserved', evidence: 'no-active-sensing-observed' }; const result = createProcgenOperationalSnapshot(input);
    expect(result.controller).to.include({ connected: true, liveness: 'unobserved', bridge: 'not-reported' }); expect(result.blockedReason.code).to.equal('ready');
    input.stage = true; input.output.enabled = false; expect(createProcgenOperationalSnapshot(input).recoveryAction.id).to.equal('exit-stage');
  });
});
