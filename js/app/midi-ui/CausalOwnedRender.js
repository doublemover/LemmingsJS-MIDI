import { planSampleTraversal, sampleTraversalBeginFields } from '../../midi/content/SampleTraversal.js';
import { acceptsSampleCursorSegment } from '../../midi/content/SampleCursorProfile.js';
import { prepareSeedLayerPlan } from './SeedLayerPlan.js';
import { prepareOwnedSamplePlan } from './OwnedSamplePlan.js';
import { verifyOwnedPcmSetPayload } from '../resources/OwnedPcmSetVerification.js';
import { createCausalRenderLaneResolver } from '../procgen/workstation/CausalLaneRouting.js';
import { prepareCapturedEffectReplay, createCapturedEffectReplayDriver } from './CapturedEffectReplay.js';
import { prepareEffectSourceBindings, createEffectSourceSampler, effectVoiceStemMask } from './EffectSourceBindings.js';
import { prepareNativeSamplePlan, sampleRegionRate, nativeSampleReleaseFrames } from './NativeSamplePlan.js';
import { getNativeOfflineProfile, NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineProfile.js';
import { RECEIPT_WIDTH, BEGIN, UPDATE, END, MIX, PANIC, APPLIED, REJECTED, FAULTED, CANCELLED } from './worklet/OwnedSineProcessor.js';
import { LIVE_LANE_ID_LIMIT } from './OwnedSourceLayout.js';
import { verifyOwnedPcmPayload } from '../resources/OwnedPcmVerification.js';
import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
import { ownedSourceSeed } from './OwnedSourceSeed.js';
import { compileInstrumentPerformance, retainInstrumentCause, validateInstrumentControls } from '../../midi/content/InstrumentPerformance.js';
import { createOwnedControlKernel } from '../resources/OwnedControlKernel.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { createCausalRenderTiming } from './CausalRenderTiming.js';
import { resolveOwnedArticulationPolicy } from './OwnedArticulationPolicy.js';
import { createOwnedEffectGraphKernel } from './OwnedEffectGraphKernel.js';
import { prepareEffectRenderPlan } from './EffectRenderPlan.js';
import { effectGraphHash } from '../../midi/content/EffectGraphRevision.js';

const MAX_SECONDS = 120, MAX_INTENTS = 32768, MAX_OUTPUT_BYTES = 64 * 1048576;
const failure = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'CausalRenderError', code, ...detail });
const text = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integerPcmBytes = value => Number.isSafeInteger(value) && value > 0 && value <= 16 * 1048576;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = intent => JSON.stringify([intent.worldId ?? null, intent.generation, intent.voiceId]);
const expressionFor = expression => {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression) || Object.keys(expression).some(key => !['pressure01', 'pitchOffsetCents', 'pan01'].includes(key)) ||
      expression.pressure01 != null && !finite(expression.pressure01, 0, 1) || expression.pitchOffsetCents != null && !finite(expression.pitchOffsetCents, -24000, 24000) ||
      expression.pan01 != null && !finite(expression.pan01, -1, 1)) throw failure('unsupported-expression', 'This owned realization supports only captured pitch offset, pressure and pan.');
  return expression;
};
const frequencyFor = (pitch, offset, rate, sample = false) => {
  if (!finite(pitch?.cents, -24000, 24000) || !finite(pitch?.referenceHz ?? 440, 0.1, 20000)) throw failure('invalid-pitch', 'Captured onset pitch is unavailable.');
  const frequency = (pitch.referenceHz ?? 440) * 2 ** ((pitch.cents - 6900 + offset) / 1200);
  if (!finite(frequency, sample ? 0 : 0.1, sample ? Infinity : rate / 2 - 1)) throw failure('unsupported-pitch', 'Captured pitch exceeds this renderer at the selected sample rate.'); return frequency;
};
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const ascii = (view, at, value) => { for (let index = 0; index < value.length; index++) view.setUint8(at + index, value.charCodeAt(index)); };
export const encodeCausalRenderWave = (pcm, frames, rate, manifest) => {
  const metadata = canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes, padded = metadata.length + metadata.length % 2;
  const length = 64 + pcm.byteLength + padded;
  if (!natural(length) || length - 8 > 0xffffffff || pcm.byteLength !== frames * 8) throw failure('wav-capacity', 'This render exceeds the classic stereo RIFF limit.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF'); view.setUint32(4, length - 8, true); ascii(view, 8, 'WAVE'); ascii(view, 12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  ascii(view, 36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, frames, true); ascii(view, 48, 'data'); view.setUint32(52, pcm.length, true); bytes.set(pcm, 56);
  const at = 56 + pcm.length; ascii(view, at, 'lmjs'); view.setUint32(at + 4, metadata.length, true); bytes.set(metadata, at + 8); return bytes;
};

export async function planCausalSourceRender({ revoice, definition, descriptor, sampleRate = 48000, startSeconds = 0, endSeconds,
  targetControls = {}, tail = { mode: 'exact-crop' }, stemLaneIds = [], effectGraph = null, effectReturnNodeIds = [], capturedEffects = false, effectReplayHash = null, applicationBuildId = null, pcm = null, nativeAssets = null, signal = null, yieldControl, maxPlanningBytes = 128 * 1048576 } = {}, { nativeConvolution = false, nativeOwnedProcessors = false } = {}) {
  if (typeof capturedEffects !== 'boolean' || capturedEffects && (!effectGraph || !hash(effectReplayHash) || NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor?.engineId)) || !capturedEffects && effectReplayHash != null) throw failure('effect-command-render-profile', 'Captured effect commands require their bound owned-source graph and replay hash.');
  if (effectGraph != null && (!effectGraph || Object.getPrototypeOf(effectGraph) !== Object.prototype)) throw failure('effect-render-preflight', 'Effect rendering requires an explicit declarative graph.');
  if (revoice?.operation !== 'sound-only-revoice' || revoice.version !== 1 || !text(revoice.takeId, 256) || !hash(revoice.sourceCanonicalHash) ||
      !natural(revoice.takeRevision) || revoice.takeRevision < 1 || !['finalized', 'partial'].includes(revoice.sourceState) || revoice.nextSequence != null ||
      revoice.coverage?.status !== 'known-covered' || !Array.isArray(revoice.intents) || revoice.intents.length > MAX_INTENTS ||
      revoice.boundary?.status !== 'captured-initial-state' || !Array.isArray(revoice.boundary.state?.voices) || revoice.boundary.state.voices.length ||
      !finite(revoice.boundary.state.sourceTimeMs, 0, Number.MAX_SAFE_INTEGER) || !finite(revoice.finalBoundaryState?.sourceTimeMs, revoice.boundary.state.sourceTimeMs, Number.MAX_SAFE_INTEGER))
    throw failure('source-preflight', 'Rendering requires a finalized, covered intent history with an exact capture clock and an empty initial voice boundary. Missing held ancestry needs reconstruction.');
  if (![44100, 48000, 96000].includes(sampleRate) || ![...OWNED_SOURCE_IDS, ...NATIVE_OFFLINE_SOURCE_IDS].includes(descriptor?.engineId) || !(NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor.engineId) ? getNativeOfflineProfile(descriptor.engineId) : getOwnedSourceProfile(descriptor.engineId)).controlReferenceRender || descriptor.engineVersion !== 1 || !hash(descriptor.artifactHash) ||
      applicationBuildId != null && !hash(applicationBuildId) || !finite(startSeconds, 0, MAX_SECONDS) || !finite(endSeconds, startSeconds, MAX_SECONDS) || endSeconds <= startSeconds ||
      !tail || !['exact-crop', 'bounded-natural', 'boundary-release'].includes(tail.mode) || Object.keys(tail).some(key => !['mode', 'maxSeconds'].includes(key)) ||
      !finite(tail.maxSeconds ?? 4, 0, effectGraph ? 30 : 4) || !Array.isArray(stemLaneIds) || stemLaneIds.length > (NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor?.engineId) ? 15 : 16) || stemLaneIds.some(id => !text(id, 128)) || new Set(stemLaneIds).size !== stemLaneIds.length)
    throw failure('render-preflight', 'Choose a bounded owned-source render, supported sample rate, range, tail policy and the source-specific captured lane stem limit.');
  const admittedTargetControls = validateInstrumentControls(targetControls);
  const owned = NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor.engineId) ? getNativeOfflineProfile(descriptor.engineId) : getOwnedSourceProfile(descriptor.engineId), patch = validateInstrumentPatchV2(definition, descriptor);
  if (!Array.isArray(effectReturnNodeIds) || !effectGraph && effectReturnNodeIds.length) throw failure('effect-render-preflight', 'Shared effect taps require an explicit graph realization.');
  const effectPlan = effectGraph ? prepareEffectRenderPlan(effectGraph, sampleRate, effectReturnNodeIds, { nativeConvolution: nativeConvolution || NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor.engineId), nativeOwnedProcessors: nativeOwnedProcessors || NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor.engineId) }) : null;
  effectReturnNodeIds = Object.freeze([...effectReturnNodeIds]);
  if ((owned.requiresNativeAssets ? patch.sampleRefs.length < 1 || patch.sampleRefs.length > 32 : owned.requiresPCMSet ? patch.sampleRefs.length < 1 || patch.sampleRefs.length > 32 : owned.requiresPCM ? patch.sampleRefs.length !== 1 : patch.sampleRefs.length !== 0) || patch.modulations.length || !owned.extended && (patch.macros.length || patch.causalBindings.length || patch.variation) || patch.voicePolicy.steal !== 'reject' || patch.voicePolicy.maxVoices > owned.voices)
    throw failure('unsupported-patch', 'This render requires a realized owned source with complete material and reject admission.');
  const pcmBytesEstimate = owned.requiresPCM && integerPcmBytes(pcm?.descriptor?.bytes) ? pcm.descriptor.bytes : 0;
  const planningBytes = (capturedEffects ? (revoice.effectEvents?.length || 0) * 2048 + 262144 : 0) + revoice.intents.length * Math.max(owned.requiresPCMSet ? 4096 : 1024, Object.keys(owned.fields).length * 256) + pcmBytesEstimate * 3 + (owned.requiresNativeAssets ? 1048576 : 0);
  if (!natural(maxPlanningBytes) || planningBytes > maxPlanningBytes) throw failure('render-memory-capacity', 'Source control and voice histories exceed their admitted planning workspace.');
  const sourcePCM = owned.requiresPCM ? await (owned.requiresPCMSet ? verifyOwnedPcmSetPayload : verifyOwnedPcmPayload)(pcm, owned.requiresPCMSet ? patch.sampleRefs : patch.sampleRefs[0], { signal, yieldControl }) : null;
  if (!owned.requiresPCM && pcm != null) throw failure('unsupported-patch', 'This target does not consume PCM material.');
  const pcmDescriptor = sourcePCM?.descriptor || null;
  if (!owned.requiresNativeAssets && nativeAssets != null) throw failure('unsupported-patch', 'This target does not consume native sample pins.');
  let selectSample = null, sampleSourcePlan = null;
  if (owned.requiresNativeAssets) { try { selectSample = prepareNativeSamplePlan(patch, nativeAssets); } catch (error) { throw failure('sample-material-preflight', error.message); } }
  const seedLayerPlan = owned.id === 'worklet-seed-layers' ? prepareSeedLayerPlan(patch, pcmDescriptor, sampleRate) : null;
  if (owned.id === 'worklet-sample') {
    sampleSourcePlan = prepareOwnedSamplePlan(patch, pcmDescriptor, sampleRate);
    selectSample = intent => { const selected = sampleSourcePlan.select(intent), entry = sampleSourcePlan.entries[selected.zoneIndex];
      if (entry.attack.mode === 'positionDriven' && !entry.attack.traversal) throw failure('sample-position-render-unavailable', 'Position-driven causal rendering requires a complete recorded travel binding, not inferred cursor motion.');
      return { ...selected, minimumRateRatio: selected.rateRatio, sourceSampleRate: entry.attack.sourceSampleRate, childSourceRate: entry.release?.sourceSampleRate ?? null }; };
  }
  if (!owned.extended && (Object.keys(admittedTargetControls.macros).length || admittedTargetControls.variationAmount01 != null || admittedTargetControls.variationSeed != null)) throw failure('unsupported-performance-controls', 'Unsupported performer controls for this source.');
  const parameters = Object.fromEntries(Object.entries(owned.fields).map(([key, spec]) => [key, patch.parameters[key] ?? spec[2]]));
  if (parameters.sourceMode === 2 && parameters.circularControlMode === 2 && (!Number.isSafeInteger(revoice.sourceVersions?.physicalMusic) || revoice.sourceVersions.physicalMusic < 11)) throw failure('circular-route-capture-unavailable', 'This take predates canonical directed-route coordinate capture.');
  const performancePlan = owned.extended ? compileInstrumentPerformance(patch, owned.parameters) : null;
  const articulation = resolveOwnedArticulationPolicy({ ...patch, parameters });
  const sourceControls = { mode: 'explicit-new-target-controls-and-identity-variation', targetControls: admittedTargetControls, observedPhysicalUpdates: 0, appliedPhysicalUpdates: 0, missingOnsetBindings: 0, minimumHoldSeconds: null, maximumHoldSeconds: null, observedKinds: new Set() };
  const sourceOriginMs = revoice.boundary.state.sourceTimeMs, sourceEndSeconds = (revoice.finalBoundaryState.sourceTimeMs - sourceOriginMs) / 1000;
  const timing = createCausalRenderTiming(revoice, sampleRate);
  if (endSeconds > sourceEndSeconds + 0.5 / sampleRate) throw failure('uncovered-range', 'The requested render extends beyond the captured source-clock boundary.');
  const firstFrame = Math.round(startSeconds * sampleRate), endFrame = Math.round(endSeconds * sampleRate), releaseFrames = Math.max(1, Math.round(parameters.releaseSeconds * sampleRate));
  const effectReplay = capturedEffects ? await prepareCapturedEffectReplay(revoice, sampleRate, endFrame) : null;
  if (effectReplay && (effectReplay.hash !== effectReplayHash || effectReplay.graphHash !== await effectGraphHash(effectPlan))) throw failure('effect-replay-preflight-identity', 'The captured effect command plan differs from the requested source and graph.');
  if (endFrame <= firstFrame) throw failure('empty-range', 'The selected range contains no output frames.');
  const resolveSourceLane = createCausalRenderLaneResolver(revoice);
  const sourceIds = new Set(), voices = new Map(), events = [], lanes = new Set(), bodyVoices = new Map(), bodySourceIds = new Set(effectReplay?.bodySourceIntentIds || []); let lastSourceMs = -Infinity, ordinal = 0, capturedBegins = 0, capturedUpdates = 0, capturedEnds = 0, derivedLaneTransfers = 0;
  for (const intent of revoice.intents) {
    if (intent?.version !== 1 || !['begin', 'update', 'end'].includes(intent.kind) || !text(intent.intentId) || !text(intent.voiceId) ||
        !natural(intent.generation) || !Array.isArray(intent.sourceEventIds) || intent.sourceEventIds.length > 8192 || intent.sourceEventIds.some(id => !text(id)) ||
        sourceIds.has(intent.intentId) || !finite(intent.scoreTime?.sourceTimeMs, sourceOriginMs, revoice.finalBoundaryState.sourceTimeMs) || intent.scoreTime.sourceTimeMs < lastSourceMs ||
        !finite(intent.scoreTime.subTick ?? 0, 0, 1) || (intent.scoreTime.subTick ?? 0) >= 1)
      throw failure('invalid-intent-history', 'Captured intent identity, ordering or source time is invalid.', { intentId: intent?.intentId ?? null });
    sourceIds.add(intent.intentId); lastSourceMs = intent.scoreTime.sourceTimeMs;
    const frame = timing.frameFor(intent), order = ++ordinal;
    if (frame >= endFrame) continue;
    const key = identity(intent), expression = expressionFor(intent.expression || {}); let voice = voices.get(key);
    if (effectReplay && intent.route === 'prepared-body') {
      const body = bodyVoices.get(key);
      if (intent.kind === 'begin') { if (body || !bodySourceIds.has(intent.intentId)) throw failure('body-source-history-unavailable', 'Captured body rendering requires the acknowledged finite strike for every original body source.'); bodyVoices.set(key, { ended: false }); lanes.add(resolveSourceLane(intent, ordinal - 1)); capturedBegins++; }
      else { if (!body || body.ended) throw failure('missing-body-source-history', 'A body source update or end lacks its original semantic onset.'); if (intent.kind === 'end') { body.ended = true; capturedEnds++; } else { if (Object.keys(expression).length) throw failure('body-source-expression-unavailable', 'Finite fixed-body sources have no continuous note-expression realization.'); capturedUpdates++; } }
      continue;
    }
    if (intent.kind === 'begin') {
      if (voice || !finite(intent.velocity01, 0, 1) || intent.laneId != null && !(natural(intent.laneId) || text(intent.laneId, 128)))
        throw failure('invalid-voice-history', 'Captured voice onsets are repeated or malformed.', { intentId: intent.intentId });
      const laneId = resolveSourceLane(intent, ordinal - 1); lanes.add(laneId);
      let initialCause = null;
      try { initialCause = intent.performanceCause ? retainInstrumentCause(intent.performanceCause) : null; } catch { throw failure('invalid-physical-control', 'Captured onset physical evidence is malformed.'); }
      const performance = performancePlan?.resolve(admittedTargetControls, frame, { ...intent, performanceCause: initialCause });
      const values = performance?.values || parameters;
      if (!owned.acceptsParameters(values)) throw failure('unsupported-source-layout', 'New target controls request an unrealized source layout.');
      const frequency = frequencyFor(intent.pitch, expression.pitchOffsetCents ?? 0, sampleRate, !!selectSample);
      if (Math.abs(expression.pitchOffsetCents ?? 0) > owned.bendCents || !finite(frequency, owned.minHz, Math.min(owned.maxHz ?? Infinity, selectSample ? Infinity : sampleRate / 2 - 1)) || !owned.acceptsOnset(values, frequency, pcmDescriptor, sampleRate) || seedLayerPlan && !seedLayerPlan.acceptsOnset(frequency))
        throw failure('unsupported-pitch', 'Captured onset exceeds this source profile.', { intentId: intent.intentId, engineId: owned.id, minimumHz: owned.minHz, maximumHz: owned.maxHz });
      let samplePlan = null;
      if (selectSample) { try { samplePlan = selectSample(intent); } catch (error) { throw failure('sample-onset-preflight', error.message, { intentId: intent.intentId }); } }
      let circularTravel = null;
      if (owned.travelPlanner) { try { circularTravel = owned.travelPlanner(values, intent, frame, sampleRate); } catch (error) { throw failure(owned.travelDomain + '-travel-preflight', error.message, { intentId: intent.intentId }); } }
      let traversal = null;
      if (sampleSourcePlan && samplePlan) { const entry = sampleSourcePlan.entries[samplePlan.zoneIndex].attack;
        if (entry.mode === 'positionDriven') { try { traversal = planSampleTraversal(entry, intent, frame, sampleRate); } catch (error) { throw failure('sample-travel-preflight', error.message, { intentId: intent.intentId }); } }
      }
      let nativeSourcePlan = null;
      if (owned.planOnset) {
        try { nativeSourcePlan = owned.planOnset({ fundamentalHz: frequency / 2 ** ((expression.pitchOffsetCents ?? 0) / 1200), sampleRate, parameters: values, pitchOffsetCents: expression.pitchOffsetCents ?? 0 }); }
        catch { throw failure('native-source-preflight', 'Captured onset exceeds the native source register or bend profile.', { intentId: intent.intentId }); }
      }
      const seed = samplePlan?.region.selectionSeed ?? (owned.native ? null : ownedSourceSeed(owned, patch, intent, performance)), sourceFields = { ...owned.beginFields(values, seed, pcmDescriptor, samplePlan, circularTravel), ...sampleTraversalBeginFields(traversal) };
      const ownReleaseFrames = Math.max(1, Math.round(values.releaseSeconds * sampleRate));
      voice = { key, laneId, routeLaneId: laneId, laneTransferUntil: 0, start: frame, order, releaseAt: null, end: null, slot: -1, token: 0, begin: { ...intent, performanceControls: admittedTargetControls }, baseFrequency: frequency / 2 ** ((expression.pitchOffsetCents ?? 0) / 1200), events: [],
        parameters: values, circularTravel: circularTravel ? { ownerIdentity: circularTravel.ownerIdentity, lastEndFrame: circularTravel.endFrame, lastPhase: circularTravel.to, lastSequence: circularTravel.sequence, segments: 1 } : null, nativeSourcePlan, samplePlan, traversalIdentity: traversal?.ownerIdentity ?? null, sampleTravelEndFrame: traversal?.segment.endOutputFrame ?? 0,
        positionFrontier: traversal ? { frame, released: false, length: 0, lastSequence: traversal.segment.sequence, lastEndFrame: traversal.segment.endOutputFrame, lastEndPosition: traversal.segment.endSourceFrame, lastSeekFrame: -sampleSourcePlan.entries[samplePlan.zoneIndex].attack.cursorProfile.slewFrames } : null,
        sampleTraversalSegments: traversal ? 1 : 0, lastSampleTraversal: traversal?.receipt ?? null, releaseFrames: ownReleaseFrames, articulation: { ...resolveOwnedArticulationPolicy({ ...patch, parameters: values }), ...(nativeSourcePlan?.oneShotHoldSeconds != null ? { oneShotTailSeconds: nativeSourcePlan.oneShotHoldSeconds } : {}), ...(samplePlan?.articulation || {}) },
        continuousBase: performance?.continuousBase, physicalCauses: new Map(initialCause ? [[initialCause.sourceKind, initialCause]] : []), sourceValues: values,
        stringT60Seconds: values.stringT60Seconds, bodyT60Seconds: values.bodyT60Seconds };
      sourceControls.minimumHoldSeconds = Math.min(sourceControls.minimumHoldSeconds ?? 4, voice.articulation.oneShotTailSeconds);
      sourceControls.maximumHoldSeconds = Math.max(sourceControls.maximumHoldSeconds ?? 0, voice.articulation.oneShotTailSeconds);
      sourceControls.missingOnsetBindings += performance?.bindingOutcomes.filter(outcome => outcome.state === 'no-qualified-source').length || 0;
      voices.set(key, voice); capturedBegins++;
      voice.events.push({ kind: 'begin', frame, order, intentId: intent.intentId, values: { 6: frequency, 7: intent.velocity01 * values.gain01 * patch.mix.gain01,
        8: expression.pressure01 ?? 1, 9: Math.max(-1, Math.min(1, (expression.pan01 ?? values.pan01) + patch.mix.pan01)),
        10: Math.round(values.attackSeconds * sampleRate), 11: Math.round(values.decaySeconds * sampleRate), 12: values.sustain01, 13: ownReleaseFrames, ...sourceFields } });
    } else {
      if (!voice || voice.end != null) throw failure('missing-voice-history', 'A captured control or end has no still-owned original onset.', { intentId: intent.intentId });
      if (frame < voice.start) throw failure('invalid-voice-time', 'A captured control precedes its own original onset.', { intentId: intent.intentId });
      if (intent.kind === 'end') {
        const at = Math.max(voice.sampleTravelEndFrame, voice.circularTravel?.lastEndFrame ?? 0, intent.terminationReason === 'one-shot' ? Math.max(frame, voice.start + Math.round(voice.articulation.oneShotTailSeconds * sampleRate)) : frame);
        voice.releaseAt = at; voice.end = at + (voice.samplePlan ? (owned.requiresPCMSet ? Math.ceil(nativeSampleReleaseFrames(voice.samplePlan, voice.parameters.releaseSeconds, sampleRate)) : nativeSampleReleaseFrames(voice.samplePlan, voice.parameters.releaseSeconds, sampleRate)) : owned.native ? voice.parameters.releaseSeconds * sampleRate : voice.releaseFrames); capturedEnds++;
        voice.events.push({ kind: 'end', frame: at, order, intentId: intent.intentId, values: { 13: voice.releaseFrames } });
      } else if (intent.articulationState?.transfer) {
        const laneId = resolveSourceLane(intent, ordinal - 1); capturedUpdates++;
        if (laneId !== voice.routeLaneId) {
          if (frame < voice.laneTransferUntil) throw failure('lane-transfer-capacity', 'Captured lane transfers overlap the bounded eight millisecond route fade.');
          lanes.add(laneId); voice.routeLaneId = laneId; voice.laneTransferUntil = frame + Math.ceil(0.008 * sampleRate); derivedLaneTransfers++;
          voice.events.push({ kind: 'lane', laneId, frame, order, intentId: intent.intentId, values: { 7: 1, 9: 0, 14: Math.ceil(0.008 * sampleRate) } });
        }
      } else {
        let mask = 0, controlFrame = frame; const values = { 14: Math.ceil(0.008 * sampleRate) };
        if (voice.circularTravel && intent.articulationState?.travel) {
          let planned; try { planned = owned.travelPlanner(voice.parameters, intent, frame, sampleRate); } catch (error) { throw failure(owned.travelDomain + '-travel-preflight', error.message, { intentId: intent.intentId }); }
          const frontier = voice.circularTravel;
          if (!planned || planned.ownerIdentity !== frontier.ownerIdentity || planned.sequence <= frontier.lastSequence || planned.firstFrame < frontier.lastEndFrame || Math.abs(planned.from - frontier.lastPhase) > 1e-7) throw failure('circular-travel-continuity', 'Circular travel changed owner, epoch, observed phase or output coverage.');
          frontier.lastEndFrame = planned.endFrame; frontier.lastPhase = planned.to; frontier.lastSequence = planned.sequence; frontier.segments++;
          mask = 64; controlFrame = planned.firstFrame; Object.assign(values, { 25: planned.from, 26: planned.to, 27: planned.endFrame - planned.firstFrame });
        }
        if (voice.traversalIdentity && intent.articulationState?.travel) {
          let planned; const entry = sampleSourcePlan.entries[voice.samplePlan.zoneIndex].attack;
          try { planned = planSampleTraversal(entry, intent, frame, sampleRate); } catch (error) { throw failure('sample-travel-preflight', error.message, { intentId: intent.intentId }); }
          const segment = planned.segment, frontier = voice.positionFrontier;
          if (planned.ownerIdentity !== voice.traversalIdentity || !acceptsSampleCursorSegment(entry.cursorProfile, frontier, segment.firstOutputFrame, segment.endOutputFrame, segment.firstSourceFrame, segment.endSourceFrame, segment.sequence, segment.discontinuity)) throw failure('sample-travel-continuity', 'Canonical travel changes owner, epoch, observed coordinate or queued output coverage.');
          frontier.lastSequence = segment.sequence; frontier.lastEndFrame = segment.endOutputFrame; frontier.lastEndPosition = segment.endSourceFrame;
          voice.sampleTravelEndFrame = segment.endOutputFrame; voice.sampleTraversalSegments++; voice.lastSampleTraversal = planned.receipt;
          mask = 8; controlFrame = segment.firstOutputFrame; Object.assign(values, { 18: segment.firstOutputFrame, 19: segment.endOutputFrame, 20: segment.firstSourceFrame, 21: segment.endSourceFrame, 22: segment.sequence, 23: 0 });
        }

        if (expression.pitchOffsetCents != null) { const frequency = voice.baseFrequency * 2 ** (expression.pitchOffsetCents / 1200);
          if (voice.samplePlan) {
            const rate = sampleRegionRate(voice.samplePlan.region, voice.begin.pitch, expression.pitchOffsetCents);
            if (rate == null || voice.samplePlan.region.releaseRegion && sampleRegionRate(voice.samplePlan.region.releaseRegion, voice.begin.pitch, expression.pitchOffsetCents) == null) throw failure('sample-pitch-preflight', 'Captured expression leaves the selected sample region pitch range.', { intentId: intent.intentId });
            if (sampleSourcePlan) { const entry = sampleSourcePlan.entries[voice.samplePlan.zoneIndex];
              if (entry.attack.mode === 'positionDriven' && expression.pitchOffsetCents !== 0 || !sampleSourcePlan.rateFor(entry.attack, voice.begin.pitch, expression.pitchOffsetCents) || entry.release && !sampleSourcePlan.rateFor(entry.release, voice.begin.pitch, expression.pitchOffsetCents)) throw failure('sample-pitch-preflight', 'Captured pitch exceeds the prepared selected reader or position policy.', { intentId: intent.intentId }); }
            voice.samplePlan.minimumRateRatio = Math.min(voice.samplePlan.minimumRateRatio, rate);
          }
          if (!finite(frequency, voice.samplePlan ? 0 : 0.1, voice.samplePlan ? Infinity : sampleRate / 2 - 1) || Math.abs(expression.pitchOffsetCents) > (voice.nativeSourcePlan?.maxBendCents ?? owned.bendCents)) throw failure('unsupported-pitch', 'Captured expression exceeds this source profile.'); values[6] = frequency; mask |= 1; }
        if (expression.pressure01 != null) { values[8] = expression.pressure01; mask |= 2; }
        if (expression.pan01 != null) { values[9] = Math.max(-1, Math.min(1, expression.pan01 + patch.mix.pan01)); mask |= 4; }
        if (intent.performanceCause) {
          let cause; try { cause = retainInstrumentCause(intent.performanceCause); } catch { throw failure('invalid-physical-control', 'Captured physical update is malformed.'); }
          sourceControls.observedPhysicalUpdates++; sourceControls.observedKinds.add(cause.sourceKind);
          if (performancePlan?.continuousSourceKinds.includes(cause.sourceKind)) {
            voice.physicalCauses.set(cause.sourceKind, cause);
            const performance = performancePlan.resolveContinuous(voice.continuousBase, [...voice.physicalCauses.values()], frame), expression = {};
            for (const id of owned.liveIds) if (performance.values[id] !== voice.sourceValues[id]) expression[id] = performance.values[id];
            const sourceMask = owned.writeUpdate(expression, voice, values);
            if (sourceMask === null) throw failure('invalid-physical-control', 'Physical control exceeds the new source domain.');
            if (sourceMask) { mask |= sourceMask; values[14] = Math.ceil(Math.max(0.008, performance.smoothingMs / 1000) * sampleRate); sourceControls.appliedPhysicalUpdates++; }
            voice.sourceValues = performance.values;
          }
        }
        values[15] = mask; capturedUpdates++; voice.events.push({ kind: 'update', frame: controlFrame, order, intentId: intent.intentId, values });
      }
    }
  }
  let derivedReleases = 0, naturalEnd = endFrame;
  for (const voice of voices.values()) {
    if (voice.end == null) {
      if (tail.mode === 'bounded-natural') throw failure('unknown-natural-release', 'A held voice has no captured release before this boundary. Choose exact crop or an explicit derived boundary release.');
      if (tail.mode === 'boundary-release') { voice.releaseAt = Math.max(endFrame, voice.sampleTravelEndFrame, voice.circularTravel?.lastEndFrame ?? 0); voice.end = voice.releaseAt + (voice.samplePlan ? (owned.requiresPCMSet ? Math.ceil(nativeSampleReleaseFrames(voice.samplePlan, voice.parameters.releaseSeconds, sampleRate)) : nativeSampleReleaseFrames(voice.samplePlan, voice.parameters.releaseSeconds, sampleRate)) : owned.native ? voice.parameters.releaseSeconds * sampleRate : voice.releaseFrames); derivedReleases++;
        voice.events.push({ kind: 'end', frame: voice.releaseAt, order: ++ordinal, intentId: null, values: { 13: voice.releaseFrames } }); }
      else voice.end = endFrame + voice.releaseFrames + 128;
    }
    voice.admissionEnd = voice.releaseAt ?? voice.end;
    events.push(...voice.events.map(event => ({ ...event, voice })));
  }
  if (selectSample) {
    const kits = new Map();
    for (const voice of voices.values()) {
      const region = voice.samplePlan.region; if (!region.chokeGroup) continue;
      const key = JSON.stringify([region.chokeGroup, region.chokeScope]);
      if (!kits.has(key)) kits.set(key, []); kits.get(key).push(voice);
    }
    for (const members of kits.values()) {
      members.sort((a, b) => a.start - b.start || (a.begin.voiceId < b.begin.voiceId ? -1 : a.begin.voiceId > b.begin.voiceId ? 1 : 0));
      for (let i = 0; i + 1 < members.length; i++) {
        const voice = members[i], next = members[i + 1];
        if (next.start >= voice.end) continue;
        voice.chokeFrame = next.start; voice.admissionEnd = Math.min(voice.admissionEnd, next.start);
        voice.end = Math.min(voice.end, next.start + (next.start === voice.start ? 0 : 0.005 * sampleRate));
        if (voice.events.some(event => event.kind === 'update' && event.values[15] && event.frame >= next.start)) throw failure('sample-choked-control', 'A captured update follows the selected same-kit choke. Choose a different authored kit mapping.', { intentId: voice.begin.intentId });
      }
    }
  }
  if (owned.requiresPCMSet) {
    for (const voice of voices.values()) if (voice.chokeFrame != null && !voice.silentChoke) {
      const frame = voice.chokeFrame;
      if (voice.events.some(event => event.frame >= frame && event.kind === 'lane')) throw failure('sample-choked-control', 'A captured lane transfer follows the selected kit choke.');
      events.push({ kind: 'force-end', frame, order: ++ordinal, intentId: null, voice,
        values: { 13: Math.max(1, Math.min(Math.ceil(0.005 * sampleRate), Math.ceil(voice.end - frame))), 16: Math.ceil(voice.end), 20: 1 } });
    }
    for (let index = events.length - 1; index >= 0; index--) { const event = events[index];
      if (event.voice.chokeFrame != null && event.frame >= event.voice.chokeFrame && (event.kind === 'end' || event.kind === 'update' && !event.values[15])) events.splice(index, 1);
    }
  }
  if (tail.mode !== 'exact-crop') for (const voice of voices.values()) naturalEnd = Math.max(naturalEnd, voice.end);
  if (effectPlan && tail.mode !== 'exact-crop') naturalEnd = Math.max(naturalEnd, effectReplay?.lastBodyDriveFrame || 0) + effectPlan.maximumTailFrames;
  const outputEnd = tail.mode === 'exact-crop' ? endFrame : Math.min(Math.ceil(naturalEnd), endFrame + Math.round((tail.maxSeconds ?? 4) * sampleRate));
  const outputFrames = outputEnd - firstFrame, fileCount = stemLaneIds.length + effectReturnNodeIds.length + 1, pcmBytes = outputFrames * 8 * fileCount;
  if (!natural(pcmBytes) || pcmBytes + 262208 * fileCount > MAX_OUTPUT_BYTES) throw failure('render-capacity', 'This render/stem/return set exceeds 64 MiB; choose a shorter range or fewer taps.');
  const slots = new Array(owned.requiresPCMSet ? owned.voices : patch.voicePolicy.maxVoices).fill(null), tokens = new Uint32Array(owned.voices); let peakVoices = 0;
  for (const voice of [...voices.values()].sort((left, right) => left.start - right.start || left.order - right.order)) {
    if (selectSample && voice.admissionEnd <= voice.start) { voice.silentChoke = true; continue; }
    let occupied = 0, selected = -1;
    for (let slot = 0; slot < slots.length; slot++) { if ((selectSample && !owned.requiresPCMSet ? slots[slot]?.admissionEnd : slots[slot]?.end) <= voice.start) slots[slot] = null; if (slots[slot]) occupied++; else if (selected < 0) selected = slot; }
    if (owned.requiresPCMSet && slots.filter(member => member && member.admissionEnd > voice.start).length >= patch.voicePolicy.maxVoices) throw failure('intent-voice-capacity', 'The patch logical-gate limit cannot admit every captured sample onset.');
    if (selected < 0) throw failure('intent-voice-capacity', 'The selected patch cannot realize every captured onset without dropping a voice.', { intentId: voice.begin.intentId });
    voice.slot = selected; voice.token = ++tokens[selected]; slots[selected] = voice; peakVoices = Math.max(peakVoices, occupied + 1);
  }
  if (lanes.size > LIVE_LANE_ID_LIMIT) throw failure('lane-transfer-capacity', 'Captured source lanes exceed the bounded stable identity inventory.');
  const sourceLaneTokens = new Map([...lanes].map((id, index) => [id, index + 1]));
  const effectSourceBindings = effectPlan ? prepareEffectSourceBindings(effectPlan, [...lanes], effectPlan.nodes.some(node => node.parameters.voiceSelection) ? [...voices.values()].map(voice => ({ voiceId: voice.begin.voiceId, generation: voice.begin.generation })) : []) : null;
  const captureLaneIds = Object.freeze([...new Set([...stemLaneIds, ...(effectSourceBindings?.laneIds || []), ...(effectSourceBindings?.voiceSelections || []).map(selection => selection.stemId)])]);
  if (effectSourceBindings?.voiceSelections?.length && (NATIVE_OFFLINE_SOURCE_IDS.includes(owned.id) || nativeConvolution)) throw failure('selected-source-render-unavailable', 'Selected-voice donors currently require one complete owned-source render without native convolution.');
  if (!NATIVE_OFFLINE_SOURCE_IDS.includes(owned.id) && captureLaneIds.length > 16) throw failure('sidechain-tap-capacity', 'Choose at most sixteen combined dry-lane and lane/voice-selection source taps.');
  for (let index = events.length - 1; index >= 0; index--) if (events[index].voice?.silentChoke) events.splice(index, 1);
  events.sort((left, right) => left.frame - right.frame || left.order - right.order);
  return { owned, sourcePCM, pcmDescriptor, sampleSourcePlan, seedLayerPlan, renderVoices: owned.requiresPCMSet ? owned.voices : patch.voicePolicy.maxVoices, planningBytes, sourceControls, patch, parameters, events, voices, source: revoice, descriptor, applicationBuildId, sampleRate, firstFrame, endFrame, outputEnd, outputFrames,
    circularTravel: { policy: parameters.circularControlMode === 2 ? 'canonical-qualified-route-arc;completed-endpoint-projection;no-inferred-segment-precision' : parameters.circularControlMode === 1 ? 'observed-contact-coordinate-at-onset;no-inter-contact-motion' : 'canonical-signed-axis;completed-observation-interpolation;no-time-driven-ascent', voices: [...voices.values()].filter(voice => voice.circularTravel).length, segments: [...voices.values()].reduce((count, voice) => count + (voice.circularTravel?.segments || 0), 0) }, sampleTraversal: { policy: 'canonical-completed-observations;no-private-distance-clock;no-extrapolation', voices: [...voices.values()].filter(voice => voice.traversalIdentity).length, segments: [...voices.values()].reduce((count, voice) => count + voice.sampleTraversalSegments, 0) }, sourceOriginMs, startSeconds, endSeconds, tail, releaseFrames, articulation, derivedReleases, derivedLaneTransfers, capturedBegins, capturedUpdates, capturedEnds, peakVoices, stemLaneIds, lanes, sourceLaneTokens, pcmBytes,
    laneRoutingReceipt: revoice.laneRouting ? { schema: revoice.laneRouting.schema, hash: await hashData(revoice.laneRouting, { maxBytes: 4194304, maxNodes: 524288 }), initialLanes: revoice.laneRouting.initial.length, changes: revoice.laneRouting.changes.length, policy: 'captured-index-to-stable-id-at-onset-and-explicit-transfer;eight-millisecond-nonoverlapping-route-fades;semantic-intents-unchanged' } : null,
    effectReplay, effectPlan, effectSourceBindings, captureLaneIds, effectReturnNodeIds, effectHash: effectPlan ? await effectGraphHash(effectPlan) : null, effectTailTruncated: !!effectPlan && tail.mode !== 'exact-crop' && naturalEnd > outputEnd,
    timing: { ...timing.receipt(), sourceTimelineHash: timing.sourceTimeline ? await hashData(timing.sourceTimeline, { maxBytes: 1048576, maxNodes: 65536 }) : null },
    definitionHash: await hashData(definition), intentHash: await hashData(revoice.intents, { maxBytes: 8 * 1048576, maxNodes: 1000000 }) };
}

export async function planCausalOwnedRender(input = {}, { nativeConvolution = false, nativeOwnedProcessors = false } = {}) {
  if (!OWNED_SOURCE_IDS.includes(input.descriptor?.engineId)) throw failure('unsupported-owned-source', 'Choose a realized owned source for this kernel render.');
  return planCausalSourceRender(input, { nativeConvolution, nativeOwnedProcessors });
}

export async function renderCausalOwnedTake(input, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {}, maxWorkingBytes = 512 * 1048576 } = {}) {
  const sourcePhase = input.outputMode === 'source-pcm';
  const panicFrame = input.panicFrame ?? null; let panicApplied = false;
  if (panicFrame != null && (!natural(panicFrame) || sourcePhase || input.effectGraph)) throw failure('panic-fixture-profile', 'Panic qualification requires a bounded dry source render.');
  if (input.outputMode != null && !sourcePhase) throw failure('render-output-mode', 'Choose an explicit supported source output phase.');
  signal?.throwIfAborted(); const plan = await planCausalOwnedRender({ ...input, maxPlanningBytes: maxWorkingBytes, signal, yieldControl }, { nativeConvolution: sourcePhase, nativeOwnedProcessors: sourcePhase }); signal?.throwIfAborted();
  if (panicFrame != null && panicFrame >= plan.outputEnd) throw failure('panic-fixture-profile', 'Panic frame exceeds the selected render.');
  if (sourcePhase && (!plan.effectPlan?.impulseCount || plan.stemLaneIds.length + plan.effectReturnNodeIds.length > 15 || plan.captureLaneIds.length > 15)) throw failure('native-convolution-source-profile', 'A source PCM stage requires an actual native body and at most fifteen combined stereo taps.');
  const sourcePcmBytes = sourcePhase ? plan.outputEnd * (1 + plan.captureLaneIds.length) * 8 : 0;
  if (sourcePhase && (!natural(sourcePcmBytes) || sourcePcmBytes > 56 * 1048576)) throw failure('source-pcm-capacity', 'Complete source history exceeds the bounded native convolution PCM profile.');
  const stateCut = input.restorationMode === 'owned-state-cut';
  if (input.restorationMode != null && !['forward-preroll', 'owned-state-cut'].includes(input.restorationMode)) throw failure('restore-mode-unavailable', 'Choose a supported owned-source restoration mode.');
  const cutWorkspace = stateCut ? 2 * plan.owned.sourceBytes({ sampleRate: plan.sampleRate, pcm: plan.pcmDescriptor, voices: plan.patch.voicePolicy.maxVoices }) + 4 * 1048576 : 0;
  const effectWorkspace = plan.effectPlan && !sourcePhase ? plan.effectPlan.stateBytes + 4 * 1048576 : 0;
  const requiredBytes = (sourcePhase ? sourcePcmBytes : plan.pcmBytes) * 4 + plan.planningBytes + 24 * 1048576 + cutWorkspace + effectWorkspace;
  if (!natural(maxWorkingBytes) || requiredBytes > maxWorkingBytes) throw failure('render-memory-capacity', 'PCM, encoding, command and transfer overlap exceed the admitted render workspace.');
  const { sampleRate, outputFrames, outputEnd, firstFrame, endFrame, events, stemLaneIds, captureLaneIds } = plan;
  const renderedLaneIds = sourcePhase ? captureLaneIds : stemLaneIds;
  const WIDTH = plan.owned.width;
  let kernel = await createOwnedControlKernel(plan.owned, sampleRate, plan.renderVoices, { signal, yieldControl, pcm: plan.sourcePCM, patch: plan.patch });
  const effects = plan.effectPlan && !sourcePhase ? await createOwnedEffectGraphKernel({ definition: plan.effectPlan.definition, sampleRate, returnNodeIds: plan.effectReturnNodeIds, frameOrigin: plan.effectReplay?.frameOrigin || 0 }) : null;
  const effectReplayDriver = effects && plan.effectReplay ? createCapturedEffectReplayDriver(plan.effectReplay, effects) : null;
  signal?.throwIfAborted(); if (effects && effects.hash !== plan.effectHash) throw failure('effect-render-identity', 'Effect preparation differs from its admitted graph.');
  let transfer = stateCut ? new Uint8Array(kernel.stateByteLength()) : null, stateReceipt = null;
  if (transfer && transfer.byteLength * 2 > cutWorkspace) throw failure('restore-memory-capacity', 'The exact source cut exceeds its admitted transfer and clone workspace.');
  const captureFirstFrame = sourcePhase ? 0 : firstFrame;
  const planes = sourcePhase ? Array.from({ length: 2 + captureLaneIds.length * 2 }, () => new Float32Array(outputEnd)) : null;
  const pcm = Array.from({ length: renderedLaneIds.length + (sourcePhase ? 0 : plan.effectReturnNodeIds.length) + 1 }, () => sourcePhase ? null : new Uint8Array(outputFrames * 8));
  const views = sourcePhase ? null : pcm.map(bytes => new DataView(bytes.buffer)), left = new Float32Array(128), right = new Float32Array(128);
  const stemChannels = captureLaneIds.map(() => [new Float32Array(128), new Float32Array(128)]), routes = new Uint16Array(plan.owned.voices), laneTokens = Uint32Array.from(captureLaneIds, id => plan.sourceLaneTokens.get(id) || 0);
  const selectedStemChannels = renderedLaneIds.map(id => stemChannels[captureLaneIds.indexOf(id)]);
  const sourceSampler = effects && plan.effectSourceBindings.routes.length ? createEffectSourceSampler(plan.effectSourceBindings, captureLaneIds, stemChannels) : null;
  const returnChannels = (sourcePhase ? [] : plan.effectReturnNodeIds).map(() => [new Float32Array(128), new Float32Array(128)]);
  const statistics = pcm.map(() => ({ peak: 0, squares: 0, overFullScaleSamples: 0 }));
  const packet = new Float64Array(WIDTH); let cursor = 0, sequence = 0, applied = 0, blocks = 0, packetSequence = 0;
  const checkReceipts = () => { for (let index = 0; index < kernel.receiptCount; index++) { const at = index * RECEIPT_WIDTH, code = kernel.receipts[at];
    if ([REJECTED, FAULTED, CANCELLED].includes(code)) throw failure('render-command-failed', 'The render kernel could not apply every requested command.', { sequence: kernel.receipts[at + 1], reasonCode: kernel.receipts[at + 5] });
    if (code === APPLIED) applied++;
  } kernel.receiptCount = 0; };
  for (let frame = 0; frame < outputEnd;) {
    signal?.throwIfAborted();
    if (transfer && frame === firstFrame) {
      const identity = { engineArtifactHash: plan.descriptor.artifactHash, patchDefinitionHash: plan.definitionHash, graphRevision: 0 };
      const cut = kernel.snapshotInto(transfer, identity);
      const staged = await createOwnedControlKernel(plan.owned, sampleRate, plan.renderVoices, { signal, yieldControl, pcm: plan.sourcePCM, patch: plan.patch, sourceBank: kernel.source?.bank });
      signal?.throwIfAborted(); staged.restoreFrom(transfer, identity);
      stateReceipt = { abi: cut.abi, frame: cut.frame, bytes: transfer.byteLength, stateHash: await digest(transfer), consumedPlannedEvents: cursor,
        sequence, packetSequence, nextEventFrame: events[cursor]?.frame ?? null, plannerContinuation: 'same-admitted-immutable-intent-plan',
        immutableAssets: 'shared-read-only', mutableState: 'independent-staged-copy', effects: sourcePhase ? 'native-body-reconstructed-from-complete-source-history-not-an-effect-state-cut' : effects ? 'continued-same-admitted-preroll-graph-not-a-graph-state-cut' : 'none', qualification: 'implementation-awaiting-pcm-equivalence' };
      signal?.throwIfAborted(); transfer.fill(0); transfer = null; kernel = staged;
    }
    if (panicFrame === frame && !panicApplied) { packet.fill(0); packet[0] = 1; packet[1] = frame; packet[2] = ++sequence; packet[3] = PANIC; packet[17] = 1; kernel.accept(packet, 1, ++packetSequence); checkReceipts(); panicApplied = true; cursor = events.length; }
    while (cursor < events.length && events[cursor].frame <= frame) {
      const event = events[cursor++], voice = event.voice;
      if (event.frame >= outputEnd) break;
      if (event.kind === 'begin') { routes[voice.slot] = effectVoiceStemMask(plan.effectSourceBindings, voice, captureLaneIds); if (!kernel.setLaneIdentity(voice.slot, voice.token, plan.sourceLaneTokens.get(voice.laneId))) throw failure('lane-transfer-identity', 'Original onset lane ancestry could not be admitted.'); }
      packet.fill(0); packet[0] = 1; packet[1] = event.frame; packet[2] = ++sequence; packet[3] = event.kind === 'begin' ? BEGIN : event.kind === 'update' ? UPDATE : event.kind === 'lane' ? MIX : END;
      packet[4] = voice.slot; packet[5] = voice.token; packet[17] = 1;
      for (const [field, value] of Object.entries(event.values)) packet[Number(field)] = value;
      if (event.kind === 'lane') packet[6] = plan.sourceLaneTokens.get(event.laneId);
      if (event.kind === 'end' && plan.owned.requiresPCMSet) packet[16] = Math.ceil(voice.end);
      if (event.kind === 'begin') packet[16] = Math.max(voice.end + 128, outputEnd + voice.releaseFrames + 128);
      kernel.accept(packet, 1, ++packetSequence); checkReceipts();
    }
    const count = Math.min(128, outputEnd - frame, panicFrame != null && frame < panicFrame ? panicFrame - frame : Infinity, cursor < events.length ? events[cursor].frame - frame : Infinity, transfer && frame < firstFrame ? firstFrame - frame : Infinity);
    const a = count === 128 ? left : left.subarray(0, count), b = count === 128 ? right : right.subarray(0, count);
    const taps = stemChannels.length ? { routeMode: 'mask', routes, laneTokens, channels: count === 128 ? stemChannels : stemChannels.map(channels => channels.map(channel => channel.subarray(0, count))) } : null;
    kernel.render(a, b, frame, taps); checkReceipts();
    if (effects) for (let index = 0; index < count; index++) {
      const sidechains = sourceSampler?.fill(a[index], b[index], index) ?? null;
      if (effectReplayDriver) { effectReplayDriver.sample(a[index], b[index], frame + index, sidechains, sourceSampler?.present ?? null); a[index] = effectReplayDriver.leftSample; b[index] = effectReplayDriver.rightSample; }
      else { effects.sample(a[index], b[index], sidechains, sourceSampler?.present ?? null); a[index] = effects.leftSample; b[index] = effects.rightSample; }
      for (let tap = 0; tap < returnChannels.length; tap++) { returnChannels[tap][0][index] = effects.tapSamples[tap * 2]; returnChannels[tap][1][index] = effects.tapSamples[tap * 2 + 1]; }
    }
    for (let index = Math.max(0, captureFirstFrame - frame); index < count; index++) for (let file = 0; file < pcm.length; file++) for (let channel = 0; channel < 2; channel++) {
      const value = file === 0 ? channel ? b[index] : a[index] : file <= renderedLaneIds.length ? selectedStemChannels[file - 1][channel][index] : returnChannels[file - 1 - renderedLaneIds.length][channel][index];
      if (!Number.isFinite(value)) throw failure('nonfinite-pcm', 'The render produced a nonfinite sample.');
      const stats = statistics[file]; stats.peak = Math.max(stats.peak, Math.abs(value)); stats.squares += value * value; if (Math.abs(value) > 1) stats.overFullScaleSamples++;
      if (sourcePhase) planes[file * 2 + channel][frame + index] = value;
      else views[file].setFloat32(((frame + index - firstFrame) * 2 + channel) * 4, value, true);
    }
    if (++blocks % 32 === 0) { onProgress({ phase: frame < firstFrame ? 'reconstructing-intent-history' : 'rendering-causal-take', completedUnits: frame + count, totalUnits: outputEnd }); await yieldControl(); }
    frame += count;
  }
  signal?.throwIfAborted(); effects?.assertHealthy();
  const common = { schema: 'lemmings-causal-audio-render/v1', mode: 'intent-render', operation: 'sound-only-revoice', takeId: plan.source.takeId,
    takeRevision: plan.source.takeRevision, sourceCanonicalHash: plan.source.sourceCanonicalHash,
    ...(plan.laneRoutingReceipt ? { sourceLaneRouting: plan.laneRoutingReceipt } : {}), sourceVersions: plan.source.sourceVersions, intentHash: plan.intentHash,
    sourceEvidence: 'provided-covered-semantic-snapshot', sourceOriginMs: plan.sourceOriginMs, timeDomain: 'captured-source-time', inputRange: { startSeconds: plan.startSeconds, endSeconds: plan.endSeconds },
    timing: plan.timing,
    sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames: outputFrames, timelineZeroSourceFrame: firstFrame, exactEndSourceFrame: endFrame, renderedEndSourceFrame: outputEnd,
    restoration: { mode: stateCut ? 'forward-preroll-and-owned-state-cut' : 'deterministic-preroll', stateCut: stateReceipt, fromSourceFrame: 0, prerollFrames: firstFrame, initialVoices: 0, maxHistorySeconds: MAX_SECONDS },
    tail: { mode: plan.tail.mode, maxSeconds: plan.tail.maxSeconds ?? 4, derivedBoundaryReleases: plan.derivedReleases, truncated: kernel.active.some(Boolean) || plan.effectTailTruncated, effectTailBoundFrames: plan.effectPlan?.maximumTailFrames ?? 0 },
    effectGraph: plan.effectPlan ? { definition: plan.effectPlan.definition, hash: plan.effectHash, processingRevisions: plan.effectPlan.processingRevisions, latencyFrames: plan.effectPlan.latencyFrames,
      maximumTailFrames: plan.effectPlan.maximumTailFrames, sourceBindings: plan.effectSourceBindings, controls: plan.effectReplay ? 'captured-native-API-commands-new-owned-realization' : 'explicit-authored-defaults-not-replayed-live-gestures', ...(plan.effectReplay ? { commandReplay: { hash: plan.effectReplay.hash, events: plan.effectReplay.events.length, graphStartFrame: plan.effectReplay.graphStartFrame, frameOrigin: plan.effectReplay.frameOrigin, initialMemory: plan.effectReplay.initialMemory, evidence: plan.effectReplay.evidence, spectralCapture: plan.effectReplay.spectralCapture, timing: plan.effectReplay.timing, dryStems: 'original-source-dry;owner-gates-and-creative-dry-scaling-are-in-complete-master' } } : {}), scope: 'one-full-shared-owner-sum', ...(effects ? { realization: effects.diagnostics() } : {}) } : null,
    definitionHash: plan.definitionHash, patchId: plan.patch.id, patchRevision: plan.patch.revision, engineRequirement: { engineId: plan.descriptor.engineId,
      engineVersion: plan.descriptor.engineVersion, artifactHash: plan.descriptor.artifactHash, parameterSchemaHash: plan.descriptor.parameterSchemaHash }, applicationBuildId: plan.applicationBuildId,
    panic: panicApplied ? { frame: panicFrame, source: 'shared-owned-kernel-panic-opcode', futureFixtureEvents: 'explicitly-suppressed-after-panic', releaseSlewMaximumFrames: 128 } : null,
    commands: { capturedBegins: plan.capturedBegins, capturedUpdates: plan.capturedUpdates, capturedEnds: plan.capturedEnds, acknowledgedFiniteBodyBegins: plan.effectReplay?.bodySourceIntentIds?.length || 0, bodySourcePolicy: plan.effectReplay?.bodySourceIntentIds?.length ? 'one-original-source-per-finite-body-force;no-extra-dry-note' : 'explicit-new-target-revoice', derivedReleases: plan.derivedReleases, derivedLaneTransfers: plan.derivedLaneTransfers, submitted: sequence, applied, peakVoices: plan.peakVoices },
    realization: { scope: plan.owned.id === 'worklet-sine' ? 'new-local-sine-realization-of-immutable-intents' : 'new-local-owned-source-realization-of-immutable-intents', liveAdmissionHistoryRecreated: false, historicalHardwareTimbreRecreated: false,
      smoothingSeconds: 0.008, articulationPolicy: plan.articulation.policy, oneShotHoldSeconds: plan.owned.extended ? null : plan.articulation.oneShotTailSeconds, oneShotHoldPolicy: 'per-onset-effective-source-parameters',
      sourcePerformanceControls: plan.owned.id === 'worklet-sine' ? 'retained-in-source-intents-replaced-by-explicit-new-sine-patch' : 'captured-controls-retained-explicit-new-target-controls-and-recorded-physical-causes-applied',
      ...(plan.owned.travelPolicy ? { [plan.owned.travelReceiptKey]: { ...plan.circularTravel, policy: plan.owned.travelPolicy, restoration: plan.owned.restoration + ';owned-source-kernel-cut;pcm-equivalence-qualification-pending' } } : { circularTravel: plan.circularTravel }), sourceControls: { ...plan.sourceControls, observedKinds: [...plan.sourceControls.observedKinds].sort(), missingPhysicalObservations: 'held-or-no-qualified-source-no-invented-facts' },
      ...(plan.sampleSourcePlan ? { sampleTraversal: plan.sampleTraversal, sampleMap: { id: plan.sampleSourcePlan.map.mapId, revision: plan.sampleSourcePlan.map.revision, profile: plan.sampleSourcePlan.map.rendererProfile ?? 'native-forward-v1', sourcePool: plan.renderVoices, maximumLogicalGates: plan.patch.voicePolicy.maxVoices, chokedVoices: [...plan.voices.values()].filter(voice => voice.chokeFrame != null).length, selection: 'one-deterministic-onset-selection;release-child-retains-original-map-entry' } } : {}),
      ...(plan.seedLayerPlan ? { seedLayers: { revision: plan.seedLayerPlan.revision, profile: plan.seedLayerPlan.profile, footprint: plan.seedLayerPlan.footprint, sourceBanks: plan.seedLayerPlan.sourceBanks, timing: plan.seedLayerPlan.timing } } : {}),
      sourceBank: plan.pcmDescriptor, sourceResampling: plan.seedLayerPlan ? 'fixed-original-rate-transient-residual;independent-owned-grains;creative-hybrid-not-qualified-warp' : plan.owned.requiresPCMSet ? 'owned-sample-sample-read-v1;128taps;phase128;rate19;unqualified-spectral-and-listening-profile' : plan.owned.requiresPCM ? 'source-rate-pcm-linear-read-resampling' : 'none',
      fixedBank: kernel.source?.bank ? { id: kernel.source.bank.id, hash: kernel.source.bank.hash, bytes: kernel.source.bank.bytes } : null,
      normalization: 'none', integerClipping: 'not-applicable', dither: 'none-float-output', sharedMasterAndLimiter: 'excluded' },
    stems: { mode: plan.effectPlan ? 'simultaneous-dry-lane-and-shared-effect-node-taps' : 'simultaneous-dry-lane-taps', laneIds: stemLaneIds, allCapturedLanesIncluded: [...plan.lanes].every(lane => stemLaneIds.includes(lane)),
      sharedReturns: plan.effectPlan ? plan.effectReturnNodeIds : 'none-in-selected-graph', recombination: plan.effectPlan ? 'dry-lanes-and-shared-node-taps-from-one-render-not-isolated-nonlinear-lane-renders' : 'linear-dry-sum-with-float32-rounding', nonlinearMaster: plan.effectPlan ? 'creative-graph-included-final-protection-excluded' : 'excluded' },
    acousticReceipt: false, qualification: 'rendered-pcm-not-listening-or-cross-browser-qualified', originalRecordMutated: false };
  if (sourcePhase) {
    const planeByteHashes = [];
    for (const [index, plane] of planes.entries()) { signal?.throwIfAborted(); planeByteHashes.push(await digest(new Uint8Array(plane.buffer)));
      onProgress({ phase: 'hashing-causal-source-pcm', completedUnits: index + 1, totalUnits: planes.length }); await yieldControl(); }
    const endian = new Uint32Array([0x01020304]);
    return { schema: 'lemmings-causal-source-pcm/v1', manifest: common, frames: outputEnd, channels: planes.length, sampleRate, planes, laneIds: captureLaneIds, sourceLaneIds: Object.freeze([...plan.lanes].sort()),
      planeByteHashes, planeHashByteOrder: new Uint8Array(endian.buffer)[0] === 4 ? 'little-endian' : 'big-endian',
      scope: 'complete-dry-owned-source-history-awaiting-native-body-not-a-final-render' };
  }
  const files = [];
  for (let index = 0; index < pcm.length; index++) {
    const lane = index > 0 && index <= stemLaneIds.length, returnNodeId = index > stemLaneIds.length ? plan.effectReturnNodeIds[index - 1 - stemLaneIds.length] : null;
    signal?.throwIfAborted(); const { squares, ...stats } = statistics[index], manifest = { ...common, tap: lane ? 'captured-lane-dry' : returnNodeId ? 'shared-effect-node-output' : effects ? 'complete-owned-effect-graph-pre-master' : plan.owned.id === 'worklet-sine' ? 'complete-sine-graph-pre-master' : 'complete-owned-source-graph-pre-master',
      laneId: lane ? stemLaneIds[index - 1] : null, returnNodeId, pcmHash: await digest(pcm[index]), statistics: { ...stats, rms: Math.sqrt(squares / (outputFrames * 2)) } };
    signal?.throwIfAborted(); files.push({ name: lane ? 'lane-' + index : returnNodeId ? 'effect-' + returnNodeId : 'master', bytes: encodeCausalRenderWave(pcm[index], outputFrames, sampleRate, manifest), manifest });
  }
  return { manifest: common, files };
}
