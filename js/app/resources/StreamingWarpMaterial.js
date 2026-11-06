import { prepareOwnedStretchCore } from './OwnedStretchCore.js';
import { prepareWarpSourcePcm } from './WarpSourcePcm.js';
import { computeOwnedSourceBank } from './OwnedSourceBankComputation.js';
import { inspectSeedDerivedInput } from './SoundSeedDerivedAudio.js';
import { validateBufferedWarpPlan } from '../../midi/content/BufferedWarpPlan.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

export async function prepareStreamingWarpMaterial(input, { applicationBuildId, estimatedPeakBytes, signal, current = () => true,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const fail = message => { throw Object.assign(new Error(message), { code: 'streaming-warp-material-unavailable' }); },
    check = () => { signal?.throwIfAborted(); if (!current()) fail('The streaming material source changed.'); };
  check();
  if (typeof document !== 'undefined' || typeof globalThis.registerProcessor === 'function' || !/^[a-f0-9]{64}$/.test(applicationBuildId || '') || input?.applicationBuildId !== applicationBuildId ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 256 * 1048576) fail('Prepare streaming material only in its admitted immutable worker with complete heap/PCM overlap.');
  if (input?.mode === 'instrument-patch') { const { prepareStreamingWarpPatchMaterial } = await import('./StreamingWarpPatchMaterial.js'); return prepareStreamingWarpPatchMaterial(input, { applicationBuildId, estimatedPeakBytes, signal, current, yieldControl, onProgress }); }
  const source = inspectSeedDerivedInput(input, ['wasmBytes', 'options', 'applicationBuildId']), options = cloneData(input.options, { maxBytes: 8192, maxNodes: 512 });
  if (!options || Object.keys(options).some(key => !['outputRate', 'rateRatio', 'pitchRatio', 'rootPitch', 'loop', 'randomSeed'].includes(key)) ||
      ![44100, 48000, 96000].includes(options.outputRate) || !(input.wasmBytes instanceof Uint8Array)) fail('Select explicit prepared-rate, traversal, pitch, region-loop and seed controls.');
  let core = null;
  try {
    onProgress({ phase: 'preparing-shared-streaming-image' });
    const blockFrames = options.outputRate === 96000 ? 4096 : 2048;
    core = await prepareOwnedStretchCore(input.wasmBytes, { sampleRate: options.outputRate, blockFrames, intervalFrames: blockFrames / 4,
      randomSeed: options.randomSeed ?? 1, captureInitialImage: true, estimatedPeakBytes, signal, current, yieldControl }); check();
    const configuration = core.configuration, image = core.getInitialImage(), bank = source.sampleRate === options.outputRate ? null : await computeOwnedSourceBank('sample-read-v1', { signal, current, yieldControl }); check();
    onProgress({ phase: 'preparing-selected-streaming-pcm' }); const pcm = await prepareWarpSourcePcm(source, { outputRate: options.outputRate, bank, signal, current, yieldControl }); check();
    const plan = validateBufferedWarpPlan({ schema: 'lemmings-buffered-warp-plan/v1', assetHash: source.source.immutableSourceRef,
      sourceRate: source.sampleRate, sourceFrames: source.source.sourceFrames, sourceFrameRegion: [source.firstFrame, source.endFrame], outputRate: options.outputRate,
      rootPitch: options.rootPitch, rateRatio: options.rateRatio, pitchRatio: options.pitchRatio, formantPolicy: 'shift-with-pitch', loop: options.loop ?? null,
      seekPolicy: 'reset-and-deterministic-preroll', algorithm: { id: 'owned-signalsmith-streaming-buffered', revision: 'streaming-worker-pcm-v1',
        artifactHashes: [OWNED_STRETCH_CORE.wasmSha256, image.metadata.moduleArtifactHash], configurationHash: core.configurationHash,
        preparedRate: options.outputRate, inputLatencyFrames: configuration.inputLatencyFrames, outputLatencyFrames: configuration.outputLatencyFrames,
        requiredPreparationLeadFrames: Math.ceil((configuration.inputLatencyFrames + configuration.outputLatencyFrames + 2048) / 128) * 128,
        restoration: 'deterministicPreroll', qualification: 'unqualified' } });
    const planHash = await hashData(plan); check();
    return Object.freeze({ schema: 'lemmings-prepared-streaming-warp-material/v1', applicationBuildId, generation: source.generation, plan, planHash, pcm,
      image: Object.freeze({ ...image, applicationBuildId }), source: freezeData({ assetHash: source.source.immutableSourceRef, sourceRate: source.sampleRate,
        sourceFrameRegion: [source.firstFrame, source.endFrame], ancestry: source.origin.ancestry, bakedEffects: source.origin.bakedEffects,
        bakedCausePolicy: source.origin.bakedCausePolicy, interpretation: 'same-immutable-source;new-owned-streaming-realization;no-new-frozen-asset' }) });
  } finally { core?.dispose(); }
}
