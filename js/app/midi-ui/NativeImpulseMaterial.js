import { validateImpulseResponseDescriptor } from '../../midi/content/ImpulseResponseDescriptor.js';
import { cloneData, freezeData } from '../../core/CanonicalData.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { DECODER_VERSION } from './AudioAssetRef.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'ImpulseMaterialError', code });
export async function prepareNativeImpulseMaterial(input, { provider, resources, context, owner, generation = 0, signal, isCurrent = () => true, jobs = backgroundJobService } = {}) {
  const descriptor = validateImpulseResponseDescriptor(input), ref = descriptor.asset;
  if (!provider?.acquireImpulse || !resources?.reserve || !context || context.state === 'closed' || ![44100, 48000, 96000].includes(context.sampleRate) || typeof jobs?.compute !== 'function')
    throw new TypeError('Impulse preparation requires the existing context, shared material provider and admitted analysis worker.');
  const guard = () => { signal?.throwIfAborted(); if (!isCurrent() || context.state === 'closed') throw failure('stale-impulse-material', 'Impulse preparation no longer belongs to this context.'); };
  guard();
  const upperBytes = (Math.ceil(ref.frames * context.sampleRate / ref.sourceSampleRate) + 1) * ref.channels * 4;
  if (!Number.isSafeInteger(upperBytes) || upperBytes > 32 * 1048576) throw failure('impulse-material-capacity', 'This impulse exceeds the native analysis PCM profile.');
  const copyLease = resources.reserve({ kind: 'impulse-analysis-copy', owner, generation, bytes: upperBytes, consumerOwned: true });
  let metadataLease = null, material = null, graphPin = null, computed = null, planes = null, analysis = null, originalError = null, producerState = null;
  try {
    metadataLease = resources.reserve({ kind: 'impulse-analysis-metadata', owner, generation, estimateBytes: 65536, consumerOwned: true });
    material = await provider.acquireImpulse(ref, { owner, generation, signal, isCurrent, decodeContext: context }); guard();
    const pin = material.assets[0], buffer = pin?.buffer;
    if (material.assets.length !== 1 || !pin.isActive() || pin.ref.contentHash !== ref.contentHash || pin.ref.bytes !== ref.bytes || pin.variant.decoderVersion !== DECODER_VERSION ||
        pin.variant.targetSampleRate !== context.sampleRate || buffer.numberOfChannels !== ref.channels || buffer.sampleRate !== context.sampleRate ||
        Math.abs(buffer.length - ref.frames * context.sampleRate / ref.sourceSampleRate) > 1) throw failure('impulse-material-mismatch', 'Decoded impulse differs from its exact asset and context rate.');
    graphPin = pin.retain({ owner, generation });
    planes = [];
    for (let channel = 0; channel < ref.channels; channel++) { guard(); planes.push(new Float32Array(buffer.getChannelData(channel))); }
    const bytes = buffer.length * ref.channels * 4; copyLease.shrink(bytes);
    computed = await jobs.compute({ kind: 'analyze-native-impulse', ownerId: 'impulse-analysis:' + owner, ownerEpoch: generation, sourceRevision: ref.contentHash,
      inputBytes: bytes + 16384, maxBytes: bytes + 65536, estimatedPeakBytes: bytes * 4 + 16 * 1048576, priority: 'background', signal, isCurrent,
      deadlineMs: 60000, prepareInput: () => ({ descriptor, sampleRate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels, decoderVersion: DECODER_VERSION, planes }) }); guard();
    const value = computed.value;
    if (computed.receipt.method !== 'dedicated-worker' || computed.receipt.executionIdentity?.activeExecution !== 'bound' || value?.schema !== 'lemmings-impulse-analysis/v1' ||
        value.assetHash !== ref.contentHash || value.decoderVersion !== DECODER_VERSION || value.sampleRate !== context.sampleRate || value.frames !== buffer.length || value.channels !== ref.channels ||
        value.normalizationMode !== descriptor.normalizationMode || value.referenceGain01 !== descriptor.referenceGain01 || !Number.isFinite(value.normalizationScale) ||
        !Number.isFinite(value.linearGainBound) || value.linearGainBound < 0 || value.linearGainBound > descriptor.maximumLinearGain + 1e-9 ||
        !Array.isArray(value.planeByteHashes) || value.planeByteHashes.length !== ref.channels || value.planeByteHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)))
      throw failure('impulse-analysis-mismatch', 'Impulse analysis did not retain its immutable source, layout and gain contract.');
    analysis = freezeData(cloneData(value, { maxBytes: 65536, maxNodes: 1024 }));
  } catch (error) {
    if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
    producerState = error.backgroundRetirement || null; originalError = error;
  }
  const transient = createProcgenRetirementScope().retire([{ name: 'impulse-analysis-producer', run: () => {
    computed?.release(); const phase = computed?.retirementState?.().phase || producerState?.phase;
    if (phase && !['released', 'canceled'].includes(phase)) throw failure('impulse-retirement-unknown', 'Impulse PCM is still owned by its analysis producer.');
  } }]); await transient.completion;
  if (transient.outcome !== 'complete') {
    const error = Object.assign(failure('impulse-retirement-unknown', 'Impulse copy and decoded pins remain reserved.'), { cause: originalError, retirement: transient, retainedMaterial: { material, graphPin, computed, planes } });
    copyLease.retainUnknown(error); metadataLease?.retainUnknown(error); throw error;
  }
  const copyRetirement = createProcgenRetirementScope().retire([{ name: 'impulse-analysis-copy', run: () => { copyLease.release(); planes = null; computed = null; } }]);
  if (copyRetirement.outcome !== 'complete') originalError ||= Object.assign(failure('impulse-retirement-unknown', 'Impulse copy bookkeeping remains unresolved.'), { retirement: copyRetirement });
  if (originalError) {
    const receipt = createProcgenRetirementScope().retire([{ name: 'impulse-graph-pin', run: () => graphPin?.release() }, { name: 'impulse-pins', run: () => material?.release() }, { name: 'impulse-metadata', run: () => metadataLease?.release() }]); await receipt.completion;
    if (receipt.outcome !== 'complete') originalError.retirement = receipt; throw originalError;
  }
  const scope = createProcgenRetirementScope(); let released = false;
  return Object.freeze({ descriptor, analysis: Object.freeze(analysis), get pin() { if (released) throw failure('impulse-material-retired', 'Impulse material was retired.'); return graphPin; },
    release() { return scope.retire([{ name: 'impulse-material', run: async () => {
      graphPin.release(); const receipt = material.release(); await receipt.completion; if (receipt.outcome !== 'complete') { metadataLease.retainUnknown(failure('impulse-retirement-unknown', 'Impulse pins remain owned.')); throw failure('impulse-retirement-unknown', 'Impulse pins remain owned.'); }
      metadataLease.release(); released = true; material = null; graphPin = null;
    } }]); } });
}
