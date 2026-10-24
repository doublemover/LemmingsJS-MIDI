import { BoundedDelayKernel, DELAY_KERNEL_REVISION } from '../../js/app/midi-ui/worklet/BoundedDelayProcessor.js';
import { NonlinearChainKernel } from '../../js/app/midi-ui/worklet/NonlinearChainKernel.js';
import { NONLINEAR_KERNEL_REVISION } from '../../js/midi/content/NonlinearChainProfile.js';
import { OFFLINE_EFFECT_COMPLETION_REVISION } from '../../js/app/midi-ui/worklet/OfflineEffectCompletion.js';
import { createQuarryTape } from '../../js/midi/content/DubQuarryRack.js';
import { prepareCausalOwnedConvolutionInput } from '../../js/app/midi-ui/CausalOwnedConvolutionRender.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { validateOwnedConvolutionSourceReceipt } from '../../js/app/midi-ui/EffectRenderPlan.js';
import { expect } from 'chai';
import { prepareEffectRenderPlan, validateNativeConvolutionRenderReceipt } from '../../js/app/midi-ui/EffectRenderPlan.js';
import { effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';
import { renderNativeOfflineGraph } from '../../js/app/midi-ui/NativeOfflineDriver.js';
import { encodeNativeOfflineRender } from '../../js/app/resources/NativeOfflineEncoding.js';
import { analyzeImpulseResponse } from '../../js/app/resources/ImpulseResponseAnalysis.js';
import { CAUSAL_RENDER_SOURCES } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { prepareCausalEffectSelection } from '../../js/app/midi-ui/CausalEffectSelection.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';

const immediate = async () => {};
const body = channels => ({ schema: 'lemmings-effect-graph/v1', id: 'fixture.native-body', revision: 1,
  latencyPolicy: 'uncompensated-native', maximumLatencyFrames: null, maximumTailSeconds: 1,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'body', kind: 'convolution-native', parameters: {},
    impulse: { schema: 'lemmings-impulse-response/v1', asset: { contentHash: 'a'.repeat(64), bytes: 44 + channels * 8,
      path: 'fixture/ir.wav', mime: 'audio/wav', kind: 'impulse-response', channels, sourceSampleRate: 44100, frames: 4,
      decodeVersion: DECODER_VERSION, licenseId: 'NOASSERTION', attribution: 'Synthetic arithmetic fixture.' },
    layout: channels === 1 ? 'mono' : channels === 2 ? 'stereo' : 'true-stereo', predelaySeconds: 0.008,
    normalizationMode: 'native-rms', referenceGain01: 1, maximumLinearGain: 16, latency: 'unknown-native-implementation' } },
  { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [{ from: { nodeId: 'source', port: 'audio' }, to: { nodeId: 'body', port: 'audio' }, gain01: 1 },
    { from: { nodeId: 'body', port: 'audio' }, to: { nodeId: 'output', port: 'audio' }, gain01: 1 }] });
const makeOwner = (channels, sampleRate, { mixed = false, processorMode = 'valid' } = {}) => {
  const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 });
  const definition = body(channels), ref = definition.nodes[1].impulse.asset, frames = Math.round(ref.frames * sampleRate / ref.sourceSampleRate), events = [];
  if (mixed) {
    definition.maximumTailSeconds = 30;
    const colour = structuredClone(createQuarryTape().nodes.find(node => node.kind === 'nonlinear-chain')); colour.id = 'colour';
    definition.nodes.push(colour, { id: 'echo', kind: 'feedback-delay', parameters: {} });
    const edge = (from, to, gain01 = 1) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01 });
    definition.edges = [edge('source', 'colour'), edge('colour', 'echo'), edge('echo', 'body', 1 / definition.nodes[1].impulse.maximumLinearGain), edge('body', 'output')];
  }
  let pins = 0, convolver; const processors = [];
  const pcm = Array.from({ length: channels }, (_, i) => new Float32Array(Array.from({ length: frames }, (__, f) => f ? 0 : i % 2 ? -1 : 1)));
  const buffer = { length: frames, sampleRate, numberOfChannels: channels, getChannelData: index => pcm[index] };
  const pin = () => { pins++; let active = true; return { ref, variant: { decoderVersion: DECODER_VERSION, targetSampleRate: sampleRate }, buffer,
    isActive: () => active, retain: pin, release() { if (active) { active = false; pins--; events.push('pin-release'); } } }; };
  const provider = { async acquireImpulse(asset, options) {
    expect(options.decodeContext.sampleRate).to.equal(sampleRate); expect(asset.contentHash).to.equal(ref.contentHash);
    const base = pin(), scope = createProcgenRetirementScope(); return { assets: [base], release: () => scope.retire([{ name: 'base-pin', run: () => base.release() }]) };
  } };
  const jobs = { async compute(request) {
    expect(admission.diagnostics().activeWorkers).to.equal(0);
    const value = await analyzeImpulseResponse(request.prepareInput(), { estimatedPeakBytes: request.estimatedPeakBytes, yieldControl: immediate });
    let phase = 'retained'; return { value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } },
      release() { phase = 'released'; }, retirementState: () => ({ phase }) };
  } };
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() { events.push('disconnect'); }, gain: param(), pan: param(), delayTime: param() });
  class OfflineDouble {
    constructor(options) { Object.assign(this, options); this.state = 'suspended'; this.currentTime = 0; this.destination = node(); this.listeners = new Set(); this.audioWorklet = { addModule: async () => { events.push('module-load'); } }; }
    addEventListener(type, listener) { if (type === 'statechange') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'statechange') this.listeners.delete(listener); }
    createBuffer(channels, length, rate) { const planes = Array.from({ length: channels }, () => new Float32Array(length)); return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: channel => planes[channel] }; }
    createBufferSource() { return { ...node(), start() { events.push('source-start'); }, stop() { events.push('source-stop'); }, set buffer(value) { events.push(value ? 'source-buffer-set' : 'source-buffer-clear'); } }; }
    createGain() { return node(); } createStereoPanner() { return node(); } createDelay() { return node(); }
    createChannelMerger() { return node(); } createChannelSplitter() { return node(); }
    createConvolver() {
      convolver = { ...node(), set normalize(value) { events.push('normalize:' + value); },
        set buffer(value) { events.push(value ? 'buffer-set' : 'buffer-clear'); } }; return convolver;
    }
    suspend() { throw new Error('Fixture renders one quantum.'); } resume() { return Promise.resolve(); }
    async startRendering() {
      expect(pins).to.equal(convolver ? 2 : 0); events.push('render');
      for (const processor of processors) if (processorMode !== 'missing-ready') processor.emitReady();
      await Promise.resolve();
      for (const processor of processors) if (processorMode !== 'missing-complete') processor.emitComplete();
      this.state = 'closed'; this.currentTime = this.length / this.sampleRate; for (const listener of [...this.listeners]) listener();
      return { length: this.length, sampleRate: this.sampleRate, numberOfChannels: this.numberOfChannels,
        getChannelData: index => new Float32Array(this.length).fill((index + 1) / 100) };
    }
  }
  const createWorkletNode = (context, name, options) => {
    events.push('processor-created'); const nonlinear = name === 'lemmings-nonlinear-chain-v1';
    const kernel = nonlinear ? new NonlinearChainKernel({ parameters: options.processorOptions.parameters, sampleRate }) : new BoundedDelayKernel({ ...options.processorOptions, sampleRate });
    const revision = nonlinear ? NONLINEAR_KERNEL_REVISION : DELAY_KERNEL_REVISION, stateBytes = nonlinear ? kernel.state.byteLength : kernel.buffer.byteLength + kernel.filter.byteLength;
    const configurationKey = nonlinear ? kernel.identity : null;
    const port = { onmessage: null, postMessage() {}, close() { events.push('processor-port-close'); } };
    const value = { ...node(), port, parameters: new Map(Object.keys(options.parameterData).filter(key => processorMode !== 'bad-parameter' || key !== 'driveDb').map(key => [key, param()])) };
    const emit = data => port.onmessage?.({ data });
    processors.push({ emitReady() { events.push('processor-ready'); emit({ type: 'ready', revision: processorMode === 'bad-abi' ? 'wrong-revision' : revision, sampleRate, stateBytes, ...(configurationKey === null ? {} : { configurationKey }) }); },
      emitComplete() { events.push('processor-complete'); emit({ type: 'offline-complete', protocol: OFFLINE_EFFECT_COMPLETION_REVISION, revision, sampleRate, stateBytes, configurationKey,
        endFrame: options.processorOptions.offlineEndFrame, firstFrame: 0, processedThroughFrame: 128, quantumFrames: 128, contiguous: true,
        faults: processorMode === 'late-fault' ? 1 : 0, faulted: processorMode === 'late-fault' }); } });
    return value;
  };
  return { definition, resources, admission, budget, provider, jobs, OfflineDouble, events, createWorkletNode, pins: () => pins, convolver: () => convolver };
};

describe('native shared convolution rendering (API/codec fixtures, no acoustic qualification)', () => {
  for (const channels of [1, 2, 4]) for (const rate of [44100, 48000, 96000]) {
    it(`binds ${channels}-channel IR analysis and simultaneous native taps at ${rate}`, async () => {
      const owner = makeOwner(channels, rate), patch = CAUSAL_RENDER_SOURCES.find(source => source.id === 'native-oscillator').definition;
      const rendered = await renderNativeOfflineGraph({ patch, events: [], frames: 128, sampleRate: rate, stemLaneIds: ['lane'],
        effectGraph: owner.definition, effectReturnNodeIds: ['body'] }, { resources: owner.resources, resourceBudget: owner.budget, admission: owner.admission,
        getMaterialProvider: () => owner.provider, jobs: owner.jobs, OfflineAudioContext: owner.OfflineDouble });
      expect(rendered.channels).to.equal(6); expect(owner.pins()).to.equal(0);
      expect(owner.events.indexOf('normalize:true')).to.be.lessThan(owner.events.indexOf('buffer-set'));
      expect(owner.events.indexOf('render')).to.be.lessThan(owner.events.indexOf('buffer-clear'));
      expect(owner.events.indexOf('buffer-clear')).to.be.lessThan(owner.events.indexOf('pin-release'));
      const plan = prepareEffectRenderPlan(owner.definition, rate, ['body'], { nativeConvolution: true }), hash = await effectGraphHash(plan);
      expect(validateNativeConvolutionRenderReceipt(plan, rendered.receipt, hash, ['body']).realization.latencyFrames).to.equal(null);
      const graph = { definition: plan.definition, hash, processingRevisions: plan.processingRevisions, latencyFrames: null,
        maximumTailFrames: plan.maximumTailFrames, controls: 'explicit-authored-defaults-not-replayed-live-gestures', scope: 'one-full-shared-owner-sum' };
      const input = { mode: 'causal-take', manifest: { schema: 'lemmings-causal-audio-render/v1', sampleRate: rate, frames: 100, channels: 2,
        sampleFormat: 'ieee-float32-le', effectGraph: graph, nativeScheduling: rendered.receipt, stems: { sharedReturns: ['body'] } }, firstFrame: 28, endFrame: 128,
      stemLaneIds: ['lane'], planes: Array.from({ length: 6 }, (_, i) => rendered.buffer.getChannelData(i)) };
      const encoded = await encodeNativeOfflineRender(input, { yieldControl: immediate }); expect(encoded.files).to.have.length(3);
      for (const [index, file] of encoded.files.entries()) {
        const view = new DataView(file.bytes.buffer); expect(view.getFloat32(56, true)).to.equal(Math.fround((index * 2 + 1) / 100));
        expect(view.getFloat32(60, true)).to.equal(Math.fround((index * 2 + 2) / 100));
      }
      expect(encoded.files[2].manifest.returnNodeId).to.equal('body'); expect(encoded.manifest.effectGraph.realization.impulses[0].analysis.channels).to.equal(channels);
      const wrong = structuredClone(rendered.receipt); wrong.effectGraph.realization.impulses[0].analysis.normalizationScale *= 2;
      expect(() => validateNativeConvolutionRenderReceipt(plan, wrong, hash, ['body'])).to.throw('normalization');
      expect(() => validateNativeConvolutionRenderReceipt(plan, rendered.receipt, hash, ['other'])).to.throw('binding');
      rendered.release(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); await owner.resources.dispose().completion; owner.admission.dispose();
    });
  }
  for (const processorMode of ['valid', 'missing-ready', 'missing-complete', 'late-fault', 'bad-abi', 'bad-parameter']) {
    it(`gates a complete mixed graph on render-thread readiness and terminal receipts: ${processorMode}`, async () => {
      const owner = makeOwner(2, 48000, { mixed: true, processorMode }), patch = CAUSAL_RENDER_SOURCES.find(source => source.id === 'native-oscillator').definition;
      let result, error;
      try { result = await renderNativeOfflineGraph({ patch, events: [], frames: 128, sampleRate: 48000, effectGraph: owner.definition, effectReturnNodeIds: ['body'] },
        { resources: owner.resources, resourceBudget: owner.budget, admission: owner.admission, getMaterialProvider: () => owner.provider, jobs: owner.jobs,
          OfflineAudioContext: owner.OfflineDouble, createWorkletNode: owner.createWorkletNode, effectInitializationTimeoutMs: 20 }); }
      catch (value) { error = value; }
      if (processorMode === 'valid') {
        expect(error).to.equal(undefined); expect(result.receipt.effectGraph.realization.initialization.completionConfirmed).to.equal(true);
        expect(result.receipt.effectGraph.realization.processors).to.have.length(2);
        expect(result.receipt.effectGraph.realization.processors.every(processor => processor.ready && processor.completion.faults === 0)).to.equal(true);
        const plan = prepareEffectRenderPlan(owner.definition, 48000, ['body'], { nativeConvolution: true, nativeOwnedProcessors: true });
        expect(validateNativeConvolutionRenderReceipt(plan, result.receipt, await effectGraphHash(plan), ['body'])).to.equal(result.receipt.effectGraph);
        expect(owner.events.indexOf('processor-created')).to.be.lessThan(owner.events.indexOf('render'));
        expect(owner.events.indexOf('render')).to.be.lessThan(owner.events.indexOf('processor-ready')); result.release();
      } else { expect(result).to.equal(undefined); expect(error).to.be.instanceOf(Error); expect(owner.events).to.include('render'); }
      expect(owner.pins()).to.equal(0); expect(owner.admission.diagnostics().activeWorkers).to.equal(0);
      expect(owner.budget.diagnostics().accountedBytes).to.equal(0); await owner.resources.dispose().completion; owner.admission.dispose();
    });
  }
  it('carries an actual owned PCM worker stage through native body preparation and final codec binding', async () => {
    const owner = makeOwner(4, 48000), definition = CAUSAL_RENDER_SOURCES.find(source => source.id === 'worklet-sine').definition;
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const build = 'd'.repeat(64), sourceHash = 'b'.repeat(64), revoice = { operation: 'sound-only-revoice', version: 1,
      takeId: 'take:raw-source', takeRevision: 1, sourceCanonicalHash: sourceHash, sourceState: 'finalized', sourceVersions: {},
      coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } },
      finalBoundaryState: { sourceTimeMs: 1000 }, intents: [] };
    const raw = await renderCausalOwnedTake({ definition, descriptor, revoice, applicationBuildId: build, sampleRate: 48000,
      startSeconds: 28 / 48000, endSeconds: 128 / 48000, stemLaneIds: ['lane'], outputMode: 'source-pcm', effectGraph: owner.definition, effectReturnNodeIds: ['body'] }, { yieldControl: immediate });
    const before = raw.planes.map(plane => plane.slice()), receipt = { method: 'dedicated-worker', kind: 'render-causal-source-pcm', sourceRevision: sourceHash, executionIdentity: { activeExecution: 'bound', buildId: build } };
    const prepared = await prepareCausalOwnedConvolutionInput(raw, receipt, definition, { resources: owner.resources, resourceBudget: owner.budget,
      getMaterialProvider: () => owner.provider, jobs: owner.jobs, admission: owner.admission, OfflineAudioContext: owner.OfflineDouble });
    expect(raw.planes).to.deep.equal(before); expect(owner.events).to.include.members(['source-start', 'source-stop', 'source-buffer-clear']);
    expect(validateOwnedConvolutionSourceReceipt(prepared.input.manifest).planeByteHashes).to.deep.equal(raw.planeByteHashes);
    const encoded = await encodeNativeOfflineRender(prepared.input, { yieldControl: immediate }); expect(encoded.files).to.have.length(3);
    expect(encoded.manifest.engineRequirement.engineId).to.equal('worklet-sine'); expect(encoded.manifest.frames).to.equal(100);
    const wrong = structuredClone(prepared.input.manifest); wrong.sourcePcmProducer.planeByteHashes[0] = '0'.repeat(64);
    expect(() => validateOwnedConvolutionSourceReceipt(wrong)).to.throw('input hashes');
    prepared.release(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); await owner.resources.dispose().completion; owner.admission.dispose();
  });
  for (const available of [false, true]) it('stages a donor lane independently of WAV selection, available=' + available, async () => {
    const owner = makeOwner(2, 48000), definition = CAUSAL_RENDER_SOURCES.find(source => source.id === 'worklet-sine').definition;
    owner.definition.nodes.push({ id: 'donor', kind: 'sidechain-in', parameters: { sourceBusId: 'lane:tools', tap: 'pre-fader' } });
    owner.definition.edges[0].gain01 = 0.5; owner.definition.edges.push({ from: { nodeId: 'donor', port: 'audio' }, to: { nodeId: 'body', port: 'audio' }, gain01: 0.5 });
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), build = 'd'.repeat(64), sourceHash = 'b'.repeat(64);
    const intents = available ? ['begin', 'end'].map((kind, index) => ({ version: 1, kind, worldId: 'fixture.world', generation: 1, actorId: 1, voiceId: 'tool-voice', onsetId: 'tool-onset', intentId: 'tool-' + index,
      laneId: 'tools', sourceEventIds: ['contact-' + index], scoreTime: { sourceTimeMs: index ? 1 : 0, subTick: 0, simTick: index }, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.8, expression: {} })) : [];
    const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:donor-source', takeRevision: 1, sourceCanonicalHash: sourceHash, sourceState: 'finalized', sourceVersions: {}, coverage: { status: 'known-covered' },
      boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } }, finalBoundaryState: { sourceTimeMs: 1000 }, intents };
    const raw = await renderCausalOwnedTake({ definition, descriptor, revoice, applicationBuildId: build, sampleRate: 48000, endSeconds: 128 / 48000, outputMode: 'source-pcm', effectGraph: owner.definition, effectReturnNodeIds: ['body'] }, { yieldControl: immediate });
    expect(raw.channels).to.equal(4); expect(raw.laneIds).to.deep.equal(['tools']); expect(raw.manifest.stems.laneIds).to.deep.equal([]);
    const receipt = { method: 'dedicated-worker', kind: 'render-causal-source-pcm', sourceRevision: sourceHash, executionIdentity: { activeExecution: 'bound', buildId: build } };
    const prepared = await prepareCausalOwnedConvolutionInput(raw, receipt, definition, { resources: owner.resources, resourceBudget: owner.budget, getMaterialProvider: () => owner.provider, jobs: owner.jobs, admission: owner.admission, OfflineAudioContext: owner.OfflineDouble });
    expect(prepared.input.planes).to.have.length(4); expect(prepared.input.manifest.nativeScheduling.effectGraph.realization.sidechains[0].connected).to.equal(available);
    expect(validateOwnedConvolutionSourceReceipt(prepared.input.manifest).laneIds).to.deep.equal(['tools']);
    const encoded = await encodeNativeOfflineRender(prepared.input, { yieldControl: immediate }); expect(encoded.files).to.have.length(2); expect(encoded.manifest.stems.laneIds).to.deep.equal([]);
    const wrong = structuredClone(prepared.input.manifest); wrong.nativeScheduling.effectGraph.sourceBindings.routes[0].tap = 'post-fader';
    let error; try { await encodeNativeOfflineRender({ ...prepared.input, manifest: wrong }, { yieldControl: immediate }); } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error);
    prepared.release(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); await owner.resources.dispose().completion; owner.admission.dispose();
  });
  it('admits authored body recipes and requires the explicit native render profile', () => {
    for (const preset of ['quarry-hollow-spring', 'quarry-stone-courtyard', 'quarry-crossed-gallery']) {
      const selected = prepareCausalEffectSelection({ preset });
      expect(prepareEffectRenderPlan(selected.effectGraph, 48000, selected.effectReturnNodeIds, { nativeConvolution: true }).impulseCount).to.equal(1);
      expect(() => prepareEffectRenderPlan(selected.effectGraph)).to.throw('native convolution');
    }
    const mixed = body(1); mixed.nodes.push({ id: 'extra', kind: 'feedback-delay', parameters: {} });
    expect(() => prepareEffectRenderPlan(mixed, 48000, [], { nativeConvolution: true })).to.throw();
  });
});
