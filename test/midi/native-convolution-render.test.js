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
const makeOwner = (channels, sampleRate) => {
  const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 });
  const definition = body(channels), ref = definition.nodes[1].impulse.asset, frames = Math.round(ref.frames * sampleRate / ref.sourceSampleRate), events = [];
  let pins = 0, convolver;
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
    constructor(options) { Object.assign(this, options); this.state = 'suspended'; this.currentTime = 0; this.destination = node(); }
    createGain() { return node(); } createStereoPanner() { return node(); } createDelay() { return node(); }
    createChannelMerger() { return node(); } createChannelSplitter() { return node(); }
    createConvolver() {
      convolver = { ...node(), set normalize(value) { events.push('normalize:' + value); },
        set buffer(value) { events.push(value ? 'buffer-set' : 'buffer-clear'); } }; return convolver;
    }
    suspend() { throw new Error('Fixture renders one quantum.'); } resume() { return Promise.resolve(); }
    async startRendering() {
      expect(pins).to.equal(2); events.push('render'); this.state = 'closed'; this.currentTime = this.length / this.sampleRate;
      return { length: this.length, sampleRate: this.sampleRate, numberOfChannels: this.numberOfChannels,
        getChannelData: index => new Float32Array(this.length).fill((index + 1) / 100) };
    }
  }
  return { definition, resources, admission, budget, provider, jobs, OfflineDouble, events, pins: () => pins, convolver: () => convolver };
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
  it('admits authored native body recipes and refuses an owned source or unavailable mixed kernel profile explicitly', () => {
    for (const preset of ['quarry-hollow-spring', 'quarry-stone-courtyard', 'quarry-crossed-gallery']) {
      const selected = prepareCausalEffectSelection({ preset });
      expect(prepareEffectRenderPlan(selected.effectGraph, 48000, selected.effectReturnNodeIds, { nativeConvolution: true }).impulseCount).to.equal(1);
      expect(() => prepareEffectRenderPlan(selected.effectGraph)).to.throw('native source');
    }
    const mixed = body(1); mixed.nodes.push({ id: 'extra', kind: 'feedback-delay', parameters: {} });
    expect(() => prepareEffectRenderPlan(mixed, 48000, [], { nativeConvolution: true })).to.throw();
  });
});
