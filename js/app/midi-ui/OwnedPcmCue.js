import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

const failure = message => Object.assign(new Error(message), { name: 'PcmCueError' });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const fourCC = (view, offset) => String.fromCharCode(...Array.from({ length: 4 }, (_, index) => view.getUint8(offset + index)));

export function inspectOwnedCueWave(bytes, manifest) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64 || bytes.byteLength > 16 * 1048576 || !manifest || !hash(manifest.pcmHash) ||
      ![44100, 48000, 96000].includes(manifest.sampleRate) || !Number.isSafeInteger(manifest.frames) || manifest.frames < 1 || manifest.frames > manifest.sampleRate * 16 || manifest.channels !== 2 || manifest.sampleFormat !== 'ieee-float32-le') throw failure('Cue requires one bounded rendered stereo Float32 WAV and its PCM identity.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE' || view.getUint32(4, true) !== bytes.byteLength - 8) throw failure('Cue WAV container length changed.');
  let format = false, data = null, fact = false, metadata = false, count = 0;
  for (let at = 12; at < bytes.byteLength;) {
    if (++count > 8 || at + 8 > bytes.byteLength) throw failure('Cue WAV chunk inventory is invalid.');
    const id = fourCC(view, at), size = view.getUint32(at + 4, true), start = at + 8, end = start + size, next = end + size % 2;
    if (end > bytes.byteLength || next > bytes.byteLength) throw failure('Cue WAV chunk exceeds its container.');
    if (id === 'fmt ') {
      if (format || size !== 16 || view.getUint16(start, true) !== 3 || view.getUint16(start + 2, true) !== 2 || view.getUint32(start + 4, true) !== manifest.sampleRate ||
          view.getUint32(start + 8, true) !== manifest.sampleRate * 8 || view.getUint16(start + 12, true) !== 8 || view.getUint16(start + 14, true) !== 32) throw failure('Cue WAV format differs from the rendered stereo layout.');
      format = true;
    } else if (id === 'fact') { if (fact || size !== 4 || view.getUint32(start, true) !== manifest.frames) throw failure('Cue WAV frame inventory changed.'); fact = true; }
    else if (id === 'data') { if (data || size !== manifest.frames * 8) throw failure('Cue WAV PCM length changed.'); data = Object.freeze({ offset: start, bytes: size }); }
    else if (id === 'lmjs') { if (metadata || size > 262144) throw failure('Cue WAV metadata exceeds its bound.'); metadata = true; }
    else throw failure('Cue WAV contains an unsupported chunk.');
    at = next;
  }
  if (!format || !fact || !metadata || !data) throw failure('Cue WAV is incomplete.');
  return data;
}

export async function prepareOwnedPcmCue(preview, owner, { bytes, manifest, signal, isCurrent = () => true } = {}) {
  const session = preview._sessions.get(owner), context = preview._context, generation = session?.generation;
  const check = () => { signal?.throwIfAborted(); if (!session || session.disposed || session.generation !== generation || preview._context !== context || !preview._ownerReady(owner) || !isCurrent()) throw failure('The cue session, clock or rehearsal source changed.'); };
  check(); if (session.workloadClass !== 'cue') throw failure('Rendered PCM playback requires an isolated cue workload.');
  const layout = inspectOwnedCueWave(bytes, manifest), scope = createProcgenRetirementScope();
  let pcm = null, buffer = null, source = null, gain = null, voice = null, started = false, disposed = false, settled = false, resolve;
  const completion = new Promise(done => { resolve = done; });
  const dispose = () => {
    if (scope.getReceipt()) return scope.getReceipt(); disposed = true;
    const native = createProcgenRetirementScope().retire([
      { name: 'cue-source-stop', run: () => { if (source) { source.onended = null; if (started) source.stop(); } } },
      { name: 'cue-source-disconnect', run: () => { source?.disconnect(); if (source) source.buffer = null; } },
      { name: 'cue-level-disconnect', run: () => gain?.disconnect() }
    ]);
    const receipt = scope.retire([{ name: 'cue-native-graph', run: () => native },
      { name: 'cue-pcm-storage', run: () => releaseAudioResourceAfterRetirement(pcm, native) },
      { name: 'cue-reference', run: () => { if (native.outcome === 'complete') { source = null; gain = null; buffer = null; } } }]);
    receipt.completion.then(value => { if (!settled) { settled = true; resolve(value); } }); return receipt;
  };
  try {
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(layout.offset, layout.offset + layout.bytes)))].map(value => value.toString(16).padStart(2, '0')).join(''); check();
    if (digest !== manifest.pcmHash) throw failure('Rendered cue PCM failed its immutable identity check.');
    pcm = preview._audioResources.reserveDecodedBuffer({ frames: manifest.frames, channels: 2, sampleRate: manifest.sampleRate, owner, generation });
    buffer = context.createBuffer(2, manifest.frames, manifest.sampleRate); pcm.validate(buffer);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1), view = new DataView(bytes.buffer, bytes.byteOffset + layout.offset, layout.bytes);
    for (let first = 0; first < manifest.frames; first += 16384) {
      check(); const end = Math.min(manifest.frames, first + 16384);
      for (let frame = first; frame < end; frame++) { const l = view.getFloat32(frame * 8, true), r = view.getFloat32(frame * 8 + 4, true); if (!Number.isFinite(l) || !Number.isFinite(r)) throw failure('Cue PCM contains non-finite samples.'); left[frame] = l; right[frame] = r; }
      if (end < manifest.frames) await yieldTask();
    }
    check();
    return Object.freeze({ completion, metadata: Object.freeze({ pcmHash: manifest.pcmHash, frames: manifest.frames, sampleRate: manifest.sampleRate, cueIncludedInMasterCapture: preview.getMonitorRouteState().cueIncludedInMasterCapture, acousticReceipt: false, edgeFadeSeconds: 0.008 }),
      play() {
        check(); if (disposed || started || voice) throw failure('One prepared cue may play once.');
        const start = context.currentTime + 0.04, end = start + manifest.frames / manifest.sampleRate, admission = preview._inspectVoiceInterval(owner, { start, end, releaseAt: end });
        if (!admission.accepted) throw failure('The reserved cue voice quota is busy.');
        const nativeVoice = preview._audioResources.reserveNativeVoice(owner, generation);
        try {
          source = context.createBufferSource(); source.buffer = buffer; gain = context.createGain(); source.connect(gain); gain.connect(preview._cueRouting.getInput());
          const fade = Math.min(0.008, (end - start) / 2); gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(1, start + fade); gain.gain.setValueAtTime(1, end - fade); gain.gain.linearRampToValueAtTime(0, end);
          voice = { id: ++preview._voiceSequence, owner, workloadClass: 'cue', number: 0, note: 0, start, end, releaseAt: end, release: 0, attack: 0, decay: 0, sustain: 1, renderCost: 1,
            startMs: preview._nowMs() + (start - context.currentTime) * 1000, resourceLease: nativeVoice, nativeContext: context, nativeNodesOwnedByBackend: true,
            captureMeta: { source: manifest.schema === 'lemmings-resonator-morph-control-render/v1' ? 'resonator-morph-control-reference' : 'rendered-scene-rehearsal', owner, physicalTakeEvidence: false }, onDestroy: dispose };
          preview._voices.add(voice); source.onended = () => preview._destroyVoice(voice, 'rendered-cue-ended'); source.start(start); started = true;
          preview._setStatus(preview._status, preview._message); return Object.freeze({ status: 'accepted', targetTime: start, endTime: end, acousticReceipt: false });
        } catch (error) {
          const receipt = voice ? preview._destroyVoice(voice, 'cue-preparation-failed') : dispose();
          if (!voice) releaseAudioResourceAfterRetirement(nativeVoice, receipt); throw error;
        }
      }, onOwnerStop: () => voice ? preview._destroyVoice(voice, 'cue-owner-stopped') : dispose(), dispose: () => voice && !voice.retirement ? preview._destroyVoice(voice, 'cue-owner-retired') : dispose() });
  } catch (error) { const receipt = dispose(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
