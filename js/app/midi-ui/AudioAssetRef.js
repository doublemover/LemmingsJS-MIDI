const plain = value => value != null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const DECODER_VERSION = 'web-audio-wav-v1';

export class AudioAssetError extends Error {
  constructor(reason, contentHash = null) { super(reason); this.name = 'AudioAssetError'; this.reason = reason; this.contentHash = contentHash; }
}

export function validateAudioAssetRef(input, { maxAssetBytes = 16 * 1024 * 1024, maxChannels = input?.kind === 'impulse-response' ? 4 : 2,
  maxSourceFrames = 8000000, maxDurationSeconds = 180, maxImpulseSeconds = 30 } = {}) {
  if (!plain(input) || typeof input.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(input.contentHash) ||
      !integer(input.bytes, 44, maxAssetBytes) || !['audio/wav', 'audio/x-wav'].includes(input.mime) ||
      !integer(input.channels, 1, maxChannels) || !(input.kind === 'impulse-response' ? [1, 2, 4] : [1, 2]).includes(input.channels) || !integer(input.sourceSampleRate, 8000, 192000) ||
      !integer(input.frames, 1, maxSourceFrames) || input.decodeVersion !== DECODER_VERSION ||
      typeof input.licenseId !== 'string' || !input.licenseId || input.licenseId.length > 128 ||
      typeof input.attribution !== 'string' || input.attribution.length > 4096 ||
      typeof input.path !== 'string' || !input.path || input.path.length > 512 || input.path.startsWith('/') ||
      /[\\:#?\u0000]/.test(input.path) || input.path.split('/').some(part => !part || part === '.' || part === '..') ||
      !['sample', 'impulse-response'].includes(input.kind ?? 'sample')) throw new AudioAssetError('invalid-or-unsupported-asset-ref', input?.contentHash);
  const kind = input.kind || 'sample';
  if (input.frames / input.sourceSampleRate > (kind === 'impulse-response' ? maxImpulseSeconds : maxDurationSeconds)) throw new AudioAssetError('asset-duration-limit', input.contentHash);
  let loopMarkers = null;
  if (input.loopMarkers != null) {
    const loop = input.loopMarkers;
    if (!plain(loop) || !integer(loop.startFrame, 0, input.frames - 1) || !integer(loop.endFrame, loop.startFrame + 1, input.frames) ||
        !integer(loop.crossfadeFrames ?? 0, 0, Math.floor((loop.endFrame - loop.startFrame) / 2))) throw new AudioAssetError('invalid-loop-markers', input.contentHash);
    loopMarkers = Object.freeze({ startFrame: loop.startFrame, endFrame: loop.endFrame, crossfadeFrames: loop.crossfadeFrames || 0,
      domain: 'source-frames' });
  }
  return Object.freeze({ contentHash: input.contentHash.toLowerCase(), path: input.path, bytes: input.bytes, mime: input.mime,
    channels: input.channels, sourceSampleRate: input.sourceSampleRate, frames: input.frames, kind,
    licenseId: input.licenseId, attribution: input.attribution, decodeVersion: DECODER_VERSION, loopMarkers });
}

export function inspectWaveContainer(bytes, { contentHash = null, maxBytes = 16 * 1048576, maxChannels = 2 } = {}) {
  const fail = reason => { throw new AudioAssetError(reason, contentHash); };
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength < 44 || bytes.byteLength > maxBytes) fail('encoded-byte-count-mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const four = at => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (four(0) !== 'RIFF' || four(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) fail('corrupt-or-truncated-wave');
  let format = null, dataBytes = null, dataOffset = null, offset = 12, chunks = 0;
  while (offset + 8 <= bytes.length) {
    if (++chunks > 1024) fail('wave-chunk-limit');
    const name = four(offset), length = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + length > bytes.length) fail('truncated-wave-chunk');
    if (name === 'fmt ') {
      if (format || length < 16) fail('invalid-wave-format');
      const encoding = view.getUint16(start, true), channels = view.getUint16(start + 2, true),
        sampleRate = view.getUint32(start + 4, true), blockAlign = view.getUint16(start + 12, true), bits = view.getUint16(start + 14, true);
      if (!integer(channels, 1, maxChannels) || ![1, 2, 4].includes(channels) || !integer(sampleRate, 8000, 192000) || ![1, 3].includes(encoding) || ![8, 16, 24, 32].includes(bits) || encoding === 3 && bits !== 32 ||
          blockAlign !== channels * bits / 8 || view.getUint32(start + 8, true) !== sampleRate * blockAlign) fail('unsupported-wave-layout');
      format = { encoding, channels, sampleRate, blockAlign, bits };
    } else if (name === 'data') {
      if (dataBytes != null) fail('multiple-wave-data-regions'); dataBytes = length; dataOffset = start;
    }
    offset = start + length + (length & 1);
  }
  if (!format || dataBytes == null || offset !== bytes.length || !dataBytes || dataBytes % format.blockAlign) fail('asset-source-metadata-mismatch');
  const frames = dataBytes / format.blockAlign;
  if (frames > 8000000 || frames / format.sampleRate > 180) fail('asset-duration-limit');
  return Object.freeze({ ...format, frames, dataOffset, dataBytes, verifiedContainer: 'riff-wave-complete' });
}

export function inspectWaveAudio(bytes, ref) {
  if (bytes?.byteLength !== ref.bytes) throw new AudioAssetError('encoded-byte-count-mismatch', ref.contentHash);
  const format = inspectWaveContainer(bytes, { contentHash: ref.contentHash, maxChannels: ref.kind === 'impulse-response' ? 4 : 2 });
  if (format.channels !== ref.channels || format.sampleRate !== ref.sourceSampleRate || format.frames !== ref.frames) throw new AudioAssetError('asset-source-metadata-mismatch', ref.contentHash);
  return format;
}

export { DECODER_VERSION };
