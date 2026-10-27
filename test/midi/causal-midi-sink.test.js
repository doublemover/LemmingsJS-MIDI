import { expect } from 'chai';
import { createCausalMidiSink } from '../../js/app/procgen/workstation/CausalMidiSink.js';
import { createCausalIntentDispatcher } from '../../js/app/procgen/workstation/CausalIntentDispatcher.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createProcgenPhysicalPlayback } from '../../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';
import { createProcgenPhysicalScoreClock } from '../../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createProcgenWorkstationProject } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject } from '../../js/midi/project/MidiProject.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const intent = (kind = 'begin', voiceId = 'voice-1', beat = 0, extra = {}) => Object.freeze({ version: 1, kind, intentId: `${kind}:${voiceId}:${beat}`,
  onsetId: 'onset:' + voiceId, batchId: 'batch-1', generation: 1, voiceId, laneId: 0, sourceEventIds: Object.freeze(['event-1']),
  route: 'local', pitch: Object.freeze({ cents: 6000, referenceHz: 440 }), velocity01: 0.75, expression: Object.freeze({}),
  scoreTime: Object.freeze({ epoch: 'score-1', simTick: 1, subTick: 0, precision: 'action-frame', beat }), ...extra });
const fixture = (clock, { mpe = true, lanes = [{ id: 'lane-1', channel: 1, outputId: null }], maxVoices = 64 } = {}) => {
  const calls = [], receipts = [], events = [], output = makeOutput([1, 2, 3], calls, 'device');
  for (const [id, channel] of Object.entries(output.channels)) {
    channel.sendChannelAftertouch = (value, options) => calls.push({ type: 'pressure', id: Number(id), value, options });
    channel.sendProgramChange = (value, options) => calls.push({ type: 'program', id: Number(id), value, options });
  }
  const ports = createProcgenMidiPorts({ now: () => clock.now, schedulerConfig: { mpe: { enabled: mpe, masterChannel: 1, memberChannels: [2, 3], pitchBendRange: { semitones: 2 } } } });
  ports.setNoteOutputs([output]); ports.setNoteOutput(output); ports.configure({ recording: true }); calls.length = 0;
  let enabled = true;
  const sink = createCausalMidiSink({ ports, getLanes: () => lanes, now: () => clock.now, maxVoices, isEnabled: () => enabled, onReceipt: receipt => events.push(receipt) });
  sink.observe({ epoch: 'score-1', beat: 0 }, { bpm: 120, executionEpoch: 'execution-1' });
  const dispatcher = createCausalIntentDispatcher({ sinks: sink.sinks, executionEpoch: () => 'execution-1',
    toTargetFrame: (score, batch, value, target) => target.toTargetFrame(score), latePolicy: context => context.sink.latePolicy(context), onReceipt: receipt => receipts.push(receipt) });
  const dispatch = values => dispatcher.dispatch(values, { batchId: 'batch-1', generation: 1 });
  return { sink, ports, dispatcher, output, calls, receipts, events, dispatch, disable() { enabled = false; },
    dispose() { dispatcher.dispose(); sink.dispose(); ports.dispose(); } };
};
describe('physical intent scheduler/MIDI realization', () => {
  it('fans the identical canonical intent to audio and MIDI with independent clocks and lease requirements', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock), audioCalls = [], source = intent(), sourceText = JSON.stringify(source);
    const audio = { begin: (value, frame) => { audioCalls.push({ value, frame }); return { status: 'accepted', stage: 'scheduled' }; },
      renewExecutionLease: (generation, execution, frame) => { audioCalls.push({ lease: frame }); return { status: 'accepted' }; }, cancelGeneration() {} };
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'audio', route: 'local', backend: audio, timeDomain: 'audio-sample-frames' }, ...f.sink.sinks],
      executionEpoch: () => 'execution-1', toTargetFrame: (score, batch, value, target) => target.toTargetFrame ? target.toTargetFrame(score) : 48000,
      latePolicy: context => context.sink.latePolicy ? context.sink.latePolicy(context) : { status: 'accepted', targetFrame: context.targetFrame } });
    try {
      const receipts = dispatcher.dispatch([source], { batchId: 'batch-1', generation: 1 });
      expect(receipts.map(row => row.targetFrame)).to.deep.equal([48000, 24000]);
      expect(receipts.map(row => row.targetTimeDomain)).to.deep.equal(['audio-sample-frames', 'performance-microseconds']);
      expect(audioCalls[0].value).to.equal(source); expect(receipts.every(row => row.intentId === source.intentId)).to.equal(true);
      expect(dispatcher.renewExecutionLease(1, 'execution-1', 96000).outcomes).to.have.length(1); expect(audioCalls[1].lease).to.equal(96000);
      clock.tick(24); expect(f.calls.filter(call => call.type === 'noteOn')).to.have.length(1); expect(JSON.stringify(source)).to.equal(sourceText);
    } finally { dispatcher.cancelGeneration(1); dispatcher.dispose(); f.dispose(); }
  }));
  it('keeps source identities and distinct scheduled/submitted receipts with a performance clock and no AudioContext', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock), source = intent();
    try {
      const before = JSON.stringify(source), receipt = f.dispatch([source])[0];
      expect(receipt).to.include({ status: 'accepted', stage: 'scheduled', targetFrame: 24000, targetTimeDomain: 'performance-microseconds', outputId: 'device' });
      expect(f.calls.filter(call => call.type === 'noteOn')).to.have.length(0); clock.tick(24);
      expect(f.events.find(row => row.stage === 'submitted')).to.include({ intentId: source.intentId, voiceId: source.voiceId, channel: 2, submittedAtMs: 24,
        sinkId: receipt.sinkId, executionEpoch: receipt.executionEpoch });
      const recorded = f.ports.getRecording().find(row => (row.data[0] & 0xf0) === 0x90);
      expect(recorded).to.include({ intentId: source.intentId, voiceId: source.voiceId, onsetId: source.onsetId });
      expect(JSON.stringify(source)).to.equal(before);
    } finally { f.dispose(); }
    expect(clock.countTimers()).to.equal(0);
  }));
  it('keeps equal-pitch actors separate through expression and physical end without releasing the peer', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock);
    try {
      f.dispatch([intent('begin', 'actor-a'), intent('begin', 'actor-b')]); clock.tick(24);
      expect(f.calls.filter(call => call.type === 'noteOn').map(call => call.id)).to.deep.equal([2, 3]);
      const update = intent('update', 'actor-a', 0.02, { expression: Object.freeze({ pitchOffsetCents: 50, pressure01: 0.5 }) });
      f.dispatch([update]); clock.tick(10);
      expect(f.calls.some(call => call.type === 'pitchBend' && call.id === 2 && call.value === 0.25)).to.equal(true);
      expect(f.events.find(row => row.stage === 'expression-submission').intentId).to.equal(update.intentId);
      f.dispatch([intent('end', 'actor-a', 0.04)]); clock.tick(10);
      expect(f.calls.filter(call => call.type === 'noteOff').map(call => call.id)).to.deep.equal([2]);
      expect(f.sink.diagnostics().ownedVoices).to.equal(1);
    } finally { f.dispose(); }
  }));
  it('reports MIDI1 quantization and per-note expression loss without silently stealing a same-pitch owner', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock, { mpe: false });
    try {
      const onset = f.dispatch([intent('begin', 'a', 0, { pitch: { cents: 6030, referenceHz: 440 } })])[0];
      expect(onset).to.include({ status: 'degraded', reason: 'midi-representation-loss' });
      expect(onset.losses).to.deep.include({ kind: 'midi1-semitone-quantization', requestedCents: 6030, representedCents: 6000 });
      clock.tick(24); const collision = f.dispatch([intent('begin', 'b', 0.01)])[0];
      expect(collision.reason).to.equal('same-pitch-owner-busy'); expect(f.calls.filter(call => call.type === 'noteOff')).to.have.length(0);
      const expression = f.dispatch([intent('update', 'a', 0.02, { expression: { pressure01: 1 } })])[0];
      expect(expression).to.include({ status: 'degraded', outputRequested: false }); expect(f.calls.filter(call => call.type === 'pressure')).to.have.length(0);
    } finally { f.dispose(); }
  }));
  it('refuses disabled/late attacks, bounds gate ownership, and preserves uncertain retirement', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock, { maxVoices: 1 });
    try {
      f.dispatch([intent()]); expect(f.dispatch([intent('begin', 'overflow')])[0].reason).to.equal('causal-midi-voice-capacity');
      clock.tick(24); f.output.channels[2].sendNoteOff = () => false;
      const receipt = f.dispatch([intent('end', 'voice-1', 0.01)])[0]; expect(receipt.status).to.equal('accepted'); clock.tick(5);
      expect(f.events.find(row => row.stage === 'voice-terminal').reason).to.equal('release-unconfirmed');
      expect(f.ports.getState().activeNoteOutputIds).to.deep.equal([]);
      expect(f.dispatch([intent('begin', 'after-unknown', 0.02)])[0].reason).to.equal('midi-retirement-unknown');
      expect(f.dispatcher.cancelGeneration(1).outcome).not.to.equal('complete');
      f.disable(); expect(f.dispatch([intent('begin', 'disabled')])).to.deep.equal([]);
    } finally { f.dispose(); }
  }));
  it('rejects stale expression and repairs a late release without manufacturing an attack', () => withFakeClockAndPerformance(clock => {
    const f = fixture(clock);
    try {
      f.dispatch([intent()]); clock.tick(40);
      expect(f.dispatch([intent('begin', 'late')])[0].reason).to.equal('late-attack');
      expect(f.dispatch([intent('update', 'voice-1', 0, { expression: { pressure01: 0.3 } })])[0].reason).to.equal('stale-expression');
      const release = f.dispatch([intent('end')])[0]; expect(release.repair).to.equal('late-release');
      expect(f.calls.filter(call => call.type === 'noteOff')).to.have.length(1);
    } finally { f.dispose(); }
  }));
  it('realizes a default physical builder fact without any pattern cells or enabled browser audio', async () => withFakeClockAndPerformance(async clock => {
    const project = createProcgenWorkstationProject(createMidiProject()), timeline = createProcgenPhysicalScoreClock();
    const f = fixture(clock, { lanes: project.procgen.lanes }), receipts = [];
    const playback = createProcgenPhysicalPlayback({ audio: null, getGraph: () => project.procgen.physicalGraph,
      getLanes: () => project.procgen.lanes, scoreTimeline: timeline, now: () => clock.now, additionalOutputs: [f.sink], onReceipt: row => receipts.push(row) });
    try {
      await playback.ready(); expect(project.procgen.lanes.every(lane => lane.mode === 'physical' && lane.patterns.length === 0)).to.equal(true);
      const batch = { version: 1, batchId: 'builder-1', worldId: 'world-1', generation: 1, tick: 1, sourceTimeMs: 60, tickDurationMs: 60,
        completeness: { status: 'complete', dropped: 0 }, facts: [{ kind: 'TerrainWorkCommitted', eventId: 'brick-1', causalSequence: 1, actorId: 1, laneId: 0, operationKind: 'build' }] };
      const values = playback.processBatch(batch, { bpm: 120, position: timeline.observe(batch, { bpm: 120 }) });
      expect(values.map(value => value.kind)).to.deep.equal(['begin', 'end']);
      expect(receipts.some(row => row.sinkId === 'physical-midi:local' && ['accepted', 'degraded'].includes(row.status))).to.equal(true);
      clock.tick(24); expect(f.calls.some(call => call.type === 'noteOn')).to.equal(true);
      clock.tick(79); expect(f.calls.some(call => call.type === 'noteOff')).to.equal(false);
      clock.tick(1); expect(f.calls.some(call => call.type === 'noteOff')).to.equal(true);
      expect(playback.diagnostics()).to.include({ enabled: true, audioEnabled: false });
      expect(playback.diagnostics().clock.anchor).to.equal(null);
    } finally { await playback.dispose().completion; f.dispose(); }
  }));
});
