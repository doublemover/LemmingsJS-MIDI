import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { encodeSeedDerivedAudio } from './SoundSeedDerivedAudio.js';

import { FINITE_FM_EXCITER, FINITE_FM_EXCITER_REVISION } from '../../midi/content/FiniteFmExciterProfile.js';
export { FINITE_FM_EXCITER, FINITE_FM_EXCITER_REVISION };
const invalid = message => { throw new TypeError('Finite FM: ' + message); };

// Material preparation only. No oscillators, callbacks or per-sample allocations
// are added to the live renderer; the immutable short asset uses its owned reader.
export async function bakeFiniteFmExcitation(input, { signal, current = () => true, yieldControl = async () => {}, estimatedPeakBytes = 0 } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) invalid('The selected body ancestry changed.'); }; check();
  if (!input || Object.keys(input).some(key => !['parentManifest', 'parentAssetHash', 'sampleRate'].includes(key)) || !/^[a-f0-9]{64}$/.test(input.parentAssetHash || '') || ![44100, 48000, 96000].includes(input.sampleRate) || estimatedPeakBytes < 16 * 1048576) invalid('Choose an exact seed parent, supported preparation rate and reserved worker workspace.');
  const parentAssetHash = input.parentAssetHash, sampleRate = input.sampleRate;
  const parent = cloneData(input.parentManifest, { maxBytes: 262144, maxNodes: 32768 });
  if (parent.schema !== 'lemmings-sound-seed/v1' || !Number.isSafeInteger(parent.frames) || parent.frames < 2 || !Number.isSafeInteger(parent.sampleRate) || parent.sampleRate < 8000 || parent.sampleRate > 192000 || parent.coverage?.status !== 'known-material' || parent.coverage.gaps?.length || !Array.isArray(parent.ancestry) || !parent.ancestry.length || parent.ancestry.length >= 16) invalid('A complete bounded original body ancestry is required.');
  await yieldControl(); check();
  const frames = Math.ceil(sampleRate * FINITE_FM_EXCITER.supportSeconds), values = new Float64Array(frames), envelope = new Float64Array(frames); let phase = 0, weightedSum = 0, envelopeSum = 0;
  for (let frame = 0; frame < frames; frame++) {
    const fraction = frame / (frames - 1), index = FINITE_FM_EXCITER.indexStart + (FINITE_FM_EXCITER.indexEnd - FINITE_FM_EXCITER.indexStart) * fraction;
    envelope[frame] = 0.5 - 0.5 * Math.cos(2 * Math.PI * fraction); values[frame] = Math.sin(phase);
    weightedSum += values[frame] * envelope[frame]; envelopeSum += envelope[frame];
    phase += 2 * Math.PI * (FINITE_FM_EXCITER.carrierHz + index * FINITE_FM_EXCITER.modulatorHz * Math.sin(2 * Math.PI * FINITE_FM_EXCITER.modulatorHz * frame / sampleRate)) / sampleRate;
  }
  const mean = weightedSum / envelopeSum, pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer);
  for (let frame = 0; frame < frames; frame++) { const value = (values[frame] - mean) * envelope[frame] * FINITE_FM_EXCITER.gain; if (!Number.isFinite(value) || Math.abs(value) > FINITE_FM_EXCITER.maximumPeak) invalid('The prepared excitation exceeded its fixed peak contract.'); view.setFloat32(frame * 8, value, true); view.setFloat32(frame * 8 + 4, value, true); }
  const transform = freezeData({ schema: 'lemmings-finite-fm-excitation/v1', algorithmRevision: FINITE_FM_EXCITER_REVISION, generator: FINITE_FM_EXCITER, preparationRate: sampleRate, frames,
    parentAssetHash, parentManifestHash: await hashData(parent, { maxBytes: 262144, maxNodes: 32768 }), parentRole: 'body-analysis-and-regeneration-ancestry-only;parent-PCM-not-read-or-played', determinism: 'actual-prepared-bytes-hashed;no-cross-build-trigonometric-byte-equivalence-claim' });
  check(); const result = await encodeSeedDerivedAudio(pcm, { frames, sampleRate, firstFrame: 0, endFrame: parent.frames, origin: parent, parentSampleRate: parent.sampleRate, parentFrameDomain: 'body-ancestry-artifact-local-frames;not-a-source-audio-time-map', source: { immutableSourceRef: parentAssetHash } }, transform, { check, yieldControl, bakedEffects: 'none-declared' });
  check(); canonicalDataText(result.manifest, { maxBytes: 262144, maxNodes: 32768 }); return result;
}
