import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { sampleTraversalBinding, sampleTravelGraph, sampleMotionBatch } from '../helpers/sampleTraversal.js';
import { expect } from 'chai';
import { createWorkletInstrumentBackend } from '../../js/app/midi-ui/workletInstrumentBackend.js';
import { OwnedSampleProcessor } from '../../js/app/midi-ui/worklet/OwnedSampleProcessor.js';
import { OwnedSineProcessor } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createAudioIntervalAdmission } from '../../js/app/midi-ui/AudioIntervalAdmission.js';
import { workloadVoiceCount, inspectVoiceInterval, inspectVoiceExtensions } from '../../js/app/midi-ui/AudioVoiceAdmission.js';
import { computeOwnedSourceBank } from '../../js/app/resources/OwnedSourceBankComputation.js';
import { retainSampleSelectionReceipt } from '../../js/midi/content/SampleInstrumentMap.js';
import { singleSampleMap } from '../helpers/sampleMap.js';
import { SAMPLE_LAYOUT } from '../../js/app/midi-ui/OwnedSourceLayout.js';

const expectReady = async work => { const result = await work; expect(result.status, result.reason).to.equal('ready'); return result; };
const a = 'a'.repeat(64), b = 'b'.repeat(64), turn = async () => { await Promise.resolve(); await Promise.resolve(); };
const source = hash => {
  const samples = Float32Array.from({ length: 8000 }, (_, frame) => Math.sin(frame * 0.1) * 0.5);
  const ref = { contentHash: hash, kind: 'sample', bytes: 32044, frames: 8000, sourceSampleRate: 48000, channels: 1 }, variant = { contentHash: hash, frames: 8000, channels: 1, decoderVersion: 'fixture-v1', targetSampleRate: 48000 };
  const buffer = { length: samples.length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples };
  const pin = () => { let active = true; return { ref, variant, buffer, isActive: () => active, retain: pin, release: () => { if (!active) return false; active = false; return true; } }; }; return pin();
};
const setup = bank => {
  const listeners = new Set(); let state = 'running';
  const context = { get state() { return state; }, set state(value) { state = value; for (const listener of [...listeners]) listener(); }, addEventListener(type, listener) { if (type === 'statechange') listeners.add(listener); }, removeEventListener(type, listener) { if (type === 'statechange') listeners.delete(listener); }, sampleRate: 48000, currentTime: 0, audioWorklet: { async addModule() {} } }, resources = createAudioResourceLeases(), nodes = [];
  const preview = { _context: context, _generation: 0, _sessions: new Map([['owner', { generation: 0 }]]), _voices: new Set(), _semanticVoiceOwners: new Map(), _retirementFaults: new Set(),
    _maxVoices: 96, _maxScheduledVoices: 96, _maxLiveScheduledVoices: 96, _maxNoteSeconds: 8, _voiceSequence: 0, _nowMs: () => context.currentTime * 1000,
    _audioResources: resources, _ownerReady: () => true, _workloadClass: () => 'live', getAudioContext: () => context, _channel: () => ({ gain: {} }), _captureMetadata: fields => fields,
    _intervalAdmission: createAudioIntervalAdmission({ maxIntervals: 97 }), _workloadVoiceCount: workloadVoiceCount, _inspectVoiceInterval: inspectVoiceInterval, _inspectVoiceExtensions: inspectVoiceExtensions,
    _renderVoiceCount() { return [...this._voices].reduce((sum, voice) => sum + (voice.renderCost || 1), 0); },
    _destroyVoice(voice, reason) { if (this._voices.delete(voice)) { voice.onDestroy?.(reason); voice.resourceLease?.release(); } } };
  const createWorkletNode = (ctx, name, options) => {
    const main = { onmessage: null, close() { this.closed = true; }, postMessage(data) { thread.onmessage?.({ data: structuredClone(data) }); } };
    const thread = { onmessage: null, postMessage(data) { const copy = structuredClone(data); queueMicrotask(() => main.onmessage?.({ data: copy })); } };
    const saved = { port: Object.getOwnPropertyDescriptor(OwnedSineProcessor.prototype, 'port'), rate: Object.getOwnPropertyDescriptor(globalThis, 'sampleRate') }; let processor;
    Object.defineProperty(OwnedSineProcessor.prototype, 'port', { configurable: true, value: thread }); globalThis.sampleRate = ctx.sampleRate;
    try { processor = new OwnedSampleProcessor(structuredClone(options)); Object.defineProperty(processor, 'port', { value: thread }); }
    finally { for (const [target, key, descriptor] of [[OwnedSineProcessor.prototype, 'port', saved.port], [globalThis, 'sampleRate', saved.rate]]) { if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key]; } }
    const node = { port: main, processor, disconnected: false, connect() {}, disconnect() { this.disconnected = true; }, render(frames) {
      const savedFrame = Object.getOwnPropertyDescriptor(globalThis, 'currentFrame'), start = processor.kernel?.lastFrame ?? Math.round(ctx.currentTime * ctx.sampleRate), outputs = [[new Float32Array(frames), new Float32Array(frames)]];
      globalThis.currentFrame = start;
      try { processor.process([], outputs); ctx.currentTime = (start + frames) / ctx.sampleRate; return outputs[0]; }
      finally { if (savedFrame) Object.defineProperty(globalThis, 'currentFrame', savedFrame); else delete globalThis.currentFrame; }
    } }; nodes.push(node); return node;
  };
  const backend = createWorkletInstrumentBackend(preview, 'owner', { engineId: 'worklet-sample', createWorkletNode, prepareSourceBank: async () => ({ payload: bank, release() {} }) });
  const map = singleSampleMap(a, { frames: 8000 }); map.rendererProfile = 'owned-sample-v1'; map.zones[0].loop = { mode: 'sustain', startFrame: 0, endFrame: 8000, crossfadeFrames: 256, gainLaw: 'linear' };
  map.zones[0].releaseRegion = { assetHash: b, onsetFrame: 0, endFrame: 8000, rootCents: 6000, tuningCents: 0, gain01: 0.5, pitchRange: { ...map.zones[0].pitchRange } };
  const patch = { status: 'ready', patch: { id: 'live-sample', revision: 1, engineId: 'worklet-sample', engineVersion: 1, parameters: { attackSeconds: 0, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.01 },
    sampleRefs: [{ sha256: a, bytes: 32044, required: true }, { sha256: b, bytes: 32044, required: true }], sampleMap: map, voicePolicy: { maxVoices: 1 }, mix: { gain01: 0.5, pan01: 0 } }, receipt: { patchId: 'live-sample', revision: 1 } };
  const intent = voiceId => ({ version: 1, kind: 'begin', voiceId, onsetId: voiceId, worldId: 'world', actorId: 1, laneId: 0, generation: 1, velocity01: 0.7, pitch: { cents: 6000 }, expression: {} });
  return { backend, preview, context, async close() { await backend.dispose().completion; context.state = 'closed'; }, resources, nodes, patch, intent, assets: [source(a), source(b)] };
};

describe('owned sample host preparation and command ownership (deferred integration fixtures)', () => {
  let bank; before(async () => { bank = await computeOwnedSourceBank('sample-read-v1', { yieldControl: async () => {} }); });
  it('allocates exact one/16-voice instances and requires a new renderer for a changed prepared capacity', async () => {
    for (const count of [1, 16]) {
      const f = setup(bank); f.patch.patch.voicePolicy.maxVoices = count;
      try {
        await expectReady(f.backend.prepare(f.patch, f.assets)); const source = f.nodes[0].processor.kernel.source; expect(f.nodes[0].processor.kernel.maxVoices).to.equal(count); expect(source.cursorQueues.length).to.equal(count * f.patch.patch.sampleMap.zones.length * SAMPLE_LAYOUT.cursorCapacity * SAMPLE_LAYOUT.cursorWidth); expect(f.backend.renderDiagnostics().preparedVoices).to.equal(count);
        f.patch.patch.voicePolicy.maxVoices = count === 1 ? 2 : 8; const rejected = await f.backend.prepare(f.patch, f.assets); expect(rejected.reason).to.equal('source-capacity-requires-new-renderer'); expect(f.nodes).to.have.length(1); expect(f.backend.renderDiagnostics().preparedVoices).to.equal(count);
      } finally { await f.close(); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion; }
    }
  });
  it('prepares every attack/release asset, retains a real child through its envelope and acknowledges private state retirement', async () => {
    const f = setup(bank); await expectReady(f.backend.prepare(f.patch, f.assets));
    f.backend.renewExecutionLease(1, 'live', 48000); const begin = f.backend.begin(f.intent('held'), 0);
    expect(begin.status).to.equal('accepted'); expect(retainSampleSelectionReceipt(begin)).to.include({ schema: 'lemmings-owned-sample-selection/v1', evidenceClass: 'owned-source-selection-api', playbackMode: 'forward' });
    const end = f.backend.end('held', { seconds: 0.01, velocity01: 0.7 }, 512); expect(end.effectiveEndFrame).to.equal(48000);
    await turn(); f.nodes[0].render(1500); await turn(); expect(f.preview._voices.size).to.equal(1);
    expect(f.nodes[0].processor.kernel.source.inspect().voices[0].childActive).to.equal(true);
    const sourceState = await f.backend.inspectSourceState(); expect(sourceState.frame).to.equal(1500);
    expect(sourceState.voices[0]).to.include({ assetHash: a, mode: 'forward', rateRatio: 1 });
    expect(sourceState.voices[0].child).to.include({ active: true, assetHash: b });
    expect(sourceState.voices[0].sourceRegionFrames).to.deep.equal([0, 8000]); expect(sourceState.acousticReceipt).to.equal(false);
    expect(f.backend.renderDiagnostics().sourceState).to.equal(sourceState);
    f.nodes[0].render(8000); await turn(); expect(f.preview._voices.size).to.equal(0);
    const stopped = f.backend.dispose(); await stopped.completion; expect(stopped.outcome).to.equal('complete'); expect(f.nodes[0].processor.kernel).to.equal(null); await f.close();
    expect(f.resources.diagnostics().reservations).to.equal(0); expect(f.preview._retirementFaults.size).to.equal(0); await f.resources.dispose().completion;
  });
  it('requires a fresh renderer for a changed map and refuses missing material before activation', async () => {
    const f = setup(bank); expect((await f.backend.prepare(f.patch, f.assets.slice(0, 1))).status).to.equal('rejected'); expect(f.nodes).to.have.length(0);
    await expectReady(f.backend.prepare(f.patch, f.assets));
    const next = structuredClone(f.patch); next.patch.sampleMap.zones[0].loop.crossfadeFrames = 128;
    expect(await f.backend.prepare(next, f.assets)).to.include({ status: 'rejected', reason: 'source-requires-new-renderer' }); expect(f.nodes).to.have.length(1);
    await f.close(); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('forces cleanup of an already playing release child without retriggering its articulation', async () => {
    const f = setup(bank); await f.backend.prepare(f.patch, f.assets); f.backend.renewExecutionLease(1, 'live', 48000);
    f.backend.begin(f.intent('held'), 0); f.backend.end('held', { seconds: 0.01 }, 512); await turn(); f.nodes[0].render(1500); await turn();
    expect(f.nodes[0].processor.kernel.source.inspect().voices[0].childActive).to.equal(true);
    expect(f.backend.end('held', { seconds: 0.005, force: true }, 1500).status).to.equal('accepted'); await turn(); f.nodes[0].render(512); await turn();
    expect(f.preview._voices.size).to.equal(0); expect(f.backend.renderDiagnostics({ includeTraces: true }).traces.some(value => value.reason === 'source-forced-release')).to.equal(true);
    await f.close(); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('chokes the original kit with a forced all-layer fade while retaining the next logical onset', async () => {
    const f = setup(bank); f.patch.patch.voicePolicy.maxVoices = 2; await f.backend.prepare(f.patch, f.assets); f.backend.renewExecutionLease(1, 'live', 48000);
    expect(f.backend.begin(f.intent('a'), 0).status).to.equal('accepted'); expect(f.backend.begin(f.intent('b'), 512).status).to.equal('accepted');
    await turn(); f.nodes[0].render(900); await turn(); expect([...f.preview._voices].map(voice => voice.voiceId)).to.deep.equal(['b']);
    expect(f.nodes[0].processor.kernel.source.inspect().voices[0].childActive).to.equal(false);
    await f.close(); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('admits observed position segments through the execution wrapper without adding a second onset', async () => {
    const f = setup(bank), zone = f.patch.patch.sampleMap.zones[0]; zone.loop = null; zone.playbackMode = 'positionDriven'; zone.positionPolicy = {
      boundary: 'wrap', interpolation: 'linear', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 256, gainLaw: 'linear' };
    await f.backend.prepare(f.patch, f.assets); f.backend.renewExecutionLease(1, 'live', 48000); f.backend.begin(f.intent('path'), 0);
    expect(f.backend.updateSamplePosition('path', { firstOutputFrame: 0, endOutputFrame: 480, firstSourceFrame: 0, endSourceFrame: 480, sequence: 1 }, 0).status).to.equal('accepted');
    expect(f.backend.updateSamplePosition('path', { firstOutputFrame: 480, endOutputFrame: 960, firstSourceFrame: 480, endSourceFrame: 0, sequence: 2 }, 480).status).to.equal('accepted');
    expect(f.backend.updateSamplePosition('path', { firstOutputFrame: 500, endOutputFrame: 600, firstSourceFrame: 0, endSourceFrame: 100, sequence: 3 }, 500).status).to.equal('rejected');
    await turn(); f.nodes[0].render(1700); await turn(); expect(f.nodes[0].processor.kernel.source.cursor(0).position).to.equal(0); expect(f.backend.renderDiagnostics().counters.applied).to.equal(3);
    await f.close(); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('admits canonical outbound/rest/return observations without retriggering and releases at the final observed endpoint', async () => {
    const f = setup(bank), zone = f.patch.patch.sampleMap.zones[0]; zone.loop = null; zone.playbackMode = 'positionDriven'; zone.positionPolicy = {
      boundary: 'wrap', interpolation: 'linear', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 256, gainLaw: 'linear', traversal: sampleTraversalBinding() };
    const engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() });
    const outbound = engine.processBatch(sampleMotionBatch(1, 0, 128))[0], rest = engine.processBatch(sampleMotionBatch(2, 128, 128))[0], returned = engine.processBatch(sampleMotionBatch(3, 128, 0))[0];
    await f.backend.prepare(f.patch, f.assets); f.backend.renewExecutionLease(1, 'live', 48000);
    const begin = f.backend.begin(outbound, 0); expect(begin.status).to.equal('accepted'); expect(begin.sampleTraversal).to.include({ endSourceFrame: 2560, lifetimeScope: 'actorJourney' });
    expect(f.backend.updateSampleTravel(outbound.voiceId, rest, 2880).status).to.equal('accepted');
    expect(f.backend.updateSampleTravel(outbound.voiceId, returned, 5760).status).to.equal('accepted');
    expect(f.backend.updateSamplePosition(outbound.voiceId, { firstOutputFrame: 9000, endOutputFrame: 10000, firstSourceFrame: 0, endSourceFrame: 10, sequence: 40 }, 9000).status).to.equal('rejected');
    const end = f.backend.end(outbound.voiceId, { seconds: 0.01, velocity01: 0 }, 6000); expect(end.effectiveTargetFrame).to.equal(8640);
    await turn(); f.nodes[0].render(8641); await turn(); expect(f.nodes[0].processor.kernel.source.cursor(0).position).to.equal(0);
    expect(f.backend.renderDiagnostics().counters.rejected).to.equal(1); expect(f.preview._voices.size).to.equal(1);
    f.nodes[0].render(600); await turn(); expect(f.preview._voices.size).to.equal(0);
    engine.dispose(); await f.close(); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });

  it('refuses an onset before queuing a slot outside the prepared one-voice capacity', async () => {
    const f = setup(bank); await expectReady(f.backend.prepare(f.patch, f.assets)); f.backend.renewExecutionLease(1, 'live', 48000);
    try {
      expect(f.backend.begin(f.intent('first'), 0).status).to.equal('accepted');
      expect(f.backend.begin(f.intent('overflow'), 512)).to.include({ status: 'rejected', reason: 'shared-voice-budget' });
      await turn(); f.nodes[0].render(900); await turn(); expect([...f.preview._voices].map(voice => voice.voiceId)).to.deep.equal(['first']);
      expect(f.nodes[0].processor.kernel.maxVoices).to.equal(1);
    } finally { await f.close(); await f.resources.dispose().completion; }
  });
  it('rejects a pending source inspection when its concrete processor owner retires', async () => {
    const f = setup(bank); await f.backend.prepare(f.patch, f.assets);
    const port = f.nodes[0].processor.port, send = port.postMessage.bind(port); port.postMessage = data => { if (data.type !== 'health') send(data); };
    const query = f.backend.inspectSourceState().then(() => null, error => error);
    const retirement = f.backend.dispose(); expect((await query).message).to.include('owner retired'); await retirement.completion; await f.close();
    expect(retirement.outcome).to.equal('complete'); expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });

});
