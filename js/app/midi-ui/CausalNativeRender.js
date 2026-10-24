import { planCausalSourceRender } from './CausalOwnedRender.js';
import { renderNativeOfflineGraph, NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineDriver.js';

export async function prepareCausalNativeRenderInput(input, { resources, signal, onProgress = () => {}, OfflineAudioContext,
  maxWorkingBytes = 512 * 1048576 } = {}) {
  if (!NATIVE_OFFLINE_SOURCE_IDS.includes(input?.descriptor?.engineId)) throw new Error('Choose an available native causal render source.');
  signal?.throwIfAborted();
  const plan = await planCausalSourceRender({ ...input, signal, maxPlanningBytes: maxWorkingBytes }); signal?.throwIfAborted();
  const nativeBytes = plan.outputEnd * (2 + plan.stemLaneIds.length * 2) * 4;
  const estimatedPeakBytes = nativeBytes * 8 + 32 * 1048576;
  if (!Number.isSafeInteger(nativeBytes) || nativeBytes > 56 * 1048576 || !Number.isSafeInteger(estimatedPeakBytes) ||
      estimatedPeakBytes + plan.planningBytes > maxWorkingBytes) throw Object.assign(new Error('Native preroll, simultaneous taps and encoding overlap exceed the admitted workspace. Choose a shorter history or fewer stems.'), { code: 'native-render-memory-capacity' });
  const originals = new Map(input.revoice.intents.map(intent => [intent.intentId, intent])), events = [];
  let indexLimitedOnsets = 0, omittedModes = 0;
  for (const voice of plan.voices.values()) { if (voice.nativeSourcePlan?.indexLimited) indexLimitedOnsets++; omittedModes += voice.nativeSourcePlan?.omittedModes?.length || 0; }
  for (const event of plan.events) {
    if (event.frame >= plan.outputEnd) continue;
    const voice = event.voice, original = originals.get(event.intentId);
    events.push({ kind: event.kind, frame: event.frame, voiceId: voice.begin.voiceId, executionEpoch: 'offline-voice-' + voice.order, laneId: voice.laneId,
      intent: event.kind === 'begin' ? voice.begin : null, expression: event.kind === 'update' ? original.expression || {} : null,
      releaseFrame: voice.releaseAt ?? plan.outputEnd + 1, releaseSeconds: voice.parameters.releaseSeconds });
  }
  const { sampleRate, outputFrames, outputEnd, firstFrame, endFrame, stemLaneIds } = plan;
  const native = await renderNativeOfflineGraph({ patch: plan.patch, events, frames: outputEnd, sampleRate, stemLaneIds }, { resources, signal, onProgress, OfflineAudioContext });
  try {
    const manifest = { schema: 'lemmings-causal-audio-render/v1', mode: 'intent-render', operation: 'sound-only-revoice', takeId: plan.source.takeId,
      takeRevision: plan.source.takeRevision, sourceCanonicalHash: plan.source.sourceCanonicalHash, sourceVersions: plan.source.sourceVersions, intentHash: plan.intentHash,
      sourceEvidence: 'provided-covered-semantic-snapshot', sourceOriginMs: plan.sourceOriginMs, timeDomain: 'captured-source-time', inputRange: { startSeconds: plan.startSeconds, endSeconds: plan.endSeconds },
      timing: plan.timing, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames: outputFrames, timelineZeroSourceFrame: firstFrame,
      exactEndSourceFrame: endFrame, renderedEndSourceFrame: outputEnd,
      restoration: { mode: 'forward-native-preroll', fromSourceFrame: 0, prerollFrames: firstFrame, initialVoices: 0, maxHistorySeconds: 120, exactNativeStateExport: false },
      tail: { mode: plan.tail.mode, maxSeconds: plan.tail.maxSeconds ?? 4, derivedBoundaryReleases: plan.derivedReleases,
        truncated: [...plan.voices.values()].some(voice => voice.end > outputEnd) },
      definitionHash: plan.definitionHash, patchId: plan.patch.id, patchRevision: plan.patch.revision,
      engineRequirement: Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, plan.descriptor[key]])), applicationBuildId: plan.applicationBuildId,
      commands: { capturedBegins: plan.capturedBegins, capturedUpdates: plan.capturedUpdates, capturedEnds: plan.capturedEnds, derivedReleases: plan.derivedReleases,
        scheduledNativeCalls: native.receipt.submitted, nativeAppliedFrames: 'not-reported-by-native-api', peakVoices: plan.peakVoices },
      realization: { scope: 'new-local-native-source-realization-of-immutable-intents', liveAdmissionHistoryRecreated: false, historicalHardwareTimbreRecreated: false,
        smoothingSeconds: 0.008, articulationPolicy: plan.articulation.policy, oneShotHoldPolicy: 'per-onset-effective-native-source-parameters',
        sourcePerformanceControls: 'captured-controls-retained-new-target-defaults-and-recorded-onset-physical-causes-applied',
        sourceControls: { ...plan.sourceControls, observedKinds: [...plan.sourceControls.observedKinds].sort(), continuousPhysicalBindings: 'not-supported-by-these-native-sources' },
        sourceBank: null, sourceResampling: 'none', normalization: 'none', integerClipping: 'not-applicable', dither: 'none-float-output', sharedMasterAndLimiter: 'excluded',
        nativeSourceProfile: { indexLimitedOnsets, omittedModes, qualification: 'native-source-register-plans-not-measured-alias-or-listening-evidence' } },
      nativeScheduling: native.receipt,
      stems: { mode: 'simultaneous-dry-lane-taps', laneIds: stemLaneIds, allCapturedLanesIncluded: [...plan.lanes].every(lane => stemLaneIds.includes(lane)),
        sharedReturns: 'none-in-selected-graph', recombination: 'linear-dry-sum-with-float32-rounding', nonlinearMaster: 'excluded' },
      acousticReceipt: false, qualification: 'native-pcm-not-listening-or-cross-browser-qualified', originalRecordMutated: false };
    const planes = Array.from({ length: native.channels }, (_, index) => native.buffer.getChannelData(index));
    let payload = { mode: 'causal-take', manifest, planes, firstFrame, endFrame: outputEnd, stemLaneIds };
    return Object.freeze({ get input() { return payload; }, bytes: nativeBytes, estimatedPeakBytes, release() { const released = native.release(); payload = null; return released; } });
  } catch (error) { native.release(); throw error; }
}
