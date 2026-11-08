import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';
import { expect } from 'chai';
import { validateAudioAssetRef, inspectWaveContainer, DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';
import { validateImpulseResponseDescriptor } from '../../js/midi/content/ImpulseResponseDescriptor.js';
import { analyzeImpulseResponse } from '../../js/app/resources/ImpulseResponseAnalysis.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { prepareNativeEffectGraph } from '../../js/app/midi-ui/NativeEffectGraph.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

const descriptor = (channels = 1) => ({ schema: 'lemmings-impulse-response/v1', asset: { contentHash: 'a'.repeat(64), bytes: 44 + channels * 8, path: 'ir/fixture.wav',
  mime: 'audio/wav', kind: 'impulse-response', channels, sourceSampleRate: 44100, frames: 4, decodeVersion: DECODER_VERSION, licenseId: 'NOASSERTION', attribution: 'Synthetic arithmetic fixture.' },
layout: channels === 1 ? 'mono' : channels === 2 ? 'stereo' : 'true-stereo', predelaySeconds: 0, normalizationMode: 'native-rms', referenceGain01: 1, maximumLinearGain: 16, latency: 'unknown-native-implementation' });
const graph = impulse => ({ schema: 'lemmings-effect-graph/v1', id: 'fixture.body', revision: 1, latencyPolicy: 'uncompensated-native', maximumLatencyFrames: null, maximumTailSeconds: 1,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'body', kind: 'convolution-native', parameters: {}, impulse }, { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [{ from: { nodeId: 'source', port: 'audio' }, to: { nodeId: 'body', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'body', port: 'audio' }, to: { nodeId: 'output', port: 'audio' }, gain01: 1 }] });
const request = (channels, options = {}) => ({ descriptor: { ...descriptor(channels), ...options }, sampleRate: 44100, frames: 4, channels, decoderVersion: DECODER_VERSION,
  planes: Array.from({ length: channels }, (_, channel) => new Float32Array([channel & 1 ? -1 : 1, 0, 0, 0])) });

describe('shared native impulse-response contracts (deferred qualification)', () => {
  it('publishes actual impulse source inventory through the worker kernel without an uninitialized metadata reference', async () => {
    const result = await runBackgroundJobKernel('analyze-native-impulse', request(2), { maxBytes: 65536, estimatedPeakBytes: 16 * 1048576 });
    expect(result.inputBytes).to.be.greaterThan(32); expect(result.nodes).to.be.greaterThan(2); expect(result.value.schema).to.equal('lemmings-impulse-analysis/v1'); expect(result.retainedBytes).to.equal(65536);
  });
  it('admits four-channel IR identity while refusing three channels and four-channel sample voices', () => {
    expect(validateAudioAssetRef(descriptor(4).asset).channels).to.equal(4);
    expect(() => validateAudioAssetRef(descriptor(3).asset)).to.throw();
    expect(() => validateAudioAssetRef({ ...descriptor(4).asset, kind: 'sample' })).to.throw();
    expect(() => validateImpulseResponseDescriptor({ ...descriptor(4), layout: 'stereo' })).to.throw();
    const bytes = new Uint8Array(76), view = new DataView(bytes.buffer), four = (at, value) => { for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i); };
    four(0, 'RIFF'); view.setUint32(4, 68, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 4, true);
    view.setUint32(24, 44100, true); view.setUint32(28, 352800, true); view.setUint16(32, 8, true); view.setUint16(34, 16, true); four(36, 'data'); view.setUint32(40, 32, true);
    expect(inspectWaveContainer(bytes, { maxChannels: 4 })).to.include({ channels: 4, frames: 4 }); expect(() => inspectWaveContainer(bytes)).to.throw('layout');
  });
  it('retains anti-phase energy, native normalization and conservative matrix gain without calling it measured latency', async () => {
    for (const channels of [1, 2, 4]) {
      const result = await analyzeImpulseResponse(request(channels), { estimatedPeakBytes: 16 * 1048576 });
      expect(result.rms).to.equal(0.5); expect(result.normalizationScale).to.equal(channels === 4 ? 0.00125 : 0.0025);
      expect(result.linearGainBound).to.equal(channels === 4 ? 0.005 : 0.0025); expect(result.measuredLatencyFrames).to.equal(null);
      expect(result.planeByteHashes).to.have.length(channels); expect(result.silent).to.equal(false);
    }
    const silent = request(1); silent.planes[0].fill(0); const result = await analyzeImpulseResponse(silent, { estimatedPeakBytes: 16 * 1048576 });
    expect(result.silent).to.equal(true); expect(result.linearGainBound).to.equal(0); expect(result.normalizationScale).to.equal(10);
    let error; try { await analyzeImpulseResponse(request(1, { normalizationMode: 'none', maximumLinearGain: 0.5 }), { estimatedPeakBytes: 16 * 1048576 }); } catch (value) { error = value; }
    expect(error.message).to.include('headroom');
  });
  it('propagates unknown native latency rather than declaring an aligned zero-delay body', () => {
    const source = graph(descriptor()), plan = prepareEffectGraphRevision(source, { sampleRate: 44100 });
    expect(plan.latencyFrames).to.equal(null); expect(plan.alignment).to.equal('disabled-unknown-native-latency'); expect(plan.impulseCount).to.equal(1);
    expect(() => prepareEffectGraphRevision({ ...source, latencyPolicy: 'align-declared', maximumLatencyFrames: 0 }, { sampleRate: 44100 })).to.throw('Unmeasured');
  });
  it('sets normalization before assigning the native buffer and retains independent pins until native disposal', async () => {
    const resources = createAudioResourceLeases(), events = [], ref = validateAudioAssetRef(descriptor().asset); let pins = 0;
    const buffer = { length: 4, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array([1, 0, 0, 0]) };
    const makePin = () => { pins++; let active = true; return { ref, variant: { decoderVersion: DECODER_VERSION, targetSampleRate: 44100 }, buffer,
      isActive: () => active, retain: makePin, release() { if (active) { active = false; pins--; events.push('pin-release'); } } }; };
    const pin = makePin(), scope = createProcgenRetirementScope(), provider = { acquireImpulse: async () => ({ assets: [pin], release: () => scope.retire([{ name: 'base-pin', run: () => pin.release() }]) }) };
    const node = () => ({ gain: { setValueAtTime() {} }, connect() {}, disconnect() {} });
    const context = { state: 'running', sampleRate: 44100, currentTime: 0, createGain: node, createConvolver() {
      return { ...node(), set normalize(value) { events.push('normalize:' + value); }, set buffer(value) { events.push(value ? 'buffer-assigned' : 'buffer-cleared'); } };
    } };
    const jobs = { async compute(options) { let phase = 'ready'; const value = await analyzeImpulseResponse(options.prepareInput(), { estimatedPeakBytes: options.estimatedPeakBytes });
      return { value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, release() { phase = 'released'; }, retirementState: () => ({ phase }) }; } };
    const prepared = await prepareNativeEffectGraph(graph(descriptor()), { context, resources, owner: 'fixture', getMaterialProvider: () => provider, jobs });
    expect(events.slice(0, 2)).to.deep.equal(['normalize:true', 'buffer-assigned']); expect(pins).to.equal(2);
    await prepared.dispose().completion; expect(events.indexOf('buffer-cleared')).to.be.lessThan(events.indexOf('pin-release')); expect(pins).to.equal(0);
    expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
});
