import { validateBufferedWarpPlan, acceptsWarpRate, acceptsWarpPitch } from '../../midi/content/BufferedWarpPlan.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { WARP_SOURCE_PCM_REVISION } from './WarpSourcePcm.js';
import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => { throw new TypeError('Buffered warp history: ' + message); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const plane = (value, first, count) => value instanceof Float32Array && value.buffer instanceof ArrayBuffer && integer(first, 0, value.length) && integer(count, 0, value.length - first);
const separate = (left, right, first, count) => left.buffer !== right.buffer || left.byteOffset + (first + count) * 4 <= right.byteOffset + first * 4 || right.byteOffset + (first + count) * 4 <= left.byteOffset + first * 4;

// The owning schedule supplies a source coordinate at outputFrame + output
// latency. This layer owns immutable samples and history reads, not onsets,
// automation publication, loop resets or retirement of the caller's producer.
export async function prepareBufferedWarpHistory({ plan: raw, parentAssetHash, pcm, configuration: rawConfiguration, configurationHash, estimatedPeakBytes, signal, current = () => true } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The source owner changed.'); }; check();
  if (typeof globalThis.registerProcessor === 'function') fail('Copy and hash prepared material outside the render thread.');
  const plan = validateBufferedWarpPlan(raw), configuration = freezeData(cloneData(rawConfiguration)), metadata = freezeData(cloneData(pcm?.metadata)), a = plan.algorithm;
  const historyFrames = configuration.inputLatencyFrames + configuration.outputLatencyFrames, first = plan.sourceFrameRegion[0], end = plan.sourceFrameRegion[1], frames = Math.ceil((end - first) * plan.outputRate / plan.sourceRate);
  if (parentAssetHash !== plan.assetHash || configuration.schema !== 'lemmings-owned-stretch-core-configuration/v1' || configuration.abi !== OWNED_STRETCH_CORE.abi || configuration.artifactHash !== OWNED_STRETCH_CORE.wasmSha256 || !a.artifactHashes.includes(OWNED_STRETCH_CORE.wasmSha256) || configurationHash !== a.configurationHash || configuration.sampleRate !== plan.outputRate || configuration.preparedRate !== plan.outputRate || configuration.channels !== 2 || configuration.formantPolicy !== plan.formantPolicy || configuration.restoration !== a.restoration || configuration.inputLatencyFrames !== a.inputLatencyFrames || configuration.outputLatencyFrames !== a.outputLatencyFrames || !integer(configuration.bufferFrames, 2, 16384) || !integer(historyFrames, 1, configuration.bufferFrames) || configuration.heapImageAbi && !a.artifactHashes.includes(configuration.heapImageAbi.moduleArtifactHash)) fail('Bind the actual pinned core configuration, both latency reports and complete artifact identity.');
  if (metadata?.schema !== 'lemmings-prepared-warp-PCM/v1' || metadata.revision !== WARP_SOURCE_PCM_REVISION || metadata.originalRate !== plan.sourceRate || metadata.originalFrames !== end - first || metadata.originalRegionFrames?.length !== 2 || metadata.originalRegionFrames[0] !== first || metadata.originalRegionFrames[1] !== end || metadata.preparedRate !== plan.outputRate || metadata.preparedFrames !== frames || metadata.normalization !== 'none' || !Array.isArray(metadata.planeHashes) || metadata.planeHashes.length !== 2 || metadata.planeHashes.some(value => !/^[a-f0-9]{64}$/.test(value)) || !Array.isArray(pcm.planes) || pcm.planes.length !== 2 || pcm.planes.some(value => !plane(value, 0, frames) || value.length !== frames)) fail('Use the exact privately prepared selected region and its original/prepared clocks.');
  const footprintBytes = frames * 8 + historyFrames * 8 + 65536;
  if (!integer(estimatedPeakBytes, footprintBytes + frames * 16 + 65536, 512 * 1048576)) fail('Reserve the source, private copy, both history planes and hash overlap.');
  let planes = [pcm.planes[0].slice(), pcm.planes[1].slice()], history = [new Float32Array(historyFrames), new Float32Array(historyFrames)], disposed = false, faulted = false, windows = 0, renderedBlocks = 0;
  for (const values of planes) for (let frame = 0; frame < frames; frame++) if (!Number.isFinite(values[frame]) || Math.abs(values[frame]) > 16) fail('Prepared PCM exceeds the finite source bound.');
  const hashes = await Promise.all([hashData(configuration), digest(new Uint8Array(planes[0].buffer)), digest(new Uint8Array(planes[1].buffer))]); check();
  if (hashes[0] !== configurationHash || hashes[1] !== metadata.planeHashes[0] || hashes[2] !== metadata.planeHashes[1]) fail('The prepared PCM or configuration immutable hash changed.');
  const alive = () => { if (disposed || faulted) fail('The history owner is unavailable.'); };
  const fill = sourceFrame => {
    alive(); if (!Number.isFinite(sourceFrame) || sourceFrame < first || sourceFrame > end || !Number.isSafeInteger(windows + 1)) fail('History requires a bounded original-asset source coordinate.');
    const preparedPosition = (sourceFrame - first) * plan.outputRate / plan.sourceRate, historyEnd = Math.round(preparedPosition + configuration.inputLatencyFrames), historyFirst = historyEnd - historyFrames;
    for (let frame = 0; frame < historyFrames; frame++) { const at = historyFirst + frame; history[0][frame] = at >= 0 && at < frames ? planes[0][at] : 0; history[1][frame] = at >= 0 && at < frames ? planes[1][at] : 0; }
    windows++; return historyFirst;
  };
  return Object.freeze({ plan, configuration, configurationHash, metadata, footprintBytes, historyFrames,
    copyHistory(sourceFrame, left, right, offset = 0) {
      alive(); if (!plane(left, offset, historyFrames) || !plane(right, offset, historyFrames) || !separate(left, right, offset, historyFrames)) fail('History copying requires separate bounded destination planes.');
      const historyFirst = fill(sourceFrame); for (let frame = 0; frame < historyFrames; frame++) { left[offset + frame] = history[0][frame]; right[offset + frame] = history[1][frame]; } return historyFirst;
    },
    process(core, sourceFrame, rateRatio, pitchRatio, left, right, offset, count) {
      alive(); if (core?.configurationHash !== configurationHash || core.configuration !== configuration && core.configuration?.artifactHash !== configuration.artifactHash || typeof core.setPitch !== 'function' || typeof core.seek !== 'function' || typeof core.processBuffered !== 'function' || !acceptsWarpRate(rateRatio) || !acceptsWarpPitch(pitchRatio) || !plane(left, offset, count) || !plane(right, offset, count) || !separate(left, right, offset, count) || !integer(count, 1, configuration.bufferFrames) || !Number.isSafeInteger(renderedBlocks + 1)) fail('Use the bound core, positive matrix controls and separate admitted output planes.');
      fill(sourceFrame);
      try { core.setPitch(pitchRatio); core.seek(history[0], history[1], 0, historyFrames, rateRatio); core.processBuffered(left, right, offset, count); renderedBlocks++; }
      catch (error) { faulted = true; left.fill(0, offset, offset + count); right.fill(0, offset, offset + count); throw error; }
    },
    diagnostics: () => Object.freeze({ disposed, faulted, windows, renderedBlocks, historyFrames, preparedFrames: frames, sourceFrameDomain: 'original-asset-rate', historyBoundary: 'zero-outside-selected-region;never-read-unselected-audio', algorithmicOutputLatencyFrames: configuration.outputLatencyFrames, scheduling: 'caller-supplies-future-source-coordinate;canonical-onset-and-loop-reset-remain-caller-owned', qualification: 'buffered-read-implementation;DSP-and-device-evidence-pending' }),
    dispose() { disposed = true; planes = history = null; return Object.freeze({ state: 'private-history-references-released', producerRetirement: 'not-established;caller-must-retire-core-and-worker' }); }
  });
}
