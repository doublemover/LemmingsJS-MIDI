import { validOwnedPcmDescriptor, validOwnedPcmPlanes } from '../../midi/content/OwnedPcmFormat.js';
const failure = message => Object.assign(new Error(message), { name: 'CausalRenderError', code: 'pcm-identity-mismatch' });
export async function verifyOwnedPcmPayload(payload, expected, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), crypto = globalThis.crypto } = {}) {
  const descriptor = payload?.descriptor;
  if (!validOwnedPcmDescriptor(descriptor) || descriptor.assetHash !== expected?.sha256 || !validOwnedPcmPlanes(payload.planes, descriptor) ||
      new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw failure('Owned rendering requires a complete matching immutable PCM bank.');
  signal?.throwIfAborted(); const bytes = new Uint8Array(descriptor.bytes); let offset = 0, peak = 0;
  for (const plane of payload.planes) {
    for (let first = 0; first < plane.length; first += 16384) {
      signal?.throwIfAborted();
      for (let index = first; index < Math.min(plane.length, first + 16384); index++) {
        const value = plane[index]; if (!Number.isFinite(value) || Math.abs(value) > 16) throw failure('Render PCM contains nonfinite or excessive samples.'); peak = Math.max(peak, Math.abs(value));
      }
      await yieldControl();
    }
    bytes.set(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength), offset); offset += plane.byteLength;
  }
  const hex = data => [...new Uint8Array(data)].map(value => value.toString(16).padStart(2, '0')).join('');
  const pcmHash = hex(await crypto.subtle.digest('SHA-256', bytes)); signal?.throwIfAborted();
  if (pcmHash !== descriptor.pcmHash || peak !== descriptor.peak) throw failure('Render PCM differs from its retained hash or peak.');
  const metadata = { schema: descriptor.schema, assetHash: descriptor.assetHash, pcmHash, format: descriptor.format, sourceFrames: descriptor.sourceFrames,
    sourceSampleRate: descriptor.sourceSampleRate, frames: descriptor.frames, sampleRate: descriptor.sampleRate, channels: descriptor.channels, bytes: descriptor.bytes,
    decoderVersion: descriptor.decoderVersion, peak, sampleMagnitudeLimit: 16, evidence: descriptor.evidence };
  const bankHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(metadata)))); signal?.throwIfAborted();
  if (bankHash !== descriptor.bankHash) throw failure('Render PCM metadata differs from its immutable bank identity.');
  return Object.freeze({ descriptor: Object.freeze({ ...metadata, bankHash }), planes: Object.freeze([...payload.planes]) });
}
