import { prepareEffectGraphRevision } from '../../midi/content/EffectGraphRevision.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { DECODER_VERSION } from './AudioAssetRef.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
export function prepareEffectRenderPlan(definition, sampleRate = 48000, returnNodeIds = [], { nativeConvolution = false } = {}) {
  const plan = prepareEffectGraphRevision(definition, { sampleRate });
  if (plan.inputs.length !== 1 || plan.outputs.length !== 1) fail('unsupported-effect-owner-buses', 'Rendering requires one complete stereo owner input and output.');
  if (!Array.isArray(returnNodeIds) || returnNodeIds.length > 8 || new Set(returnNodeIds).size !== returnNodeIds.length || returnNodeIds.some(id => !plan.nodes.some(node => node.id === id && !['bus-in', 'bus-out'].includes(node.kind))))
    fail('invalid-effect-taps', 'Choose at most eight unique actual effect node outputs.');
  if (plan.impulseCount) {
    if (!nativeConvolution) fail('native-impulse-render-required', 'Choose a native source for the native convolution render profile.');
    // No offline Worklet readiness is inferred before the render thread starts.
    // This native profile contains actual native gains, buses and convolution.
    if (plan.nodes.some(node => !['bus-in', 'bus-out', 'gain', 'convolution-native'].includes(node.kind)) || plan.edges.some(edge => edge.alignmentFrames))
      fail('mixed-native-effect-render-unavailable', 'This convolution render profile supports native gain/bus/body graphs. Mixed owned processors need their explicit offline adapter.');
  }
  return plan;
}

// An API execution receipt binds PCM to the same graph and analyzed IR revisions.
// It does not establish measured latency, acoustic output or browser bit identity.
export function validateNativeConvolutionRenderReceipt(plan, receipt, graphHash, returnNodeIds) {
  const body = receipt?.effectGraph, actual = body?.realization;
  if (!plan?.impulseCount || receipt?.method !== 'native-offline-audio-context' || body?.hash !== graphHash || !Array.isArray(body.returnNodeIds) ||
      body.controls !== 'explicit-authored-defaults-not-replayed-live-gestures' || body.scope !== 'one-full-shared-owner-sum' ||
      canonicalDataText(body.returnNodeIds).text !== canonicalDataText(returnNodeIds).text ||
      actual?.hash !== graphHash || actual.sampleRate !== plan.sampleRate || actual.fault || actual.disposed !== false ||
      actual.stateBytes !== plan.stateBytes || actual.latencyFrames !== plan.latencyFrames || actual.maximumTailFrames !== plan.maximumTailFrames ||
      actual.runtime?.convolution !== 'browser-native-unpinned-dsp' || !Array.isArray(actual.impulses) || actual.impulses.length !== plan.impulseCount)
    fail('native-convolution-receipt-mismatch', 'Native convolution output omitted its exact graph, tap or execution binding.');
  const seen = new Set();
  for (const entry of actual.impulses) {
    const node = plan.nodes.find(node => node.id === entry.nodeId && node.kind === 'convolution-native'), analysis = entry.analysis, descriptor = node?.impulse;
    if (!node || seen.has(node.id) || canonicalDataText(entry.descriptor).text !== canonicalDataText(descriptor).text ||
        analysis?.schema !== 'lemmings-impulse-analysis/v1' || analysis.assetHash !== descriptor.asset.contentHash || analysis.decoderVersion !== DECODER_VERSION ||
        analysis.sampleRate !== plan.sampleRate || analysis.channels !== descriptor.asset.channels || !Number.isSafeInteger(analysis.frames) || analysis.frames < 1 ||
        Math.abs(analysis.frames - descriptor.asset.frames * plan.sampleRate / descriptor.asset.sourceSampleRate) > 1 || analysis.bytes !== analysis.frames * analysis.channels * 4 ||
        analysis.normalizationMode !== descriptor.normalizationMode || analysis.referenceGain01 !== descriptor.referenceGain01 ||
        !Number.isFinite(analysis.rms) || analysis.rms < 0 || analysis.rms > 16 || !Number.isFinite(analysis.peak) || analysis.peak + 1e-9 < analysis.rms || analysis.peak > 16 || analysis.silent !== (analysis.peak === 0) ||
        !Array.isArray(analysis.absoluteSums) || analysis.absoluteSums.length !== analysis.channels || analysis.absoluteSums.some(value => !Number.isFinite(value) || value < 0 || value > analysis.frames * 16) ||
        !Number.isFinite(analysis.normalizationScale) || analysis.normalizationScale <= 0 || !Number.isFinite(analysis.linearGainBound) || analysis.linearGainBound < 0 || analysis.linearGainBound > descriptor.maximumLinearGain + 1e-9 ||
        analysis.measuredLatencyFrames !== null || !['little-endian', 'big-endian'].includes(analysis.planeHashByteOrder) ||
        !Array.isArray(analysis.planeByteHashes) || analysis.planeByteHashes.length !== analysis.channels || analysis.planeByteHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)))
      fail('native-convolution-asset-mismatch', 'Native convolution PCM is not bound to its declared layout, decoded coefficients and normalization.');
    const scale = descriptor.normalizationMode === 'none' ? 1 : 0.00125 / Math.max(0.000125, analysis.rms) * 44100 / plan.sampleRate * (analysis.channels === 4 ? 0.5 : 1);
    const bound = (analysis.channels === 1 ? analysis.absoluteSums[0] : analysis.channels === 2 ? Math.max(...analysis.absoluteSums) : analysis.absoluteSums.reduce((sum, value) => sum + value, 0)) * scale * descriptor.referenceGain01;
    if (analysis.normalizationScale !== scale || analysis.linearGainBound !== bound) fail('native-convolution-normalization-mismatch', 'Convolution normalization or matrix gain does not match its analyzed coefficients.');
    seen.add(node.id);
  }
  return body;
}
