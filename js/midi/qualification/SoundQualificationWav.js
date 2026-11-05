export function decodeQualificationFloatWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 56 || bytes.byteLength > 64 * 1048576) throw new Error('Qualification PCM requires a bounded shared-renderer WAV.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = at => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Malformed qualification WAV.');
  let format = null, data = null;
  for (let at = 12; at + 8 <= bytes.length;) { const length = view.getUint32(at + 4, true); if (at + 8 + length > bytes.length) throw new Error('Truncated qualification WAV.');
    if (text(at) === 'fmt ') { if (format || length < 16) throw new Error('Ambiguous qualification format.'); format = { code: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), sampleRate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) }; }
    if (text(at) === 'data') { if (data) throw new Error('Ambiguous qualification PCM.'); data = { offset: at + 8, length }; }
    at += 8 + length + length % 2;
  }
  if (format?.code !== 3 || format.channels !== 2 || format.bits !== 32 || ![44100, 48000, 96000].includes(format.sampleRate) || !data?.length || data.length % 8) throw new Error('Qualification needs exact stereo float32 PCM.');
  const frames = data.length / 8, planes = [new Float32Array(frames), new Float32Array(frames)];
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) planes[channel][frame] = view.getFloat32(data.offset + (frame * 2 + channel) * 4, true);
  return { planes, sampleRate: format.sampleRate, frames };
}
