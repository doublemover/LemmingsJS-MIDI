export const MAX_OWNED_PCM_BYTES = 16 * 1048576;
export const MAX_OWNED_PCM_BANKS = 32;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validOwnedPcmDescriptor(d) {
  return !!d && Object.getPrototypeOf(d) === Object.prototype && Object.keys(d).every(key => ['schema', 'assetHash', 'pcmHash', 'bankHash', 'format', 'sourceFrames', 'sourceSampleRate', 'frames', 'sampleRate', 'channels', 'bytes', 'decoderVersion', 'peak', 'sampleMagnitudeLimit', 'evidence'].includes(key)) &&
    d.schema === 'lemmings-owned-pcm-bank/v1' && d.format === 'float32-planar-le' && hash(d.assetHash) && hash(d.pcmHash) && hash(d.bankHash) && integer(d.frames, 2, 4194304) && integer(d.channels, 1, 2) && integer(d.sampleRate, 8000, 192000) && integer(d.sourceSampleRate, 8000, 192000) && integer(d.sourceFrames, 2, 8000000) &&
    d.bytes === d.frames * d.channels * 4 && d.bytes <= MAX_OWNED_PCM_BYTES && typeof d.decoderVersion === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(d.decoderVersion) && Number.isFinite(d.peak) && d.peak >= 0 && d.peak <= 16 && d.sampleMagnitudeLimit === 16 && d.evidence === 'copied-decoded-pcm-not-acoustic-qualification' && Math.abs(d.frames - d.sourceFrames * d.sampleRate / d.sourceSampleRate) <= 1;
}
export function validOwnedPcmSetDescriptor(d) {
  if (!d || Object.getPrototypeOf(d) !== Object.prototype || Object.keys(d).some(key => !['schema', 'banks', 'assetHashes', 'bytes', 'pcmHash', 'bankHash'].includes(key)) || d.schema !== 'lemmings-owned-pcm-set/v1' || !Array.isArray(d.banks) || !d.banks.length || d.banks.length > MAX_OWNED_PCM_BANKS || !Array.isArray(d.assetHashes) || d.assetHashes.length !== d.banks.length || !hash(d.bankHash) || !hash(d.pcmHash) || !integer(d.bytes, 8, MAX_OWNED_PCM_BYTES)) return false;
  let bytes = 0, previous = '';
  for (let index = 0; index < d.banks.length; index++) { const bank = d.banks[index]; if (!validOwnedPcmDescriptor(bank) || bank.assetHash <= previous || d.assetHashes[index] !== bank.assetHash) return false; previous = bank.assetHash; bytes += bank.bytes; }
  return bytes === d.bytes;
}

export function validOwnedPcmPlanes(planes, descriptor, previousBuffers = null) {
  const { frames, channels, bytes } = descriptor || {};
  if (!integer(frames, 2, 4194304) || !integer(channels, 1, 2) || bytes !== frames * channels * 4 || !Array.isArray(planes) || planes.length !== channels ||
      planes.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.length !== frames || previousBuffers?.has(plane.buffer))) return false;
  const packed = planes.every((plane, channel) => plane.buffer === planes[0].buffer && plane.buffer.byteLength === bytes && plane.byteOffset === channel * frames * 4);
  const independent = planes.every(plane => plane.byteOffset === 0 && plane.byteLength === plane.buffer.byteLength) && (channels === 1 || planes[0].buffer !== planes[1].buffer);
  return packed || independent;
}
