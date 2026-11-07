import { createAudioResourceLeases } from './AudioResourceLeases.js';
import { computeMaterializedAudioImage } from './OwnedAudioImageMaterials.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../procgen/ProcgenRetirement.js';
import { retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { freezeData } from '../../core/CanonicalData.js';
const fail = message => Object.assign(new Error(message), { name: 'CausalRenderError', code: 'captured-image-render-owner' });
let sequence = 0;
export function createCausalOwnedImageRenderer({ journal, resourceBudget, jobs, getCatalog, getMaterialProvider, onState = () => {} } = {}) {
  const id = 'causal-owned-image-render:' + (++sequence), resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: id }), scope = createProcgenRetirementScope(), bundles = new Set(), faults = new Set();
  let disposed = false, active = null, prepared = null, ordinal = 0, phase = 'idle', progress = null, error = null;
  const state = () => ({ active: !!active, phase, progress, prepared: prepared?.metadata() || null, error, unresolvedRetirement: faults.size });
  const report = () => { try { onState(state()); } catch {} };
  const prepare = ({ takeId, takeRevision, startSeconds = 0, endSeconds, includeRack = false, includeStems = false, signal, isCurrent = () => true } = {}) => {
    if (disposed || active || faults.size || typeof takeId !== 'string' || !takeId || takeId.length > 256 || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120 || typeof includeRack !== 'boolean' || typeof includeStems !== 'boolean' || includeStems && !includeRack) return Promise.reject(fail('Choose one saved owned-image take and a bounded audio-clock crop.'));
    const controller = new AbortController(), cancel = () => controller.abort(signal?.reason); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const producerRetirement = createProcgenRetirementScope();
    const operation = active = { controller, promise: null, job: null, loans: [], workspace: null, retirement: null }; const revision = ++ordinal;
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw fail('The captured image render request changed.'); };
    phase = 'reading-owned-command-history'; progress = null; error = null; report();
    operation.promise = (async () => {
      const artifacts = []; let bundle = null, failure = null, result = null;
      try {
        check(); operation.workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'captured-command-history-links', bytes: 2 * 1048576 });
        const metadata = await journal.openTakeOwned(takeId, { signal: controller.signal }); operation.loans.push(metadata); check(); const manifest = metadata.value;
        if (takeRevision != null && manifest.revision !== takeRevision || !['finalized', 'partial'].includes(manifest.state) || manifest.prefix || !manifest.boundaryState?.['owned-audio'] || !manifest.coverage?.available?.stateKinds?.includes('owned-source-commands') || manifest.coverage.gaps.some(gap => ['all', 'owned-source-commands', 'owned-audio'].includes(gap.kind))) throw fail('This take lacks a complete original initial sound image and actual command coverage.');
        const checkpointLoan = await journal.readCheckpointOwned(manifest.initialCheckpoint, { signal: controller.signal }); operation.loans.push(checkpointLoan); check();
        const checkpoint = checkpointLoan.value.ownedAudio;
        if (!checkpoint || checkpoint.sha256 !== manifest.boundaryState['owned-audio'].sha256 || checkpoint.applicationBuildId !== manifest.boundaryState['owned-audio'].applicationBuildId) throw fail('The retained audio image differs from its immutable journal boundary.');
        const events = [], effectEvents = []; let next = 1, historyBytes = 0, historyNodes = 64;
        do {
          check(); const page = await journal.queryOwned({ takeId, takeRevision: manifest.revision, firstSequence: next, kinds: ['sink-outcome'], limit: 256, signal: controller.signal }); operation.loans.push(page); check();
          for (let index = 0; index < page.value.records.length; index++) {
            const record = page.value.records[index]; historyBytes += page.value.recordBytes[index];
            const values = Array.isArray(record.payload?.outcomes) ? record.payload.outcomes : [record.payload];
            for (const value of values) { if (value?.schema === 'lemmings-captured-source-transport/v1') { events.push(value); historyNodes += (value.event?.data?.length || 0) + 96; } else if (includeRack && value?.schema === 'lemmings-effect-performance/v1') { effectEvents.push(value); historyNodes += 1024; } }
          }
          if (historyBytes > 24 * 1048576 || events.length > 65536 || effectEvents.length > 8192 || operation.loans.length > 1024) throw fail('The complete command history exceeds its bounded render source profile.');
          if (page.value.nextSequence != null && page.value.nextSequence <= next) throw fail('The source command query did not advance.'); next = page.value.nextSequence;
        } while (next != null);
        if (!events.length) throw fail('The take has no complete actual source command capture.');
        const source = { schema: 'lemmings-owned-source-history/v1', takeId, takeRevision: manifest.revision, sourceCanonicalHash: manifest.canonicalHash, coverage: 'complete', events, ...(includeRack ? { effectEvents, effectCoverage: { captured: manifest.captureProfile.stateKinds.includes('effect-performance'), gaps: manifest.coverage.gaps.filter(gap => ['all', 'effect-performance'].includes(gap.kind)) } } : {}) };
        const catalog = await getCatalog(); check(); if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity.buildId !== checkpoint.applicationBuildId) throw fail('Open the take with its exact original application source build.');
        phase = 'preparing-original-owned-materials'; report();
        operation.job = await computeMaterializedAudioImage({ checkpoint, jobs, resourceBudget, resources, materialProvider: getMaterialProvider?.(), getCatalog, signal: controller.signal, isCurrent: () => !disposed && isCurrent() }, async materials => {
          check(); const materialBytes = materials.reduce((sum, row) => sum + (row.pcm?.descriptor?.bytes || 0), 0), frames = Math.round((endSeconds - startSeconds) * checkpoint.sampleRate);
          const inputBytes = checkpoint.data.length + historyBytes + materialBytes + 262144;
          const peak = Math.ceil(inputBytes * 8 + historyNodes * 192 + frames * 32 * (includeStems ? 4 : 1) + (includeRack ? 32 * 1048576 : 0) + checkpoint.bytes * 4 + 96 * 1048576);
          if (inputBytes > 64 * 1048576 || peak > 512 * 1048576) throw fail('The complete image, commands, material and WAV representations exceed the admitted worker profile.');
          phase = 'rendering-captured-owned-sources'; report();
          try { return await jobs.compute({ kind: 'render-causal-owned-image', ownerId: id, ownerEpoch: revision, sourceRevision: manifest.canonicalHash, inputBytes, maxBytes: inputBytes, maxNodes: 2000000, maxStringBytes: 32 * 1048576, estimatedPeakBytes: peak,
            budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !disposed && isCurrent(), deadlineMs: 180000, priority: 'background',
            prepareInput: () => ({ checkpoint, source, materials, startSeconds, endSeconds, includeRack, includeStems }), onProgress: value => { progress = value; report(); } }); } catch (caught) { if (caught.backgroundRetirementCompletion) caught.backgroundRetirement = await caught.backgroundRetirementCompletion; if (caught.backgroundRetirement && !['released', 'canceled'].includes(caught.backgroundRetirement.phase)) caught.retirement = createProcgenRetirementScope().retire([{ name: 'unresolved-image-input-consumer', run: () => { throw fail('The actual image input consumer remains unresolved.'); } }]); throw caught; }
        }); check();
        const value = operation.job.value, rendered = value?.manifest;
        if (operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity?.activeExecution !== 'bound' || rendered?.applicationBuildId !== catalog.executionIdentity.buildId || rendered.takeId !== takeId || rendered.takeRevision !== manifest.revision || rendered.sourceCanonicalHash !== manifest.canonicalHash || rendered.imageSha256 !== checkpoint.sha256 || rendered.mode !== 'captured-owned-source-image-and-actual-command-history' || rendered.sampleRate !== checkpoint.sampleRate || rendered.timelineZeroSourceFrame !== Math.round(startSeconds * checkpoint.sampleRate) || rendered.exactEndSourceFrame !== Math.round(endSeconds * checkpoint.sampleRate) || (includeRack ? rendered.realization?.creativeRack?.schema !== 'lemmings-captured-rack-continuation-render/v1' : rendered.realization?.creativeRack !== 'excluded-explicit-dry-source-projection') || value.files?.length !== (includeStems ? 4 : 1) || value.files.some((file, index) => !(file.bytes instanceof Uint8Array) || file.id !== (index === 0 ? includeRack ? 'owned-rack' : 'owned-dry' : ['source-dry', 'owner-dry-route', 'shared-rack-return'][index - 1]) || file.manifest?.fileId !== file.id || file.manifest?.imageSha256 !== checkpoint.sha256 || file.manifest?.sourceCanonicalHash !== manifest.canonicalHash || file.manifest?.sampleRate !== rendered.sampleRate || file.manifest?.frames !== rendered.frames) || value.files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > 64 * 1048576) throw fail('The actual worker result differs from the image, source, application or exact audio-clock crop.');
        const labels = { 'owned-dry': 'Captured owned sources · initial image + actual commands · dry', 'owned-rack': 'Captured owned sources + saved creative rack · original state and controls', 'source-dry': 'Raw captured source · upstream of creative rack', 'owner-dry-route': 'Aligned owner dry route · recombines with shared return', 'shared-rack-return': 'Aligned shared rack return · one complete interacting graph' };
        const files = value.files.map(file => {
          const artifact = prepareExportArtifact({ bytes: file.bytes, immutableSourceRef: [manifest.canonicalHash, checkpoint.sha256, rendered.historyHash, file.manifest.pcmHash, file.id].join(':'), formatVersion: rendered.schema, mediaType: 'audio/wav', suggestedFilename: 'take-' + manifest.canonicalHash.slice(0, 12) + '-captured-' + file.id + '.wav', maxBytes: 64 * 1048576, budgetAdapter: resourceBudget }); artifacts.push(artifact);
          return Object.freeze({ id: file.id, label: labels[file.id], artifact, manifest: freezeData(file.manifest) });
        });
        const retirement = createProcgenRetirementScope(); let discarded = false;
        bundle = Object.freeze({ files: Object.freeze(files), manifest: files[0].manifest, metadata: () => ({ sourceTakeId: takeId, sourceCanonicalHash: rendered.sourceCanonicalHash, sampleRate: rendered.sampleRate, frames: rendered.frames, mode: rendered.mode, discarded, files: files.map(file => ({ id: file.id, label: file.label, artifact: file.artifact.metadata() })) }),
          discard() { if (retirement.getReceipt()) return retirement.getReceipt(); discarded = true; if (prepared === bundle) prepared = null;
            const receipt = retirement.retire(files.map(file => ({ name: 'captured-wave:' + file.id, run: async () => { file.artifact.discard(); await file.artifact.digest(); const state = file.artifact.metadata(); if (state.activeLeases || state.budgetState === 'failed-or-unknown') throw fail('A captured WAV still has unresolved readers.'); } }))); receipt.completion.then(() => { if (receipt.outcome === 'complete') bundles.delete(bundle); report(); }); return receipt; } });
        bundles.add(bundle); result = { bundle, receipt: operation.job.receipt };
      } catch (caught) { failure = caught; error = caught.message; }
      phase = 'retiring'; report();
      operation.retirement = createProcgenRetirementScope().retire([
        { name: 'captured-image-worker', run: () => producerRetirement.retire([{ name: 'actual-worker', run: async () => { if (failure?.backgroundRetirementCompletion) failure.backgroundRetirement = await failure.backgroundRetirementCompletion; if (failure?.backgroundRetirement && !['released', 'canceled'].includes(failure.backgroundRetirement.phase)) throw fail('The image render producer remains unresolved.'); operation.job?.release(); if (operation.job && !['released', 'canceled'].includes(operation.job.retirementState().phase)) throw fail('The image render result remains unresolved.'); } }]) },
        { name: 'captured-source-readers', run: () => afterProcgenRetirement([producerRetirement.getReceipt()], () => { if (failure?.backgroundRetirement && !['released', 'canceled'].includes(failure.backgroundRetirement.phase)) throw fail('The worker still owns its captured source input.'); for (const loan of operation.loans) retireCausalRead(loan); operation.loans.length = 0; operation.workspace?.release(); }) },
        { name: 'material-preparation', run: () => failure?.retirement || failure?.materialRetirement }
      ]); await operation.retirement.completion;
      if (operation.retirement.outcome !== 'complete') { faults.add(operation); failure ||= fail('The captured image render retains unresolved resources.'); }
      if (!failure) try { check(); } catch (caught) { failure = caught; }
      if (failure) { const cleanup = bundle?.discard(); await cleanup?.completion; if (!bundle) for (const artifact of artifacts) { artifact.discard(); await artifact.digest(); } phase = controller.signal.aborted ? 'canceled' : 'failed'; error = failure.message; throw failure; }
      const previous = prepared; prepared = bundle; const receipt = previous?.discard(); await receipt?.completion; if (receipt && receipt.outcome !== 'complete') faults.add(operation); phase = 'prepared'; progress = null; report(); return result;
    })().finally(() => { signal?.removeEventListener('abort', cancel); if (active === operation) active = null; report(); }); return operation.promise;
  };
  return Object.freeze({ prepare, state, getPrepared: () => prepared, cancel() { if (!active) return false; active.controller.abort(fail('Captured image rendering canceled.')); return true; },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const pending = active; pending?.controller.abort(fail('Captured image renderer retired.')); const producers = createProcgenRetirementScope();
      return scope.retire([{ name: 'captured-image-render-operation', run: () => producers.retire([{ name: 'operation', run: async () => { await pending?.promise.catch(() => {}); if (faults.size) throw fail('Captured image rendering retains unresolved resources.'); } }]) },
        { name: 'captured-image-artifacts', run: () => createProcgenRetirementScope().retire([...bundles].map((bundle, index) => ({ name: 'wav-' + index, run: () => bundle.discard() }))) },
        { name: 'captured-image-materials', run: () => afterProcgenRetirement([producers.getReceipt()], () => resources.dispose()) }]); }
  });
}
