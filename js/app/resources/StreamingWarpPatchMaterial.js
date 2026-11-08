import { prepareOwnedStretchCore } from './OwnedStretchCore.js';
import { prepareWarpSourcePcm } from './WarpSourcePcm.js';
import { computeOwnedSourceBank } from './OwnedSourceBankComputation.js';
import { validateBufferedWarpPlan } from '../../midi/content/BufferedWarpPlan.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { hashData } from '../../core/CanonicalData.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'streaming-warp-patch-material-unavailable' }); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
export async function prepareStreamingWarpPatchMaterial(input, { applicationBuildId, estimatedPeakBytes, signal, current = () => true, yieldControl, onProgress }) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The streaming patch source changed.'); }; check();
  const plan = validateBufferedWarpPlan(input.plan), pcm = input.pcm, d = pcm?.descriptor;
  if (typeof document !== 'undefined' || typeof globalThis.registerProcessor === 'function' || input.applicationBuildId !== applicationBuildId || estimatedPeakBytes < 256 * 1048576 ||
      Object.keys(input).some(key => !['mode', 'plan', 'pcm', 'wasmBytes', 'applicationBuildId'].includes(key)) || input.mode !== 'instrument-patch' || !(input.wasmBytes instanceof Uint8Array) ||
      d?.schema !== 'lemmings-owned-pcm-bank/v1' || d.assetHash !== plan.assetHash || d.sourceSampleRate !== plan.sourceRate || d.sampleRate !== plan.sourceRate || d.sourceFrames !== plan.sourceFrames || d.frames !== plan.sourceFrames || ![1, 2].includes(d.channels) || d.bytes !== d.frames * d.channels * 4 || d.bytes > 16 * 1048576 || d.format !== 'float32-planar-le' ||
      !Array.isArray(pcm.planes) || pcm.planes.length !== d.channels || pcm.planes.some(plane => !(plane instanceof Float32Array) || plane.length !== d.frames)) fail('Use the exact source-rate PCM and complete immutable saved WarpVoice plan.');
  const bytes = new Uint8Array(d.bytes);
  for (let channel = 0; channel < d.channels; channel++) { bytes.set(new Uint8Array(pcm.planes[channel].buffer, pcm.planes[channel].byteOffset, pcm.planes[channel].byteLength), channel * d.frames * 4); check(); await yieldControl(); }
  if (await digest(bytes) !== d.pcmHash) fail('The source-rate PCM changed after its verified bank was copied.'); check();
  const firstFrame = plan.sourceFrameRegion[0], endFrame = plan.sourceFrameRegion[1], source = { frames: endFrame - firstFrame, sampleRate: plan.sourceRate, firstFrame, endFrame,
    sample: (frame, channel) => pcm.planes[Math.min(channel, d.channels - 1)][firstFrame + frame] };
  let core = null;
  try {
    onProgress({ phase: 'preparing-saved-warp-instrument-image' }); const blockFrames = plan.outputRate === 96000 ? 4096 : 2048;
    core = await prepareOwnedStretchCore(input.wasmBytes, { sampleRate: plan.outputRate, blockFrames, intervalFrames: blockFrames / 4, randomSeed: 1, captureInitialImage: true, estimatedPeakBytes, signal, current, yieldControl }); check();
    const image = core.getInitialImage(), c = core.configuration;
    if (plan.algorithm.id !== 'owned-signalsmith-streaming-buffered' || plan.algorithm.revision !== 'streaming-worker-pcm-v1' || plan.algorithm.configurationHash !== core.configurationHash || plan.algorithm.inputLatencyFrames !== c.inputLatencyFrames || plan.algorithm.outputLatencyFrames !== c.outputLatencyFrames || plan.algorithm.requiredPreparationLeadFrames !== Math.ceil((c.inputLatencyFrames + c.outputLatencyFrames + 2048) / 128) * 128 || plan.algorithm.artifactHashes.length !== 2 || plan.algorithm.artifactHashes[0] !== OWNED_STRETCH_CORE.wasmSha256 || plan.algorithm.artifactHashes[1] !== image.metadata.moduleArtifactHash)
      fail('The saved algorithm/configuration differs from this actual pinned renderer. Reprepare an explicit compatible patch revision.');
    const bank = plan.sourceRate === plan.outputRate ? null : await computeOwnedSourceBank('sample-read-v1', { signal, current, yieldControl }); check();
    const prepared = await prepareWarpSourcePcm(source, { outputRate: plan.outputRate, bank, signal, current, yieldControl }); check();
    return { schema: 'lemmings-prepared-streaming-warp-material/v1', applicationBuildId, plan, planHash: await hashData(plan), pcm: prepared, image: { ...image, applicationBuildId },
      source: { assetHash: plan.assetHash, sourceRate: plan.sourceRate, sourceFrameRegion: plan.sourceFrameRegion, sourcePcmHash: d.pcmHash, sourceBankHash: d.bankHash, interpretation: 'exact-installed-source;independent-live-warp-realization;ancestry-retained-in-pinned-pack' } };
  } finally { core?.dispose(); }
}
