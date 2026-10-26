import { resonatorBlendBodyIdentity } from '../../midi/content/ResonatorBlendProfile.js';
import { pairedModalBodyIdentity } from '../../midi/content/PairedModalBodyProfile.js';
import { rectangularMembraneIdentity } from '../../midi/content/RectangularMembraneProfile.js';
import { sympatheticNetworkIdentity } from '../../midi/content/SympatheticNetworkProfile.js';
import { spectralFreezeIdentity } from '../../midi/content/SpectralFreezeProfile.js';
import { allpassNotchIdentity } from '../../midi/content/AllpassNotchProfile.js';
import { ringModulatorIdentity } from '../../midi/content/RingModulatorProfile.js';
import { validateEffectSourceBindings } from './EffectSourceBindings.js';
import { vocoderBankIdentity, vocoderRealizationKey } from '../../midi/content/VocoderBankProfile.js';
import { envelopeDetectorIdentity } from '../../midi/content/EnvelopeDetectorProfile.js';
import { envelopeMappingIdentity } from '../../midi/content/EnvelopeMappingProfile.js';
import { nonlinearChainIdentity } from '../../midi/content/NonlinearChainProfile.js';
import { fixedFractionalDelayIdentity } from './worklet/FixedFractionalDelayProcessor.js';
import { validateOfflineEffectCompletion, OFFLINE_EFFECT_COMPLETION_REVISION } from './worklet/OfflineEffectCompletion.js';
import { prepareEffectGraphRevision } from '../../midi/content/EffectGraphRevision.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { DECODER_VERSION } from './AudioAssetRef.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
export function prepareEffectRenderPlan(definition, sampleRate = 48000, returnNodeIds = [], { nativeConvolution = false, nativeOwnedProcessors = false } = {}) {
  const plan = prepareEffectGraphRevision(definition, { sampleRate });
  if (plan.inputs.length !== 1 || plan.outputs.length !== 1) fail('unsupported-effect-owner-buses', 'Rendering requires one complete stereo owner input and output.');
  if (!Array.isArray(returnNodeIds) || returnNodeIds.length > 8 || new Set(returnNodeIds).size !== returnNodeIds.length || returnNodeIds.some(id => !plan.nodes.some(node => node.id === id && !['bus-in', 'bus-out'].includes(node.kind) && node.ports.outputs.audio?.type === 'audioStereo')))
    fail('invalid-effect-taps', 'Choose at most eight unique actual effect node outputs.');
  if (plan.impulseCount) {
    if (!nativeConvolution) fail('native-impulse-render-required', 'This graph requires its exact native convolution render adapter.');
    // Mixed graphs require the explicit offline Worklet initialization and
    // terminal-completion adapter, never a pre-render ready assumption.
    if (!nativeOwnedProcessors && (plan.nodes.some(node => !['bus-in', 'bus-out', 'gain', 'convolution-native'].includes(node.kind)) || plan.edges.some(edge => edge.alignmentFrames)))
      fail('mixed-native-effect-render-unavailable', 'This convolution render profile supports native gain/bus/body graphs. Mixed owned processors need their explicit offline adapter.');
  }
  return plan;
}

// An API execution receipt binds PCM to the same graph and analyzed IR revisions.
// It does not establish measured latency, acoustic output or browser bit identity.
export function validateNativeEffectRenderReceipt(plan, receipt, graphHash, returnNodeIds) {
  const body = receipt?.effectGraph, actual = body?.realization;
  if (!plan || receipt?.method !== 'native-offline-audio-context' || body?.hash !== graphHash || !Array.isArray(body.returnNodeIds) ||
      body.controls !== 'explicit-authored-defaults-not-replayed-live-gestures' || body.scope !== 'one-full-shared-owner-sum' ||
      canonicalDataText(body.returnNodeIds).text !== canonicalDataText(returnNodeIds).text ||
      actual?.hash !== graphHash || actual.sampleRate !== plan.sampleRate || actual.fault || actual.disposed !== false ||
      actual.stateBytes !== plan.stateBytes || actual.latencyFrames !== plan.latencyFrames || actual.maximumTailFrames !== plan.maximumTailFrames ||
      (actual.runtime?.blendBodyRevision ?? null) !== (plan.processingRevisions.blendBody ?? null) || (actual.runtime?.pairedBodyRevision ?? null) !== (plan.processingRevisions.pairedBody ?? null) || actual.runtime?.delayRevision !== plan.processingRevisions.delay || actual.runtime?.nonlinearRevision !== plan.processingRevisions.nonlinear || actual.runtime?.alignmentRevision !== plan.processingRevisions.alignment || actual.runtime?.detectorRevision !== (plan.processingRevisions.detector || null) || actual.runtime?.envelopeMappingRevision !== (plan.processingRevisions.envelopeMapping || null) || (actual.runtime?.membraneRevision ?? null) !== (plan.processingRevisions.membrane ?? null) || (actual.runtime?.networkRevision ?? null) !== (plan.processingRevisions.network ?? null) || (actual.runtime?.spectralRevision ?? null) !== (plan.processingRevisions.spectral ?? null) || (actual.runtime?.allpassRevision ?? null) !== (plan.processingRevisions.allpass ?? null) || (actual.runtime?.ringRevision ?? null) !== (plan.processingRevisions.ring ?? null) || actual.runtime?.vocoderRevision !== (plan.processingRevisions.vocoder || null) || actual.runtime?.hostRevision !== 'owned-native-effect-host-v2' || actual.initialization?.mode !== 'offline-before-publication' || actual.initialization.confirmed !== true || actual.initialization.completionConfirmed !== true ||
      actual.initialization.completionProtocol !== OFFLINE_EFFECT_COMPLETION_REVISION || !Number.isSafeInteger(receipt.frames) || receipt.frames < 1 || receipt.frames > plan.sampleRate * 150 || actual.initialization.offlineEndFrame !== receipt.frames ||
      actual.runtime?.convolution !== (plan.impulseCount ? 'browser-native-unpinned-dsp' : null) || !Array.isArray(actual.impulses) || actual.impulses.length !== plan.impulseCount)
    fail('native-convolution-receipt-mismatch', 'Native convolution output omitted its exact graph, tap or execution binding.');
  const audible = new Set([...plan.outputs, ...returnNodeIds]);
  for (let changed = true; changed;) { changed = false; for (const edge of plan.edges) if (audible.has(edge.to.nodeId) && !audible.has(edge.from.nodeId)) { audible.add(edge.from.nodeId); changed = true; } }
  const expectedProcessors = plan.nodes.filter(node => ['feedback-delay', 'nonlinear-chain', 'envelope-detector', 'envelope-mapping', 'multiband-vocoder', 'ring-modulator', 'allpass-notch', 'spectral-freeze', 'sympathetic-network', 'paired-modal-body', 'resonator-blend-body', 'rectangular-membrane'].includes(node.kind)).map(node => ({ nodeId: node.id, kind: node.kind,
    revision: node.kind === 'resonator-blend-body' ? plan.processingRevisions.blendBody : node.kind === 'paired-modal-body' ? plan.processingRevisions.pairedBody : node.kind === 'rectangular-membrane' ? plan.processingRevisions.membrane : node.kind === 'sympathetic-network' ? plan.processingRevisions.network : node.kind === 'spectral-freeze' ? plan.processingRevisions.spectral : node.kind === 'allpass-notch' ? plan.processingRevisions.allpass : node.kind === 'ring-modulator' ? plan.processingRevisions.ring : node.kind === 'multiband-vocoder' ? plan.processingRevisions.vocoder : node.kind === 'feedback-delay' ? plan.processingRevisions.delay : node.kind === 'envelope-detector' ? plan.processingRevisions.detector : node.kind === 'envelope-mapping' ? plan.processingRevisions.envelopeMapping : plan.processingRevisions.nonlinear, stateBytes: node.stateBytes,
    configurationKey: node.kind === 'resonator-blend-body' ? resonatorBlendBodyIdentity(node.blendBody) : node.kind === 'paired-modal-body' ? pairedModalBodyIdentity(node.pairedBody) : node.kind === 'rectangular-membrane' ? rectangularMembraneIdentity(node.membrane) : node.kind === 'sympathetic-network' ? sympatheticNetworkIdentity(node.network) : node.kind === 'spectral-freeze' ? spectralFreezeIdentity(node.spectral) : node.kind === 'allpass-notch' ? allpassNotchIdentity(node.allpass) : node.kind === 'ring-modulator' ? ringModulatorIdentity(node.ring) : node.kind === 'multiband-vocoder' ? vocoderBankIdentity(node.vocoder) : node.kind === 'nonlinear-chain' ? nonlinearChainIdentity(node.nonlinear) : node.kind === 'envelope-detector' ? envelopeDetectorIdentity(node.detector) : node.kind === 'envelope-mapping' ? envelopeMappingIdentity(node.mapping, plan.sampleRate) : null, offlineActive: audible.has(node.id) }));
  for (const [index, edge] of plan.edges.entries()) if (edge.alignmentFrames) expectedProcessors.push({ nodeId: '@alignment:' + index, kind: 'fixed-fractional-delay', revision: plan.processingRevisions.alignment,
    stateBytes: (Math.ceil(edge.alignmentFrames) + 2) * 8, configurationKey: fixedFractionalDelayIdentity(plan.sampleRate, edge.alignmentFrames), offlineActive: audible.has(edge.to.nodeId) });
  if (!Array.isArray(actual.processors) || actual.processors.length !== expectedProcessors.length || new Set(actual.processors.map(entry => entry.nodeId)).size !== actual.processors.length)
    fail('native-convolution-processor-mismatch', 'Mixed native convolution omitted its exact owned processor inventory.');
  for (const expected of expectedProcessors) {
    const processor = actual.processors.find(entry => entry.nodeId === expected.nodeId);
    if (!processor || processor.ready !== true || ['kind', 'revision', 'stateBytes', 'configurationKey', 'offlineActive'].some(key => processor[key] !== expected[key])) fail('native-convolution-processor-mismatch', 'Mixed effect processor initialization differs from its admitted profile.');
    const vocoder = plan.nodes.find(node => node.id === expected.nodeId)?.vocoder;
    if (vocoder && (!processor.vocoderProfile || vocoderRealizationKey(processor.vocoderProfile) !== vocoderRealizationKey(vocoder))) fail('native-vocoder-bank-mismatch', 'The native processor differs from its exact admitted digital filterbank.');
    if (expected.offlineActive) validateOfflineEffectCompletion(processor.completion, { ...expected, sampleRate: plan.sampleRate, endFrame: actual.initialization.offlineEndFrame });
  }
  if (plan.sidechainInputs.length) {
    const bindings = validateEffectSourceBindings(plan, body.sourceBindings);
    if (!Array.isArray(actual.sidechains) || actual.sidechains.length !== bindings.routes.length) fail('native-sidechain-receipt-mismatch', 'Native rendering omitted its external detector source inventory.');
    for (const route of bindings.routes) {
      const actualRoute = actual.sidechains.find(entry => entry.id === route.nodeId);
      if (!actualRoute || actualRoute.sourceBusId !== route.sourceBusId || actualRoute.tap !== route.tap || actualRoute.inputLayout !== route.layout || actualRoute.connected !== route.available || actualRoute.status !== (route.available ? 'connected' : 'missing')) fail('native-sidechain-receipt-mismatch', 'An external detector source differs from the admitted lane/tap or missing-source policy.');
    }
  }
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

export const validateNativeConvolutionRenderReceipt = validateNativeEffectRenderReceipt;

export function validateOwnedConvolutionSourceReceipt(manifest) {
  const source = manifest?.sourcePcmProducer, native = manifest?.nativeScheduling?.sourcePcm;
  if (source?.schema !== 'lemmings-causal-source-pcm-receipt/v1' || source.scope !== 'same-owned-source-kernel-full-history-before-native-body-and-crop' ||
      !Number.isSafeInteger(source.frames) || source.frames < 1 || !Number.isSafeInteger(source.channels) || source.channels < 2 || source.channels > 32 || ![44100, 48000, 96000].includes(source.sampleRate) ||
      !Array.isArray(manifest.stems?.laneIds) || !/^[a-f0-9]{64}$/.test(source.applicationBuildId) || !/^[a-f0-9]{64}$/.test(source.sourceCanonicalHash) ||
      source.engineRequirement?.engineVersion !== 1 || !/^[a-f0-9]{64}$/.test(source.engineRequirement?.artifactHash) || !/^[a-f0-9]{64}$/.test(source.engineRequirement?.parameterSchemaHash) || manifest.nativeScheduling?.nativeSourceBackend !== source.engineRequirement?.engineId ||
      source.laneIds != null && (!Array.isArray(source.laneIds) || source.laneIds.length > 15 || source.laneIds.some(id => typeof id !== 'string' || !id || id.length > 128) || new Set(source.laneIds).size !== source.laneIds.length || manifest.stems.laneIds.some(id => !source.laneIds.includes(id))) ||
      source.frames !== manifest.renderedEndSourceFrame || source.channels !== 2 + (source.laneIds || manifest.stems.laneIds).length * 2 || source.sampleRate !== manifest.sampleRate ||
      source.sourceCanonicalHash !== manifest.sourceCanonicalHash || source.applicationBuildId !== manifest.applicationBuildId ||
      canonicalDataText(source.engineRequirement).text !== canonicalDataText(manifest.engineRequirement).text ||
      source.worker?.method !== 'dedicated-worker' || source.worker.kind !== 'render-causal-source-pcm' || source.worker.sourceRevision !== manifest.sourceCanonicalHash ||
      source.worker.executionIdentity?.activeExecution !== 'bound' || source.worker.executionIdentity.buildId !== manifest.applicationBuildId ||
      !Array.isArray(source.planeByteHashes) || source.planeByteHashes.length !== source.channels || source.planeByteHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) ||
      !['little-endian', 'big-endian'].includes(source.planeHashByteOrder) || native?.scope !== 'whole-dry-source-history-before-crop' ||
      source.laneIds != null && canonicalDataText(native.laneIds).text !== canonicalDataText(source.laneIds).text ||
      source.sourceLaneIds != null && canonicalDataText(native.sourceLaneIds).text !== canonicalDataText(source.sourceLaneIds).text ||
      native.frames !== source.frames || native.channels !== source.channels || native.bytes !== source.frames * source.channels * 4 || native.planeHashByteOrder !== source.planeHashByteOrder ||
      !Array.isArray(native.planeByteHashes) || canonicalDataText(native.planeByteHashes).text !== canonicalDataText(source.planeByteHashes).text)
    fail('owned-convolution-source-receipt-mismatch', 'Native convolution PCM differs from its bound owned-source worker and complete-history input hashes.');
  if (manifest.effectGraph?.definition && manifest.effectGraph.sourceBindings) {
    const bindings = manifest.effectGraph.sourceBindings;
    if (source.sourceLaneIds && canonicalDataText(source.sourceLaneIds).text !== canonicalDataText(bindings.sourceLaneIds).text || bindings.laneIds?.some(id => !(source.laneIds || manifest.stems.laneIds).includes(id))) fail('owned-convolution-sidechain-source-mismatch', 'The owned source receipt omitted or changed its detector source lanes.');
  }
  return source;
}
