import { validateEffectSourceBindings } from './EffectSourceBindings.js';
import { renderNativeOfflineGraph } from './NativeOfflineDriver.js';
import { prepareEffectRenderPlan, validateOwnedConvolutionSourceReceipt } from './EffectRenderPlan.js';
import { effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code }); };
export async function prepareCausalOwnedConvolutionInput(source, workerReceipt, patch, { resources, resourceBudget, signal,
  getMaterialProvider, jobs, OfflineAudioContext, admission, isCurrent = () => true, onProgress = () => {}, maxWorkingBytes = 512 * 1048576 } = {}) {
  signal?.throwIfAborted();
  const manifest = source?.manifest, returns = manifest?.stems?.sharedReturns, sourceLaneIds = source?.laneIds ?? manifest?.stems?.laneIds;
  if (source?.schema !== 'lemmings-causal-source-pcm/v1' || !OWNED_SOURCE_IDS.includes(patch?.engineId) ||
      source.scope !== 'complete-dry-owned-source-history-awaiting-native-body-not-a-final-render' || manifest?.schema !== 'lemmings-causal-audio-render/v1' ||
      manifest.engineRequirement?.engineId !== patch.engineId || manifest.patchId !== patch.id || manifest.patchRevision !== patch.revision ||
      workerReceipt?.method !== 'dedicated-worker' || workerReceipt.kind !== 'render-causal-source-pcm' || workerReceipt.sourceRevision !== manifest.sourceCanonicalHash ||
      workerReceipt.executionIdentity?.activeExecution !== 'bound' || workerReceipt.executionIdentity.buildId !== manifest.applicationBuildId ||
      !Array.isArray(manifest.stems?.laneIds) || !Array.isArray(returns) || !manifest.effectGraph?.definition || source.sampleRate !== manifest.sampleRate ||
      source.frames !== manifest.renderedEndSourceFrame || !Number.isSafeInteger(manifest.timelineZeroSourceFrame) || manifest.timelineZeroSourceFrame < 0 ||
      manifest.frames !== source.frames - manifest.timelineZeroSourceFrame || !Array.isArray(source.planes) || !Array.isArray(sourceLaneIds) || sourceLaneIds.length > 15 || new Set(sourceLaneIds).size !== sourceLaneIds.length || source.planes.length !== 2 + sourceLaneIds.length * 2)
    fail('source-pcm-result-mismatch', 'Native body preparation requires the exact complete source history from the admitted owned-source worker.');
  if (await hashData(patch) !== manifest.definitionHash) fail('source-pcm-definition-mismatch', 'The source PCM stage belongs to a different immutable instrument definition.');
  const plan = prepareEffectRenderPlan(manifest.effectGraph.definition, source.sampleRate, returns, { nativeConvolution: true, nativeOwnedProcessors: true }), hash = await effectGraphHash(plan);
  if (!plan.impulseCount || hash !== manifest.effectGraph.hash || plan.latencyFrames !== manifest.effectGraph.latencyFrames || plan.maximumTailFrames !== manifest.effectGraph.maximumTailFrames ||
      canonicalDataText(plan.processingRevisions).text !== canonicalDataText(manifest.effectGraph.processingRevisions).text)
    fail('source-pcm-effect-mismatch', 'Owned source history selected a different native body graph.');
  if (plan.sidechainInputs.length) { const bindings = validateEffectSourceBindings(plan, manifest.effectGraph.sourceBindings);
    if (canonicalDataText(bindings.sourceLaneIds).text !== canonicalDataText(source.sourceLaneIds).text || bindings.laneIds.some(id => !sourceLaneIds.includes(id))) fail('source-pcm-sidechain-mismatch', 'Source PCM omitted a detector lane or its captured source identity.'); }
  const nativeBytes = source.frames * (2 + (manifest.stems.laneIds.length + returns.length) * 2) * 4;
  const sourceBytes = source.planes.reduce((sum, plane) => sum + (plane?.byteLength || 0), 0), outputBytes = manifest.frames * 8 * (1 + manifest.stems.laneIds.length + returns.length);
  const estimatedPeakBytes = nativeBytes * 8 + outputBytes * 4 + 32 * 1048576;
  const nativeWorkspace = nativeBytes + sourceBytes * 2 + plan.impulseDecodedBytes * 6 + plan.nativeNodeEstimateBytes + plan.stateBytes + 34 * 1048576;
  if (!Number.isSafeInteger(nativeBytes) || nativeBytes > 56 * 1048576 || !Number.isSafeInteger(estimatedPeakBytes) || !Number.isSafeInteger(maxWorkingBytes) ||
      Math.max(nativeWorkspace, nativeBytes + estimatedPeakBytes) > maxWorkingBytes) fail('native-owned-render-memory-capacity', 'Complete owned-source history, native convolution and encoding overlap exceed the admitted workspace. Choose fewer taps or a shorter history.');
  const native = await renderNativeOfflineGraph({ patch, events: [], frames: source.frames, sampleRate: source.sampleRate, stemLaneIds: manifest.stems.laneIds,
    effectGraph: plan.definition, effectReturnNodeIds: returns,
    sourcePcm: Object.fromEntries(['frames', 'channels', 'sampleRate', 'planes', 'planeByteHashes', 'planeHashByteOrder', ...(source.laneIds ? ['laneIds'] : []), ...(source.sourceLaneIds ? ['sourceLaneIds'] : [])].map(key => [key, source[key]])) },
  { resources, resourceBudget, signal, getMaterialProvider, jobs, OfflineAudioContext, admission, isCurrent, onProgress });
  try {
    const completed = { ...manifest, nativeScheduling: native.receipt,
      sourcePcmProducer: { schema: 'lemmings-causal-source-pcm-receipt/v1', frames: source.frames, channels: source.channels, laneIds: sourceLaneIds.slice(), sourceLaneIds: (source.sourceLaneIds || sourceLaneIds).slice(), sampleRate: source.sampleRate,
        planeByteHashes: source.planeByteHashes.slice(), planeHashByteOrder: source.planeHashByteOrder,
        sourceCanonicalHash: manifest.sourceCanonicalHash, engineRequirement: manifest.engineRequirement, applicationBuildId: manifest.applicationBuildId,
        worker: { method: workerReceipt.method, kind: workerReceipt.kind, sourceRevision: workerReceipt.sourceRevision, executionIdentity: workerReceipt.executionIdentity },
        scope: 'same-owned-source-kernel-full-history-before-native-body-and-crop' } };
    validateOwnedConvolutionSourceReceipt(completed);
    const planes = Array.from({ length: native.channels }, (_, channel) => native.buffer.getChannelData(channel));
    let payload = { mode: 'causal-take', manifest: completed, planes, firstFrame: manifest.timelineZeroSourceFrame, endFrame: source.frames, stemLaneIds: manifest.stems.laneIds };
    source = null;
    return Object.freeze({ get input() { return payload; }, bytes: nativeBytes, estimatedPeakBytes,
      release() { const released = native.release(); payload = null; return released; } });
  } catch (error) { native.release(); throw error; }
}
