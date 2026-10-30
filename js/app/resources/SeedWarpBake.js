import { prepareOwnedStretchCore } from './OwnedStretchCore.js';
import { prepareWarpSourcePcm } from './WarpSourcePcm.js';
import { computeOwnedSourceBank } from './OwnedSourceBankComputation.js';
import { inspectSeedDerivedInput, encodeSeedDerivedAudio, seedDerivedFailure } from './SoundSeedDerivedAudio.js';
import { acceptsWarpPitch, acceptsWarpRate } from '../../midi/content/BufferedWarpPlan.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

export const SEED_WARP_BAKE_REVISION = 'direct-core-buffered-finite-warp-bake-v1';
export async function bakeSeedWarp(input, { estimatedPeakBytes, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) seedDerivedFailure('The seed warp source or controls changed.'); }; check();
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 128 * 1048576) seedDerivedFailure('The complete finite warp requires 128 MiB of admitted worker workspace.');
  const source = inspectSeedDerivedInput(input, ['wasmBytes', 'options']), options = cloneData(input.options, { maxBytes: 4096, maxNodes: 128 });
  if (!options || Object.keys(options).some(key => !['rateRatio', 'pitchRatio', 'outputRate'].includes(key)) || !acceptsWarpRate(options.rateRatio) || !acceptsWarpPitch(options.pitchRatio) || ![44100, 48000, 96000].includes(options.outputRate) || !(input.wasmBytes instanceof Uint8Array) || input.wasmBytes.byteLength !== OWNED_STRETCH_CORE.wasmBytes || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 128 * 1048576) seedDerivedFailure('A finite warp needs its exact core, bounded positive starting matrix and complete 128 MiB workspace.');
  let core;
  try {
    onProgress({ phase: 'preparing-pinned-core' });
    core = await prepareOwnedStretchCore(input.wasmBytes, { sampleRate: options.outputRate, blockFrames: options.outputRate === 96000 ? 4096 : 2048, intervalFrames: options.outputRate === 96000 ? 1024 : 512, estimatedPeakBytes, signal, current, yieldControl }); check();
    const bank = source.sampleRate === options.outputRate ? null : await computeOwnedSourceBank('sample-read-v1', { signal, current, yieldControl }); check();
    onProgress({ phase: 'copying-and-converting-source' }); const material = await prepareWarpSourcePcm(source, { outputRate: options.outputRate, bank, signal, current, yieldControl }); check();
    core.setPitch(options.pitchRatio); const config = core.configuration, rate = options.rateRatio, outputRate = options.outputRate,
      warmFrames = Math.ceil((config.inputLatencyFrames / rate + config.outputLatencyFrames + config.blockFrames * 2) / 128) * 128,
      readAheadFrames = config.inputLatencyFrames + config.outputLatencyFrames * rate, bodyFrames = Math.ceil(source.frames * outputRate / source.sampleRate / rate),
      tailFrames = Math.ceil(config.inputLatencyFrames / rate + config.outputLatencyFrames), frames = bodyFrames + tailFrames;
    if (!Number.isSafeInteger(readAheadFrames) || frames * 8 > 15 * 1048576 || tailFrames > config.bufferFrames) seedDerivedFailure('The concrete latency/crop requires a separately qualified fractional seek or larger tail profile.');
    const pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer), inputLeft = new Float32Array(192), inputRight = new Float32Array(192), outputLeft = new Float32Array(128), outputRight = new Float32Array(128);
    for (let outputFrame = -warmFrames, blocks = 0; outputFrame < bodyFrames;) {
      check(); const count = Math.min(128, bodyFrames - outputFrame), firstInput = Math.round(outputFrame * rate), endInput = Math.round((outputFrame + count) * rate), inputFrames = endInput - firstInput;
      for (let frame = 0; frame < inputFrames; frame++) { const position = readAheadFrames + firstInput + frame, inside = position >= 0 && position < material.planes[0].length; inputLeft[frame] = inside ? material.planes[0][position] : 0; inputRight[frame] = inside ? material.planes[1][position] : 0; }
      core.process(inputLeft, inputRight, 0, inputFrames, outputLeft, outputRight, 0, count);
      if (outputFrame >= 0) for (let frame = 0; frame < count; frame++) { const l = outputLeft[frame], r = outputRight[frame]; if (Math.max(Math.abs(l), Math.abs(r)) > 16) seedDerivedFailure('Warp output exceeds the immutable seed range; no normalization or clipping was applied.'); view.setFloat32((outputFrame + frame) * 8, l, true); view.setFloat32((outputFrame + frame) * 8 + 4, r, true); }
      outputFrame += count; if ((++blocks & 15) === 0) { onProgress({ phase: 'rendering-finite-warp', completedOutputFrames: Math.max(0, outputFrame), bodyFrames }); await yieldControl(); }
    }
    check(); const tailLeft = new Float32Array(tailFrames), tailRight = new Float32Array(tailFrames); core.flush(tailLeft, tailRight, 0, tailFrames);
    for (let frame = 0; frame < tailFrames; frame++) { if (Math.max(Math.abs(tailLeft[frame]), Math.abs(tailRight[frame])) > 16) seedDerivedFailure('Warp tail exceeds the immutable seed range.'); view.setFloat32((bodyFrames + frame) * 8, tailLeft[frame], true); view.setFloat32((bodyFrames + frame) * 8 + 4, tailRight[frame], true); }
    check(); const transform = freezeData({ schema: 'lemmings-seed-warp-bake/v1', algorithmRevision: SEED_WARP_BAKE_REVISION, parentAssetHash: source.source.immutableSourceRef, parentRegionFrames: [source.firstFrame, source.endFrame], options,
      coreArtifactHash: OWNED_STRETCH_CORE.wasmSha256, coreConfigurationHash: core.configurationHash, coreConfiguration: config, preparedMaterial: material.metadata, bodyFrames, tailFrames,
      coordinateMap: 'originalSourceFrame=firstFrame+outputBodyFrame*originalRate/outputRate*rateRatio;pitchRatio-does-not-change-duration',
      inputFrontierPolicy: 'global-nearest-integer-prepared-frame-frontier;bounded-half-frame-rounding;no-cumulative-drift', readAheadFrames, discardedPreparationOutputFrames: warmFrames,
      sourceBoundary: 'zero-pad-outside-selected-material;no-parent-audio-beyond-region', tailPolicy: 'explicit-core-flush-after-finite-body;not-additional-physical-source-time',
      semanticTiming: 'new-immutable-material;no-live-world-or-causal-onset-retimed', formantPolicy: 'shift-with-pitch', loop: 'not-supported-by-this-finite-bake-profile', restoration: 'deterministicPreroll', normalization: 'none', coreReceipt: core.diagnostics(),
      qualification: 'experimental-offline-core-bake;onset-pitch-stereo-duration-device-and-listening-qualification-pending;not-a-ready-live-warp-voice' });
    canonicalDataText(transform, { maxBytes: 65536, maxNodes: 8192 }); const recipeHash = await hashData(transform, { maxBytes: 65536, maxNodes: 8192 }); check();
    const result = await encodeSeedDerivedAudio(pcm, { ...source, frames, sampleRate: outputRate, parentSampleRate: source.sampleRate }, { ...transform, recipeHash }, { check, yieldControl }); check(); onProgress({ phase: 'finite-warp-prepared', bodyFrames, tailFrames });
    return { ...result, recipeHash, recipe: transform };
  } finally { core?.dispose(); }
}
