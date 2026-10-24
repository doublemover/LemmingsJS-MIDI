import { canonicalDataText } from '../../core/CanonicalData.js';

const failure = message => Object.assign(new Error(message), { name: 'NativeOfflineEncodingError' });
const ascii = (view, at, text) => { for (let index = 0; index < text.length; index++) view.setUint8(at + index, text.charCodeAt(index)); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const encode = (pcm, manifest) => {
  const metadata = canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes;
  const length = 64 + pcm.byteLength + metadata.length + metadata.length % 2;
  if (!Number.isSafeInteger(length) || length > 64 * 1048576 || length - 8 > 0xffffffff) throw failure('Native WAV exceeds its admitted RIFF bound.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF'); view.setUint32(4, length - 8, true); ascii(view, 8, 'WAVE'); ascii(view, 12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, manifest.sampleRate, true); view.setUint32(28, manifest.sampleRate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  ascii(view, 36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, manifest.frames, true); ascii(view, 48, 'data'); view.setUint32(52, pcm.byteLength, true); bytes.set(pcm, 56);
  const at = 56 + pcm.byteLength; ascii(view, at, 'lmjs'); view.setUint32(at + 4, metadata.length, true); bytes.set(metadata, at + 8); return bytes;
};

export async function encodeNativeOfflineRender({ mode, manifest, planes, firstFrame = 0, endFrame, stemLaneIds = [] } = {},
  { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const nativeFrames = planes?.[0]?.length, frames = endFrame - firstFrame;
  if (!['controls', 'causal-take'].includes(mode) || !Array.isArray(planes) || planes.length !== 2 + stemLaneIds.length * 2 || planes.length > 32 ||
      !Array.isArray(stemLaneIds) || stemLaneIds.length > 15 || new Set(stemLaneIds).size !== stemLaneIds.length ||
      stemLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      !Number.isSafeInteger(nativeFrames) || nativeFrames < 1 || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== nativeFrames) ||
      !Number.isSafeInteger(firstFrame) || firstFrame < 0 || !Number.isSafeInteger(endFrame) || endFrame <= firstFrame || endFrame > nativeFrames ||
      nativeFrames * planes.length * 4 > 64 * 1048576 || (frames * 8 + 262208) * (stemLaneIds.length + 1) > 64 * 1048576 ||
      ![44100, 48000, 96000].includes(manifest?.sampleRate) || manifest.frames !== frames || manifest.channels !== 2 ||
      manifest.sampleFormat !== 'ieee-float32-le' || manifest.schema !== (mode === 'controls' ? 'lemmings-rendered-audition/v1' : 'lemmings-causal-audio-render/v1') ||
      mode === 'controls' && (firstFrame !== 0 || endFrame !== nativeFrames || stemLaneIds.length)) throw failure('Native PCM, frame interval or stereo tap inventory differs from its admitted manifest.');
  canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 });
  for (let first = 0; first < nativeFrames; first += 16384) {
    signal?.throwIfAborted(); const end = Math.min(nativeFrames, first + 16384);
    for (const plane of planes) for (let index = first; index < end; index++) if (!Number.isFinite(plane[index])) throw failure('The native producer returned a nonfinite PCM sample.');
    await yieldControl();
  }
  const files = []; let totalBytes = 0;
  for (let tap = 0; tap < planes.length / 2; tap++) {
    const pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer); let peak = 0, squares = 0, overFullScaleSamples = 0;
    for (let first = firstFrame; first < endFrame; first += 16384) {
      signal?.throwIfAborted(); const end = Math.min(endFrame, first + 16384);
      for (let frame = first; frame < end; frame++) for (let channel = 0; channel < 2; channel++) {
        const value = planes[tap * 2 + channel][frame]; peak = Math.max(peak, Math.abs(value)); squares += value * value;
        if (Math.abs(value) > 1) overFullScaleSamples++;
        view.setFloat32(((frame - firstFrame) * 2 + channel) * 4, value, true);
      }
      onProgress({ phase: 'encoding-native-pcm', completedUnits: tap * frames + end - firstFrame, totalUnits: frames * planes.length / 2 }); await yieldControl();
    }
    const result = { ...manifest, ...(mode === 'causal-take' ? { tap: tap ? 'captured-lane-dry' : 'complete-native-source-graph-pre-master', laneId: tap ? stemLaneIds[tap - 1] : null } : {}),
      pcmHash: await digest(pcm), statistics: { peak, rms: Math.sqrt(squares / (frames * 2)), overFullScaleSamples } };
    signal?.throwIfAborted(); const bytes = encode(pcm, result); totalBytes += bytes.byteLength;
    if (totalBytes > 64 * 1048576) throw failure('Native encoded files exceed their combined admitted bound.');
    files.push({ name: tap ? 'lane-' + tap : 'master', bytes, manifest: result });
  }
  return mode === 'controls' ? { bytes: files[0].bytes, manifest: files[0].manifest } : { manifest, files };
}
