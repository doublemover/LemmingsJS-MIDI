import { canonicalDataText } from '../../core/CanonicalData.js';

export function encodeOwnedAudioWav(pcm, frames, sampleRate, manifest, { maxMetadataBytes = 65536, maxMetadataNodes = 8192 } = {}) {
  if (!(pcm instanceof Uint8Array) || !Number.isSafeInteger(frames) || frames < 1 || pcm.byteLength !== frames * 8 || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new TypeError('WAV output requires exact stereo Float32 frame storage.');
  const metadata = canonicalDataText(manifest, { maxBytes: maxMetadataBytes, maxNodes: maxMetadataNodes }).bytes, padded = metadata.byteLength + metadata.byteLength % 2, length = 64 + pcm.byteLength + padded;
  if (!Number.isSafeInteger(length) || length - 8 > 0xffffffff) throw new RangeError('WAV output exceeds classic stereo RIFF capacity.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer), ascii = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  ascii(36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, frames, true); ascii(48, 'data'); view.setUint32(52, pcm.byteLength, true); bytes.set(pcm, 56);
  const at = 56 + pcm.byteLength; ascii(at, 'lmjs'); view.setUint32(at + 4, metadata.byteLength, true); bytes.set(metadata, at + 8); return bytes;
}
