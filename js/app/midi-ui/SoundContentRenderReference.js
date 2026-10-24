import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
import { borrowSoundContentStage } from './SoundContentReader.js';
import { planSoundContentSelection } from '../../midi/content/SoundContentPack.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = message => Object.assign(new Error(message), { name: 'SoundContentRenderError' });
export function createSoundContentRenderReferences({ resourceBudget, jobs = backgroundJobService } = {}) {
  if (!resourceBudget?.reserve || !resourceBudget?.release || typeof jobs?.compute !== 'function') throw new TypeError('Rendered references need shared resource ownership.');
  const retirement = createProcgenRetirementScope(), unknown = new Set(); let active = null, disposed = false, serial = 0;
  const prepare = (stage, patchIdentity, { signal: externalSignal, sampleRate = 48000, isCurrent = () => true, onProgress = () => {} } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || active || unknown.size || ![44100, 48000, 96000].includes(sampleRate) || typeof isCurrent !== 'function') return Promise.reject(failure('Rendered reference preparation is unavailable.'));
    const source = borrowSoundContentStage(stage), controller = new AbortController(), operation = { controller, source, job: null, promise: null };
    const cancel = () => controller.abort(externalSignal?.aborted ? externalSignal.reason : source.signal.reason);
    externalSignal?.addEventListener('abort', cancel, { once: true }); source.signal.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted || source.signal.aborted) cancel(); active = operation;
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw failure('Rendered reference source changed.'); };
    operation.promise = (async () => {
      let artifact = null;
      try {
        check(); const patch = source.prepared.patches.find(entry => entry.identity === patchIdentity);
        if (!patch || patch.state !== 'definition-admitted' || !OWNED_SOURCE_IDS.includes(patch.definition.engineId) || !getOwnedSourceProfile(patch.definition.engineId).controlReferenceRender || patch.definition.sampleRefs.length ||
            patch.definition.modulations.length) throw failure('This reference requires an available asset-free owned renderer.');
        const plan = planSoundContentSelection(source.prepared, [patchIdentity], { availableHashes: source.metadata.assetHashes });
        if (plan.missingReferences.length || plan.missingAssetBytes.length) throw failure('Rendered reference material is incomplete.');
        const input = { definition: patch.archivedDefinition, engineRequirement: patch.engineRequirement, sampleRate,
          source: { packId: source.prepared.pack.id, packVersion: source.prepared.pack.version, contentHash: source.prepared.contentHash,
            patchIdentity, definitionHash: patch.definitionHash, attribution: plan.credits.map(entry => entry.subject + ': ' + entry.rights.attribution).join('\n') } };
        const encoded = canonicalDataText(input, { maxBytes: 128 * 1024, maxNodes: 8192 });
        operation.job = await jobs.compute({ kind: 'render-sound-controls', ownerId: 'sound-render-reference', ownerEpoch: ++serial,
          sourceRevision: patch.definitionHash, inputBytes: encoded.bytes.byteLength, estimatedPeakBytes: 32 * 1048576, maxBytes: 128 * 1024,
          priority: 'background', budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !disposed && isCurrent(), onProgress,
          prepareInput: () => input }); check();
        const value = operation.job.value, manifest = value?.manifest;
        if (!(value?.bytes instanceof Uint8Array) || value.bytes.byteLength > 8 * 1048576 || manifest?.schema !== 'lemmings-rendered-audition/v1' ||
            manifest.source?.definitionHash !== patch.definitionHash || manifest.source?.contentHash !== source.prepared.contentHash || manifest.sampleRate !== sampleRate ||
            !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => manifest.engineRequirement?.[key] === patch.engineRequirement[key]) ||
            operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity.activeExecution !== 'bound' ||
            manifest.applicationBuildId !== operation.job.receipt.executionIdentity.buildId) throw failure('Rendered reference does not match its admitted immutable source.');
        artifact = prepareExportArtifact({ bytes: value.bytes, immutableSourceRef: ['sound-controls', patch.definitionHash, patch.engineRequirement.artifactHash, sampleRate, manifest.fixtureHash].join(':'),
          formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: patch.definition.id + '-' + sampleRate + '-controls.wav',
          coverageLossReportRef: 'embedded-lmjs-manifest', maxBytes: 8 * 1048576, budgetAdapter: resourceBudget }); check();
        return Object.freeze({ artifact, manifest: freezeData(manifest), receipt: operation.job.receipt });
      } catch (error) { artifact?.discard(); throw error; }
      finally {
        externalSignal?.removeEventListener('abort', cancel); source.signal.removeEventListener('abort', cancel);
        const receipt = createProcgenRetirementScope().retire([
          { name: 'computed-render', run: () => { operation.job?.release(); const phase = operation.job?.retirementState?.().phase;
            if (phase && phase !== 'released' && phase !== 'canceled') throw failure('Rendered computation retirement is unresolved.'); } },
          { name: 'staged-source', run: () => source.release() }
        ]);
        if (active === operation) active = null;
        if (receipt.outcome !== 'complete') { unknown.add(operation); artifact?.discard(); throw Object.assign(failure('Rendered reference cleanup is incomplete.'), { retirement: receipt }); }
      }
    })(); return operation.promise;
  };
  return Object.freeze({ prepare, diagnostics: () => Object.freeze({ active: !!active, unknownRetirement: unknown.size, disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const pending = active?.promise; active?.controller.abort(failure('Rendered reference owner retired.'));
      return retirement.retire([{ name: 'render-source', run: async () => { await pending?.catch(() => {}); if (unknown.size) throw failure('Rendered reference ownership is unresolved.'); } }]); }
  });
}
