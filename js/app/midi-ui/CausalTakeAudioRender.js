import { createCausalRenderLaneResolver } from '../procgen/workstation/CausalLaneRouting.js';
import { prepareGraftComparison } from '../../midi/content/GraftComparison.js';
import { prepareCapturedEffectReplay } from './CapturedEffectReplay.js';
import { prepareCausalOwnedConvolutionInput } from './CausalOwnedConvolutionRender.js';
import { prepareCausalNativeRenderInput } from './CausalNativeRender.js';
import { getNativeOfflineProfile, NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineProfile.js';
import { prepareNativeRenderMaterial } from './NativeRenderMaterial.js';
import { prepareOwnedRenderMaterial } from './OwnedRenderMaterial.js';
import { createAudioResourceLeases } from './AudioResourceLeases.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
import { querySoundOnlyRevoiceOwned } from '../procgen/workstation/CausalTake.js';
import { retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { createCausalRenderTiming } from './CausalRenderTiming.js';
import { prepareEffectRenderPlan } from './EffectRenderPlan.js';
import { effectGraphHash } from '../../midi/content/EffectGraphRevision.js';

export const CAUSAL_RENDER_SINE = freezeData({ schemaVersion: 2, id: 'causal-render.sine', revision: 1, name: 'Sine revoice', author: 'LemmingsJS-MIDI', tags: ['revoice'],
  engineId: 'worklet-sine', engineVersion: 1, parameters: { attackSeconds: 0.008, decaySeconds: 0.05, sustain01: 0.7, releaseSeconds: 0.04, gain01: 0.5, pan01: 0 },
  modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 64, steal: 'reject' }, mix: { gain01: 0.6, pan01: 0 } });
export const CAUSAL_RENDER_SOURCES = Object.freeze([
  Object.freeze({ id: 'worklet-sine', label: 'Sine', definition: CAUSAL_RENDER_SINE }),
  ...[['worklet-pluck', 'Seeded pluck'], ['worklet-choir', 'Artificial formants'], ['worklet-spectrum', 'Spectral frames'], ['native-oscillator', 'Native oscillator'], ['native-fm', 'Native FM'], ['native-modal', 'Native modal body']].map(([id, label]) => {
    const profile = NATIVE_OFFLINE_SOURCE_IDS.includes(id) ? getNativeOfflineProfile(id) : getOwnedSourceProfile(id), parameters = Object.fromEntries(Object.entries(profile.fields).map(([name, spec]) => [name, spec[2]]));
    return Object.freeze({ id, label, definition: freezeData({ schemaVersion: 2, id: 'causal-render.' + id, revision: 1, name: label + ' revoice', author: 'LemmingsJS-MIDI', tags: ['revoice'],
      engineId: id, engineVersion: 1, parameters, modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: profile.voices, steal: 'reject' }, mix: { gain01: 0.6, pan01: 0 } }) });
  })
]);
const failure = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'CausalRenderError', code, ...detail });
const HASH = /^[a-f0-9]{64}$/;
let nextOwner = 0;

export function createCausalTakeAudioRenderer({ journal, resourceBudget, jobs = backgroundJobService, getCatalog = getNativeInstrumentCatalog,
  sourceMaxBytes = 4194304, getMaterialProvider = null, onState = () => {} } = {}) {
  if (!journal?.queryOwned || !journal?.openTakeOwned || !resourceBudget?.reserve || !resourceBudget?.release || typeof jobs?.compute !== 'function' ||
      typeof getCatalog !== 'function' || getMaterialProvider != null && typeof getMaterialProvider !== 'function' || typeof onState !== 'function' || !Number.isSafeInteger(sourceMaxBytes) || sourceMaxBytes < 32768 || sourceMaxBytes > 8 * 1048576)
    throw new TypeError('Causal rendering requires owned journal sources, shared budgets and worker execution.');
  const ownerId = 'causal-audio-render-' + (++nextOwner), retirement = createProcgenRetirementScope(), unresolved = new Set(), bundles = new Set();
  const materialResources = createAudioResourceLeases({ resourceBudget, ownerPrefix: ownerId + '-material' });
  let disposed = false, active = null, prepared = null, serial = 0, phase = 'idle', progress = null, lastError = null;
  const state = () => Object.freeze({ schema: 'lemmings-causal-render-state/v1', phase, disposed, active: !!active, progress,
    prepared: prepared?.metadata() || null, materialResources: materialResources.diagnostics(), unresolvedRetirement: unresolved.size, error: lastError,
    capabilities: Object.freeze({ intentSine: true, intentOwnedSources: OWNED_SOURCE_IDS, intentNativeSources: NATIVE_OFFLINE_SOURCE_IDS, nativeOfflineAvailable: typeof globalThis.OfflineAudioContext === 'function', ownedEffects: Object.freeze(['gain', 'feedback-delay', 'nonlinear-chain']), nativeEffects: true, nativeConvolution: true, nativeConvolutionSources: Object.freeze([...OWNED_SOURCE_IDS, ...NATIVE_OFFLINE_SOURCE_IDS]), nativeConvolutionTopology: 'one-full-native-and-owned-worklet-graph-with-offline-completion-fences', maxSharedEffectTaps: 8, capturedPcm: false, admissionHistory: false, arbitraryOfflineEngines: false, maxSeconds: 120, maxOutputBytes: 64 * 1048576 }) });
  const report = () => { try { onState(state()); } catch { /* Rendering ownership does not depend on view callbacks. */ } };
  const discardArtifact = async artifact => {
    artifact.discard(); await artifact.digest();
    const state = artifact.metadata();
    if (state.activeLeases || state.budgetState === 'failed-or-unknown') throw failure('render-artifact-retirement-unknown', 'A discarded render still has an active consumer or unresolved reservation.');
  };
  const makeBundle = (entries, manifest) => {
    const scope = createProcgenRetirementScope(); let discarded = false;
    const bundle = Object.freeze({ files: Object.freeze(entries.map(entry => Object.freeze(entry))), manifest: freezeData(manifest),
      metadata: () => Object.freeze({ sourceTakeId: manifest.takeId, sourceCanonicalHash: manifest.sourceCanonicalHash, sampleRate: manifest.sampleRate,
        frames: manifest.frames, mode: manifest.mode, discarded, files: Object.freeze(entries.map(entry => Object.freeze({ id: entry.id, label: entry.label, artifact: entry.artifact.metadata() }))) }),
      discard() {
        if (scope.getReceipt()) return scope.getReceipt(); discarded = true; if (prepared === bundle) prepared = null;
        const receipt = scope.retire(entries.map(entry => ({ name: 'render-file-' + entry.id, run: () => discardArtifact(entry.artifact) })));
        receipt.completion.then(result => { if (result.outcome === 'complete') bundles.delete(bundle); report(); }); report(); return receipt;
      }, retirementState: () => scope.getReceipt() }); bundles.add(bundle); return bundle;
  };
  const prepare = ({ takeId, takeRevision, definition = null, materialReference = null, sampleRate = 48000, startSeconds = 0, endSeconds,
    tail = { mode: 'exact-crop' }, stemLaneIds = [], includeAllLaneStems = false, restorationMode = 'forward-preroll', effectGraph = null, effectReturnNodeIds = [], capturedEffects = false, includeCapturedReturn = true, graftComparison = null, signal: externalSignal, isCurrent = () => true } = {}) => {
    externalSignal?.throwIfAborted();
    if (graftComparison !== null && !['exciter-only', 'body-only'].includes(graftComparison) || typeof capturedEffects !== 'boolean' || typeof includeCapturedReturn !== 'boolean' || capturedEffects && (effectGraph !== null || restorationMode !== 'forward-preroll') || !['forward-preroll', 'owned-state-cut'].includes(restorationMode) || disposed || active || unresolved.size || typeof takeId !== 'string' || !takeId || takeId.length > 256 || ![44100, 48000, 96000].includes(sampleRate) ||
        !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds >= 120 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120 ||
        !Array.isArray(stemLaneIds) || stemLaneIds.length > 16 || stemLaneIds.some(lane => typeof lane !== 'string' || !lane || lane.length > 128) ||
        new Set(stemLaneIds).size !== stemLaneIds.length || typeof includeAllLaneStems !== 'boolean' || typeof isCurrent !== 'function' || effectGraph != null && (!effectGraph || Object.getPrototypeOf(effectGraph) !== Object.prototype) ||
        !Array.isArray(effectReturnNodeIds) || effectReturnNodeIds.length > 8 || new Set(effectReturnNodeIds).size !== effectReturnNodeIds.length || effectReturnNodeIds.some(id => typeof id !== 'string' || !id || id.length > 128) || !effectGraph && effectReturnNodeIds.length)
      return Promise.reject(failure('render-unavailable', 'Choose a bounded causal source, effect graph and tap inventory.'));
    const ordinal = ++serial, controller = new AbortController(), operation = { controller, source: null, job: null, sourceHanded: false, sourceSettled: null,
      workspace: null, material: null, native: null, pcmJob: null, producerState: null, promise: null, retirement: null };
    let settleSource, rejectSource; operation.sourceSettled = new Promise((resolve, reject) => { settleSource = resolve; rejectSource = reject; }); operation.sourceSettled.catch(() => {});
    const cancel = () => { controller.abort(externalSignal.reason); phase = 'retiring'; report(); };
    externalSignal?.addEventListener('abort', cancel, { once: true }); if (externalSignal?.aborted) cancel();
    active = operation; phase = 'preparing-source'; progress = null; lastError = null; report();
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw failure('stale-render-source', 'The selected render request has changed.'); };
    operation.promise = (async () => {
      const candidates = []; let bundle = null, result = null, originalError = null, input = null, revoice = null;
      try {
        operation.workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId + ':' + ordinal, kind: 'causal-render-input', bytes: 2 * 1048576 });
        const reference = materialReference ? validateSoundContentReference(materialReference) : null;
        let patch = cloneData(definition || reference?.definition || CAUSAL_RENDER_SINE, { maxBytes: 262144, maxNodes: 16384 });
        const baseDefinitionHash = await hashData(patch), comparison = graftComparison ? await prepareGraftComparison(patch, graftComparison) : null; check();
        if (comparison) patch = comparison.definition;
        const policy = cloneData(tail, { maxBytes: 1024, maxNodes: 32 }); let lanes = Object.freeze(stemLaneIds.slice());
        let effectReplay = null; let graph = effectGraph ? cloneData(effectGraph, { maxBytes: 65536, maxNodes: 8192 }) : null, returns = Object.freeze(effectReturnNodeIds.slice());
        if (!policy || Object.getPrototypeOf(policy) !== Object.prototype || !['exact-crop', 'bounded-natural', 'boundary-release'].includes(policy.mode) || Object.keys(policy).some(key => !['mode', 'maxSeconds'].includes(key)) || !Number.isFinite(policy.maxSeconds ?? 4) || (policy.maxSeconds ?? 4) < 0 || (policy.maxSeconds ?? 4) > (graph || capturedEffects ? 30 : 4))
          throw failure('render-tail-policy', 'Choose a bounded source/effect tail policy.');
        const definitionHash = await hashData(patch), catalog = await getCatalog(); check();
        const descriptor = catalog.descriptors.find(entry => entry.engineId === patch.engineId && entry.engineVersion === patch.engineVersion);
        const native = NATIVE_OFFLINE_SOURCE_IDS.includes(patch.engineId), profile = native ? getNativeOfflineProfile(patch.engineId) : OWNED_SOURCE_IDS.includes(patch.engineId) ? getOwnedSourceProfile(patch.engineId) : null;
        if (catalog.state !== 'bound-application-engines' || !profile?.controlReferenceRender || !descriptor || !HASH.test(descriptor.artifactHash))
          throw failure('engine-identity-unbound', 'Prepare this render from an immutable application build with the selected owned source.');
        if (native && restorationMode !== 'forward-preroll') throw failure('restore-mode-unavailable', 'Native sources reconstruct from covered history; their hidden DSP state cannot use an owned state cut.');
        if (capturedEffects) {
          if (native) throw failure('effect-command-source-unavailable', 'Captured effect commands currently render with owned sources. Select an owned source or explicit static effects.');
          const requirement = Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, descriptor[key]]));
          operation.source = await querySoundOnlyRevoiceOwned({ journal, resourceBudget, jobs, takeId, takeRevision, includeEffects: true,
            soundPatch: { id: patch.id, revision: patch.revision, definitionHash, engineRequirement: requirement }, executionEpoch: ownerId + ':' + ordinal,
            limit: 8192, maxIntents: 32768, maxBytes: sourceMaxBytes, signal: controller.signal }); check(); revoice = operation.source.value;
          operation.workspace.resize(4 * 1048576 + operation.source.receipt.retainedBytes * 4);
          effectReplay = await prepareCapturedEffectReplay(revoice, sampleRate, Math.round(endSeconds * sampleRate)); check(); graph = effectReplay.definition;
          if (includeCapturedReturn && !graph.nodes.some(node => node.id === 'return')) throw failure('effect-return-unavailable', 'This captured graph has no named return. Disable the shared return WAV to render its complete output.');
          returns = Object.freeze(includeCapturedReturn ? ['return'] : []);
        }
        const effectPlan = graph ? prepareEffectRenderPlan(graph, sampleRate, returns, { nativeConvolution: true, nativeOwnedProcessors: true }) : null, effectHash = effectPlan ? await effectGraphHash(effectPlan) : null;
        const effectDefinitionHash = effectPlan ? await hashData(effectPlan.definition) : null; check();
        const ownedConvolution = !native && !!effectPlan?.impulseCount;
        if (effectPlan?.impulseCount && (!getMaterialProvider || typeof globalThis.OfflineAudioContext !== 'function')) throw failure('native-body-unavailable', 'Native body rendering requires the shared material provider and OfflineAudioContext.');
        if (effectPlan?.impulseCount && lanes.length + returns.length > 15) throw failure('native-convolution-tap-capacity', 'Choose at most fifteen combined dry lanes and shared body returns.');
        if (reference && (reference.definitionHash !== baseDefinitionHash || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => reference.engineRequirement[key] === descriptor[key])))
          throw failure('engine-revision-mismatch', 'The selected immutable instrument definition or renderer differs from the saved reference.');
        if (profile.requiresPCM || profile.requiresNativeAssets) {
          if (!reference || !getMaterialProvider) throw failure('material-reference-required', 'Choose a pinned installed sample source for this render.');
          phase = 'preparing-material'; report();
          operation.material = await (profile.requiresNativeAssets ? prepareNativeRenderMaterial : prepareOwnedRenderMaterial)({ provider: getMaterialProvider(), resources: materialResources, definition: patch, reference,
            engineDescriptors: catalog.descriptors, sampleRate, owner: ownerId, generation: ordinal, signal: controller.signal, isCurrent: () => !disposed && isCurrent() }); check();
        }
        const engineRequirement = Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, descriptor[key]]));
        operation.source ||= await querySoundOnlyRevoiceOwned({ journal, resourceBudget, jobs, takeId, takeRevision,
          soundPatch: { id: patch.id, revision: patch.revision, definitionHash, engineRequirement }, executionEpoch: ownerId + ':' + ordinal,
          limit: 8192, maxIntents: 32768, maxBytes: sourceMaxBytes, signal: controller.signal }); check();
        revoice = operation.source.value;
        if (revoice.nextSequence != null) throw failure('render-source-capacity', 'This take exceeds the bounded source window. Prepare a shorter qualified take instead of silently dropping later intent pages.');
        if (includeAllLaneStems) {
          const timing = createCausalRenderTiming(revoice, sampleRate), cutoff = Math.round(endSeconds * sampleRate);
          const resolveLane = createCausalRenderLaneResolver(revoice);
          lanes = Object.freeze([...new Set(revoice.intents.flatMap((intent, index) => (intent.kind === 'begin' || intent.kind === 'update' && intent.articulationState?.transfer) && timing.frameFor(intent) < cutoff ? [resolveLane(intent, index)] : []))].sort());
          if (lanes.length > (native ? 15 : 16) || effectPlan?.impulseCount && lanes.length + returns.length > 15) throw failure('stem-capacity', 'This range exceeds the selected engine stem limit (' + (native ? 15 : 16) + '). Render the complete graph or select fewer lanes.');
        }
        const frames = Math.round((endSeconds - startSeconds + (policy.mode === 'exact-crop' ? 0 : policy.maxSeconds ?? 4)) * sampleRate);
        const fileCount = lanes.length + returns.length + 1, pcmBytes = frames * 8 * fileCount, sourceFootprint = operation.source.receipt.retainedBytes;
        operation.workspace.resize(2 * 1048576 + sourceFootprint + (effectReplay ? 4 * 1048576 + effectReplay.events.length * 2048 : 0) + (native ? revoice.intents.length * Math.max(profile.requiresPCMSet ? 4096 : 1024, Object.keys(profile.fields).length * 256) : 0));
        const binding = { takeRevision: revoice.takeRevision, sourceCanonicalHash: revoice.sourceCanonicalHash };
        let estimatedPeakBytes = sourceFootprint * 6 + pcmBytes * 4 + revoice.intents.length * Math.max(profile.requiresPCMSet ? 4096 : 1024, Object.keys(profile.fields).length * 256) + 32 * 1048576 + (operation.material?.descriptor.bytes || 0) * 6 + (restorationMode === 'owned-state-cut' ? 2 * profile.sourceBytes({ sampleRate, pcm: operation.material?.descriptor, voices: patch.voicePolicy.maxVoices }) + 4 * 1048576 : 0) + (effectPlan ? effectPlan.stateBytes + 4 * 1048576 : 0);
        if (!Number.isSafeInteger(pcmBytes) || pcmBytes + 262208 * fileCount > 64 * 1048576 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes > 512 * 1048576)
          throw failure('render-memory-capacity', 'Choose a shorter output range or fewer stems to fit source, PCM, encoding and transfer overlap.');
        input = { ...(effectReplay ? { capturedEffects: true, effectReplayHash: effectReplay.hash } : {}), revoice, definition: patch, engineRequirement, sampleRate, startSeconds, endSeconds, tail: policy, stemLaneIds: lanes, restorationMode,
          ...(effectPlan ? { effectGraph: effectPlan.definition, effectReturnNodeIds: returns } : {}), ...(operation.material && !native ? { pcm: operation.material.payload } : {}) };
        phase = native ? 'rendering-native' : 'rendering'; report();
        if (native) {
          operation.native = await prepareCausalNativeRenderInput({ ...input, descriptor, applicationBuildId: catalog.executionIdentity.buildId, ...(profile.requiresNativeAssets ? { nativeAssets: operation.material.assets, materialDescriptor: operation.material.descriptor } : {}) },
            { resources: materialResources, resourceBudget, getMaterialProvider, jobs, signal: controller.signal, isCurrent: () => !disposed && isCurrent(), maxWorkingBytes: 512 * 1048576 - sourceFootprint * 6 - (operation.material?.descriptor.bytes || 0),
              onProgress: value => { if (!disposed && active === operation) { progress = Object.freeze(value); report(); } } }); check();
          estimatedPeakBytes = operation.native.estimatedPeakBytes; input = operation.native.input;
          phase = 'encoding-native'; report();
        }
        if (ownedConvolution) {
          const historyBytes = Math.round((endSeconds + (policy.mode === 'exact-crop' ? 0 : policy.maxSeconds ?? 4)) * sampleRate) * (1 + lanes.length) * 8;
          const stagePeak = Math.max(estimatedPeakBytes, historyBytes * 4 + (restorationMode === 'owned-state-cut' ? 2 * profile.sourceBytes({ sampleRate, pcm: operation.material?.descriptor, voices: patch.voicePolicy.maxVoices }) + 4 * 1048576 : 0) + sourceFootprint * 6 + revoice.intents.length * Math.max(profile.requiresPCMSet ? 4096 : 1024, Object.keys(profile.fields).length * 256) + 32 * 1048576 + (operation.material?.descriptor.bytes || 0) * 6);
          if (!Number.isSafeInteger(historyBytes) || historyBytes > 56 * 1048576 || !Number.isSafeInteger(stagePeak) || stagePeak > 512 * 1048576) throw failure('source-pcm-capacity', 'Complete source history exceeds the native body profile. Choose fewer taps or a shorter history.');
          phase = 'rendering-source-pcm'; report();
          operation.pcmJob = await jobs.compute({ kind: 'render-causal-source-pcm', ownerId, ownerEpoch: ordinal, sourceRevision: revoice.sourceCanonicalHash,
            inputBytes: sourceMaxBytes + 262144 + (operation.material?.descriptor.bytes || 0), maxBytes: sourceMaxBytes + 262144 + (operation.material?.descriptor.bytes || 0), estimatedPeakBytes: stagePeak,
            priority: 'background', budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !disposed && isCurrent(), deadlineMs: 180000,
            prepareInput: () => { operation.sourceHanded = true; return input; },
            releasePreparedInput: () => { try { if (operation.source) retireCausalRead(operation.source); operation.source = null; settleSource(); return true; } catch (error) { rejectSource(error); throw error; } },
            onProgress: value => { if (!disposed && active === operation) { progress = Object.freeze(value); report(); } } }); check();
          phase = 'rendering-native-body'; report();
          operation.native = await prepareCausalOwnedConvolutionInput(operation.pcmJob.value, operation.pcmJob.receipt, patch,
            { resources: materialResources, resourceBudget, getMaterialProvider, jobs, signal: controller.signal, isCurrent: () => !disposed && isCurrent(),
              maxWorkingBytes: 512 * 1048576 - sourceFootprint * 6 - (operation.material?.descriptor.bytes || 0) - operation.pcmJob.receipt.retainedBytes,
              onProgress: value => { if (!disposed && active === operation) { progress = Object.freeze(value); report(); } } }); check();
          operation.pcmJob.release();
          if (!['released', 'canceled'].includes(operation.pcmJob.retirementState().phase)) throw failure('source-pcm-retirement-unknown', 'Source PCM remains reserved after native body completion.');
          operation.pcmJob = null; input = operation.native.input; estimatedPeakBytes = operation.native.estimatedPeakBytes; phase = 'encoding-native'; report();
        }
        const workerMaxBytes = native || ownedConvolution ? operation.native.bytes + 262144 : sourceMaxBytes + 262144 + (operation.material?.descriptor.bytes || 0);
        operation.job = await jobs.compute({ kind: native || ownedConvolution ? 'encode-native-render' : 'render-causal-sine-take', ownerId, ownerEpoch: ordinal, sourceRevision: revoice.sourceCanonicalHash,
          inputBytes: workerMaxBytes, maxBytes: workerMaxBytes, estimatedPeakBytes, priority: 'background', budgetAdapter: resourceBudget,
          signal: controller.signal, isCurrent: () => !disposed && isCurrent(), deadlineMs: 180000,
          prepareInput: () => { operation.sourceHanded = true; return input; },
          releasePreparedInput: () => { try { if (operation.source) retireCausalRead(operation.source); operation.source = null; settleSource(); return true; }
          catch (error) { rejectSource(error); throw error; } },
          onProgress: value => { if (!disposed && active === operation) { progress = Object.freeze({ phase: value.phase, completedUnits: value.completedUnits, totalUnits: value.totalUnits }); report(); } }
        }); input = null; revoice = null; check();
        const value = operation.job.value, manifest = value?.manifest;
        if (operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity?.activeExecution !== 'bound' || manifest?.schema !== 'lemmings-causal-audio-render/v1' ||
            manifest.applicationBuildId !== operation.job.receipt.executionIdentity.buildId || manifest.takeId !== takeId || manifest.takeRevision !== binding.takeRevision ||
            manifest.sourceCanonicalHash !== binding.sourceCanonicalHash || manifest.definitionHash !== definitionHash || manifest.sampleRate !== sampleRate ||
            manifest.timelineZeroSourceFrame !== Math.round(startSeconds * sampleRate) || manifest.exactEndSourceFrame !== Math.round(endSeconds * sampleRate) || operation.material && (profile.requiresNativeAssets ? await hashData(manifest.realization?.sourceBank) !== await hashData(operation.material.descriptor) : manifest.realization?.sourceBank?.bankHash !== operation.material.descriptor.bankHash) ||
            !Array.isArray(value.files) || value.files.length !== fileCount || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => manifest.engineRequirement?.[key] === engineRequirement[key]))
          throw failure('render-result-mismatch', 'The worker result differs from the selected immutable source, range or renderer.');
        if (effectPlan ? manifest.effectGraph?.hash !== effectHash || !manifest.effectGraph.definition || !manifest.effectGraph.processingRevisions || !Array.isArray(manifest.stems?.sharedReturns) || await hashData(manifest.effectGraph.definition) !== effectDefinitionHash ||
            canonicalDataText(manifest.effectGraph.processingRevisions).text !== canonicalDataText(effectPlan.processingRevisions).text || manifest.effectGraph.latencyFrames !== effectPlan.latencyFrames || manifest.effectGraph.maximumTailFrames !== effectPlan.maximumTailFrames ||
            manifest.effectGraph.controls !== (effectReplay ? 'captured-native-API-commands-new-owned-realization' : 'explicit-authored-defaults-not-replayed-live-gestures') || effectReplay && manifest.effectGraph.commandReplay?.hash !== effectReplay.hash || canonicalDataText(manifest.stems.sharedReturns).text !== canonicalDataText(returns).text : manifest.effectGraph != null)
          throw failure('render-effect-mismatch', 'The worker result differs from the selected exact effect graph or simultaneous shared taps.');
        let totalBytes = 0;
        for (let index = 0; index < value.files.length; index++) {
          const file = value.files[index];
          const lane = index > 0 && index <= lanes.length, returnNodeId = index > lanes.length ? returns[index - 1 - lanes.length] ?? null : null;
          if (!(file.bytes instanceof Uint8Array) || !HASH.test(file.manifest?.pcmHash) || file.manifest.sourceCanonicalHash !== manifest.sourceCanonicalHash ||
              file.manifest.frames !== manifest.frames || file.manifest.sampleRate !== sampleRate || file.manifest.laneId !== (lane ? lanes[index - 1] : null) || (file.manifest.returnNodeId ?? null) !== returnNodeId ||
              lane && file.manifest.tap !== 'captured-lane-dry' || returnNodeId && file.manifest.tap !== 'shared-effect-node-output' || effectPlan && (file.manifest.effectGraph?.hash !== effectHash || !index && file.manifest.tap !== 'complete-owned-effect-graph-pre-master') ||
              (totalBytes += file.bytes.byteLength) > 64 * 1048576) throw failure('render-result-mismatch', 'A rendered PCM file omitted its exact frame/source/tap inventory.');
          const label = lane ? 'Captured lane ' + lanes[index - 1] + ' · dry' : returnNodeId ? 'Shared effect ' + returnNodeId + ' · same full graph' : 'Complete ' + patch.engineId + (effectPlan ? ' and effect' : '') + ' graph · pre-master';
          const filename = lane ? 'lane-' + index : returnNodeId ? 'effect-' + index + '-' + returnNodeId.replace(/[^A-Za-z0-9._-]/g, '_') : 'master';
          const artifact = prepareExportArtifact({ bytes: file.bytes, immutableSourceRef: [binding.sourceCanonicalHash, definitionHash, effectHash || 'dry-source', sampleRate, startSeconds, endSeconds, policy.mode, returnNodeId || (lane ? lanes[index - 1] : 'master'), file.manifest.pcmHash].join(':'),
            formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: 'take-' + binding.sourceCanonicalHash.slice(0, 12) + '-' + filename + '.wav',
            coverageLossReportRef: 'embedded-lmjs-render-manifest', maxBytes: 64 * 1048576, budgetAdapter: resourceBudget }); candidates.push({ id: String(index), label, artifact, manifest: freezeData(file.manifest) });
        }
        check(); bundle = makeBundle(candidates, manifest); result = Object.freeze({ bundle, receipt: operation.job.receipt, ...(comparison ? { comparison: comparison.comparison } : {}) });
      } catch (error) {
        if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
        operation.producerState = error.backgroundRetirement || null; originalError = error; lastError = String(error?.message || 'Causal render failed.').slice(0, 512); }
      finally {
        input = revoice = null;
        externalSignal?.removeEventListener('abort', cancel); phase = 'retiring'; report();
        operation.retirement = createProcgenRetirementScope().retire([
          { name: 'render-result', run: () => { operation.job?.release(); const current = operation.job?.retirementState?.();
            if (current && !['released', 'canceled'].includes(current.phase)) throw failure('render-retirement-unknown', 'Rendered computation retirement is unresolved.'); } },
          { name: 'material-preparation-fault', run: () => originalError?.retirement },
          { name: 'render-material', run: () => {
            if (operation.producerState && !['released', 'canceled'].includes(operation.producerState.phase)) throw failure('render-retirement-unknown', 'Render input is still owned by its producer.');
            return operation.material?.release();
          } },
          { name: 'source-pcm-producer', run: () => {
            if (originalError?.retirement && originalError.retirement.outcome !== 'complete') throw failure('source-pcm-retirement-unknown', 'Native source PCM custody remains unresolved.');
            operation.pcmJob?.release(); const state = operation.pcmJob?.retirementState?.();
            if (state && !['released', 'canceled'].includes(state.phase)) throw failure('source-pcm-retirement-unknown', 'Source PCM producer did not acknowledge retirement.');
          } },
          { name: 'native-pcm', run: () => { if (operation.producerState && !['released', 'canceled'].includes(operation.producerState.phase)) throw failure('render-retirement-unknown', 'Native PCM is still owned by its consumer.'); return operation.native?.release(); } },
          { name: 'render-source', run: () => { if (operation.sourceHanded) return operation.sourceSettled;
            if (operation.source) { retireCausalRead(operation.source); operation.source = null; } settleSource(); } },
          { name: 'render-input-workspace', run: async () => { if (operation.sourceHanded) await operation.sourceSettled; operation.workspace?.release(); } }
        ]);
        await operation.retirement.completion;
        if (operation.retirement.outcome !== 'complete') { unresolved.add(operation); originalError = failure('render-retirement-unknown', 'Causal render ownership is unresolved.', { cause: originalError, retirement: operation.retirement }); }
      }
      if (!originalError) { try { check(); } catch (error) { originalError = error; } }
      if (originalError) {
        const cleanup = bundle ? bundle.discard() : createProcgenRetirementScope().retire(candidates.map(entry => ({ name: 'candidate-' + entry.id, run: () => discardArtifact(entry.artifact) })));
        await cleanup.completion;
        if (cleanup.outcome !== 'complete') { unresolved.add(operation); originalError = failure('render-retirement-unknown', 'Prepared render file cleanup is unresolved.', { cause: originalError, retirement: cleanup }); }
        phase = controller.signal.aborted ? 'canceled' : 'failed'; lastError = originalError.message; report(); throw originalError;
      }
      const previous = prepared; prepared = bundle;
      const old = previous?.discard(); if (old) await old.completion; if (old && old.outcome !== 'complete') { unresolved.add(operation); lastError = 'The previous render has unresolved file retirement.'; }
      if (!disposed) { phase = 'prepared'; progress = null; lastError ||= null; report(); } return result;
    })().finally(() => { if (active === operation) { active = null; report(); } }); return operation.promise;
  };
  return Object.freeze({ prepare, state, getPrepared: () => prepared,
    cancel() { if (!active) return false; active.controller.abort(failure('render-canceled', 'Causal audio render canceled.')); phase = 'retiring'; report(); return true; },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const pending = active;
      pending?.controller.abort(failure('owner-retired', 'Causal audio render owner retired.')); phase = 'disposed'; report();
      return retirement.retire([{ name: 'accepted-render', run: async () => { await pending?.promise.catch(() => {}); if (pending?.retirement?.outcome !== 'complete') {
        if (pending) throw failure('render-retirement-unknown', 'Accepted render ownership is unresolved.'); } } },
      ...[...bundles].map((bundle, index) => ({ name: 'prepared-render-' + index, run: () => bundle.discard() })),
      { name: 'material-cache-reservations', run: async () => { await pending?.promise.catch(() => {}); return materialResources.dispose(); } },
      { name: 'retained-render-faults', run: () => { if (unresolved.size) throw failure('render-retirement-unknown', 'A causal render still has unresolved resources.'); } }]);
    }
  });
}
