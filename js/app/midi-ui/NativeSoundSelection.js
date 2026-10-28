import { nativeSoundCollection } from '../procgen/workstation/NativeSoundCollections.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { prepareSoundContentPack } from '../../midi/content/SoundContentPack.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { readBrowserBuildResponse } from '../../runtime/BrowserGenerationService.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText } from '../../core/CanonicalData.js';

const failure = message => Object.assign(new Error(message), { name: 'SoundContentError' });
let nextOwner = 0;
export function createNativeSoundSelection({ fetch: fetchSource, jobs = backgroundJobService, resourceBudget, getCatalog = getNativeInstrumentCatalog } = {}) {
  if (typeof fetchSource !== 'function' || !jobs?.compute || !resourceBudget) throw new TypeError('Native sound selection needs fetch, worker and resource owners.');
  const owner = 'native-sound-selection-' + (++nextOwner), operations = new Set(), retirement = createProcgenRetirementScope();
  let disposed = false, serial = 0, unknown = false;
  const prepare = async (patchId, { signal: externalSignal, includePrepared = false } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || unknown || operations.size >= 2 || !Number.isSafeInteger(serial + 1)) throw failure('Native sound preparation is unavailable or busy.');
    const source = nativeSoundCollection(patchId), reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: owner + ':' + (++serial), kind: 'native-sound-selection', category: 'audio', bytes: 262144 });
    let resolveFinished;
    const operation = { epoch: serial, controller: new AbortController(), reservation, retirement: createProcgenRetirementScope(), finished: new Promise(resolve => { resolveFinished = resolve; }) };
    operations.add(operation); const signal = operation.controller.signal, cancel = () => { operation.controller.abort(externalSignal.reason); if (operation.ready) operation.release(); };
    externalSignal?.addEventListener('abort', cancel, { once: true }); if (externalSignal?.aborted) cancel();
    const check = () => { signal.throwIfAborted(); if (disposed) throw failure('Native sound selection owner retired.'); };
    const jobRetirement = createProcgenRetirementScope();
    const releaseJob = job => { if (!job) return; job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw failure('Native sound worker retirement is unresolved.'); };
    const releaseJobs = () => jobRetirement.retire([{ name: 'compiled', run: () => releaseJob(operation.compiled) }, { name: 'parsed', run: () => releaseJob(operation.parsed) }]);
    const retire = () => {
      let jobsReceipt;
      const receipt = operation.retirement.retire([
        { name: 'worker-results', run: () => jobsReceipt = releaseJobs() },
        { name: 'selection-inputs', run: async () => { await jobsReceipt.completion; if (jobsReceipt.outcome !== 'complete') throw failure('Native sound result inputs retain unresolved workers.'); reservation.release(); } }
      ]);
      receipt.completion.then(result => { externalSignal?.removeEventListener('abort', cancel); if (result.outcome === 'complete') operations.delete(operation); else unknown = true; resolveFinished(result); }); return receipt;
    };
    operation.release = retire;
    try {
      const catalog = await getCatalog(); check(); if (!catalog.descriptors.length) throw failure('Native sound selection needs an immutable build with pinned renderer artifacts. The prior sound remains selected.');
      operation.parsed = await jobs.compute({ kind: 'parse-json', ownerId: owner, ownerEpoch: operation.epoch, sourceRevision: source.source.href,
        inputBytes: 128 * 1024, maxBytes: 128 * 1024, estimatedPeakBytes: 32 * 1048576, deadlineMs: 15000, signal, budgetAdapter: resourceBudget, isCurrent: () => !disposed && !signal.aborted,
        prepareInput: async () => new TextDecoder('utf-8', { fatal: true }).decode(await readBrowserBuildResponse(await fetchSource(source.source, { signal, credentials: 'same-origin' }), 128 * 1024, signal)) }); check();
      operation.compiled = await jobs.compute({ kind: 'compile-sound-content', ownerId: owner, ownerEpoch: operation.epoch, sourceRevision: source.source.href,
        inputBytes: operation.parsed.receipt.inputBytes, maxBytes: 4 * 1048576, estimatedPeakBytes: 64 * 1048576, deadlineMs: 30000, signal, budgetAdapter: resourceBudget,
        isCurrent: () => !disposed && !signal.aborted, prepareInput: () => operation.parsed.value }); check();
      reservation.resize(64 * 1048576);
      const prepared = await prepareSoundContentPack(operation.compiled.value.pack, { engineDescriptors: catalog.descriptors, signal }); check();
      if (prepared.contentHash !== operation.compiled.value.contentHash) throw failure('Native recipe compilation changed its immutable content identity.');
      const patch = prepared.patches.find(entry => entry.definition?.id === patchId);
      if (!patch || patch.state !== 'definition-admitted' || patch.dependencies.length) throw failure('This native alias needs an unavailable renderer or a separately installed material pack.');
      const reference = validateSoundContentReference({ schema: 'lemmings-sound-reference/v1', packHash: prepared.contentHash, patchId, revision: patch.definition.revision,
        definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: [], definition: patch.archivedDefinition });
      const sourceHash = operation.compiled.value.sourceHash, receipt = releaseJobs(); await receipt.completion; check(); if (receipt.outcome !== 'complete') throw Object.assign(failure('Native sound worker retirement is unresolved.'), { retirement: receipt });
      reservation.resize(262144 + (includePrepared ? canonicalDataText(prepared.pack, { maxBytes: 4 * 1048576, maxNodes: 200000 }).bytes.byteLength * 6 : 0)); operation.ready = true;
      return Object.freeze({ reference, definition: reference.definition, ...(includePrepared ? { prepared } : {}), selectionSource: Object.freeze({ collectionId: source.id, sourceHash, rights: 'unchanged-local-recipe-no-redistribution-grant' }), release: retire });
    } catch (error) { const receipt = retire(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
  };
  return Object.freeze({ prepare, diagnostics: () => Object.freeze({ pending: operations.size, unknownRetirement: unknown, disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; for (const operation of operations) { operation.controller.abort(failure('Native sound selection retired.')); if (operation.ready) operation.release(); }
      return retirement.retire([...operations].map((operation, index) => ({ name: 'selection-' + index, run: () => operation.finished }))); }
  });
}
