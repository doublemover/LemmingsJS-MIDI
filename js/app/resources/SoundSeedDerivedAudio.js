import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { encodeOwnedAudioWav } from '../midi-ui/OwnedAudioWav.js';

export const SEED_DERIVED_MAX_PCM = 4 * 1048576;
export const seedDigest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
export const seedDerivedFailure = message => { throw Object.assign(new Error(message), { name: 'SeedDerivedError', code: 'seed-analysis-unavailable' }); };
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

export function inspectSeedDerivedInput(input, allowed = []) {
  const { pcm, originBytes, source, firstFrame, endFrame, sampleRate, generation } = input || {};
  if (!input || Object.keys(input).some(key => !['pcm', 'originBytes', 'source', 'firstFrame', 'endFrame', 'sampleRate', 'generation', ...allowed].includes(key)) ||
      !(pcm instanceof Uint8Array) || !(pcm.buffer instanceof ArrayBuffer) || pcm.length > SEED_DERIVED_MAX_PCM || !(originBytes instanceof Uint8Array) || originBytes.length > 262144 ||
      !integer(sampleRate, 8000, 192000) || source?.sampleRate !== sampleRate || source.formatVersion !== 'lemmings-sound-seed/v1' || !/^[a-f0-9]{64}$/.test(source.immutableSourceRef) ||
      !integer(firstFrame, 0, source.sourceFrames - 1) || !integer(endFrame, firstFrame + 2, source.sourceFrames) || endFrame - firstFrame > sampleRate * 8 || pcm.length !== (endFrame - firstFrame) * 8 || !integer(generation, 1, Number.MAX_SAFE_INTEGER)) seedDerivedFailure('Derived analysis needs one exact frozen seed window, at most eight seconds and 4 MiB of stereo PCM.');
  let origin; try { origin = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originBytes)); } catch { seedDerivedFailure('Invalid original seed annotation.'); }
  canonicalDataText(origin, { maxBytes: 262144, maxNodes: 32768 });
  if (origin.schema !== source.formatVersion || origin.frames !== source.sourceFrames || origin.sampleRate !== sampleRate || !Array.isArray(origin.ancestry) || origin.ancestry.length >= 16 ||
      typeof origin.tap !== 'string' || typeof origin.bakedEffects !== 'string' || typeof origin.bakedCausePolicy !== 'string' || origin.coverage?.status !== 'known-material' || !Array.isArray(origin.coverage.gaps) || origin.coverage.gaps.length) seedDerivedFailure('Derived playback requires a complete frozen material region and bounded retained ancestry.');
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength), frames = endFrame - firstFrame;
  const sample = (frame, channel) => view.getFloat32(frame * 8 + channel * 4, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) { const value = sample(frame, channel); if (!Number.isFinite(value) || Math.abs(value) > 16) seedDerivedFailure('Derived source PCM is nonfinite or exceeds its declared magnitude bound.'); }
  return { origin, source, frames, sampleRate, generation, firstFrame, endFrame, sample };
}

export async function encodeSeedDerivedAudio(pcm, source, transform, { check = () => {}, yieldControl = async () => {}, bakedEffects = null } = {}) {
  const { frames, sampleRate, origin } = source;
  if (!(pcm instanceof Uint8Array) || pcm.length !== frames * 8) seedDerivedFailure('Derived component frame inventory changed.');
  if (bakedEffects !== null && (typeof bakedEffects !== 'string' || !bakedEffects.length || bakedEffects.length > 512)) seedDerivedFailure('Printed processing needs an explicit bounded effect annotation.');
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength), blockFrames = 2 ** Math.max(0, Math.ceil(Math.log2(frames / 1024))), bins = Math.ceil(frames / blockFrames), minMax = new Float32Array(bins * 4);
  for (let bin = 0; bin < bins; bin++) { minMax[bin * 4] = minMax[bin * 4 + 2] = Infinity; minMax[bin * 4 + 1] = minMax[bin * 4 + 3] = -Infinity; }
  let peak = 0, squares = 0, clipping = 0, ll = 0, rr = 0, lr = 0;
  for (let first = 0; first < frames; first += 16384) {
    check();
    for (let frame = first; frame < Math.min(frames, first + 16384); frame++) {
      const l = view.getFloat32(frame * 8, true), r = view.getFloat32(frame * 8 + 4, true), bin = Math.floor(frame / blockFrames) * 4;
      if (!Number.isFinite(l) || !Number.isFinite(r) || Math.max(Math.abs(l), Math.abs(r)) > 16) seedDerivedFailure('A derived component exceeds the admitted Float32 material range.');
      ll += l * l; rr += r * r; lr += l * r;
      for (let channel = 0; channel < 2; channel++) { const value = channel ? r : l, at = bin + channel * 2; minMax[at] = Math.min(minMax[at], value); minMax[at + 1] = Math.max(minMax[at + 1], value);
        peak = Math.max(peak, Math.abs(value)); squares += value * value; clipping += Number(Math.abs(value) > 1); }
    }
    await yieldControl();
  }
  check(); const pcmHash = await seedDigest(pcm), parentManifestHash = await hashData(origin, { maxBytes: 262144, maxNodes: 32768 }); check();
  const ancestry = [...origin.ancestry, { originKind: 'FROZEN SEED', immutableSourceRef: source.source.immutableSourceRef, completeParentArtifactHash: source.source.immutableSourceRef,
    parentManifestHash, parentFrameDomain: source.parentFrameDomain ?? 'artifact-local-output-frames-at-original-artifact-rate', parentSampleRate: source.parentSampleRate ?? sampleRate, firstFrame: source.firstFrame, endFrame: source.endFrame,
    parentTimelineOriginFrame: 0, sourceTap: origin.tap, takeId: null, takeRevision: null, sourceCanonicalHash: null, bakedEffects: origin.bakedEffects,
    regeneration: 'requires-separately-retained-original-source;not-required-to-play-frozen-PCM' }];
  const statistics = { rawPeak: peak, peak, rawRms: Math.sqrt(squares / (frames * 2)), rms: Math.sqrt(squares / (frames * 2)), rawClippedSamples: clipping, clippedSamples: clipping,
    stereoCorrelation: ll && rr ? Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr))) : null, silence: peak < 1e-8 };
  const manifest = freezeData({ schema: 'lemmings-sound-seed/v1', revision: transform.algorithmRevision, frames, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', tap: 'derived-frozen-seed-component',
    rawPcmHash: pcmHash, pcmHash, bakedEffects: bakedEffects ?? origin.bakedEffects, normalization: 'none', dither: 'none-float-output', fades: { inFrames: 0, outFrames: 0, law: 'linear' },
    coverage: { ...origin.coverage, gaps: [], frameDomain: 'seed-local-output-frames' }, ancestry, statistics, derivedTransform: transform,
    bakedCausePolicy: origin.bakedCausePolicy, physicalTakeEvidence: false, acousticReceipt: false, qualification: 'derived-analysis-material;not-perceptual-isolation-or-physical-material-identification' });
  const bytes = encodeOwnedAudioWav(pcm, frames, sampleRate, manifest, { maxMetadataBytes: 262144, maxMetadataNodes: 32768 }), assetHash = await seedDigest(bytes); check();
  return { bytes, assetHash, manifest, waveform: { blockFrames, bins, minMax } };
}
