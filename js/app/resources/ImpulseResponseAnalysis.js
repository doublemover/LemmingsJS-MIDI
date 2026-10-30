import { validateImpulseResponseDescriptor } from '../../midi/content/ImpulseResponseDescriptor.js';
import { DECODER_VERSION } from '../midi-ui/AudioAssetRef.js';

const fail = message => { throw Object.assign(new Error(message), { name: 'ImpulseAnalysisError', code: 'invalid-impulse-analysis' }); };
export async function analyzeImpulseResponse(input, { signal, current = () => true, yieldControl = () => Promise.resolve(), crypto = globalThis.crypto, estimatedPeakBytes = 0 } = {}) {
  const guard = () => { signal?.throwIfAborted(); if (!current()) fail('Impulse analysis is stale.'); };
  guard(); const descriptor = validateImpulseResponseDescriptor(input?.descriptor), { sampleRate, frames, channels, planes, decoderVersion } = input;
  const bytes = frames * channels * 4;
  if (Object.keys(input).some(key => !['descriptor', 'sampleRate', 'frames', 'channels', 'planes', 'decoderVersion'].includes(key)) || ![44100, 48000, 96000].includes(sampleRate) ||
      !Number.isSafeInteger(frames) || frames < 1 || channels !== descriptor.asset.channels || Math.abs(frames - descriptor.asset.frames * sampleRate / descriptor.asset.sourceSampleRate) > 1 ||
      !Number.isSafeInteger(bytes) || bytes > 32 * 1048576 || estimatedPeakBytes < bytes * 4 + 1048576 || decoderVersion !== DECODER_VERSION ||
      !Array.isArray(planes) || planes.length !== channels || planes.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.length !== frames || plane.byteOffset || plane.buffer.byteLength !== plane.byteLength))
    fail('Impulse planes differ from the decoded source/rate profile or admitted workspace.');
  const absoluteSums = [], planeByteHashes = []; let squares = 0, peak = 0;
  for (const plane of planes) {
    let sum = 0;
    for (let first = 0; first < frames; first += 65536) {
      for (let i = first; i < Math.min(frames, first + 65536); i++) {
        const value = plane[i]; if (!Number.isFinite(value) || Math.abs(value) > 16) fail('Impulse has nonfinite or excessive coefficients.');
        sum += Math.abs(value); squares += value * value; peak = Math.max(peak, Math.abs(value));
      }
      guard(); await yieldControl();
    }
    absoluteSums.push(sum);
    const digest = await crypto.subtle.digest('SHA-256', plane.buffer); guard();
    planeByteHashes.push([...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''));
  }
  const rms = Math.sqrt(squares / (channels * frames));
  const normalizationScale = descriptor.normalizationMode === 'none' ? 1 : 0.00125 / Math.max(0.000125, rms) * 44100 / sampleRate * (channels === 4 ? 0.5 : 1);
  // Summing every true-stereo path is conservative for either output row and
  // avoids treating a four-channel IR as four unrelated audible source lanes.
  const coefficientBound = channels === 1 ? absoluteSums[0] : channels === 2 ? Math.max(...absoluteSums) : absoluteSums.reduce((sum, value) => sum + value, 0);
  const linearGainBound = coefficientBound * normalizationScale * descriptor.referenceGain01;
  if (!Number.isFinite(linearGainBound) || linearGainBound > descriptor.maximumLinearGain + 1e-9) fail('The decoded impulse exceeds its declared convolution headroom.');
  const endian = new Uint32Array([0x01020304]);
  return Object.freeze({ schema: 'lemmings-impulse-analysis/v1', assetHash: descriptor.asset.contentHash, decoderVersion, sampleRate, frames, channels, bytes,
    normalizationMode: descriptor.normalizationMode, normalizationScale, referenceGain01: descriptor.referenceGain01, linearGainBound,
    absoluteSums: Object.freeze(absoluteSums), rms, peak, silent: peak === 0, planeByteHashes: Object.freeze(planeByteHashes),
    planeHashByteOrder: new Uint8Array(endian.buffer)[0] === 4 ? 'little-endian' : 'big-endian',
    boundEvidence: 'conservative-absolute-impulse-coefficients', measuredLatencyFrames: null,
    qualification: 'decoded-pcm-analysis-not-room-listening-or-latency-measurement' });
}
