import { isPrivateSpatialReadout } from './PrivateSpatialReadout.js';
import { prepareCapturedSpatialReadout } from './CapturedSpatialReadout.js';
import { prepareCapturedMaterialReadout } from './CapturedMaterialReadout.js';
import { planCausalSourceRender } from './CausalOwnedRender.js';
import { renderNativeOfflineGraph, NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineDriver.js';

export async function prepareCausalNativeRenderInput(input, { resources, signal, onProgress = () => {}, OfflineAudioContext, resourceBudget, admission, getMaterialProvider, jobs, isCurrent = () => true,
  privateSpatialReadout = null, maxWorkingBytes = 512 * 1048576 } = {}) {
  if (!NATIVE_OFFLINE_SOURCE_IDS.includes(input?.descriptor?.engineId)) throw new Error('Choose an available native causal render source.');
  signal?.throwIfAborted();
  if (privateSpatialReadout && (!isPrivateSpatialReadout(privateSpatialReadout) || input.revoice !== privateSpatialReadout.source || input.capturedSpatial || input.capturedMaterials)) throw new Error('Private spatial realization needs its exact owned observation plan and an independent source.');
  const spatialReadout = privateSpatialReadout || (input.capturedSpatial ? await prepareCapturedSpatialReadout(input.revoice, input.sampleRate, { signal }) : null);
  if (spatialReadout) input = { ...input, revoice: spatialReadout.source };
  if (input.capturedMaterials && input.revoice.spatialEvents?.some(event => event.kind === 'onset' && event.acousticMaterialState)) throw new Error('Choose captured spatial + material bodies to preserve the authored zone body selections.');
  const materialReadout = input.capturedMaterials || spatialReadout ? await prepareCapturedMaterialReadout(input.revoice, input.descriptor, { signal, allowUnmapped: !!spatialReadout }) : null;
  const plan = await planCausalSourceRender({ ...input, materialReadout, spatialTailFrames: spatialReadout?.maximumTailFrames || 0, signal, maxPlanningBytes: maxWorkingBytes }); signal?.throwIfAborted();
  const nativeEffects = !!plan.effectPlan, nativeReturns = nativeEffects ? plan.effectReturnNodeIds.length : 0;
  if (plan.stemLaneIds.length + nativeReturns > 15) throw Object.assign(new Error('Native convolution shares a 32-channel simultaneous tap budget: choose at most fifteen dry lanes plus shared returns.'), { code: 'native-convolution-tap-capacity' });
  const nativeBytes = plan.outputEnd * (2 + (plan.stemLaneIds.length + nativeReturns) * 2) * 4;
  const nativeEffectWorkspace = nativeEffects ? plan.effectPlan.impulseDecodedBytes * 6 + plan.effectPlan.nativeNodeEstimateBytes + plan.effectPlan.stateBytes + 18 * 1048576 : 0;
  const estimatedPeakBytes = (spatialReadout?.planningBytes || 0) + nativeBytes * 8 + 32 * 1048576 + (plan.effectPlan ? plan.pcmBytes * 4 + plan.effectPlan.stateBytes + 4 * 1048576 : 0);
  if (!Number.isSafeInteger(nativeBytes) || nativeBytes > 56 * 1048576 || !Number.isSafeInteger(estimatedPeakBytes) ||
      Math.max(nativeBytes + 16 * 1048576 + nativeEffectWorkspace + (spatialReadout?.planningBytes || 0), nativeBytes + estimatedPeakBytes) + plan.planningBytes > maxWorkingBytes) throw Object.assign(new Error('Native preroll, retained PCM, simultaneous taps and encoding overlap exceed the admitted workspace. Choose a shorter history or fewer stems.'), { code: 'native-render-memory-capacity' });
  const originals = new Map(input.revoice.intents.map(intent => [intent.intentId, intent])), events = [];
  let indexLimitedOnsets = 0, omittedModes = 0;
  for (const voice of plan.voices.values()) { if (voice.nativeSourcePlan?.indexLimited) indexLimitedOnsets++; omittedModes += voice.nativeSourcePlan?.omittedModes?.length || 0; }
  for (const event of plan.events) {
    if (event.frame >= plan.outputEnd) continue;
    const voice = event.voice, original = originals.get(event.intentId);
    events.push({ ...(materialReadout ? { sourceKey: voice.materialVariantKey || 'selected-source' } : {}), kind: event.kind, frame: event.frame, voiceId: voice.begin.voiceId, executionEpoch: 'offline-voice-' + voice.order, laneId: event.laneId ?? voice.laneId,
      intent: event.kind === 'begin' ? voice.begin : null, expression: event.kind === 'update' ? original.expression || {} : null,
      releaseFrame: voice.releaseAt ?? plan.outputEnd + 1, releaseSeconds: voice.parameters.releaseSeconds });
  }
  let clippedSpatialUpdates = 0;
  if (spatialReadout) {
    const byOnset = new Map([...plan.voices.values()].map(voice => [voice.begin.intentId, voice]));
    for (const { onsetId, event } of spatialReadout.updates) {
      const voice = byOnset.get(onsetId); if (!voice) { clippedSpatialUpdates++; continue; }
      const frame = Math.max(voice.start, Math.round((event.sourceTimeMs - plan.sourceOriginMs) * plan.sampleRate / 1000) + Math.round((event.sourceOwnerDelayFrames || 0) * plan.sampleRate / event.sampleRate));
      if (frame >= plan.outputEnd || frame >= voice.end) { clippedSpatialUpdates++; continue; }
      events.push({ kind: 'spatial', frame, sourceKey: voice.materialVariantKey || 'selected-source', voiceId: voice.begin.voiceId, executionEpoch: 'offline-voice-' + voice.order, state: event.state });
    }
    events.sort((a, b) => a.frame - b.frame);
  }
  const { sampleRate, outputFrames, outputEnd, firstFrame, endFrame, stemLaneIds } = plan;
  const native = await renderNativeOfflineGraph({ patch: plan.patch, ...(materialReadout ? { sourceVariants: [...(materialReadout.allowUnmapped ? [{ key: 'selected-source', patch: plan.patch }] : []), ...[...materialReadout.variants.values()].map(variant => ({ key: variant.key, patch: variant.patch }))] } : {}), ...(spatialReadout ? { spatialMaps: spatialReadout.maps } : {}), events, frames: outputEnd, sampleRate, stemLaneIds, panicFrame: input.panicFrame ?? null, assets: input.nativeAssets || [],
    ...(nativeEffects ? { effectGraph: plan.effectPlan.definition, effectReturnNodeIds: plan.effectReturnNodeIds } : {}) },
  { resources, signal, onProgress, OfflineAudioContext, resourceBudget, admission, getMaterialProvider, jobs, isCurrent });
  try {
    const manifest = { schema: 'lemmings-causal-audio-render/v1', mode: 'intent-render', operation: 'sound-only-revoice', takeId: plan.source.takeId,
      takeRevision: plan.source.takeRevision, sourceCanonicalHash: plan.source.sourceCanonicalHash, ...(plan.laneRoutingReceipt ? { sourceLaneRouting: plan.laneRoutingReceipt } : {}), sourceVersions: plan.source.sourceVersions, intentHash: spatialReadout?.receipt.semanticIntentHash || plan.intentHash, ...(spatialReadout ? { realizationIntentHash: plan.intentHash, [privateSpatialReadout ? 'privateSpatial' : 'capturedSpatial']: { ...spatialReadout.receipt, clippedSpatialUpdates } } : {}),
      sourceEvidence: privateSpatialReadout ? 'actual-independent-private-world-prefix;not-historical-performance' : 'provided-covered-semantic-snapshot', sourceOriginMs: plan.sourceOriginMs, timeDomain: 'captured-source-time', inputRange: { startSeconds: plan.startSeconds, endSeconds: plan.endSeconds },
      timing: plan.timing, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames: outputFrames, timelineZeroSourceFrame: firstFrame,
      exactEndSourceFrame: endFrame, renderedEndSourceFrame: outputEnd,
      restoration: { mode: 'forward-native-preroll', fromSourceFrame: 0, prerollFrames: firstFrame, initialVoices: 0, maxHistorySeconds: 120, exactNativeStateExport: false },
      tail: { mode: plan.tail.mode, maxSeconds: plan.tail.maxSeconds ?? 4, derivedBoundaryReleases: plan.derivedReleases,
        truncated: [...plan.voices.values()].some(voice => voice.end > outputEnd) || plan.effectTailTruncated || plan.spatialTailTruncated, spatialTailBoundFrames: plan.spatialTailFrames, effectTailBoundFrames: plan.effectPlan?.maximumTailFrames ?? 0 },
      effectGraph: plan.effectPlan ? { definition: plan.effectPlan.definition, hash: plan.effectHash, processingRevisions: plan.effectPlan.processingRevisions, latencyFrames: plan.effectPlan.latencyFrames,
        maximumTailFrames: plan.effectPlan.maximumTailFrames, sourceBindings: plan.effectSourceBindings, controls: 'explicit-authored-defaults-not-replayed-live-gestures', scope: 'one-full-shared-owner-sum' } : null,
      ...(materialReadout?.receipt ? { capturedMaterials: materialReadout.receipt } : {}),
      definitionHash: plan.definitionHash, patchId: plan.patch.id, patchRevision: plan.patch.revision,
      engineRequirement: Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, plan.descriptor[key]])), applicationBuildId: plan.applicationBuildId,
      commands: { capturedBegins: plan.capturedBegins, capturedUpdates: plan.capturedUpdates, capturedEnds: plan.capturedEnds, derivedReleases: plan.derivedReleases, derivedLaneTransfers: plan.derivedLaneTransfers,
        scheduledNativeCalls: native.receipt.submitted, nativeAppliedFrames: 'not-reported-by-native-api', peakVoices: plan.peakVoices },
      realization: { scope: 'new-local-native-source-realization-of-immutable-intents', liveAdmissionHistoryRecreated: false, historicalHardwareTimbreRecreated: false,
        smoothingSeconds: 0.008, articulationPolicy: plan.articulation.policy, oneShotHoldPolicy: plan.owned.requiresNativeAssets ? 'selected-region-varispeed-duration-capped-at-four-seconds' : 'per-onset-effective-native-source-parameters',
        sourcePerformanceControls: materialReadout ? 'captured-material-per-onset-controls-and-recorded-physical-causes' : 'captured-controls-retained-explicit-new-target-controls-and-recorded-onset-physical-causes-applied',
        sourceControls: { ...plan.sourceControls, observedKinds: [...plan.sourceControls.observedKinds].sort(), continuousPhysicalBindings: 'not-supported-by-these-native-sources' },
        sourceBank: input.materialDescriptor || null, sourceResampling: plan.owned.requiresNativeAssets ? 'native-varispeed-source-rate-conversion' : 'none', normalization: 'none', integerClipping: 'not-applicable', dither: 'none-float-output', sharedMasterAndLimiter: 'excluded',
        nativeSourceProfile: { indexLimitedOnsets, omittedModes, qualification: 'native-source-register-plans-not-measured-alias-or-listening-evidence' } },
      nativeScheduling: native.receipt,
      sampleTailPlanning: plan.owned.requiresNativeAssets ? { mode: 'conservative-release-child-duration-from-minimum-captured-rate', sameKitChokes: [...plan.voices.values()].filter(voice => voice.chokeFrame != null).length, exactPlayheadExport: false } : null,
      stems: { mode: plan.effectPlan ? 'simultaneous-dry-lane-and-shared-effect-node-taps' : 'simultaneous-dry-lane-taps', laneIds: stemLaneIds, allCapturedLanesIncluded: [...plan.lanes].every(lane => stemLaneIds.includes(lane)),
        sharedReturns: spatialReadout ? 'captured-zone-returns-in-master;selected-creative-return-taps-separate' : plan.effectPlan ? plan.effectReturnNodeIds : 'none-in-selected-graph', recombination: spatialReadout ? 'dry-lane-taps-exclude-shared-zone-returns;master-is-one-complete-render' : plan.effectPlan ? 'dry-lanes-and-shared-node-taps-from-one-render-not-isolated-nonlinear-lane-renders' : 'linear-dry-sum-with-float32-rounding', nonlinearMaster: plan.effectPlan ? 'creative-graph-included-final-protection-excluded' : 'excluded' },
      acousticReceipt: false, qualification: 'native-pcm-not-listening-or-cross-browser-qualified', originalRecordMutated: false };
    const planes = Array.from({ length: native.channels }, (_, index) => native.buffer.getChannelData(index));
    let payload = { mode: 'causal-take', manifest, planes, firstFrame, endFrame: outputEnd, stemLaneIds };
    return Object.freeze({ get input() { return payload; }, bytes: nativeBytes, estimatedPeakBytes, release() { const released = native.release(); payload = null; return released; } });
  } catch (error) { native.release(); throw error; }
}
