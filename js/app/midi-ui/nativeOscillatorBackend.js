import { selectLocalAudioVoice } from '../../midi/scheduler/LocalAudioVoiceBudget.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const parameters = Object.freeze({
  waveform: { min: 0, max: 3, integer: true }, attackSeconds: { min: 0, max: 2 },
  decaySeconds: { min: 0, max: 4 }, sustain01: { min: 0, max: 1 },
  releaseSeconds: { min: 0.002, max: 4 }, gain01: { min: 0, max: 1 }, pan01: { min: -1, max: 1 }
});
const waveforms = Object.freeze(['sine', 'triangle', 'sawtooth', 'square']);
const capabilities = Object.freeze({ independentSamePitch: true, perVoicePitch: true, perVoicePressure: true,
  perVoicePan: true, perVoiceTimbre: false, offlineRender: false,
  supportedParameterIds: Object.freeze(Object.keys(parameters)) });
const validCents = value => Number.isFinite(value) && value >= -24000 && value <= 24000;
const frequencyFor = pitch => {
  const reference = pitch?.referenceHz ?? 440;
  if (!validCents(pitch?.cents) || !Number.isFinite(reference) || reference <= 0 || reference > 20000) return null;
  const frequency = reference * 2 ** ((pitch.cents - 6900) / 1200);
  return frequency >= 0.1 && frequency <= 40000 ? frequency : null;
};

// This backend uses the existing BrowserNotePreview context, limiter, mixer,
// owner sessions and global voice budget. It never encodes semantic pitch or
// expression through a MIDI channel before reaching the oscillator.
const createNativeOscillatorBackend = (preview, owner = null) => {
  let prepared = null, disposed = false, deliveryErrors = 0;
  const voices = new Map();
  const keyFor = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
  const sharedKeyFor = (epoch, voiceId) => JSON.stringify([owner, epoch, voiceId]);
  const failure = (reason, intent = null) => Object.freeze({ status: 'rejected', reason,
    voiceId: intent?.voiceId ?? null, generation: intent?.generation ?? null });
  const audioTime = frame => {
    const context = preview._context, rate = context?.sampleRate || 48000;
    if (!Number.isSafeInteger(frame) || frame < 0) return null;
    return frame / rate;
  };
  const validatePatch = resolution => {
    if (!resolution || !['ready', 'degraded'].includes(resolution.status) || !resolution.patch ||
        resolution.patch.engineId !== 'native-oscillator' || resolution.patch.engineVersion !== 1 ||
        resolution.patch.sampleRefs?.length || resolution.receipt?.patchId !== resolution.patch.id ||
        resolution.receipt?.revision !== resolution.patch.revision) return null;
    const values = { waveform: 1, attackSeconds: 0.008, decaySeconds: 0.05, sustain01: 0.7,
      releaseSeconds: 0.04, gain01: 0.5, pan01: 0 };
    for (const [name, value] of Object.entries(resolution.patch.parameters || {})) {
      const spec = parameters[name];
      if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max || spec.integer && !Number.isInteger(value)) return null;
      values[name] = value;
    }
    if (!Number.isFinite(resolution.patch.mix?.gain01) || resolution.patch.mix.gain01 < 0 || resolution.patch.mix.gain01 > 1 ||
        !Number.isFinite(resolution.patch.mix?.pan01) || resolution.patch.mix.pan01 < -1 || resolution.patch.mix.pan01 > 1 ||
        !Number.isSafeInteger(resolution.patch.voicePolicy?.maxVoices) || resolution.patch.voicePolicy.maxVoices < 1 ||
        resolution.patch.voicePolicy.maxVoices > 1024) return null;
    return Object.freeze({ patch: resolution.patch, receipt: resolution.receipt, values: Object.freeze(values) });
  };
  const prepare = async (resolution, assets = []) => {
    if (disposed) return failure('disposed');
    if (!Array.isArray(assets) || assets.length) return failure('assets-unsupported');
    const next = validatePatch(resolution);
    if (!next) return failure('unsupported-patch-or-engine');
    prepared = next;
    return Object.freeze({ status: 'ready', patchId: next.patch.id, revision: next.patch.revision,
      receipt: next.receipt, capabilities });
  };
  const begin = (intent, targetFrame, executionEpoch = 'live') => {
    if (disposed) return failure('disposed', intent);
    if (!prepared) return failure('patch-unprepared', intent);
    if (!preview._ownerReady(owner)) return failure('audio-not-ready', intent);
    if (intent?.version !== 1 || intent.kind !== 'begin' || typeof intent.voiceId !== 'string' || !intent.voiceId ||
        !Number.isSafeInteger(intent.generation) || !Number.isFinite(intent.velocity01) || intent.velocity01 < 0 || intent.velocity01 > 1 ||
        !intent.pitch || frequencyFor(intent.pitch) == null || typeof executionEpoch !== 'string' || !executionEpoch) return failure('invalid-intent', intent);
    const start = audioTime(targetFrame), context = preview._context;
    if (start == null || start - context.currentTime > preview._maxNoteSeconds) return failure('target-frame-out-of-range', intent);
    if (start < context.currentTime - 1 / context.sampleRate) return failure('late-attack', intent);
    const identity = keyFor(executionEpoch, intent.voiceId);
    if (voices.has(identity)) return failure('duplicate-voice', intent);
    const sharedIdentity = sharedKeyFor(executionEpoch, intent.voiceId);
    if (preview._semanticVoiceOwners.has(sharedIdentity)) return failure('duplicate-owner-voice', intent);
    const activeForBackend = [...voices.values()].filter(voice => !voice.released && !voice.stolen);
    if (activeForBackend.length >= prepared.patch.voicePolicy.maxVoices) return failure('patch-voice-budget', intent);
    for (const voice of preview._voices) if (preview._voiceFinished(voice)) preview._destroyVoice(voice, 'inaudible-voice-reuse');
    if (preview._voices.size >= preview._maxScheduledVoices) return failure('shared-scheduled-voice-budget', intent);
    const incoming = { priority: 1, laneIndex: intent.laneId ?? 0 };
    const simultaneous = [...preview._voices].filter(voice => !voice.stolen && voice.start <= start && voice.releaseAt > start);
    if (simultaneous.length >= preview._maxVoices) {
      const victim = selectLocalAudioVoice(simultaneous, incoming);
      if (!victim) return failure('shared-voice-budget', intent);
      preview._voiceSteals++;
      preview._release(victim, Math.max(context.currentTime, start - 0.04), true);
    }
    const values = prepared.values;
    let oscillator, gain, pan, voice;
    try {
      const frequency = frequencyFor(intent.pitch), pressure = intent.expression?.pressure01 ?? 1;
      if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1 ||
          (intent.expression != null && (typeof intent.expression !== 'object' || Array.isArray(intent.expression) ||
            Object.getPrototypeOf(intent.expression) !== Object.prototype)) ||
          (intent.expression?.pan01 != null && (!Number.isFinite(intent.expression.pan01) || intent.expression.pan01 < -1 || intent.expression.pan01 > 1)) ||
          Object.keys(intent.expression || {}).some(name => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(name))) return failure('unsupported-expression', intent);
      const offset = intent.expression?.pitchOffsetCents ?? 0;
      if (!validCents(offset)) return failure('invalid-expression', intent);
      oscillator = context.createOscillator(); gain = context.createGain();
      pan = context.createStereoPanner?.() || null;
      const channel = preview._channel(1, owner), release = values.releaseSeconds;
      const end = start + preview._maxNoteSeconds;
      const basePeak = intent.velocity01 * values.gain01 * prepared.patch.mix.gain01;
      voice = { oscillator, gain, pan, owner, number: 1, note: Math.round(intent.pitch.cents / 100),
        start, end, releaseAt: end - release, released: false, id: ++preview._voiceSequence,
        startMs: preview._nowMs() + (start - context.currentTime) * 1000, token: null,
        basePeak, peak: basePeak * pressure,
        attack: values.attackSeconds, decay: values.decaySeconds, sustain: values.sustain01, release,
        velocity: intent.velocity01 * 127, instrument: prepared.patch,
        priority: incoming.priority, laneIndex: incoming.laneIndex, startedAt: start,
        semanticKey: identity, semanticGeneration: intent.generation, semanticEpoch: executionEpoch,
        playback: { voiceId: intent.voiceId, sourceEventIds: intent.sourceEventIds, role: intent.role },
        onDestroy: () => {
          if (voices.get(identity) === voice) voices.delete(identity);
          if (preview._semanticVoiceOwners.get(sharedIdentity) === voice) preview._semanticVoiceOwners.delete(sharedIdentity);
        } };
      oscillator.type = waveforms[values.waveform];
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.detune.setValueAtTime(offset, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(voice.peak, start + voice.attack);
      gain.gain.linearRampToValueAtTime(voice.peak * voice.sustain, start + voice.attack + voice.decay);
      gain.gain.setValueAtTime(voice.peak * voice.sustain, end - release);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain);
      if (pan) {
        pan.pan.setValueAtTime(clamp((intent.expression?.pan01 ?? values.pan01) + prepared.patch.mix.pan01, -1, 1), start);
        gain.connect(pan); pan.connect(channel.gain);
      } else gain.connect(channel.gain);
      oscillator.onended = () => preview._destroyVoice(voice);
      preview._voices.add(voice); voices.set(identity, voice); preview._semanticVoiceOwners.set(sharedIdentity, voice);
      oscillator.start(start); oscillator.stop(end);
      return Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId: intent.voiceId,
        generation: intent.generation, executionEpoch, targetFrame, patchId: prepared.patch.id, patchRevision: prepared.patch.revision });
    } catch {
      deliveryErrors++;
      if (voice) preview._destroyVoice(voice, 'backend-failure');
      else { try { oscillator?.stop(); } catch { /* The oscillator may not have started. */ } oscillator?.disconnect(); gain?.disconnect(); pan?.disconnect(); }
      return failure('backend-failure', intent);
    }
  };
  const update = (voiceId, expression, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice || voice.stolen || voice.released || !preview._ownerReady(owner)) return failure('voice-not-active', { voiceId });
    const time = audioTime(targetFrame);
    if (time == null || !expression || typeof expression !== 'object') return failure('invalid-expression', { voiceId });
    if (time < preview._context.currentTime - 1 / preview._context.sampleRate) return failure('stale-expression', { voiceId });
    const unsupported = Object.keys(expression).filter(name => !['pitchOffsetCents', 'pressure01', 'pan01'].includes(name));
    if (unsupported.length) return Object.freeze({ status: 'degraded', reason: 'unsupported-expression', unsupported: Object.freeze(unsupported), voiceId });
    if (expression.pitchOffsetCents != null && !validCents(expression.pitchOffsetCents) ||
        expression.pressure01 != null && (!Number.isFinite(expression.pressure01) || expression.pressure01 < 0 || expression.pressure01 > 1) ||
        expression.pan01 != null && (!Number.isFinite(expression.pan01) || expression.pan01 < -1 || expression.pan01 > 1)) return failure('invalid-expression', { voiceId });
    if (expression.pitchOffsetCents != null) voice.oscillator.detune.setValueAtTime(expression.pitchOffsetCents, time);
    if (expression.pressure01 != null) {
      voice.gain.gain.cancelScheduledValues(time);
      voice.peak = voice.basePeak * expression.pressure01;
      voice.gain.gain.setValueAtTime(voice.peak, time);
    }
    if (expression.pan01 != null && voice.pan) voice.pan.pan.setValueAtTime(expression.pan01, time);
    return Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch, targetFrame });
  };
  const end = (voiceId, release, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice || voice.released) return failure('voice-not-active', { voiceId });
    const time = audioTime(targetFrame);
    if (time == null || release != null && (!Number.isFinite(release.seconds) || release.seconds < 0 || release.seconds > 4 ||
        (release.mode != null && release.mode !== 'one-shot') ||
        (release.mode === 'one-shot' && (!Number.isFinite(release.tailSeconds) || release.tailSeconds < 0 || release.tailSeconds > 4)))) return failure('invalid-release', { voiceId });
    if (release) voice.release = release.seconds;
    const releaseAt = release?.mode === 'one-shot' ? Math.max(time, voice.start + release.tailSeconds, preview._context.currentTime) :
      Math.max(time, preview._context.currentTime);
    preview._release(voice, releaseAt, false, release?.mode === 'one-shot' ? 'semantic-one-shot' : 'semantic-end');
    return Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch, targetFrame,
      repair: time < preview._context.currentTime ? 'late-release' : null });
  };
  const cancelGeneration = (generation, executionEpoch = 'live') => {
    let count = 0;
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch) {
      preview._release(voice, preview._context?.currentTime || 0, true, 'generation-cancel'); count++;
    }
    return count;
  };
  const renderDiagnostics = () => Object.freeze({ activeVoices: [...voices.values()].filter(voice => !voice.released).length,
    deliveryErrors, sharedActiveVoices: preview._voices.size, capabilities });
  const dispose = () => { if (disposed) return; disposed = true; for (const voice of voices.values()) preview._destroyVoice(voice, 'backend-disposed'); voices.clear(); prepared = null; };
  return Object.freeze({ capabilities, prepare, begin, update, end, cancelGeneration, renderDiagnostics, dispose });
};

export { createNativeOscillatorBackend };
