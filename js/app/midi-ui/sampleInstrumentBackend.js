import { createVoiceLaneMix, validVoiceLaneMix } from './VoiceLaneMix.js';
import { validVoiceTransition, transitionAttackSeconds } from './VoiceTransition.js';
import { sampleRegionRate as rateFor, sampleRegionArticulation } from './NativeSamplePlan.js';
import { DECODER_VERSION } from './AudioAssetRef.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createInstrumentExecutionLifecycle, isManagedExecutionEpoch } from './InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { NATIVE_SAMPLE_FIELDS as parameterSpecs } from './NativeInstrumentSchema.js';
import { createSampleMapResolver, validateSampleMapAssets } from '../../midi/content/SampleInstrumentMap.js';
import { nativeHeldEnvelopeLevel, scheduleNativeHeldEnvelope, truncateNativeEnvelope } from './NativeAdsrEnvelope.js';

const plain = value => value != null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const capabilities = Object.freeze({ independentSamePitch: true, perVoicePitch: true, perVoicePressure: true,
  perVoicePan: true, ownedGates: true, sampleMaps: true, releaseVelocity: true, releaseRegion: true, forwardLoops: true,
  crossfadeLoops: false, reverse: false, positionDriven: false, independentTimeStretch: false,
  renderAcknowledgment: false, offlineRender: true, maximumVoices: 64, latencyFrames: 0,
  supportedParameterIds: Object.freeze(['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds', 'gain01', 'pan01']) });

// Region selection belongs to the content map. This renderer snapshots exactly
// one resolved source-frame region at onset and never rerolls it at release.
export function createSampleInstrumentBackend(preview, owner = null, { resolveRegion = null, gateMode = 'owned', clockMode = 'realtime',
  smoothingSeconds = 0.008, maxControlEvents = 128, traceLimit = 128 } = {}) {
  if (resolveRegion != null && typeof resolveRegion !== 'function' || !['owned', 'bounded'].includes(gateMode) || !['realtime', 'offline'].includes(clockMode) || !finite(smoothingSeconds, 0, 1) ||
      !integer(maxControlEvents, 1, 4096) || !integer(traceLimit, 0, 4096)) throw new TypeError('Invalid sample audio backend options.');
  const voices = new Map(), leases = new Map(), cancelled = new Set(), traces = [];
  const retirement = createProcgenRetirementScope();
  let prepared = null, revision = 0, disposed = false, cancellationHistoryFull = false, errors = 0, sequence = 0, expiryTimer = null, rebuildingChokes = false;
  let preparationFault = null, pendingPreparations = 0;
  const retiredPrepared = new Set();
  const retirementSummary = receipt => receipt ? Object.freeze({ state: receipt.state, outcome: receipt.outcome,
    failures: Object.freeze(receipt.resources.filter(resource => resource.status !== 'completed').map(resource => Object.freeze({ name: resource.name, status: resource.status, error: resource.error || null }))) }) : null;
  const keyFor = (epoch, id) => JSON.stringify([epoch, id]), generationKey = (generation, epoch) => JSON.stringify([generation, epoch]);
  const sharedKey = (epoch, voiceId) => JSON.stringify([owner, epoch, voiceId]);
  const trace = receipt => {
    if (traceLimit) {
      if (traces.length === traceLimit) traces.shift();
      traces.push(Object.freeze({ sequence: ++sequence, owner, engineId: 'native-sample', engineVersion: 1,
        evidenceClass: 'native-scheduling-api', appliedFrame: null, acousticReceipt: false, ...receipt }));
    }
    return Object.freeze(receipt);
  };
  const reject = (reason, voiceId = null) => trace({ status: 'rejected', reason, voiceId });
  const timeFor = frame => integer(frame, 0, Number.MAX_SAFE_INTEGER) && preview._context ? frame / preview._context.sampleRate : null;
  const validExpression = expression => plain(expression) && Object.keys(expression).every(name => ['pressure01', 'pan01', 'pitchOffsetCents'].includes(name)) &&
    (expression.pressure01 == null || finite(expression.pressure01, 0, 1)) && (expression.pan01 == null || finite(expression.pan01, -1, 1)) &&
    (expression.pitchOffsetCents == null || finite(expression.pitchOffsetCents, -24000, 24000));
  const armExpiry = () => {
    if (expiryTimer != null) clearTimeout(expiryTimer); expiryTimer = null;
    if (disposed || !voices.size || clockMode === 'offline') return;
    const remaining = Math.min(...[...voices.values()].map(voice => voice.end)) - (preview._context?.currentTime ?? 0);
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      for (const voice of voices.values()) if (voice.end <= (preview._context?.currentTime ?? 0)) preview._destroyVoice(voice, 'sample-owner-lease-expired');
      armExpiry();
    }, Math.max(1, Math.min(1000, remaining * 1000 + 1)));
  };
  const releasePrepared = value => {
    if (!value) return null;
    if (value.retirement) return value.retirement;
    value.retirement = createProcgenRetirementScope().retire([...value.assets.values()].map((pin, index) => ({ name: 'sample-pin-' + index, run: () => pin.release() }))
      .concat({ name: 'sample-map-metadata', run: () => { value.mapResolver = null; return value.mapLease?.release(); } }));
    if (value.retirement.outcome !== 'complete') {
      retiredPrepared.add(value); preparationFault = value.retirement;
      value.retirement.completion.then(receipt => { if (receipt.outcome === 'complete') {
        retiredPrepared.delete(value); if (preparationFault === receipt) preparationFault = null;
      } });
    }
    return value.retirement;
  };
  const releaseComponentPin = component => {
    component.pinRetirementScope ||= createProcgenRetirementScope();
    return component.pinRetirementScope.retire([{ name: 'sample-pin', run: () => component.pin.release() }]);
  };
  const retireComponent = component => {
    component.retirementScope ||= createProcgenRetirementScope();
    let native;
    return component.retirementScope.retire([
      { name: 'native-source', run: () => { native = createProcgenRetirementScope().retire([
        { name: 'stop', run: () => { if (component.source) { component.source.onended = null; if (component.started) {
          try { component.source.stop(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; }
        } } } },
        { name: 'disconnect', run: () => component.source?.disconnect() },
        { name: 'buffer', run: () => { if (component.source) component.source.buffer = null; } },
        { name: 'gain', run: () => component.gain?.disconnect() }
      ]); return native; } },
      { name: 'sample-pin', run: () => {
        if (native.outcome !== 'complete') { component.pinWithheld = true; throw new Error('Sample source retirement is unknown; its decoded pin remains owned.'); }
        return releaseComponentPin(component);
      } }
    ]);
  };
  const reconcileComponents = components => createProcgenRetirementScope().retire(components.map((component, index) => ({
    name: 'closed-source-pin-' + index, run: () => releaseComponentPin(component)
  })));
  const watchSourceEnd = (voice, component) => {
    const source = component.source, context = preview._context;
    source.onended = () => {
      if (component.source !== source) return;
      component.ended = true; component.completed = true; if (!preview._voices.has(voice)) return;
      if (voice.stolen && voice.releaseAt > context.currentTime) return;
      if (!voice.released && voice.child && context.currentTime < voice.hardEnd - 1 / context.sampleRate) return;
      if (!voice.released || voice.components.every(item => item.ended)) preview._destroyVoice(voice, !voice.released && voice.ownedGate ? 'owner-lease-expired-or-source-ended' : 'sample-sources-ended');
    };
  };
  const prepare = async (resolution, assets = []) => {
    if (disposed) return reject('disposed');
    if (preparationFault) return reject('sample-retirement-unknown');
    if (pendingPreparations >= 2) return reject('sample-preparation-busy');
    const patch = resolution?.patch;
    if (!['ready', 'degraded'].includes(resolution?.status) || !patch || patch.engineId !== 'native-sample' || patch.engineVersion !== 1 ||
        !text(patch.id, 128) || !integer(patch.revision, 1, 2147483647) || resolution.receipt?.patchId !== patch.id ||
        resolution.receipt?.revision !== patch.revision || !plain(patch.parameters) || patch.modulations?.length || patch.macros?.length || patch.causalBindings?.length || patch.variation ||
        !finite(patch.mix?.gain01, 0, 1) || !finite(patch.mix?.pan01, -1, 1) || !integer(patch.voicePolicy?.maxVoices, 1, 64) ||
        patch.voicePolicy.steal != null && patch.voicePolicy.steal !== 'reject' ||
        !Array.isArray(patch.sampleRefs) || patch.sampleRefs.length > 32 || !Array.isArray(assets) || assets.length > 32) return reject('unsupported-patch-or-engine');
    const parameters = {};
    for (const [name, spec] of Object.entries(parameterSpecs)) parameters[name] = spec[2];
    for (const [name, value] of Object.entries(patch.parameters)) {
      const spec = parameterSpecs[name]; if (!spec || !finite(value, spec[0], spec[1])) return reject('unsupported-patch-parameter'); parameters[name] = value;
    }
    const pins = new Map(), request = ++revision, audioGeneration = preview._generation, ownerGeneration = preview._sessions.get(owner)?.generation;
    let mapLease = null, mapResolver = null;
    pendingPreparations++;
    try {
      for (const pin of assets) {
        const hash = pin?.ref?.contentHash;
        if (!pin?.isActive?.() || typeof pin.retain !== 'function' || !/^[a-f0-9]{64}$/.test(hash) || pins.has(hash) ||
            pin.ref.kind !== 'sample' || pin.variant?.decoderVersion !== DECODER_VERSION || pin.variant?.contentHash !== hash || pin.variant.targetSampleRate !== preview._context?.sampleRate) throw new Error('invalid-prepared-sample-pin');
        pins.set(hash, pin.retain({ owner, generation: audioGeneration }));
      }
      for (const ref of patch.sampleRefs) {
        const pin = pins.get(ref.sha256);
        if (!pin && ref.required !== false || pin && pin.ref.bytes !== ref.bytes) throw new Error('required-sample-unavailable');
      }
      if (patch.sampleMap) {
        mapLease = preview._audioResources.reserve({ kind: 'sample-map-metadata', owner, generation: audioGeneration, estimateBytes: 1048576, consumerOwned: true });
        mapResolver = createSampleMapResolver(patch.sampleMap, patch.sampleRefs, { patchId: patch.id, patchRevision: patch.revision });
      }
      if (!mapResolver && !resolveRegion) throw new Error('sample-map-required');
      if (mapResolver) validateSampleMapAssets(mapResolver.map, [...pins.values()]);
      const next = { id: patch.id, revision: patch.revision, parameters: Object.freeze(parameters),
        mix: Object.freeze({ gain01: patch.mix.gain01, pan01: patch.mix.pan01 }), maxVoices: patch.voicePolicy.maxVoices,
        receipt: Object.freeze({ patchId: patch.id, revision: patch.revision }), assets: pins, mapResolver, mapLease };
      await Promise.resolve();
      if (disposed || preparationFault || request !== revision || audioGeneration !== preview._generation || ownerGeneration !== preview._sessions.get(owner)?.generation) throw new Error('preparation-cancelled');
      const prior = prepared; prepared = next;
      const retired = releasePrepared(prior);
      return trace({ status: 'ready', patchId: next.id, revision: next.revision, capabilities, retirement: retirementSummary(retired) });
    } catch (error) {
      const retired = releasePrepared({ assets: pins, mapResolver, mapLease });
      return trace({ status: 'rejected', reason: error.message, retirement: retirementSummary(retired) });
    } finally { pendingPreparations--; }
  };
  const snapshotRegion = (input, assets, child = false) => {
    if (!plain(input) || input.domain !== 'source-frames' || !/^[a-f0-9]{64}$/.test(input.assetHash)) throw new Error('invalid-resolved-sample-region');
    const pin = assets.get(input.assetHash), ref = pin?.ref;
    if (!pin?.isActive() || !ref || !integer(input.onsetFrame, 0, ref.frames - 1) || !integer(input.endFrame, input.onsetFrame + 1, ref.frames) ||
        !finite(input.rootCents, -24000, 24000) || !finite(input.gain01 ?? 1, 0, 1) || !finite(input.tuningCents ?? 0, -1200, 1200) ||
        input.chokeGroup != null && !text(input.chokeGroup, 128) || input.chokeScope != null && !text(input.chokeScope, 1024) ||
        input.selectionSeed != null && !integer(input.selectionSeed, 0, 0xffffffff)) throw new Error('invalid-resolved-sample-region');
    if (input.playbackMode != null && input.playbackMode !== 'forward' || input.positionDriven != null || input.reverse === true) throw new Error('unsupported-sample-playback-mode');
    let loop = null, releaseRegion = null, pitchRange = null;
    if (input.loop != null) {
      const value = input.loop;
      if (child || !plain(value) || !['forward', 'sustain'].includes(value.mode) ||
          !integer(value.startFrame, input.onsetFrame, input.endFrame - 1) || !integer(value.endFrame, value.startFrame + 1, input.endFrame) ||
          !integer(value.crossfadeFrames ?? 0, 0, ref.frames)) throw new Error('invalid-sample-loop');
      if (value.crossfadeFrames) throw new Error('crossfade-loop-unsupported');
      loop = Object.freeze({ startFrame: value.startFrame, endFrame: value.endFrame, mode: value.mode, crossfadeFrames: 0 });
    }
    if (input.pitchRange != null) {
      if (!plain(input.pitchRange) || !finite(input.pitchRange.minCents, -24000, 24000) || !finite(input.pitchRange.maxCents, input.pitchRange.minCents, 24000)) throw new Error('invalid-sample-pitch-range');
      pitchRange = Object.freeze({ minCents: input.pitchRange.minCents, maxCents: input.pitchRange.maxCents });
    }
    if (input.releaseRegion != null) {
      if (child) throw new Error('nested-release-region-unsupported');
      releaseRegion = snapshotRegion(input.releaseRegion, assets, true);
    }
    return Object.freeze({ domain: 'source-frames', assetHash: input.assetHash, onsetFrame: input.onsetFrame, endFrame: input.endFrame,
      rootCents: input.rootCents, gain01: input.gain01 ?? 1, tuningCents: input.tuningCents ?? 0, loop, releaseRegion, pitchRange,
      chokeGroup: input.chokeGroup ?? null, chokeScope: input.chokeScope ?? null, selectionSeed: input.selectionSeed ?? null, selection: !child && prepared?.mapResolver ? input.selection : null });
  };
  const scheduleHeldEnvelope = (voice, until) => {
    const at = Math.max(voice.start, preview._context.currentTime);
    voice.end = until; voice.hardEnd = until; voice.releaseAt = Math.max(at, until - voice.release);
    scheduleNativeHeldEnvelope(voice, at);
    if (!voice.main.ended) voice.main.source.stop(until);
  };
  const renewExecutionLease = (generation, executionEpoch, validUntilFrame) => {
    const until = timeFor(validUntilFrame), now = preview._context?.currentTime;
    if (disposed || !integer(generation, 0, Number.MAX_SAFE_INTEGER) || !text(executionEpoch) || until == null ||
        !preview._ownerReady(owner) || until <= now || until - now > 120) return reject('invalid-execution-lease');
    const key = generationKey(generation, executionEpoch);
    if (cancelled.has(key)) return reject('generation-cancelled');
    if (cancellationHistoryFull && !isManagedExecutionEpoch(executionEpoch)) return reject('execution-registration-required');
    for (const [id, value] of leases) if (value.until <= now || value.context !== preview._context || value.ownerGeneration !== preview._sessions.get(owner)?.generation) leases.delete(id);
    if (leases.get(key)?.until >= until || !leases.has(key) && leases.size >= 64) return reject('stale-or-excessive-execution-lease');
    if ([...voices.values()].some(voice => voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch && !voice.released && voice.releaseAt <= now)) return reject('execution-lease-too-late');
    const changes = new Map();
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch && voice.ownedGate &&
        (!voice.released || voice.stolen && voice.releaseAt > now)) changes.set(voice, { end: until, releaseAt: until - voice.release });
    const admission = preview._inspectVoiceExtensions(changes, { patchVoices: voices.values(), patchLimit: prepared?.maxVoices ?? 64 });
    if (!admission.accepted) return reject(admission.reason);
    leases.set(key, { until, context: preview._context, ownerGeneration: preview._sessions.get(owner)?.generation });
    const groups = new Map();
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch && voice.ownedGate &&
        (!voice.released || voice.stolen && voice.releaseAt > now)) {
      if (voice.region.chokeGroup) { voice.hardEnd = until; groups.set(JSON.stringify([voice.region.chokeGroup, voice.region.chokeScope]), voice.region); }
      else scheduleHeldEnvelope(voice, until);
    }
    for (const region of groups.values()) rebuildChokes(region.chokeGroup, region.chokeScope);
    armExpiry(); return trace({ status: 'accepted', stage: 'scheduled', generation, executionEpoch, validUntilFrame });
  };
  const begin = (intent, targetFrame, executionEpoch = 'live') => {
    if (!validVoiceLaneMix(intent?.laneMix)) return reject('invalid-lane-mix', intent?.voiceId);
    if (!validVoiceTransition(intent?.voiceTransition)) return reject('invalid-voice-transition', intent?.voiceId);
    if (Object.keys(intent?.performanceControls?.macros || {}).length || Object.keys(intent?.performanceControls || {}).some(key => key !== 'macros')) return reject('performance-controls-unavailable', intent?.voiceId);
    if (disposed || !prepared || !preview._ownerReady(owner)) return reject(disposed ? 'disposed' : !prepared ? 'patch-unprepared' : 'audio-not-ready', intent?.voiceId);
    const context = preview._context, start = timeFor(targetFrame), expression = intent?.expression ?? {};
    if (intent?.version !== 1 || intent.kind !== 'begin' || !text(intent.voiceId, 512) || !text(executionEpoch) || !integer(intent.generation, 0, Number.MAX_SAFE_INTEGER) ||
        !finite(intent.velocity01, 0, 1) || !finite(intent.pitch?.cents, -24000, 24000) || !finite(intent.pitch?.referenceHz ?? 440, 0.1, 20000) ||
        start == null || start < context.currentTime - 1 / context.sampleRate || start - context.currentTime > preview._maxNoteSeconds || !validExpression(expression) ||
        intent.sourceEventIds != null && (!Array.isArray(intent.sourceEventIds) || intent.sourceEventIds.length > 8192 || intent.sourceEventIds.some(id => !text(id)))) return reject('invalid-or-late-intent', intent?.voiceId);
    if (cancelled.has(generationKey(intent.generation, executionEpoch))) return reject('generation-cancelled', intent.voiceId);
    if (cancellationHistoryFull && !isManagedExecutionEpoch(executionEpoch)) return reject('execution-registration-required', intent.voiceId);
    const identity = keyFor(executionEpoch, intent.voiceId), sharedIdentity = sharedKey(executionEpoch, intent.voiceId);
    if (voices.has(identity) || preview._semanticVoiceOwners.has(sharedIdentity)) return reject('duplicate-owner-voice', intent.voiceId);
    const lease = leases.get(generationKey(intent.generation, executionEpoch));
    const hardEnd = gateMode === 'owned' && lease?.context === context && lease.ownerGeneration === preview._sessions.get(owner)?.generation ? lease.until :
      gateMode === 'bounded' ? start + preview._maxNoteSeconds : null;
    if (hardEnd == null || hardEnd <= start + prepared.parameters.releaseSeconds) return reject('execution-lease-required', intent.voiceId);
    let region; const selectedPatch = prepared;
    try { region = snapshotRegion(selectedPatch.mapResolver ? selectedPatch.mapResolver(intent) : resolveRegion(intent, selectedPatch.receipt), selectedPatch.assets); } catch (error) { return reject(error.message || 'sample-region-unavailable', intent.voiceId); }
    if (disposed || prepared !== selectedPatch || context !== preview._context || !preview._ownerReady(owner)) return reject('sample-selection-cancelled', intent.voiceId);
    const rate = rateFor(region, intent.pitch, expression.pitchOffsetCents ?? 0), childRate = region.releaseRegion ? rateFor(region.releaseRegion, intent.pitch, expression.pitchOffsetCents ?? 0) : null;
    if (rate == null || region.releaseRegion && childRate == null) return reject('sample-pitch-out-of-range', intent.voiceId);
    const renderCost = region.releaseRegion ? 2 : 1;
    if (hardEnd - start <= prepared.parameters.releaseSeconds) return reject('bounded-envelope-out-of-range', intent.voiceId);
    for (const voice of preview._voices) if (preview._voiceFinished(voice)) preview._destroyVoice(voice, 'inaudible-voice-reuse');
    if (preview._renderVoiceCount() + renderCost > preview._maxScheduledVoices) return reject('shared-sample-source-budget', intent.voiceId);
    const overrides = new Map(); let nextChoke = Infinity;
    if (region.chokeGroup) for (const member of voices.values()) {
      if (member.region.chokeGroup !== region.chokeGroup || member.region.chokeScope !== region.chokeScope) continue;
      const later = member.start > start || member.start === start && member.playback.voiceId > intent.voiceId;
      if (later) nextChoke = Math.min(nextChoke, member.start);
      else overrides.set(member, { releaseAt: Math.min(member.releaseAt, start), end: Math.min(member.end, start + 0.005) });
    }
    const admission = preview._inspectVoiceInterval(owner, { start, end: Math.min(hardEnd, nextChoke + 0.005),
      releaseAt: Math.min(hardEnd - prepared.parameters.releaseSeconds, nextChoke), overrides,
      cost: renderCost, patchVoices: voices.values(), patchLimit: prepared.maxVoices });
    if (!admission.accepted) return reject(admission.reason, intent.voiceId);
    const allocations = [], components = []; let pressureGain, pan, voice, laneMix;
    try {
      for (let n = 0; n < renderCost; n++) allocations.push(preview._audioResources.reserveNativeVoice(owner, intent.generation));
      for (const selected of [region, region.releaseRegion].filter(Boolean)) {
        const preparedPin = prepared.assets.get(selected.assetHash);
        if (preparedPin.variant.targetSampleRate !== context.sampleRate) throw new Error('sample-rate-variant-unavailable');
        const pin = preparedPin.retain({ owner, generation: intent.generation });
        const component = { pin, region: selected, source: null, gain: null, started: false, ended: false }; components.push(component);
        component.source = context.createBufferSource(); component.source.buffer = pin.buffer; component.gain = context.createGain();
        component.source.connect(component.gain);
        if (selected.loop) {
          component.source.loop = true; component.source.loopStart = selected.loop.startFrame / pin.ref.sourceSampleRate;
          component.source.loopEnd = selected.loop.endFrame / pin.ref.sourceSampleRate;
        }
      }
      const channel = preview._channel(0, owner), values = prepared.parameters;
      laneMix = createVoiceLaneMix({ preview, context, owner, generation: intent.generation, destination: channel.sourceInput || channel.gain, start, laneId: intent.audioLaneId ?? null, voiceId: intent.voiceId, value: intent.laneMix });
      pressureGain = context.createGain(); pan = context.createStereoPanner?.() || null;
      for (const component of components) component.gain.connect(pressureGain);
      pressureGain.connect(pan || laneMix.input); pan?.connect(laneMix.input);
      voice = { owner, workloadClass: preview._workloadClass(owner), number: 0, note: Math.round(intent.pitch.cents / 100), velocity: intent.velocity01 * 127, id: ++preview._voiceSequence,
        start, end: hardEnd, hardEnd, releaseAt: hardEnd - values.releaseSeconds, released: false, renderCost, startedAt: start, priority: 1, laneIndex: intent.laneId ?? 0,
        main: components[0], child: components[1] || null, components, gain: components[0].gain, pressureGain, pan, laneMix, nativeNodesOwnedByBackend: true,
        onContextClosed: () => reconcileComponents(components),
        peak: intent.velocity01 * values.gain01 * prepared.mix.gain01 * region.gain01, patchGain: values.gain01 * prepared.mix.gain01, attack: transitionAttackSeconds(intent, values.attackSeconds), decay: values.decaySeconds,
        sustain: values.sustain01, release: values.releaseSeconds, ownedGate: gateMode === 'owned', region, pitch: Object.freeze({ ...intent.pitch }),
        mixPan: prepared.mix.pan01, semanticGeneration: intent.generation, semanticEpoch: executionEpoch, patchId: prepared.id, patchRevision: prepared.revision,
        startMs: preview._nowMs() + (start - context.currentTime) * 1000, playback: { voiceId: intent.voiceId, onsetId: intent.onsetId, actorId: intent.actorId },
        captureMeta: preview._captureMetadata({ semanticVoiceId: intent.voiceId, generation: intent.generation, executionEpoch, onsetId: intent.onsetId,
          intentId: intent.intentId, sourceEventIds: intent.sourceEventIds?.slice(0, 32) }, owner),
        isFinished: now => voice.end <= now,
        onDestroy: reason => {
          voices.delete(identity); if (preview._semanticVoiceOwners.get(sharedIdentity) === voice) preview._semanticVoiceOwners.delete(sharedIdentity);
          let native;
          return createProcgenRetirementScope().retire([
            { name: 'native-sources', run: () => { native = createProcgenRetirementScope().retire([
              ...components.map((component, index) => ({ name: 'source-' + index, run: () => retireComponent(component) })),
              { name: 'lane-mix', run: () => laneMix?.dispose() }, { name: 'pressure-gain', run: () => pressureGain.disconnect() }, { name: 'pan', run: () => pan?.disconnect() }
            ]); return native; } },
            ...allocations.map((allocation, index) => ({ name: `allocation-${index}`, run: () => releaseAudioResourceAfterRetirement(allocation, native) })),
            { name: 'observation', run: () => { trace({ status: 'ended', voiceId: intent.voiceId, generation: intent.generation, executionEpoch, reason }); armExpiry(); } },
            { name: 'choke-ownership', run: () => {
              if (!disposed && region.chokeGroup && context.currentTime < voice.start && preview._ownerReady(owner)) rebuildChokes(region.chokeGroup, region.chokeScope);
            } }
          ]);
        } };
      voice.rateAutomation = createSmoothedAudioParameter({ param: voice.main.source.playbackRate, initialValue: rate, startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      voice.pressureAutomation = createSmoothedAudioParameter({ param: pressureGain.gain, initialValue: expression.pressure01 ?? 1, startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      if (pan) voice.panAutomation = createSmoothedAudioParameter({ param: pan.pan, initialValue: clamp((expression.pan01 ?? values.pan01) + prepared.mix.pan01, -1, 1), startTime: start, smoothingSeconds, maxEvents: maxControlEvents });
      if (voice.child) { voice.child.source.playbackRate.setValueAtTime(childRate, start); voice.child.gain.gain.setValueAtTime(0, start); }
      voice.requestRelease = (at, force = false, reason = 'semantic-end', velocity = 1) => releaseVoice(voice, at, force, reason, velocity);
      for (const component of components) watchSourceEnd(voice, component);
      preview._voices.add(voice); voices.set(identity, voice); preview._semanticVoiceOwners.set(sharedIdentity, voice);
      const main = voice.main, offset = region.onsetFrame / main.pin.ref.sourceSampleRate;
      if (region.loop) main.source.start(start, offset); else main.source.start(start, offset, (region.endFrame - region.onsetFrame) / main.pin.ref.sourceSampleRate);
      main.started = true; scheduleHeldEnvelope(voice, hardEnd); armExpiry();
      if (region.chokeGroup) rebuildChokes(region.chokeGroup, region.chokeScope);
      return trace({ status: 'accepted', stage: 'scheduled', voiceId: intent.voiceId, generation: intent.generation, executionEpoch, targetFrame,
        assetHash: region.assetHash, selectionSeed: region.selectionSeed, region, rateRatio: rate, renderCost, patchId: prepared.id, patchRevision: prepared.revision,
        articulation: sampleRegionArticulation(region, main.pin.ref.sourceSampleRate, rate, values.releaseSeconds) });
    } catch (error) {
      errors++;
      if (voice && preview._voices.has(voice)) preview._destroyVoice(voice, 'sample-construction-failure');
      else {
        let native;
        const construction = createProcgenRetirementScope();
        const receipt = construction.retire([
          { name: 'native-sources', run: () => { native = createProcgenRetirementScope().retire([
            ...components.map((component, index) => ({ name: 'source-' + index, run: () => retireComponent(component) })),
            { name: 'lane-mix', run: () => laneMix?.dispose() }, { name: 'pressure-gain', run: () => pressureGain?.disconnect() }, { name: 'pan', run: () => pan?.disconnect() }
          ]); return native; } },
          ...allocations.map((allocation, index) => ({ name: 'allocation-' + index, run: () => releaseAudioResourceAfterRetirement(allocation, native) }))
        ]);
        if (receipt.outcome !== 'complete') {
          const retained = { id: voice?.id ?? ++preview._voiceSequence, owner, nativeContext: context, retirement: construction, components,
            onContextClosed: () => reconcileComponents(components) };
          preview._retiredVoices?.set(retained.id, retained); preview._retirementFaults?.add(owner);
        }
      }
      return reject(error.name === 'ResourceBudgetError' ? 'audio-resource-budget' : error.message || 'sample-construction-failure', intent.voiceId);
    }
  };
  const scheduleReleaseChild = (voice, at, velocity) => {
    if (voice.child.completed) return;
    const child = voice.child, selected = child.region,
      ratio = voice.rateAutomation.valueAt(at) * 2 ** ((voice.region.rootCents - selected.rootCents + selected.tuningCents - voice.region.tuningCents) / 1200);
    const duration = (selected.endFrame - selected.onsetFrame) / child.pin.ref.sourceSampleRate;
    const childEnd = Math.min(voice.hardEnd, at + duration / ratio, at + 4), peak = velocity * selected.gain01 * voice.patchGain,
      attackEnd = at + Math.min(0.005, (childEnd - at) / 3), releaseStart = Math.max(attackEnd, childEnd - 0.005);
    const from = Math.max(at, preview._context.currentTime);
    if (child.started && child.envelope?.at !== at && child.envelope?.at > preview._context.currentTime) {
      child.source.onended = null; child.source.stop(preview._context.currentTime); child.source.disconnect(); child.source.buffer = null;
      child.started = false; child.ended = false;
      child.source = preview._context.createBufferSource(); child.source.buffer = child.pin.buffer; child.source.connect(child.gain);
      if (selected.loop) { child.source.loop = true; child.source.loopStart = selected.loop.startFrame / child.pin.ref.sourceSampleRate; child.source.loopEnd = selected.loop.endFrame / child.pin.ref.sourceSampleRate; }
      watchSourceEnd(voice, child);
    }
    child.source.playbackRate.setValueAtTime(ratio, from);
    truncateNativeEnvelope({ gain: child.gain, start: at, attack: attackEnd - at, decay: 0, sustain: 1, peak,
      released: true, releaseAt: releaseStart, releaseLevel: peak, end: childEnd }, from);
    if (attackEnd > from) child.gain.gain.linearRampToValueAtTime(peak, attackEnd);
    if (releaseStart > from) child.gain.gain.setValueAtTime(peak, releaseStart);
    child.gain.gain.linearRampToValueAtTime(0, Math.max(from, childEnd));
    if (!child.started) { child.source.start(at, selected.onsetFrame / child.pin.ref.sourceSampleRate, duration); child.started = true; }
    child.source.stop(Math.max(from, childEnd)); child.envelope = { at, attackEnd, releaseStart, end: childEnd, peak };
    voice.end = Math.max(voice.mainReleaseEnd, childEnd);
  };
  const releaseVoice = (voice, requested, force, reason, velocity = 1, restoring = false) => {
    if (!preview._voices.has(voice)) return;
    const context = preview._context, at = restoring ? requested : Math.max(requested, context.currentTime);
    if (voice.released && !force && at >= voice.releaseAt) return;
    if (at < voice.start || force && reason !== 'sample-choke' && voice.start > context.currentTime && at <= voice.start) { preview._destroyVoice(voice, 'sample-cancel-before-onset'); return; }
    if (at >= voice.hardEnd || force && voice.released && at >= voice.end) return;
    const beforeOnsetChoke = force && reason === 'sample-choke' && at <= voice.start;
    const until = Math.min(voice.hardEnd, force ? voice.end : Infinity, at + (beforeOnsetChoke ? 0 : force ? 0.005 : voice.release)), gain = voice.gain.gain;
    let level = 0;
    if (restoring && at < context.currentTime) {
      level = nativeHeldEnvelopeLevel(voice, at); voice.releaseLevel = level; voice.releaseAt = at; voice.released = true;
      truncateNativeEnvelope(voice, context.currentTime, until);
    } else if (beforeOnsetChoke) { gain.cancelScheduledValues(at); gain.setValueAtTime(0, at); }
    else level = truncateNativeEnvelope(voice, at, voice.mainReleaseEnd ?? voice.end);
    voice.releaseLevel = level; gain.linearRampToValueAtTime(0, Math.max(at, until, context.currentTime));
    if (!voice.main.ended) voice.main.source.stop(Math.max(at, until, context.currentTime));
    voice.released = true; voice.releaseAt = at; voice.end = Math.max(at, until); voice.mainReleaseEnd = voice.end;
    voice.releaseVelocity = velocity; voice.stolen = force; voice.terminationCause = reason;
    if (voice.child && !force && at < voice.hardEnd) {
      scheduleReleaseChild(voice, at, velocity);
    } else if (voice.child) {
      const child = voice.child, envelope = child.envelope;
      if (child.started && !child.ended) {
        const childLevel = !envelope || at < envelope.at || at >= envelope.end ? 0 : at < envelope.attackEnd ? envelope.peak * (at - envelope.at) / (envelope.attackEnd - envelope.at) :
          at < envelope.releaseStart ? envelope.peak : envelope.peak * (envelope.end - at) / Math.max(1e-9, envelope.end - envelope.releaseStart);
        child.gain.gain.cancelScheduledValues(at);
        if (envelope && at > envelope.at && (at <= envelope.attackEnd || at >= envelope.releaseStart)) child.gain.gain.linearRampToValueAtTime(childLevel, at);
        else child.gain.gain.setValueAtTime(childLevel, at);
        child.gain.gain.linearRampToValueAtTime(0, until);
        child.source.stop(childLevel === 0 ? at : until); if (childLevel === 0) child.ended = true;
      } else child.ended = true;
    }
    if (voice.components.every(component => component.ended) && at <= context.currentTime) preview._destroyVoice(voice, reason);
    armExpiry(); preview._observe('synth-release', { ...voice.captureMeta, voiceId: voice.id, audioTime: at, endAudioTime: voice.end, reason });
  };
  const restoreTerminal = (voice, now, next = null) => {
    const terminal = voice.semanticRelease;
    const forced = next && (!voice.forcedRelease || next.start < voice.forcedRelease.at) ? { at: next.start, reason: 'sample-choke', velocity: 1 } : voice.forcedRelease;
    voice.released = false; voice.stolen = false; voice.releaseLevel = null;
    if (voice.child) voice.child.ended = !!voice.child.completed;
    if (!terminal || terminal.at >= now) scheduleHeldEnvelope(voice, voice.hardEnd);
    if (terminal) { voice.release = terminal.seconds; releaseVoice(voice, terminal.at, false, 'semantic-end', terminal.velocity, true); }
    if (forced && forced.at < voice.end) releaseVoice(voice, forced.at, true, forced.reason, forced.velocity, true);
  };
  const rebuildChokes = (group, scope) => {
    if (rebuildingChokes) return;
    rebuildingChokes = true;
    try {
      const now = preview._context.currentTime;
      const members = [...voices.values()].filter(voice => voice.region.chokeGroup === group && voice.region.chokeScope === scope);
      for (const voice of members) {
        if (!preview._voices.has(voice) || voice.stolen && voice.releaseAt <= now) continue;
        const next = members.filter(candidate => candidate !== voice && preview._voices.has(candidate) && (candidate.start > voice.start ||
          candidate.start === voice.start && candidate.playback.voiceId > voice.playback.voiceId))
          .sort((a, b) => a.start - b.start || (a.playback.voiceId < b.playback.voiceId ? 1 : a.playback.voiceId > b.playback.voiceId ? -1 : 0))[0];
        restoreTerminal(voice, now, next);
      }
    } finally { rebuildingChokes = false; armExpiry(); }
  };
  const update = (voiceId, expression, targetFrame, executionEpoch = 'live', rampSeconds = smoothingSeconds) => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), time = timeFor(targetFrame), context = preview._context, now = context?.currentTime;
    if (!voice || voice.released && voice.releaseAt <= now || voice.semanticRelease?.at <= now || !preview._ownerReady(owner)) return reject('voice-not-active', voiceId);
    if (!finite(rampSeconds, 0, 60)) return reject('invalid-control-ramp', voiceId);
    if (!validExpression(expression) || time == null || time < now - 1 / context.sampleRate || time < voice.start || time >= Math.min(voice.releaseAt, voice.semanticRelease?.at ?? Infinity)) return reject('invalid-or-stale-expression', voiceId);
    const ratio = expression.pitchOffsetCents == null ? null : rateFor(voice.region, voice.pitch, expression.pitchOffsetCents);
    if (expression.pitchOffsetCents != null && (ratio == null || voice.region.releaseRegion && rateFor(voice.region.releaseRegion, voice.pitch, expression.pitchOffsetCents) == null)) return reject('sample-pitch-out-of-range', voiceId);
    if (expression.pan01 != null && !voice.pan) return reject('pan-unavailable', voiceId);
    const changes = [[voice.rateAutomation, ratio], [voice.pressureAutomation, expression.pressure01],
      [voice.panAutomation, expression.pan01 == null ? null : clamp(expression.pan01 + voice.mixPan, -1, 1)]];
    if (changes.some(([automation, value]) => value != null && !automation.canInsert(now))) return reject('expression-queue-full', voiceId);
    try {
      for (const [automation, value] of changes) if (value != null && !automation.insert(value, Math.max(time, now), now, Math.max(smoothingSeconds, rampSeconds))) throw new Error('Expression automation refused admission.');
      if (ratio != null && voice.child && voice.semanticRelease?.at > now) {
        if (voice.region.chokeGroup) rebuildChokes(voice.region.chokeGroup, voice.region.chokeScope);
        else restoreTerminal(voice, now);
      }
      armExpiry();
    }
    catch { errors++; preview._destroyVoice(voice, 'sample-update-failure'); return reject('sample-update-failure', voiceId); }
    return trace({ status: 'accepted', stage: 'scheduled', voiceId, executionEpoch, targetFrame, smoothingFrames: Math.ceil(Math.max(smoothingSeconds, rampSeconds) * context.sampleRate) });
  };
  const updateLaneMix = (voiceId, mix, frame, epoch = 'live', laneId = undefined) => {
    const voice = voices.get(keyFor(epoch, voiceId));
    return voice?.laneMix?.update(mix, frame, laneId) || Object.freeze({ status: 'rejected', reason: 'voice-not-active' });
  };
  const end = (voiceId, release, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), time = timeFor(targetFrame);
    if (!voice) return reject('voice-not-active', voiceId);
    if (time == null || release != null && (!plain(release) || !finite(release.seconds, 0, 4) ||
        release.velocity01 != null && !finite(release.velocity01, 0, 1) || release.force != null && typeof release.force !== 'boolean' || release.mode != null && release.mode !== 'one-shot' ||
        release.mode === 'one-shot' && !finite(release.tailSeconds, 0, 4))) return reject('invalid-release', voiceId);
    const at = release?.mode === 'one-shot' ? Math.max(time, voice.start + release.tailSeconds) : time;
    const now = preview._context.currentTime, target = Math.max(at, now), prior = release?.force === true ? voice.forcedRelease : voice.semanticRelease;
    if (prior && target >= prior.at || voice.stolen && voice.releaseAt <= now) return trace({ status: 'accepted', stage: 'scheduled', voiceId, reason: 'already-releasing' });
    if (release?.force === true) voice.forcedRelease = { at: target, velocity: release.velocity01 ?? 1, reason: 'owned-cleanup' };
    else { if (release) voice.release = release.seconds; voice.semanticRelease = { at: target, seconds: voice.release, velocity: release?.velocity01 ?? 1 }; }
    try {
      if (voice.region.chokeGroup) rebuildChokes(voice.region.chokeGroup, voice.region.chokeScope);
      else restoreTerminal(voice, now);
    }
    catch { errors++; preview._destroyVoice(voice, 'sample-release-failure'); return reject('sample-release-failure', voiceId); }
    return trace({ status: 'accepted', stage: 'scheduled', voiceId, targetFrame, executionEpoch, endFrame: Math.ceil(voice.end * preview._context.sampleRate),
      repair: time < preview._context.currentTime ? 'late-release' : null });
  };
  const cancelGenerationWithReceipt = (generation, executionEpoch = 'live') => {
    if (!integer(generation, 0, Number.MAX_SAFE_INTEGER) || !text(executionEpoch)) return reject('invalid-generation');
    const key = generationKey(generation, executionEpoch), frontierFrame = preview._context ? Math.ceil(preview._context.currentTime * preview._context.sampleRate) : null;
    if (!isManagedExecutionEpoch(executionEpoch) && !cancelled.has(key)) { if (cancelled.size < 1024) cancelled.add(key); else cancellationHistoryFull = true; }
    const outcomes = [];
    const selected = [...voices.values()].filter(voice => voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch);
    const retirement = createProcgenRetirementScope().retire(selected.map(voice => ({ name: 'voice-' + voice.id, run: () => {
      const beforeOnset = voice.start > (preview._context?.currentTime ?? 0);
      try {
        const result = preview._destroyVoice(voice, beforeOnset ? 'generation-cancel-before-onset' : 'generation-cancel');
        outcomes.push(trace({ status: result?.outcome === 'partial' ? 'rejected' : 'accepted', stage: 'scheduled-cancellation-requested', voiceId: voice.playback.voiceId,
          generation, executionEpoch, beforeOnset, frontierFrame, appliedFrame: null, renderedStatus: 'unknown', acousticReceipt: false }));
        return result;
      } catch (error) {
        outcomes.push(trace({ status: 'rejected', reason: 'voice-cancellation-failed', voiceId: voice.playback.voiceId, generation, executionEpoch,
          frontierFrame, appliedFrame: null, renderedStatus: 'unknown', acousticReceipt: false })); throw error;
      }
    } })));
    leases.delete(key); return Object.freeze({ generation, executionEpoch, frontierFrame, count: outcomes.filter(outcome => outcome.status === 'accepted').length,
      requestedCount: selected.length, outcomes: Object.freeze(outcomes), retirement });
  };
  const renderDiagnostics = ({ includeVoices = false, includeTraces = false } = {}) => Object.freeze({
    readiness: disposed ? 'disposed' : !prepared ? 'patch-unprepared' : !preview._ownerReady(owner) ? 'audio-not-ready' : 'ready',
    engineId: 'native-sample', engineVersion: 1, capabilities, gateMode, clockMode, smoothingSeconds, sampleMap: prepared?.mapResolver ? { mapId: prepared.mapResolver.map.mapId, revision: prepared.mapResolver.map.revision, zones: prepared.mapResolver.map.zones.length } : null, activeVoices: voices.size,
    reservedSources: [...voices.values()].reduce((sum, voice) => sum + voice.renderCost, 0), patchId: prepared?.id ?? null, patchRevision: prepared?.revision ?? null,
    deliveryErrors: errors, cancelledGenerations: cancelled.size, cancellationHistoryFull, pendingPreparations, maximumPendingPreparations: 2,
    preparedResourceRetirement: retirementSummary(preparationFault), evidenceClass: 'native-scheduling-api', appliedFrame: null, acousticReceipt: false,
    ...(includeTraces ? { traces: Object.freeze([...traces]) } : {}),
    ...(includeVoices ? { voices: Object.freeze([...voices.values()].map(voice => Object.freeze({ voiceId: voice.playback.voiceId,
      onsetId: voice.playback.onsetId ?? null, actorId: voice.playback.actorId ?? null, owner, generation: voice.semanticGeneration, executionEpoch: voice.semanticEpoch,
      assetHash: voice.region.assetHash, region: voice.region, selectedSeed: voice.region.selectionSeed, rootCents: voice.region.rootCents,
      sourceSampleRate: voice.main.pin.ref.sourceSampleRate, decodedSampleRate: voice.main.pin.variant.targetSampleRate, decodedFrames: voice.main.pin.buffer.length,
      rateRatio: voice.rateAutomation.valueAt(preview._context.currentTime), rateEvidence: 'modeled-native-k-rate', playheadFrame: null,
      state: voice.end <= preview._context.currentTime ? 'ended' : preview._context.currentTime < voice.start ? 'scheduled' : voice.releaseAt <= preview._context.currentTime ? 'release' : 'held',
      targetFrame: Math.round(voice.start * preview._context.sampleRate), endFrame: Math.ceil(voice.end * preview._context.sampleRate), renderCost: voice.renderCost }))) } : {}) });
  const onOwnerStop = () => { revision++; leases.clear(); if (expiryTimer != null) clearTimeout(expiryTimer); expiryTimer = null; };
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt();
    return retirement.retire([
      { name: 'admission', run: () => { disposed = true; } }, { name: 'owner-stop', run: onOwnerStop },
      ...[...voices.values()].map(voice => ({ name: `voice-${voice.id}`, run: () => preview._destroyVoice(voice, 'sample-backend-disposed') })),
      { name: 'prepared-samples', run: () => releasePrepared(prepared) },
      ...[...retiredPrepared].map((value, index) => ({ name: 'retired-prepared-samples-' + index, run: () => value.retirement })),
      { name: 'patch', run: () => { prepared = null; } }
    ]);
  };
  return createInstrumentExecutionLifecycle({ capabilities, prepare, begin, update, updateLaneMix, end, renewExecutionLease, cancelGenerationWithReceipt,
    cancelGeneration: (generation, executionEpoch = 'live') => cancelGenerationWithReceipt(generation, executionEpoch).count || 0,
    renderDiagnostics, onOwnerStop, dispose }, {
    getContext: () => preview.getAudioContext(), getGeneration: () => preview._sessions.get(owner)?.generation ?? preview._generation,
    isSettled: epoch => !preview._retirementFaults?.has(owner) && ![...voices.values()].some(voice => voice.semanticEpoch === epoch),
    isVoiceSettled: (voiceId, epoch) => !preview._retirementFaults?.has(owner) && !voices.has(keyFor(epoch, voiceId)),
    forget: (epoch, generation) => leases.delete(generationKey(generation, epoch))
  }).api;
}
