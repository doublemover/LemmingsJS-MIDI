import { selectLocalAudioVoice } from '../../midi/scheduler/LocalAudioVoiceBudget.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const parameters = Object.freeze({
  waveform: { min: 0, max: 3, integer: true }, attackSeconds: { min: 0, max: 2 },
  decaySeconds: { min: 0, max: 4 }, sustain01: { min: 0, max: 1 },
  releaseSeconds: { min: 0.002, max: 4 }, gain01: { min: 0, max: 1 }, pan01: { min: -1, max: 1 }
});
const waveforms = Object.freeze(['sine', 'triangle', 'sawtooth', 'square']);
const capabilities = Object.freeze({ independentSamePitch: true, perVoicePitch: true, perVoicePressure: true,
  perVoicePan: true, perVoiceTimbre: false, offlineRender: false,
  ownedGates: true, sustainPedal: false, sostenuto: false, releaseVelocity: false,
  renderAcknowledgment: false, latencyFrames: 0, maximumVoices: 64,
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
const createNativeOscillatorBackend = (preview, owner = null, { gateMode = 'bounded', smoothingSeconds = 0.008,
  maxControlEvents = 128, traceLimit = 128 } = {}) => {
  if (!['bounded', 'owned'].includes(gateMode) || !Number.isFinite(smoothingSeconds) || smoothingSeconds < 0 || smoothingSeconds > 1 ||
      !Number.isSafeInteger(maxControlEvents) || maxControlEvents < 1 || maxControlEvents > 4096 ||
      !Number.isSafeInteger(traceLimit) || traceLimit < 0 || traceLimit > 4096) throw new Error('Invalid native audio backend options.');
  let prepared = null, disposed = false, deliveryErrors = 0, preparationRevision = 0, traceSequence = 0, truncatedTraces = 0;
  const voices = new Map();
  const leases = new Map(), traces = [], decisions = Object.create(null);
  const cancelledGenerations = new Set();
  let cancellationHistoryFull = false;
  const keyFor = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
  const sharedKeyFor = (epoch, voiceId) => JSON.stringify([owner, epoch, voiceId]);
  const trace = fields => {
    decisions[fields.reason || fields.stage || fields.status] = (decisions[fields.reason || fields.stage || fields.status] || 0) + 1;
    if (!traceLimit) return;
    if (traces.length === traceLimit) { traces.shift(); truncatedTraces++; }
    traces.push(Object.freeze({ sequence: ++traceSequence, owner, engineId: 'native-oscillator', engineVersion: 1,
      evidenceClass: 'native-scheduling-api', appliedFrame: null, acousticReceipt: false, ...fields }));
  };
  const failure = (reason, intent = null) => {
    const receipt = Object.freeze({ status: 'rejected', reason,
      voiceId: intent?.voiceId ?? null, generation: intent?.generation ?? null });
    trace(receipt); return receipt;
  };
  const audioTime = frame => {
    const context = preview._context, rate = context?.sampleRate || 48000;
    if (!Number.isSafeInteger(frame) || frame < 0) return null;
    return frame / rate;
  };
  const validatePatch = resolution => {
    if (!resolution || !['ready', 'degraded'].includes(resolution.status) || !resolution.patch ||
        resolution.patch.engineId !== 'native-oscillator' || resolution.patch.engineVersion !== 1 ||
        resolution.patch.sampleRefs?.length || resolution.patch.modulations?.length || resolution.receipt?.patchId !== resolution.patch.id ||
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
    if (typeof resolution.patch.id !== 'string' || !resolution.patch.id || resolution.patch.id.length > 128 ||
        !Number.isSafeInteger(resolution.patch.revision) || resolution.patch.revision < 1) return null;
    const patch = Object.freeze({ id: resolution.patch.id, revision: resolution.patch.revision,
      engineId: resolution.patch.engineId, engineVersion: resolution.patch.engineVersion,
      parameters: Object.freeze({ ...values }), sampleRefs: Object.freeze([]),
      mix: Object.freeze({ ...resolution.patch.mix }), voicePolicy: Object.freeze({ ...resolution.patch.voicePolicy }) });
    return Object.freeze({ patch, receipt: Object.freeze({ ...resolution.receipt }), values: Object.freeze(values) });
  };
  const prepare = async (resolution, assets = []) => {
    if (disposed) return failure('disposed');
    if (!Array.isArray(assets) || assets.length) return failure('assets-unsupported');
    const next = validatePatch(resolution);
    if (!next) return failure('unsupported-patch-or-engine');
    const revision = ++preparationRevision, generation = preview._generation, ownerGeneration = preview._sessions.get(owner)?.generation;
    await Promise.resolve();
    if (disposed || revision !== preparationRevision || generation !== preview._generation ||
        ownerGeneration !== preview._sessions.get(owner)?.generation) return failure('preparation-cancelled');
    prepared = next;
    return Object.freeze({ status: 'ready', patchId: next.patch.id, revision: next.patch.revision,
      receipt: next.receipt, capabilities });
  };
  const leaseKey = (generation, epoch) => JSON.stringify([generation, epoch]);
  const renewExecutionLease = (generation, executionEpoch, validUntilFrame) => {
    if (disposed || !Number.isSafeInteger(generation) || generation < 0 || typeof executionEpoch !== 'string' || !executionEpoch ||
        !Number.isSafeInteger(validUntilFrame) || validUntilFrame < 0) return failure('invalid-execution-lease');
    if (cancelledGenerations.has(leaseKey(generation, executionEpoch))) return failure('generation-cancelled');
    if (cancellationHistoryFull) return failure('cancellation-history-full');
    const time = audioTime(validUntilFrame), now = preview._context?.currentTime;
    if (!preview._ownerReady(owner)) return failure('audio-not-ready');
    if (!Number.isFinite(now) || time <= now || time - now > 120) return failure('execution-lease-out-of-range');
    for (const [identity, lease] of leases) if (lease.until <= now || lease.context !== preview._context ||
        lease.generation !== preview._generation || lease.ownerGeneration !== preview._sessions.get(owner)?.generation) leases.delete(identity);
    const key = leaseKey(generation, executionEpoch), prior = leases.get(key);
    if (prior != null && time <= prior.until) return failure('stale-execution-lease');
    if (prior == null && leases.size >= 64) return failure('execution-lease-budget');
    if ([...voices.values()].some(voice => voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch &&
        voice.ownedGate && !voice.released && voice.releaseAt <= now)) return failure('execution-lease-too-late');
    leases.set(key, { until: time, context: preview._context, generation: preview._generation,
      ownerGeneration: preview._sessions.get(owner)?.generation });
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch &&
        voice.ownedGate && !voice.released) {
      if (voice.end <= now) { preview._destroyVoice(voice, 'owner-lease-expired'); continue; }
      voice.end = time; voice.releaseAt = time - voice.release;
      voice.gain.gain.cancelScheduledValues(now);
      const elapsed = Math.max(0, now - voice.start), level = elapsed < voice.attack ? elapsed / voice.attack :
        voice.decay > 0 && elapsed < voice.attack + voice.decay ? 1 - (1 - voice.sustain) * (elapsed - voice.attack) / voice.decay : voice.sustain;
      voice.gain.gain.setValueAtTime(voice.peak * level, Math.max(now, voice.start));
      if (now < voice.start + voice.attack) voice.gain.gain.linearRampToValueAtTime(voice.peak, voice.start + voice.attack);
      if (now < voice.start + voice.attack + voice.decay) voice.gain.gain.linearRampToValueAtTime(voice.peak * voice.sustain, voice.start + voice.attack + voice.decay);
      voice.gain.gain.setValueAtTime(voice.peak * voice.sustain, voice.releaseAt);
      voice.gain.gain.linearRampToValueAtTime(0, voice.end); voice.oscillator.stop(voice.end);
    }
    return Object.freeze({ status: 'accepted', generation, executionEpoch, validUntilFrame,
      policy: 'authoritative-execution-liveness', stage: 'scheduled' });
  };
  const begin = (intent, targetFrame, executionEpoch = 'live') => {
    if (disposed) return failure('disposed', intent);
    if (!prepared) return failure('patch-unprepared', intent);
    if (!preview._ownerReady(owner)) return failure('audio-not-ready', intent);
    if (intent?.version !== 1 || intent.kind !== 'begin' || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 256 ||
        !Number.isSafeInteger(intent.generation) || intent.generation < 0 || !Number.isFinite(intent.velocity01) || intent.velocity01 < 0 || intent.velocity01 > 1 ||
        (intent.sourceEventIds != null && (!Array.isArray(intent.sourceEventIds) || intent.sourceEventIds.length > 8192 ||
          intent.sourceEventIds.some(id => typeof id !== 'string' || id.length > 256))) ||
        !intent.pitch || frequencyFor(intent.pitch) == null || typeof executionEpoch !== 'string' || !executionEpoch) return failure('invalid-intent', intent);
    if (cancelledGenerations.has(leaseKey(intent.generation, executionEpoch))) return failure('generation-cancelled', intent);
    if (cancellationHistoryFull) return failure('cancellation-history-full', intent);
    const start = audioTime(targetFrame), context = preview._context;
    if (start == null || start - context.currentTime > preview._maxNoteSeconds) return failure('target-frame-out-of-range', intent);
    if (start < context.currentTime - 1 / context.sampleRate) return failure('late-attack', intent);
    const pressure = intent.expression?.pressure01 ?? 1, offset = intent.expression?.pitchOffsetCents ?? 0;
    if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1 ||
        (intent.expression != null && (typeof intent.expression !== 'object' || Array.isArray(intent.expression) ||
          Object.getPrototypeOf(intent.expression) !== Object.prototype)) ||
        (intent.expression?.pan01 != null && (!Number.isFinite(intent.expression.pan01) || intent.expression.pan01 < -1 || intent.expression.pan01 > 1)) ||
        Object.keys(intent.expression || {}).some(name => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(name))) return failure('unsupported-expression', intent);
    if (!validCents(offset)) return failure('invalid-expression', intent);
    const lease = leases.get(leaseKey(intent.generation, executionEpoch));
    const leaseEnd = lease?.context === context && lease?.generation === preview._generation &&
      lease?.ownerGeneration === preview._sessions.get(owner)?.generation ? lease?.until : null;
    if (gateMode === 'owned' && (!Number.isFinite(leaseEnd) || leaseEnd <= start + prepared.values.releaseSeconds)) return failure('execution-lease-required', intent);
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
    let oscillator, gain, pressureGain, pan, voice;
    try {
      const frequency = frequencyFor(intent.pitch);
      oscillator = context.createOscillator(); gain = context.createGain();
      pressureGain = context.createGain();
      pan = context.createStereoPanner?.() || null;
      const channel = preview._channel(0, owner), release = values.releaseSeconds;
      const end = gateMode === 'owned' ? leaseEnd : start + preview._maxNoteSeconds;
      const basePeak = intent.velocity01 * values.gain01 * prepared.patch.mix.gain01;
      voice = { oscillator, gain, pressureGain, pan, owner, number: 0, note: Math.round(intent.pitch.cents / 100),
        start, end, releaseAt: end - release, released: false, id: ++preview._voiceSequence,
        startMs: preview._nowMs() + (start - context.currentTime) * 1000, token: null,
        basePeak, peak: basePeak,
        attack: values.attackSeconds, decay: values.decaySeconds, sustain: values.sustain01, release,
        velocity: intent.velocity01 * 127, instrument: prepared.patch,
        priority: incoming.priority, laneIndex: incoming.laneIndex, startedAt: start,
        semanticKey: identity, semanticGeneration: intent.generation, semanticEpoch: executionEpoch,
        ownedGate: gateMode === 'owned', patchRevision: prepared.patch.revision, patchId: prepared.patch.id,
        mixPan: prepared.patch.mix.pan01, onsetId: intent.onsetId ?? null, actorId: intent.actorId ?? null,
        captureMeta: preview._captureMetadata({ semanticVoiceId: intent.voiceId, generation: intent.generation,
          executionEpoch, intentId: intent.intentId, onsetId: intent.onsetId, sourceEventIds: intent.sourceEventIds?.slice(0, 32) }, owner),
        playback: { voiceId: intent.voiceId, sourceEventIds: intent.sourceEventIds?.slice(0, 32), role: intent.role },
        onDestroy: reason => {
          if (voices.get(identity) === voice) voices.delete(identity);
          if (preview._semanticVoiceOwners.get(sharedIdentity) === voice) preview._semanticVoiceOwners.delete(sharedIdentity);
          pressureGain.disconnect();
          trace({ status: 'ended', stage: 'native-source-ended', voiceId: intent.voiceId, executionEpoch,
            generation: intent.generation, targetFrame, reason, patchRevision: voice.patchRevision });
        } };
      oscillator.type = waveforms[values.waveform];
      oscillator.frequency.setValueAtTime(frequency, start);
      voice.pitchAutomation = createSmoothedAudioParameter({ param: oscillator.detune, initialValue: offset, startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      voice.pressureAutomation = createSmoothedAudioParameter({ param: pressureGain.gain, initialValue: pressure, startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(voice.peak, start + voice.attack);
      gain.gain.linearRampToValueAtTime(voice.peak * voice.sustain, start + voice.attack + voice.decay);
      gain.gain.setValueAtTime(voice.peak * voice.sustain, end - release);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain);
      gain.connect(pressureGain);
      if (pan) {
        voice.panAutomation = createSmoothedAudioParameter({ param: pan.pan,
          initialValue: clamp((intent.expression?.pan01 ?? values.pan01) + prepared.patch.mix.pan01, -1, 1), startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
        pressureGain.connect(pan); pan.connect(channel.gain);
      } else pressureGain.connect(channel.gain);
      oscillator.onended = () => preview._destroyVoice(voice,
        voice.ownedGate && !voice.released ? 'owner-lease-expired' : 'source-ended');
      preview._voices.add(voice); voices.set(identity, voice); preview._semanticVoiceOwners.set(sharedIdentity, voice);
      oscillator.start(start); oscillator.stop(end);
      const receipt = Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId: intent.voiceId,
        generation: intent.generation, executionEpoch, targetFrame, patchId: prepared.patch.id, patchRevision: prepared.patch.revision });
      trace({ ...receipt, sourceEventIds: Object.freeze(intent.sourceEventIds?.slice(0, 32) || []),
        omittedSourceEventIds: Math.max(0, (intent.sourceEventIds?.length || 0) - 32), intentId: intent.intentId ?? null,
        onsetId: intent.onsetId ?? null, actorId: intent.actorId ?? null });
      preview._observe('synth-scheduled', { ...voice.captureMeta, voiceId: voice.id, targetFrame,
        audioTime: start, endAudioTime: end, patchId: voice.patchId, patchRevision: voice.patchRevision });
      return receipt;
    } catch {
      deliveryErrors++;
      if (voice && preview._voices.has(voice)) preview._destroyVoice(voice, 'backend-failure');
      else { try { oscillator?.stop(); } catch { /* The oscillator may not have started. */ } oscillator?.disconnect(); gain?.disconnect(); pressureGain?.disconnect(); pan?.disconnect(); }
      return failure('backend-failure', intent);
    }
  };
  const update = (voiceId, expression, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice || voice.stolen || voice.released || !preview._ownerReady(owner)) return failure('voice-not-active', { voiceId });
    const time = audioTime(targetFrame);
    if (time == null || !expression || typeof expression !== 'object' || Array.isArray(expression) ||
        Object.getPrototypeOf(expression) !== Object.prototype) return failure('invalid-expression', { voiceId });
    if (time < preview._context.currentTime - 1 / preview._context.sampleRate) return failure('stale-expression', { voiceId });
    if (time < voice.start || time >= voice.releaseAt) return failure('expression-outside-gate', { voiceId });
    const unsupported = Object.keys(expression).filter(name => !['pitchOffsetCents', 'pressure01', 'pan01'].includes(name));
    if (expression.pan01 != null && !voice.pan) unsupported.push('pan01');
    if (unsupported.length) {
      const receipt = Object.freeze({ status: 'degraded', reason: 'unsupported-expression', unsupported: Object.freeze(unsupported), voiceId });
      trace(receipt); return receipt;
    }
    if (expression.pitchOffsetCents != null && !validCents(expression.pitchOffsetCents) ||
        expression.pressure01 != null && (!Number.isFinite(expression.pressure01) || expression.pressure01 < 0 || expression.pressure01 > 1) ||
        expression.pan01 != null && (!Number.isFinite(expression.pan01) || expression.pan01 < -1 || expression.pan01 > 1)) return failure('invalid-expression', { voiceId });
    const now = preview._context.currentTime, at = Math.max(time, now);
    const changes = [[voice.pitchAutomation, expression.pitchOffsetCents], [voice.pressureAutomation, expression.pressure01],
      [voice.panAutomation, expression.pan01 == null ? null : clamp(expression.pan01 + voice.mixPan, -1, 1)]];
    if (changes.some(([automation, value]) => value != null && !automation?.canInsert(now))) return failure('expression-queue-full', { voiceId });
    try {
      for (const [automation, value] of changes) if (value != null) automation.insert(value, at, now);
    } catch {
      deliveryErrors++; preview._destroyVoice(voice, 'backend-failure-after-acceptance');
      return failure('backend-failure-after-acceptance', { voiceId, generation: voice.semanticGeneration });
    }
    const receipt = Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch, targetFrame,
      smoothingFrames: Math.ceil(smoothingSeconds * preview._context.sampleRate) });
    trace({ ...receipt, generation: voice.semanticGeneration, patchRevision: voice.patchRevision }); return receipt;
  };
  const end = (voiceId, release, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice) return failure('voice-not-active', { voiceId });
    const time = audioTime(targetFrame);
    if (time == null || release != null && (!Number.isFinite(release.seconds) || release.seconds < 0 || release.seconds > 4 ||
        (release.mode != null && release.mode !== 'one-shot') ||
        (release.mode === 'one-shot' && (!Number.isFinite(release.tailSeconds) || release.tailSeconds < 0 || release.tailSeconds > 4)))) return failure('invalid-release', { voiceId });
    if (voice.released) return Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch,
      targetFrame, reason: 'already-releasing' });
    if (release) voice.release = release.seconds;
    const releaseAt = release?.mode === 'one-shot' ? Math.max(time, voice.start + release.tailSeconds, preview._context.currentTime) :
      Math.max(time, preview._context.currentTime);
    try { preview._release(voice, releaseAt, false, release?.mode === 'one-shot' ? 'semantic-one-shot' : 'semantic-end'); }
    catch {
      deliveryErrors++; preview._destroyVoice(voice, 'backend-failure-after-acceptance');
      return failure('backend-failure-after-acceptance', { voiceId, generation: voice.semanticGeneration });
    }
    const receipt = Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch, targetFrame,
      repair: time < preview._context.currentTime ? 'late-release' : null });
    trace({ ...receipt, reason: receipt.repair || 'semantic-end', generation: voice.semanticGeneration,
      endFrame: Math.round(voice.end * preview._context.sampleRate), patchRevision: voice.patchRevision }); return receipt;
  };
  const cancelGenerationWithReceipt = (generation, executionEpoch = 'live') => {
    const outcomes = [], context = preview._context, frontierFrame = context ? Math.ceil(context.currentTime * context.sampleRate) : null;
    const cancelledKey = leaseKey(generation, executionEpoch);
    if (!cancelledGenerations.has(cancelledKey)) {
      if (cancelledGenerations.size < 1024) cancelledGenerations.add(cancelledKey);
      else cancellationHistoryFull = true;
    }
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch) {
      const beforeOnset = voice.start > (context?.currentTime ?? 0);
      if (beforeOnset) preview._destroyVoice(voice, 'generation-cancel-before-onset');
      else if (!voice.released) preview._release(voice, context?.currentTime || 0, true, 'generation-cancel');
      const outcome = Object.freeze({ status: 'accepted', stage: 'scheduled-cancellation-requested',
        voiceId: voice.playback.voiceId, generation, executionEpoch, frontierFrame, beforeOnset,
        appliedFrame: null, renderedStatus: 'unknown', acousticReceipt: false });
      outcomes.push(outcome); trace(outcome);
    }
    leases.delete(leaseKey(generation, executionEpoch));
    return Object.freeze({ generation, executionEpoch, frontierFrame, count: outcomes.length, outcomes: Object.freeze(outcomes) });
  };
  const cancelGeneration = (generation, executionEpoch = 'live') => cancelGenerationWithReceipt(generation, executionEpoch).count;
  const renderDiagnostics = ({ includeVoices = false, includeTraces = false } = {}) => {
    const now = preview._context?.currentTime ?? 0;
    return Object.freeze({ activeVoices: [...voices.values()].filter(voice => !voice.released && voice.end > now).length,
      deliveryErrors, sharedActiveVoices: preview._voices.size, capabilities, gateMode, smoothingSeconds,
      patchId: prepared?.patch.id ?? null, patchRevision: prepared?.patch.revision ?? null,
      readiness: disposed ? 'disposed' : !prepared ? 'patch-unprepared' : !preview._ownerReady(owner) ? 'audio-not-ready' : 'ready',
      decisions: Object.freeze({ ...decisions }), traceCount: traces.length, traceLimit, truncatedTraces,
      cancelledGenerations: cancelledGenerations.size, cancellationHistoryFull,
      evidenceClass: 'native-scheduling-api', appliedFrame: null, acousticReceipt: false,
      ...(includeTraces ? { traces: Object.freeze([...traces]) } : {}),
      ...(includeVoices ? { voices: Object.freeze([...voices.values()].map(voice => Object.freeze({
        voiceId: voice.playback.voiceId, onsetId: voice.onsetId, actorId: voice.actorId, owner,
        generation: voice.semanticGeneration, executionEpoch: voice.semanticEpoch, patchRevision: voice.patchRevision,
        state: voice.end <= now ? 'ended' : voice.stolen ? 'stolen' : voice.released || voice.releaseAt <= now ? 'release' :
          now < voice.start ? 'scheduled' : now < voice.start + voice.attack ? 'attack' : 'held',
        targetFrame: Math.round(voice.start * preview._context.sampleRate),
        endFrame: Math.round(voice.end * preview._context.sampleRate),
        modeledPressure01: voice.pressureAutomation.valueAt(now), modeledParameters: true }))) } : {}) });
  };
  const dispose = () => { if (disposed) return; disposed = true; preparationRevision++;
    for (const voice of voices.values()) preview._destroyVoice(voice, 'backend-disposed');
    voices.clear(); leases.clear(); prepared = null; };
  return Object.freeze({ capabilities, prepare, begin, update, end, renewExecutionLease, cancelGeneration,
    cancelGenerationWithReceipt, renderDiagnostics, dispose });
};

export { createNativeOscillatorBackend };
