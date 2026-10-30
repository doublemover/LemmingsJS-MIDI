import { hashData } from '../../core/CanonicalData.js';
import { planSoundContentSelection, prepareSoundContentPack } from '../../midi/content/SoundContentPack.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export const SOUND_ARCHIVE_FORMAT = 'lemmings-sound-archive/v1';
export const SOUND_ARCHIVE_MAGIC = 'LSNDPK01';
const HEADER_LIMIT = 4 * 1048576;
const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
const interruptible = (work, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason || failure('cancelled', 'Sound export canceled.'));
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  if (signal.aborted) abort();
});

const readExactSource = async (file, readAsset, signal) => {
  signal.throwIfAborted();
  const response = await readAsset(file, { signal });
  if (signal.aborted) { await response?.body?.cancel?.(); signal.throwIfAborted(); }
  if (!response?.ok || !response.body?.getReader) { await response?.body?.cancel?.(); throw failure('asset-unavailable', 'A bounded sound asset stream is unavailable: ' + file.path); }
  const declared = response.headers?.get?.('Content-Length');
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) !== file.bytes)) {
    await response.body.cancel?.(); throw failure('asset-size-mismatch', 'Sound source length differs from its manifest.');
  }
  const reader = response.body.getReader(); let cancellation = null, offset = 0, chunks = 0, completed = false;
  const cancel = () => { cancellation ||= Promise.resolve().then(() => reader.cancel(signal.reason)); cancellation.catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted(); const bytes = new Uint8Array(file.bytes);
    while (true) {
      signal.throwIfAborted(); const item = await reader.read(); signal.throwIfAborted();
      if (item.done) { completed = true; break; }
      if (++chunks > 262144 || !(item.value instanceof Uint8Array) || offset + item.value.byteLength > bytes.byteLength) throw failure('asset-size-mismatch', 'Sound source exceeds its bounded file inventory.');
      bytes.set(item.value, offset); offset += item.value.byteLength;
    }
    if (offset !== file.bytes) throw failure('asset-size-mismatch', 'Sound source is truncated.');
    return bytes;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!completed) { cancel(); try { await cancellation; } catch { /* The accepted read has settled; its failure stays with this operation. */ } }
    reader.releaseLock();
  }
};

export function createSoundContentArchiver({ resourceBudget, jobs = backgroundJobService, maxArchiveBytes = 64 * 1048576,
  maxPending = 2, timeoutMs = 120000 } = {}) {
  if (!resourceBudget?.reserve || !resourceBudget?.release || !Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < HEADER_LIMIT || maxArchiveBytes > 128 * 1048576 ||
      !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 4 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new TypeError('Invalid sound archive owner.');
  const operations = new Set(); let sequence = 0, disposed = false;
  const prepareExport = async ({ prepared, selection, mode = 'reference-only', reviewRights, readAsset,
    signal: externalSignal, isCurrent = () => true, onProgress = () => {} } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || operations.size >= maxPending) throw failure('archive-capacity', 'Sound archive preparation is unavailable or busy.');
    if (!['portable', 'reference-only'].includes(mode) || mode === 'portable' && typeof readAsset !== 'function' || typeof isCurrent !== 'function') throw failure('invalid-contract', 'Invalid sound export request.');
    const plan = planSoundContentSelection(prepared, selection, { reviewRights });
    if (mode === 'portable' && (plan.missingReferences.length || plan.portability === 'reference-only' || plan.unavailableEngines.length))
      throw failure('reference-only-required', 'This selection needs an explicit reference-only export; material or realization rights are incomplete.');
    const files = mode === 'portable' ? plan.files : [], payloadBytes = files.reduce((total, file) => total + file.bytes, 0);
    if (payloadBytes + 12 > maxArchiveBytes) throw failure('archive-capacity', 'Selected sound material exceeds the archive staging limit.');
    const operation = { controller: new AbortController(), token: {}, pending: new Set(), cleanup: false, released: false, budgetHeld: false }, ordinal = ++sequence;
    const signal = operation.controller.signal, cancel = () => operation.controller.abort(externalSignal.reason);
    const release = () => {
      if (!operation.cleanup || operation.pending.size || operation.released) return;
      if (operation.releaseAttempted) return;
      operation.releaseAttempted = true;
      try {
        if (operation.budgetHeld) {
          const acknowledged = resourceBudget.release({ token: operation.token, owner: 'sound-archive' });
          if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
            if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {});
            throw failure('retirement-unknown', 'Sound archive reservation release was not acknowledged synchronously.');
          }
        }
      }
      catch (error) { operation.releaseError = error; return; }
      operation.released = true; operations.delete(operation);
    };
    const check = () => { signal.throwIfAborted(); if (disposed || !isCurrent()) throw failure('stale-owner', 'Sound archive source ownership changed.'); };
    const own = work => {
      const promise = Promise.resolve().then(() => { check(); return work(); }); operation.pending.add(promise);
      promise.then(() => { operation.pending.delete(promise); release(); }, () => { operation.pending.delete(promise); release(); });
      return interruptible(promise, signal);
    };
    operations.add(operation); externalSignal?.addEventListener('abort', cancel, { once: true }); if (externalSignal?.aborted) cancel();
    const deadline = setTimeout(() => operation.controller.abort(failure('deadline', 'Sound archive preparation deadline exceeded.')), timeoutMs);
    let encoded = null, artifact = null, preparationError = null;
    const parts = [];
    try {
      check();
      resourceBudget.reserve({ token: operation.token, owner: 'sound-archive', generation: ordinal, category: 'export', bytes: payloadBytes * 2 + HEADER_LIMIT * 2 + 65536, pinned: true, reloadable: false });
      operation.budgetHeld = true;
      const selectionHash = await hashData({ source: prepared.contentHash, selection: [...selection].sort() }); check();
      const source = prepared.pack, licenses = new Set(plan.credits.map(entry => entry.rights.licenseTextHash).filter(Boolean));
      const complete = selection.length === source.patches.length && plan.files.length === source.files.length && licenses.size === source.licenses.length;
      const pack = complete ? source : { schema: source.schema, id: source.id.slice(0, 64) + '.selection.' + selectionHash.slice(0, 24), version: source.version,
        name: source.name, author: source.author, sourceUrl: source.sourceUrl ?? null, licenseId: source.licenseId, licenseUrl: source.licenseUrl ?? null,
        attribution: source.attribution, modifications: source.modifications, redistributionPolicy: source.redistributionPolicy,
        origin: source.origin || { id: source.id, version: source.version, contentHash: prepared.contentHash },
        ...(source.compilation ? { compilation: { compilerRevision: source.compilation.compilerRevision, sourceHash: source.compilation.sourceHash,
          schemaRevision: source.compilation.schemaRevision, ...(source.compilation.realizationGroups ? { realizationGroups: source.compilation.realizationGroups.filter(group => group.profiles.every(profile => selection.includes(profile.patchIdentity))) } : {}), artifacts: source.compilation.artifacts.filter(artifact => selection.includes(artifact.id + '@' + artifact.revision)) } } : {}),
        files: plan.files, patches: source.patches.filter(entry => selection.includes(entry.definition.id + '@' + entry.definition.revision)),
        licenses: source.licenses.filter(license => licenses.has(license.sha256)) };
      const selected = await own(() => prepareSoundContentPack(pack, { signal })); check();
      const header = { format: SOUND_ARCHIVE_FORMAT, mode, contentHash: selected.contentHash, pack: selected.pack,
        payloads: files.map(file => ({ sha256: file.sha256, bytes: file.bytes })),
        rightsReview: plan.credits.map(entry => ({ subject: entry.subject, contentHash: entry.contentHash, rightsHash: entry.rightsHash,
          decision: entry.redistribution, receiptId: entry.reviewReceiptId, trustedOnReceiver: false })), qualification: 'verified-material-not-render-qualified' };
      encoded = await jobs.compute({ kind: 'encode-canonical-json', ownerId: 'sound-archive', ownerEpoch: ordinal, sourceRevision: selected.contentHash,
        inputBytes: prepared.manifestBytes + files.length * 128 + plan.credits.length * 768 + 4096, estimatedPeakBytes: 64 * 1048576, maxBytes: HEADER_LIMIT,
        signal, budgetAdapter: resourceBudget, isCurrent, prepareInput: () => header });
      const headerBytes = new TextEncoder().encode(encoded.value); encoded.release(); encoded = null;
      if (payloadBytes + headerBytes.byteLength + 12 > maxArchiveBytes) throw failure('archive-capacity', 'Selected sound material exceeds the archive staging limit.');
      const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, headerBytes.byteLength, false);
      parts.push(prefix, headerBytes);
      for (let index = 0; index < files.length; index++) {
        check(); const file = files[index], bytes = await own(() => readExactSource(file, readAsset, signal)); check();
        const digest = await jobs.compute({ kind: 'asset-hash', ownerId: 'sound-archive-hash', ownerEpoch: ordinal, sourceRevision: file.sha256,
          inputBytes: bytes.byteLength, estimatedPeakBytes: Math.max(4096, bytes.byteLength * 6), maxBytes: Math.max(1, file.bytes), expectedInputHash: file.sha256,
          signal, budgetAdapter: resourceBudget, isCurrent, prepareInput: () => bytes });
        digest.release(); parts.push(bytes); check();
        try { onProgress(Object.freeze({ phase: 'verified-material', completed: index + 1, total: files.length, bytes: parts.reduce((total, part) => total + part.byteLength, 0) })); } catch { /* Progress cannot publish or change a prepared artifact. */ }
      }
      check(); const blob = new Blob(parts, { type: 'application/vnd.lemmings.sound-pack' });
      artifact = prepareExportArtifact({ bytes: blob, immutableSourceRef: 'sound-pack:' + selected.contentHash, formatVersion: SOUND_ARCHIVE_FORMAT,
        mediaType: blob.type, suggestedFilename: selected.pack.id + '.lemmings-sound', maxBytes: maxArchiveBytes, budgetAdapter: resourceBudget });
      check();
      return Object.freeze({ artifact, mode, sourcePackHash: prepared.contentHash, selectedPackHash: selected.contentHash, selection: Object.freeze([...selection]),
        plan, qualification: 'verified-material-not-render-qualified', bytes: blob.size });
    } catch (error) { preparationError = error; operation.controller.abort(error); throw error; }
    finally {
      const receipt = createProcgenRetirementScope().retire([
        { name: 'deadline', run: () => clearTimeout(deadline) },
        { name: 'source-signal', run: () => externalSignal?.removeEventListener('abort', cancel) },
        { name: 'encoded-header', run: () => encoded?.release() },
        { name: 'temporary-parts', run: () => { parts.length = 0; } },
        { name: 'failed-artifact', run: () => { if (preparationError) return artifact?.discard(); } },
        { name: 'source-reservation', run: () => { operation.cleanup = true; release();
          if (!operation.released) throw operation.releaseError || failure('retirement-unknown', 'A canceled sound source is still settling; its reservation remains charged.'); } }
      ]);
      await receipt.completion;
      if (receipt.outcome !== 'complete') {
        if (!preparationError) artifact?.discard();
        throw Object.assign(failure(preparationError?.code || 'retirement-unknown', preparationError?.message || 'Sound archive cleanup is incomplete.'),
          { cause: preparationError, retirement: receipt });
      }
    }
  };
  return Object.freeze({ prepareExport, diagnostics: () => Object.freeze({ pending: operations.size,
    unknownRetirement: [...operations].filter(operation => operation.cleanup && !operation.released).length, maxPending, maxArchiveBytes, disposed }),
  dispose() { if (!disposed) { disposed = true; for (const operation of operations) operation.controller.abort(failure('owner-retired', 'Sound archive owner retired.')); } } });
}
