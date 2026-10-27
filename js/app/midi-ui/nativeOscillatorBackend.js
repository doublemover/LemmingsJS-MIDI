import { createVoiceLaneMix, validVoiceLaneMix } from './VoiceLaneMix.js';
import { validVoiceTransition, transitionAttackSeconds } from './VoiceTransition.js';
import { scheduleNativeHeldEnvelope } from './NativeAdsrEnvelope.js';
export { nativeVoiceFinished, nativeRenderVoiceCount, releaseNativeVoice, destroyNativeVoice } from './NativeVoiceLifetime.js';
export { workloadVoiceCount, inspectVoiceInterval, inspectVoiceExtensions } from './AudioVoiceAdmission.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createInstrumentExecutionLifecycle, isManagedExecutionEpoch } from './InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { NATIVE_OSCILLATOR_PARAMETERS, NATIVE_FM_PARAMETERS, NATIVE_MODAL_PARAMETERS } from './NativeInstrumentSchema.js';
import { planNativeFmSource, createNativeFmSourceOwner } from './NativeFmSource.js';
import { planNativeModalSource, createNativeModalSourceOwner } from './NativeModalSource.js';
import { compileInstrumentPerformance } from '../../midi/content/InstrumentPerformance.js';
import { resolveOwnedArticulationPolicy } from './OwnedArticulationPolicy.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const waveforms = Object.freeze(['sine', 'triangle', 'sawtooth', 'square']);
const baseCapabilities = Object.freeze({ independentSamePitch: true, perVoicePitch: true, perVoicePressure: true,
  perVoicePan: true, perVoiceTimbre: false, offlineRender: true,
  ownedGates: true, sustainPedal: false, sostenuto: false, releaseVelocity: false,
  renderAcknowledgment: false, latencyFrames: 0 });
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
  maxControlEvents = 128, traceLimit = 128, engineId = 'native-oscillator' } = {}) => {
  if (!['bounded', 'owned'].includes(gateMode) || !Number.isFinite(smoothingSeconds) || smoothingSeconds < 0 || smoothingSeconds > 1 ||
      !Number.isSafeInteger(maxControlEvents) || maxControlEvents < 1 || maxControlEvents > 4096 ||
      !Number.isSafeInteger(traceLimit) || traceLimit < 0 || traceLimit > 4096 || !['native-oscillator', 'native-fm', 'native-modal'].includes(engineId)) throw new Error('Invalid native audio backend options.');
  const parameters = engineId === 'native-modal' ? NATIVE_MODAL_PARAMETERS : engineId === 'native-fm' ? NATIVE_FM_PARAMETERS : NATIVE_OSCILLATOR_PARAMETERS;
  const capabilities = Object.freeze({ ...baseCapabilities, maximumVoices: engineId === 'native-modal' ? 16 : engineId === 'native-fm' ? 32 : 64, supportedParameterIds: Object.freeze(Object.keys(parameters)) });
  let prepared = null, disposed = false, deliveryErrors = 0, preparationRevision = 0, traceSequence = 0, truncatedTraces = 0;
  const voices = new Map();
  const retirement = createProcgenRetirementScope();
  const leases = new Map(), traces = [], decisions = Object.create(null);
  const cancelledGenerations = new Set();
  let cancellationHistoryFull = false;
  const keyFor = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
  const sharedKeyFor = (epoch, voiceId) => JSON.stringify([owner, epoch, voiceId]);
  const trace = fields => {
    decisions[fields.reason || fields.stage || fields.status] = (decisions[fields.reason || fields.stage || fields.status] || 0) + 1;
    if (!traceLimit) return;
    if (traces.length === traceLimit) { traces.shift(); truncatedTraces++; }
    traces.push(Object.freeze({ sequence: ++traceSequence, owner, engineId, engineVersion: 1,
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
        resolution.patch.engineId !== engineId || resolution.patch.engineVersion !== 1 ||
        resolution.patch.sampleRefs?.length || resolution.patch.modulations?.length || resolution.receipt?.patchId !== resolution.patch.id ||
        resolution.receipt?.revision !== resolution.patch.revision) return null;
    const values = Object.fromEntries(Object.entries(parameters).map(([id, spec]) => [id, spec.default]));
    for (const [name, value] of Object.entries(resolution.patch.parameters || {})) {
      const spec = parameters[name];
      if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max || spec.integer && !Number.isInteger(value)) return null;
      values[name] = value;
    }
    if (!Number.isFinite(resolution.patch.mix?.gain01) || resolution.patch.mix.gain01 < 0 || resolution.patch.mix.gain01 > 1 ||
        !Number.isFinite(resolution.patch.mix?.pan01) || resolution.patch.mix.pan01 < -1 || resolution.patch.mix.pan01 > 1 ||
        !Number.isSafeInteger(resolution.patch.voicePolicy?.maxVoices) || resolution.patch.voicePolicy.maxVoices < 1 ||
        resolution.patch.voicePolicy.maxVoices > capabilities.maximumVoices || resolution.patch.voicePolicy.steal != null && resolution.patch.voicePolicy.steal !== 'reject') return null;
    if (typeof resolution.patch.id !== 'string' || !resolution.patch.id || resolution.patch.id.length > 128 ||
        !Number.isSafeInteger(resolution.patch.revision) || resolution.patch.revision < 1) return null;
    let performance;
    try { performance = compileInstrumentPerformance(resolution.patch, Object.values(parameters)); } catch { return null; }
    const patch = Object.freeze({ id: resolution.patch.id, revision: resolution.patch.revision,
      engineId: resolution.patch.engineId, engineVersion: resolution.patch.engineVersion,
      parameters: Object.freeze({ ...values }), sampleRefs: Object.freeze([]),
      mix: Object.freeze({ ...resolution.patch.mix }), voicePolicy: Object.freeze({ ...resolution.patch.voicePolicy }) });
    return Object.freeze({ patch, receipt: Object.freeze({ ...resolution.receipt }), values: Object.freeze(values), performance });
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
    if (cancellationHistoryFull && !isManagedExecutionEpoch(executionEpoch)) return failure('execution-registration-required');
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
    const changes = new Map();
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch && voice.ownedGate && !voice.released)
      changes.set(voice, { end: time, releaseAt: time - voice.release });
    const admission = preview._inspectVoiceExtensions(changes, { patchVoices: voices.values(), patchLimit: prepared?.patch.voicePolicy.maxVoices ?? 64 });
    if (!admission.accepted) return failure(admission.reason);
    leases.set(key, { until: time, context: preview._context, generation: preview._generation,
      ownerGeneration: preview._sessions.get(owner)?.generation });
    for (const [voice, interval] of changes) { voice.end = interval.end; voice.releaseAt = interval.releaseAt; }
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch &&
        voice.ownedGate && !voice.released) {
      if (voice.end <= now) { preview._destroyVoice(voice, 'owner-lease-expired'); continue; }
      voice.end = time; voice.releaseAt = time - voice.release;
      scheduleNativeHeldEnvelope(voice, Math.max(now, voice.start)); voice.oscillator.stop(voice.end);
    }
    return Object.freeze({ status: 'accepted', generation, executionEpoch, validUntilFrame,
      policy: 'authoritative-execution-liveness', stage: 'scheduled' });
  };
  const begin = (intent, targetFrame, executionEpoch = 'live') => {
    if (!validVoiceLaneMix(intent?.laneMix)) return failure('invalid-lane-mix', intent);
    if (!validVoiceTransition(intent?.voiceTransition)) return failure('invalid-voice-transition', intent);
    if (disposed) return failure('disposed', intent);
    if (!prepared) return failure('patch-unprepared', intent);
    if (!preview._ownerReady(owner)) return failure('audio-not-ready', intent);
    if (intent?.version !== 1 || intent.kind !== 'begin' || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 512 ||
        !Number.isSafeInteger(intent.generation) || intent.generation < 0 || !Number.isFinite(intent.velocity01) || intent.velocity01 < 0 || intent.velocity01 > 1 ||
        (intent.sourceEventIds != null && (!Array.isArray(intent.sourceEventIds) || intent.sourceEventIds.length > 8192 ||
          intent.sourceEventIds.some(id => typeof id !== 'string' || id.length > 512))) ||
        !intent.pitch || frequencyFor(intent.pitch) == null || typeof executionEpoch !== 'string' || !executionEpoch) return failure('invalid-intent', intent);
    if (cancelledGenerations.has(leaseKey(intent.generation, executionEpoch))) return failure('generation-cancelled', intent);
    if (cancellationHistoryFull && !isManagedExecutionEpoch(executionEpoch)) return failure('execution-registration-required', intent);
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
    let controls;
    try { controls = prepared.performance.resolve(intent.performanceControls, targetFrame, intent); } catch { return failure('unsupported-performance-controls', intent); }
    const values = controls.values;
    let fmPlan = null, modalPlan = null;
    if (engineId === 'native-fm') { try { fmPlan = planNativeFmSource({ fundamentalHz: frequencyFor(intent.pitch), sampleRate: context.sampleRate, parameters: values, pitchOffsetCents: offset }); }
    catch { return failure('fm-register-or-bend-unavailable', intent); } }
    if (engineId === 'native-modal') { try { modalPlan = planNativeModalSource({ fundamentalHz: frequencyFor(intent.pitch), sampleRate: context.sampleRate, parameters: values, pitchOffsetCents: offset }); }
    catch { return failure('modal-register-or-body-unavailable', intent); } }
    const sourcePlan = fmPlan || modalPlan, sourceCost = sourcePlan?.sourceCost ?? 1;
    const lease = leases.get(leaseKey(intent.generation, executionEpoch));
    const leaseEnd = lease?.context === context && lease?.generation === preview._generation &&
      lease?.ownerGeneration === preview._sessions.get(owner)?.generation ? lease?.until : null;
    if (gateMode === 'owned' && (!Number.isFinite(leaseEnd) || leaseEnd <= start + values.releaseSeconds)) return failure('execution-lease-required', intent);
    const identity = keyFor(executionEpoch, intent.voiceId);
    if (voices.has(identity)) return failure('duplicate-voice', intent);
    const sharedIdentity = sharedKeyFor(executionEpoch, intent.voiceId);
    if (preview._semanticVoiceOwners.has(sharedIdentity)) return failure('duplicate-owner-voice', intent);
    for (const voice of preview._voices) if (preview._voiceFinished(voice)) preview._destroyVoice(voice, 'inaudible-voice-reuse');
    if (preview._renderVoiceCount() + sourceCost > preview._maxScheduledVoices) return failure('shared-scheduled-voice-budget', intent);
    let resourceLease;
    try { resourceLease = preview._audioResources.reserveNativeVoice(owner, intent.generation, sourceCost); }
    catch { return failure('audio-resource-budget', intent); }
    const end = gateMode === 'owned' ? leaseEnd : start + preview._maxNoteSeconds;
    if (end - start <= values.releaseSeconds) { resourceLease.release(); return failure('bounded-envelope-out-of-range', intent); }
    const admission = preview._inspectVoiceInterval(owner, { start, end, releaseAt: end - values.releaseSeconds, cost: sourceCost,
      patchVoices: voices.values(), patchLimit: prepared.patch.voicePolicy.maxVoices });
    if (!admission.accepted) { resourceLease.release(); return failure(admission.reason, intent); }
    let oscillator, gain, pressureGain, pan, voice, laneMix;
    try {
      const frequency = frequencyFor(intent.pitch);
      const channel = preview._channel(0, owner), release = values.releaseSeconds;
      laneMix = createVoiceLaneMix({ preview, context, owner, generation: intent.generation, destination: channel.sourceInput || channel.gain, start, laneId: intent.audioLaneId ?? null, voiceId: intent.voiceId, value: intent.laneMix });
      oscillator = fmPlan ? createNativeFmSourceOwner(context, fmPlan, start) : modalPlan ? createNativeModalSourceOwner(context, modalPlan, start) : context.createOscillator();
      if (sourcePlan) oscillator.prepare(); gain = context.createGain();
      pressureGain = context.createGain();
      pan = context.createStereoPanner?.() || null;
      const basePeak = intent.velocity01 * values.gain01 * prepared.patch.mix.gain01;
      voice = { oscillator, gain, pressureGain, pan, laneMix, resourceLease, owner, renderCost: sourceCost, fmPlan, modalPlan, sourcePlan, workloadClass: preview._workloadClass(owner), number: 0, note: Math.round(intent.pitch.cents / 100),
        start, end, releaseAt: end - release, released: false, id: ++preview._voiceSequence,
        startMs: preview._nowMs() + (start - context.currentTime) * 1000, token: null,
        basePeak, peak: basePeak,
        attack: transitionAttackSeconds(intent, values.attackSeconds), decay: values.decaySeconds, sustain: values.sustain01, release,
        velocity: intent.velocity01 * 127, instrument: prepared.patch,
        priority: 1, laneIndex: intent.laneId ?? 0, startedAt: start,
        semanticKey: identity, semanticGeneration: intent.generation, semanticEpoch: executionEpoch,
        ownedGate: gateMode === 'owned', patchRevision: prepared.patch.revision, patchId: prepared.patch.id,
        mixPan: prepared.patch.mix.pan01, onsetId: intent.onsetId ?? null, actorId: intent.actorId ?? null,
        captureMeta: preview._captureMetadata({ semanticVoiceId: intent.voiceId, generation: intent.generation,
          executionEpoch, intentId: intent.intentId, onsetId: intent.onsetId, sourceEventIds: intent.sourceEventIds?.slice(0, 32) }, owner),
        playback: { voiceId: intent.voiceId, sourceEventIds: intent.sourceEventIds?.slice(0, 32), role: intent.role },
        onDestroy: reason => {
          if (voices.get(identity) === voice) voices.delete(identity);
          if (preview._semanticVoiceOwners.get(sharedIdentity) === voice) preview._semanticVoiceOwners.delete(sharedIdentity);
          const mixRetirement = createProcgenRetirementScope().retire([{ name: 'pressure-gain', run: () => pressureGain.disconnect() }, { name: 'lane-mix', run: () => laneMix.dispose() }]);
          trace({ status: 'ended', stage: 'native-source-ended', voiceId: intent.voiceId, executionEpoch,
            generation: intent.generation, targetFrame, reason, patchRevision: voice.patchRevision }); return mixRetirement;
        } };
      if (!sourcePlan) oscillator.type = waveforms[values.waveform];
      oscillator.frequency.setValueAtTime(frequency, start);
      voice.pitchAutomation = createSmoothedAudioParameter({ param: oscillator.detune, initialValue: offset, startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      voice.pressureAutomation = createSmoothedAudioParameter({ param: pressureGain.gain, initialValue: pressure, startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      scheduleNativeHeldEnvelope(voice);
      oscillator.connect(gain);
      gain.connect(pressureGain);
      if (pan) {
        voice.panAutomation = createSmoothedAudioParameter({ param: pan.pan,
          initialValue: clamp((intent.expression?.pan01 ?? values.pan01) + prepared.patch.mix.pan01, -1, 1), startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
        pressureGain.connect(pan); pan.connect(laneMix.input);
      } else pressureGain.connect(laneMix.input);
      oscillator.onended = () => preview._destroyVoice(voice,
        voice.ownedGate && !voice.released ? 'owner-lease-expired' : 'source-ended');
      preview._voices.add(voice); voices.set(identity, voice); preview._semanticVoiceOwners.set(sharedIdentity, voice);
      oscillator.start(start); oscillator.stop(end);
      const receipt = Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId: intent.voiceId,
        generation: intent.generation, executionEpoch, targetFrame, patchId: prepared.patch.id, patchRevision: prepared.patch.revision,
        performance: controls, articulation: Object.freeze({ ...resolveOwnedArticulationPolicy({ engineId, parameters: values }),
          ...(modalPlan ? { oneShotTailSeconds: modalPlan.oneShotHoldSeconds } : {}) }),
        ...(fmPlan ? { sourceCost, quality: fmPlan.quality, indexLimited: fmPlan.indexLimited, fmPlan } : {}),
        ...(modalPlan ? { sourceCost, quality: modalPlan.quality, modalPlan } : {}) });
      const { performance: effectivePerformance, ...traceReceipt } = receipt;
      trace({ ...traceReceipt, effectiveValues: effectivePerformance.values, performanceRevision: effectivePerformance.revision,
        variation: effectivePerformance.variation, effectiveTargetCount: effectivePerformance.deltas.length,
        appliedPhysicalBindings: effectivePerformance.bindingOutcomes.filter(binding => binding.state === 'applied').length,
        sourceEventIds: Object.freeze(intent.sourceEventIds?.slice(0, 32) || []),
        omittedSourceEventIds: Math.max(0, (intent.sourceEventIds?.length || 0) - 32), intentId: intent.intentId ?? null,
        onsetId: intent.onsetId ?? null, actorId: intent.actorId ?? null });
      preview._observe('synth-scheduled', { ...voice.captureMeta, voiceId: voice.id, targetFrame,
        audioTime: start, endAudioTime: end, patchId: voice.patchId, patchRevision: voice.patchRevision });
      return receipt;
    } catch (error) {
      if (error?.name !== 'ResourceBudgetError') deliveryErrors++;
      if (voice && preview._voices.has(voice)) preview._destroyVoice(voice, 'backend-failure');
      else {
        let native;
        const construction = createProcgenRetirementScope(), receipt = construction.retire([
          { name: 'native-nodes', run: () => { native = createProcgenRetirementScope().retire([
            { name: 'stop', run: () => { if (oscillator) { oscillator.onended = null; try { oscillator.stop(); } catch (failure) { if (failure.name !== 'InvalidStateError') throw failure; } } } },
            { name: 'lane-mix', run: () => laneMix?.dispose() }, { name: 'oscillator', run: () => oscillator?.disconnect() }, { name: 'gain', run: () => gain?.disconnect() },
            { name: 'pressure-gain', run: () => pressureGain?.disconnect() }, { name: 'pan', run: () => pan?.disconnect() }
          ]); return native; } },
          { name: 'reservation', run: () => releaseAudioResourceAfterRetirement(resourceLease, native) }
        ]);
        if (receipt.outcome !== 'complete') {
          const retained = { id: voice?.id ?? ++preview._voiceSequence, owner, nativeContext: context, retirement: construction, oscillator, gain, pressureGain, pan };
          preview._retiredVoices?.set(retained.id, retained); preview._retirementFaults?.add(owner);
        }
      }
      return failure(error?.name === 'ResourceBudgetError' ? 'audio-resource-budget' : 'backend-failure', intent);
    }
  };
  const update = (voiceId, expression, targetFrame, executionEpoch = 'live', rampSeconds = smoothingSeconds) => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice || voice.stolen || voice.released && voice.releaseAt <= preview._context?.currentTime || !preview._ownerReady(owner)) return failure('voice-not-active', { voiceId });
    if (!Number.isFinite(rampSeconds) || rampSeconds < 0 || rampSeconds > 60) return failure('invalid-control-ramp', { voiceId });
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
    if (voice.sourcePlan && expression.pitchOffsetCents != null && Math.abs(expression.pitchOffsetCents) > voice.sourcePlan.maxBendCents) return failure(voice.fmPlan ? 'fm-bend-profile-exceeded' : 'modal-bend-profile-exceeded', { voiceId });
    const now = preview._context.currentTime, at = Math.max(time, now);
    const changes = [[voice.pitchAutomation, expression.pitchOffsetCents], [voice.pressureAutomation, expression.pressure01],
      [voice.panAutomation, expression.pan01 == null ? null : clamp(expression.pan01 + voice.mixPan, -1, 1)]];
    if (changes.some(([automation, value]) => value != null && !automation?.canInsert(now))) return failure('expression-queue-full', { voiceId });
    try {
      for (const [automation, value] of changes) if (value != null) { if (!automation.insert(value, at, now, Math.max(smoothingSeconds, rampSeconds))) throw new Error('Expression automation refused admission.'); }
    } catch {
      deliveryErrors++; preview._destroyVoice(voice, 'backend-failure-after-acceptance');
      return failure('backend-failure-after-acceptance', { voiceId, generation: voice.semanticGeneration });
    }
    const receipt = Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch, targetFrame,
      smoothingFrames: Math.ceil(Math.max(smoothingSeconds, rampSeconds) * preview._context.sampleRate) });
    trace({ ...receipt, generation: voice.semanticGeneration, patchRevision: voice.patchRevision }); return receipt;
  };
  const updateLaneMix = (voiceId, mix, frame, epoch = 'live', laneId = undefined) => {
    const voice = voices.get(keyFor(epoch, voiceId));
    return voice?.laneMix?.update(mix, frame, laneId) || Object.freeze({ status: 'rejected', reason: 'voice-not-active' });
  };
  const end = (voiceId, release, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice) return failure('voice-not-active', { voiceId });
    const time = audioTime(targetFrame);
    if (time == null || release != null && (!Number.isFinite(release.seconds) || release.seconds < 0 || release.seconds > 4 || release.force != null && typeof release.force !== 'boolean' ||
        (release.mode != null && release.mode !== 'one-shot') ||
        (release.mode === 'one-shot' && (!Number.isFinite(release.tailSeconds) || release.tailSeconds < 0 || release.tailSeconds > 4)))) return failure('invalid-release', { voiceId });
    const releaseAt = release?.mode === 'one-shot' ? Math.max(time, voice.start + release.tailSeconds, preview._context.currentTime) :
      Math.max(time, preview._context.currentTime);
    if (voice.released && release?.force !== true && releaseAt >= voice.releaseAt) return Object.freeze({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch,
      targetFrame, reason: 'already-releasing' });
    if (release) voice.release = release.seconds;
    try { preview._release(voice, releaseAt, release?.force === true, release?.force ? 'owned-cleanup' : release?.mode === 'one-shot' ? 'semantic-one-shot' : 'semantic-end'); }
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
    if (!isManagedExecutionEpoch(executionEpoch) && !cancelledGenerations.has(cancelledKey)) {
      if (cancelledGenerations.size < 1024) cancelledGenerations.add(cancelledKey);
      else cancellationHistoryFull = true;
    }
    const selected = [...voices.values()].filter(voice => voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch);
    const retirement = createProcgenRetirementScope().retire(selected.map(voice => ({ name: 'voice-' + voice.id, run: () => {
      const beforeOnset = voice.start > (context?.currentTime ?? 0);
      try {
        const result = beforeOnset ? preview._destroyVoice(voice, 'generation-cancel-before-onset') :
          !voice.released ? preview._release(voice, context?.currentTime || 0, true, 'generation-cancel') : null;
        const outcome = Object.freeze({ status: result?.outcome === 'partial' ? 'rejected' : 'accepted', stage: 'scheduled-cancellation-requested',
          voiceId: voice.playback.voiceId, generation, executionEpoch, frontierFrame, beforeOnset,
          appliedFrame: null, renderedStatus: 'unknown', acousticReceipt: false });
        outcomes.push(outcome); trace(outcome); return result;
      } catch (error) {
        const outcome = Object.freeze({ status: 'rejected', reason: 'voice-cancellation-failed', voiceId: voice.playback.voiceId,
          generation, executionEpoch, frontierFrame, appliedFrame: null, renderedStatus: 'unknown', acousticReceipt: false });
        outcomes.push(outcome); trace(outcome); throw error;
      }
    } })));
    leases.delete(leaseKey(generation, executionEpoch));
    return Object.freeze({ generation, executionEpoch, frontierFrame, count: outcomes.filter(outcome => outcome.status === 'accepted').length,
      requestedCount: selected.length, outcomes: Object.freeze(outcomes), retirement });
  };
  const cancelGeneration = (generation, executionEpoch = 'live') => cancelGenerationWithReceipt(generation, executionEpoch).count;
  const renderDiagnostics = ({ includeVoices = false, includeTraces = false } = {}) => {
    const now = preview._context?.currentTime ?? 0;
    return Object.freeze({ engineId, activeVoices: [...voices.values()].filter(voice => !voice.released && voice.end > now).length,
      deliveryErrors, sharedActiveVoices: preview._voices.size, capabilities, gateMode, smoothingSeconds,
      patchId: prepared?.patch.id ?? null, patchRevision: prepared?.patch.revision ?? null,
      readiness: disposed ? 'disposed' : !prepared ? 'patch-unprepared' : !preview._ownerReady(owner) ? 'audio-not-ready' : 'ready',
      decisions: Object.freeze({ ...decisions }), traceCount: traces.length, traceLimit, truncatedTraces,
      cancelledGenerations: cancelledGenerations.size, cancellationHistoryFull,
      evidenceClass: 'native-scheduling-api', appliedFrame: null, acousticReceipt: false,
      ...(includeTraces ? { traces: Object.freeze([...traces]) } : {}),
      ...(includeVoices ? { voices: Object.freeze([...voices.values()].map(voice => Object.freeze({
        voiceId: voice.playback.voiceId, onsetId: voice.onsetId, actorId: voice.actorId, owner,
        generation: voice.semanticGeneration, executionEpoch: voice.semanticEpoch, patchRevision: voice.patchRevision, sourceCost: voice.renderCost, fmPlan: voice.fmPlan, modalPlan: voice.modalPlan,
        state: voice.end <= now ? 'ended' : now < voice.start ? 'scheduled' : voice.releaseAt <= now ? voice.stolen ? 'stolen' : 'release' :
          now < voice.start + voice.attack ? 'attack' : 'held',
        targetFrame: Math.round(voice.start * preview._context.sampleRate),
        endFrame: Math.round(voice.end * preview._context.sampleRate),
        modeledPressure01: voice.pressureAutomation.valueAt(now), modeledParameters: true }))) } : {}) });
  };
  const dispose = () => retirement.retire([
    { name: 'admission', run: () => { disposed = true; preparationRevision++; } },
    ...[...voices.values()].map(voice => ({ name: `voice-${voice.id}`, run: () => preview._destroyVoice(voice, 'backend-disposed') })),
    { name: 'leases', run: () => leases.clear() }, { name: 'patch', run: () => { prepared = null; } }
  ]);
  return createInstrumentExecutionLifecycle({ capabilities, prepare, begin, update, updateLaneMix, end, renewExecutionLease, cancelGeneration,
    cancelGenerationWithReceipt, renderDiagnostics, dispose }, {
    getContext: () => preview.getAudioContext(), getGeneration: () => preview._sessions.get(owner)?.generation ?? preview._generation,
    isSettled: epoch => !preview._retirementFaults?.has(owner) && ![...voices.values()].some(voice => voice.semanticEpoch === epoch),
    isVoiceSettled: (voiceId, epoch) => !preview._retirementFaults?.has(owner) && !voices.has(keyFor(epoch, voiceId)),
    forget: (epoch, generation) => leases.delete(leaseKey(generation, epoch))
  }).api;
};

export { createNativeOscillatorBackend };
