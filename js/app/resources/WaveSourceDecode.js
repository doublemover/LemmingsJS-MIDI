import { inspectWaveContainer } from '../midi-ui/AudioAssetRef.js';
import { WAVE_SOURCE_DECODER_VERSION } from '../midi-ui/WaveSourceProfile.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'BackgroundJobError', code });
export async function decodeWaveSource(input, { signal, current = () => true, maxBytes, estimatedPeakBytes, crypto = globalThis.crypto,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) throw failure('stale-owner', 'Source decoder ownership changed.'); };
  const bytes = input?.bytes, ref = input?.ref;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 44 || maxBytes > 16 * 1048576 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes > 512 * 1048576 || !(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || !ref || Object.keys(input).some(key => !['bytes', 'ref'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(ref.contentHash) || bytes.byteLength !== ref.bytes || bytes.byteLength > maxBytes || ref.kind !== 'sample') throw failure('invalid-contract', 'Source decoding requires exact immutable WAV bytes.');
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw failure('unsupported-host', 'Source PCM requires a little-endian host.');
  const format = inspectWaveContainer(bytes, { contentHash: ref.contentHash, maxBytes }), decodedBytes = format.frames * format.channels * 4;
  if (format.frames !== ref.frames || format.channels !== ref.channels || format.sampleRate !== ref.sourceSampleRate) throw failure('content-mismatch', 'Source WAV format differs from its reference.');
  if (decodedBytes > 32 * 1048576 || estimatedPeakBytes < Math.max(16 * 1048576, bytes.byteLength * 8 + decodedBytes * 4 + 1048576)) throw failure('memory-capacity', 'Source PCM exceeds the admitted decoder workspace.');
  const hex = buffer => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes)); check();
  if (hash !== ref.contentHash) throw failure('content-mismatch', 'Source WAV bytes differ from their pinned hash.');
  const planes = Array.from({ length: format.channels }, () => new Float32Array(format.frames)), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = format.bits / 8;
  for (let frame = 0; frame < format.frames; frame++) {
    for (let channel = 0; channel < format.channels; channel++) {
      const at = format.dataOffset + frame * format.blockAlign + channel * width; let sample;
      if (format.encoding === 3) sample = view.getFloat32(at, true);
      else if (format.bits === 8) sample = (view.getUint8(at) - 128) / 128;
      else if (format.bits === 16) sample = view.getInt16(at, true) / 32768;
      else if (format.bits === 24) { const integer = view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getUint8(at + 2) << 16; sample = (integer << 8 >> 8) / 8388608; }
      else sample = view.getInt32(at, true) / 2147483648;
      if (!Number.isFinite(sample) || Math.abs(sample) > 16) throw failure('invalid-data', 'Source WAV contains nonfinite or excessive samples.');
      planes[channel][frame] = sample;
    }
    if ((frame & 16383) === 16383) { check(); await yieldControl(); }
  }
  const planar = new Uint8Array(decodedBytes); let offset = 0;
  for (const plane of planes) { planar.set(new Uint8Array(plane.buffer), offset); offset += plane.byteLength; }
  const pcmHash = hex(await crypto.subtle.digest('SHA-256', planar)); check();
  return { value: { contentHash: hash, pcmHash, decoderVersion: WAVE_SOURCE_DECODER_VERSION, frames: format.frames, channels: format.channels,
    sampleRate: format.sampleRate, planes }, inputBytes: bytes.byteLength, nodes: 32, retainedBytes: decodedBytes + 16384 };
}
