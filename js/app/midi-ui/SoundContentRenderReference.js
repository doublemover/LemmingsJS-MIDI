import { prepareNativeControlRenderInput } from './NativeControlRender.js';
import { NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineDriver.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { prepareNativeRenderMaterial } from './NativeRenderMaterial.js';
import { prepareOwnedRenderMaterial } from './OwnedRenderMaterial.js';
import { createAudioResourceLeases } from './AudioResourceLeases.js';
import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
import { borrowSoundContentStage } from './SoundContentReader.js';
import { planSoundContentSelection } from '../../midi/content/SoundContentPack.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = message => Object.assign(new Error(message), { name: 'SoundContentRenderError' });
export function createSoundContentRenderReferences({ resourceBudget, jobs = backgroundJobService, getMaterialProvider = null } = {}) {
  if (!resourceBudget?.reserve || !resourceBudget?.release || typeof jobs?.compute !== 'function' || getMaterialProvider != null && typeof getMaterialProvider !== 'function') throw new TypeError('Rendered references need shared resource ownership.');
  const resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'sound-control-render-material' });
  const retirement = createProcgenRetirementScope(), unknown = new Set(); let active = null, disposed = false, serial = 0;
  const prepare = (stage, patchIdentity, { signal: externalSignal, sampleRate = 48000, sampleGesture = null, isCurrent = () => true, onProgress = () => {} } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || active || unknown.size || ![44100, 48000, 96000].includes(sampleRate) || typeof isCurrent !== 'function') return Promise.reject(failure('Rendered reference preparation is unavailable.'));
    const source = borrowSoundContentStage(stage), controller = new AbortController(), operation = { controller, source, job: null, material: null, native: null, producerState: null, promise: null };
    const cancel = () => controller.abort(externalSignal?.aborted ? externalSignal.reason : source.signal.reason);
    externalSignal?.addEventListener('abort', cancel, { once: true }); source.signal.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted || source.signal.aborted) cancel(); active = operation;
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw failure('Rendered reference source changed.'); };
    operation.promise = (async () => {
      let artifact = null;
      try {
        check(); const patch = source.prepared.patches.find(entry => entry.identity === patchIdentity);
        const sample = patch?.definition.engineId === 'native-sample', native = NATIVE_OFFLINE_SOURCE_IDS.includes(patch?.definition.engineId), owned = OWNED_SOURCE_IDS.includes(patch?.definition.engineId) ? getOwnedSourceProfile(patch.definition.engineId) : null;
        if (!patch || patch.state !== 'definition-admitted' || !native && !owned?.controlReferenceRender || (sample || owned?.requiresPCMSet ? patch.definition.sampleRefs.length < 1 || patch.definition.sampleRefs.length > 32 : owned?.requiresPCM ? patch.definition.sampleRefs.length !== 1 : patch.definition.sampleRefs.length !== 0) ||
            patch.definition.modulations.length) throw failure('This reference requires an available owned renderer with its required material.');
        const plan = planSoundContentSelection(source.prepared, [patchIdentity], { availableHashes: source.metadata.assetHashes });
        if (plan.missingReferences.length || plan.missingAssetBytes.length && !owned?.requiresPCM && !sample) throw failure('Rendered reference material is incomplete.');
        const input = { definition: patch.archivedDefinition, engineRequirement: patch.engineRequirement, sampleRate, ...(owned?.requiresPCMSet ? { sampleGesture } : {}),
          source: { packId: source.prepared.pack.id, packVersion: source.prepared.pack.version, contentHash: source.prepared.contentHash,
            patchIdentity, definitionHash: patch.definitionHash, attribution: plan.credits.map(entry => entry.subject + ': ' + entry.rights.attribution).join('\n') } };
        if (owned?.requiresPCM || sample) {
          if (!getMaterialProvider) throw failure('Pinned local source material is unavailable for this render.');
          operation.material = await (sample ? prepareNativeRenderMaterial : prepareOwnedRenderMaterial)({ provider: getMaterialProvider(), resources, definition: patch.definition, stage, patchIdentity,
            engineDescriptors: [patch.engineRequirement], sampleRate, owner: 'sound-control-render', generation: serial + 1, signal: controller.signal, isCurrent: () => !disposed && isCurrent() }); check();
        }
        const encoded = canonicalDataText(input, { maxBytes: 128 * 1024, maxNodes: 8192 });
        if (native) {
          const catalog = await getNativeInstrumentCatalog(), descriptor = catalog.descriptors.find(entry => entry.engineId === patch.definition.engineId); check();
          if (catalog.state !== 'bound-application-engines' || !descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === patch.engineRequirement[key])) throw failure('Native offline source differs from this immutable application.');
          operation.native = await prepareNativeControlRenderInput({ definition: patch.archivedDefinition, descriptor, sampleRate, source: input.source,
            applicationBuildId: catalog.executionIdentity.buildId, sampleGesture, ...(sample ? { assets: operation.material.assets, materialDescriptor: operation.material.descriptor } : {}) }, { resources, resourceBudget, signal: controller.signal, onProgress, isCurrent: () => !disposed && isCurrent() }); check();
        }
        if (operation.material && !native) input.pcm = operation.material.payload;
        operation.job = await jobs.compute({ kind: native ? 'encode-native-render' : 'render-sound-controls', ownerId: 'sound-render-reference', ownerEpoch: ++serial,
          sourceRevision: patch.definitionHash, inputBytes: encoded.bytes.byteLength + (operation.native?.bytes || 0) + (operation.material?.descriptor.bytes || 0), estimatedPeakBytes: 32 * 1048576 + (operation.native?.bytes || 0) * 8 + (operation.material?.descriptor.bytes || 0) * 10, maxBytes: 128 * 1024 + (operation.native?.bytes || 0) + (operation.material?.descriptor.bytes || 0),
          priority: 'background', budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !disposed && isCurrent(), onProgress,
          prepareInput: () => operation.native?.input || input }); check();
        const value = operation.job.value, manifest = value?.manifest;
        if (!(value?.bytes instanceof Uint8Array) || value.bytes.byteLength > 8 * 1048576 || manifest?.schema !== 'lemmings-rendered-audition/v1' ||
            manifest.source?.definitionHash !== patch.definitionHash || manifest.source?.contentHash !== source.prepared.contentHash || manifest.sampleRate !== sampleRate ||
            !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => manifest.engineRequirement?.[key] === patch.engineRequirement[key]) ||
            operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity.activeExecution !== 'bound' ||
            manifest.applicationBuildId !== operation.job.receipt.executionIdentity.buildId || operation.material && (sample ? await hashData(manifest.sourceBank) !== await hashData(operation.material.descriptor) : manifest.sourceBank?.bankHash !== operation.material.descriptor.bankHash)) throw failure('Rendered reference does not match its admitted immutable source.');
        artifact = prepareExportArtifact({ bytes: value.bytes, immutableSourceRef: ['sound-controls', patch.definitionHash, patch.engineRequirement.artifactHash, sampleRate, manifest.fixtureHash].join(':'),
          formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: patch.definition.id + '-' + sampleRate + '-controls.wav',
          coverageLossReportRef: 'embedded-lmjs-manifest', maxBytes: 8 * 1048576, budgetAdapter: resourceBudget }); check();
        return Object.freeze({ artifact, manifest: freezeData(manifest), receipt: operation.job.receipt });
      } catch (error) {
        if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
        operation.producerState = error.backgroundRetirement || null; operation.preparationFault = error.retirement || null; artifact?.discard(); throw error;
      }
      finally {
        externalSignal?.removeEventListener('abort', cancel); source.signal.removeEventListener('abort', cancel);
        const receipt = createProcgenRetirementScope().retire([
          { name: 'computed-render', run: () => { operation.job?.release(); const phase = operation.job?.retirementState?.().phase;
            if (phase && phase !== 'released' && phase !== 'canceled') throw failure('Rendered computation retirement is unresolved.'); } },
          { name: 'material-preparation-fault', run: () => operation.preparationFault },
          { name: 'render-material', run: () => { if (operation.producerState && !['released', 'canceled'].includes(operation.producerState.phase)) throw failure('Render source producer retirement is unknown.'); return operation.material?.release(); } },
          { name: 'native-pcm', run: () => { if (operation.producerState && !['released', 'canceled'].includes(operation.producerState.phase)) throw failure('Native PCM consumer retirement is unknown.'); return operation.native?.release(); } },
          { name: 'staged-source', run: () => source.release() }
        ]);
        await receipt.completion;
        if (active === operation) active = null;
        if (receipt.outcome !== 'complete') { unknown.add(operation); artifact?.discard(); throw Object.assign(failure('Rendered reference cleanup is incomplete.'), { retirement: receipt }); }
      }
    })(); return operation.promise;
  };
  return Object.freeze({ prepare, diagnostics: () => Object.freeze({ active: !!active, unknownRetirement: unknown.size, materialResources: resources.diagnostics(), disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const pending = active?.promise; active?.controller.abort(failure('Rendered reference owner retired.'));
      return retirement.retire([{ name: 'render-source', run: async () => { await pending?.catch(() => {}); if (unknown.size) throw failure('Rendered reference ownership is unresolved.'); return resources.dispose(); } }]); }
  });
}
