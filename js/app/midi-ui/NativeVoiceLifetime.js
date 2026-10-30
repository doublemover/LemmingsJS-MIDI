import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { truncateNativeEnvelope } from './NativeAdsrEnvelope.js';
export function nativeVoiceFinished(voice) {
  const now = this._context?.currentTime ?? 0;
  if (voice.isFinished) return voice.isFinished(now);
  return voice.end <= now || (voice.released && voice.releaseLevel === 0 && voice.releaseAt <= now) || (voice.sustain === 0 && now >= voice.start + voice.attack + voice.decay);
}

export function nativeRenderVoiceCount(voices = this._voices) {
  let count = 0; for (const voice of voices) count += voice.renderCost || 1; return count;
}

export function releaseNativeVoice(voice, time, force = false, reason = 'note-off') {
  if (voice.requestRelease) { voice.requestRelease(time, force, reason); return; }
  if (!this._voices.has(voice) || (!force && voice.released && time >= voice.releaseAt)) return;
  const releaseAt = Math.max(voice.start, Math.min(time, voice.end - voice.release));
  const end = Math.min(voice.end, releaseAt + voice.release);
  const param = voice.gain.gain;
  const attackLevel = truncateNativeEnvelope(voice, releaseAt);
  voice.releaseLevel = attackLevel;
  param.linearRampToValueAtTime(0, end);
  voice.oscillator.stop(end);
  voice.end = end;
  voice.releaseAt = releaseAt;
  voice.released = true;
  voice.terminationCause = force && reason === 'note-off' ? 'voice-budget' : reason;
  if (force && reason === 'note-off') voice.stolen = true;
  this._observe('synth-release', { ...voice.captureMeta, type: 'noteOff', voiceId: voice.id, channel: voice.number,
    note: voice.note, scheduledMs: voice.startMs + (releaseAt - voice.start) * 1000, audioTime: releaseAt,
    endAudioTime: end, reason: voice.terminationCause });
  this._emitPlayback(voice, 'release', releaseAt);
  if (force && attackLevel === 0) this._destroyVoice(voice, 'inaudible-voice-reuse');
}

export function destroyNativeVoice(voice, reason = 'source-ended') {
  if (!voice) return;
  if (voice.retirement) return voice.retirement.getReceipt();
  if (!this._voices.delete(voice)) return;
  voice.retirement = createProcgenRetirementScope();
  voice.nativeContext ||= this._context;
  let nativeRetirement;
  const receipt = voice.retirement.retire([
    { name: 'token', run: () => { if (voice.token != null && this._voicesByToken.get(this._tokenKey(voice.token, voice.owner)) === voice) this._voicesByToken.delete(this._tokenKey(voice.token, voice.owner)); } },
    { name: 'native-voice', run: () => { nativeRetirement = createProcgenRetirementScope().retire([
      { name: 'backend-voice', run: () => voice.onDestroy?.(reason) },
      { name: 'source-stop', run: () => { if (voice.oscillator && !voice.nativeNodesOwnedByBackend) { voice.oscillator.onended = null;
        try { voice.oscillator.stop(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; } } } },
      { name: 'source-disconnect', run: () => { if (!voice.nativeNodesOwnedByBackend) voice.oscillator?.disconnect(); } },
      { name: 'gain', run: () => { if (!voice.nativeNodesOwnedByBackend) voice.gain?.disconnect(); } },
      { name: 'pan', run: () => { if (!voice.nativeNodesOwnedByBackend) voice.pan?.disconnect(); } }
    ]); return nativeRetirement; } },
    { name: 'reservation', run: () => releaseAudioResourceAfterRetirement(voice.resourceLease, nativeRetirement) },
    { name: 'observation', run: () => this._observe('synth-end', { ...voice.captureMeta, type: 'noteEnd', voiceId: voice.id, channel: voice.number,
      note: voice.note, audioTime: this._context?.currentTime, scheduledMs: voice.startMs + (voice.end - voice.start) * 1000,
      matchedDurationMs: Math.max(0, ((this._context?.currentTime ?? voice.start) - voice.start) * 1000), reason }) },
    { name: 'playback-observer', run: () => this._emitPlayback(voice, 'end') },
    { name: 'status', run: () => this._setStatus(this._status, this._message) }
  ]);
  const retainFailure = value => { if (value.outcome !== 'complete') { this._retiredVoices.set(voice.id, voice); this._retirementFaults.add(voice.owner); } };
  if (receipt.state === 'retired') retainFailure(receipt); else receipt.completion.then(retainFailure);
  return receipt;
}
