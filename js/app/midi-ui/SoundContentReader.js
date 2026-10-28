import { freezeData } from '../../core/CanonicalData.js';
import { prepareSoundContentPack, planSoundContentSelection } from '../../midi/content/SoundContentPack.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from './SoundContentArchive.js';

const HEADER_LIMIT = 4 * 1048576, stages = new WeakMap();
const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
const interruptible = (work, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason || failure('cancelled', 'Sound import canceled.'));
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  if (signal.aborted) abort();
});

export function borrowSoundContentStage(stage) {
  const borrow = stages.get(stage);
  if (!borrow) throw failure('invalid-stage', 'Sound installation requires an owned verified stage.');
  return borrow();
}

export function createSoundContentReader({ resourceBudget, jobs = backgroundJobService, maxArchiveBytes = 64 * 1048576,
  maxPending = 2, timeoutMs = 120000, stageLifetimeMs = 600000 } = {}) {
  if (!resourceBudget?.reserve || !resourceBudget?.release || !jobs?.compute || !Number.isSafeInteger(maxArchiveBytes) ||
      maxArchiveBytes < HEADER_LIMIT || maxArchiveBytes > 128 * 1048576 || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 4 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isSafeInteger(stageLifetimeMs) || stageLifetimeMs < 1 || stageLifetimeMs > 3600000)
    throw new TypeError('Invalid sound import owner.');
  const operations = new Set(); let disposed = false, sequence = 0;
  const stageArchive = async (blob, { engineDescriptors = [], signal: externalSignal, isCurrent = () => true, stageIsCurrent = isCurrent, onProgress = () => {} } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || operations.size >= maxPending) throw failure('archive-capacity', 'Sound import is unavailable or has retained stages.');
    if (!(blob instanceof Blob) || blob.size < 13 || blob.size > maxArchiveBytes || typeof isCurrent !== 'function' || typeof stageIsCurrent !== 'function' || typeof onProgress !== 'function')
      throw failure('invalid-archive', 'Sound archive is outside the supported byte bounds.');
    const operation = { token: {}, controller: new AbortController(), pending: new Set(), leases: 0, cleanup: false, released: false, held: false }, ordinal = ++sequence;
    const signal = operation.controller.signal; let prepared = null, header = null, stage = null, timer = null;
    const assets = new Map();
    const check = () => { signal.throwIfAborted(); if (disposed || !isCurrent()) throw failure('stale-owner', 'Sound import source ownership changed.'); };
    const checkStage = () => { signal.throwIfAborted(); if (disposed || !stageIsCurrent()) throw failure('stale-owner', 'Sound import stage ownership changed.'); };
    const release = () => {
      if (!operation.cleanup || operation.pending.size || operation.leases || operation.releaseAttempted) return;
      operation.releaseAttempted = true; assets.clear(); prepared = null; header = null; blob = null;
      try {
        if (operation.held) {
          const ack = resourceBudget.release({ token: operation.token, owner: 'sound-import' });
          if (ack === false || ack && typeof ack.then === 'function') {
            if (ack?.then) Promise.resolve(ack).catch(() => {});
            throw failure('retirement-unknown', 'Sound import reservation release was not acknowledged synchronously.');
          }
        }
        operation.released = true; operations.delete(operation);
      } catch (error) { operation.releaseError = error; }
    };
    const cleanup = () => { operation.cleanup = true; clearTimeout(timer); externalSignal?.removeEventListener('abort', cancel); release(); };
    const cancel = () => operation.controller.abort(externalSignal.reason);
    operation.retire = reason => { operation.controller.abort(reason); cleanup(); };
    const own = work => {
      const promise = Promise.resolve().then(() => { check(); return work(); }); operation.pending.add(promise);
      promise.then(() => { operation.pending.delete(promise); release(); }, () => { operation.pending.delete(promise); release(); });
      return interruptible(promise, signal);
    };
    const compute = async (kind, input, inputBytes, sourceRevision, maxBytes, expectedInputHash = null) => {
      const result = await jobs.compute({ kind, ownerId: 'sound-import', ownerEpoch: ordinal, sourceRevision, inputBytes,
        estimatedPeakBytes: kind === 'asset-hash' ? Math.max(4096, inputBytes * 6) : 64 * 1048576, maxBytes, expectedInputHash,
        signal, budgetAdapter: resourceBudget, isCurrent, prepareInput: () => input });
      try { check(); return result.value; } finally { result.release(); }
    };
    operations.add(operation); externalSignal?.addEventListener('abort', cancel, { once: true });
    signal.addEventListener('abort', () => { if (stage) cleanup(); }, { once: true });
    if (externalSignal?.aborted) cancel();
    timer = setTimeout(() => operation.controller.abort(failure('deadline', 'Sound import verification deadline exceeded.')), timeoutMs);
    try {
      check();
      resourceBudget.reserve({ token: operation.token, owner: 'sound-import', generation: ordinal, category: 'candidate',
        bytes: blob.size + HEADER_LIMIT * 8 + Math.min(blob.size, 16 * 1048576) * 2 + 65536, pinned: true, reloadable: false }); operation.held = true;
      const prefix = new Uint8Array(await own(() => blob.slice(0, 12).arrayBuffer())); check();
      if (prefix.byteLength !== 12 || new TextDecoder().decode(prefix.subarray(0, 8)) !== SOUND_ARCHIVE_MAGIC) throw failure('invalid-archive', 'Unknown sound archive signature.');
      const headerBytes = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(8, false);
      if (!headerBytes || headerBytes > HEADER_LIMIT || 12 + headerBytes > blob.size) throw failure('invalid-archive', 'Sound archive header is truncated or oversized.');
      const rawHeader = await own(() => blob.slice(12, 12 + headerBytes).arrayBuffer()); check();
      if (rawHeader.byteLength !== headerBytes) throw failure('invalid-archive', 'Sound archive header read differs from its byte inventory.');
      const headerText = new TextDecoder('utf-8', { fatal: true }).decode(rawHeader);
      header = await compute('parse-json', headerText, headerBytes, 'sound-archive-header', HEADER_LIMIT);
      if (!header || header.format !== SOUND_ARCHIVE_FORMAT || !['portable', 'reference-only'].includes(header.mode) ||
          !/^[a-f0-9]{64}$/.test(header.contentHash) || !Array.isArray(header.payloads) || header.payloads.length > 512 ||
          !Array.isArray(header.rightsReview) || header.rightsReview.length > 768 ||
          Object.keys(header).some(key => !['format', 'mode', 'contentHash', 'pack', 'payloads', 'rightsReview', 'qualification'].includes(key)))
        throw failure('invalid-archive', 'Unsupported sound archive header.');
      if (await compute('encode-canonical-json', header, headerBytes, header.contentHash, HEADER_LIMIT) !== headerText)
        throw failure('invalid-archive', 'Sound archive header must use the exact canonical representation.');
      prepared = await own(() => prepareSoundContentPack(header.pack, { engineDescriptors, signal })); check();
      if (prepared.contentHash !== header.contentHash) throw failure('content-mismatch', 'Sound pack manifest differs from its saved hash.');
      const files = [...prepared.pack.files].sort((a, b) => a.sha256 < b.sha256 ? -1 : 1), payloads = header.mode === 'portable' ? files : [];
      if (header.payloads.length !== payloads.length || header.payloads.some((entry, index) => !entry ||
          Object.keys(entry).length !== 2 || entry.sha256 !== payloads[index].sha256 || entry.bytes !== payloads[index].bytes))
        throw failure('invalid-archive', 'Sound archive payloads differ from the exact declared inventory.');
      let offset = 12 + headerBytes;
      if (offset + payloads.reduce((total, file) => total + file.bytes, 0) !== blob.size) throw failure('invalid-archive', 'Sound archive has truncated or trailing payload bytes.');
      for (let index = 0; index < payloads.length; index++) {
        check(); const file = payloads[index], payload = blob.slice(offset, offset + file.bytes, file.mediaType); offset += file.bytes;
        const bytes = await own(() => payload.arrayBuffer()); check();
        if (bytes.byteLength !== file.bytes) throw failure('invalid-archive', 'Sound archive payload read differs from its byte inventory.');
        await compute('asset-hash', bytes, file.bytes, file.sha256, Math.max(1, file.bytes), file.sha256); check(); assets.set(file.sha256, payload);
        try { onProgress(Object.freeze({ phase: 'verified-material', completed: index + 1, total: payloads.length })); } catch { /* Observers do not publish content. */ }
      }
      check(); checkStage();
      const assetHashes = Object.freeze([...assets.keys()]), selection = prepared.patches.map(patch => patch.identity);
      const plan = planSoundContentSelection(prepared, selection, { availableHashes: assetHashes });
      const metadata = freezeData({ format: SOUND_ARCHIVE_FORMAT, mode: header.mode, contentHash: prepared.contentHash,
        id: prepared.pack.id, version: prepared.pack.version, name: prepared.pack.name, patches: selection, assetHashes, archiveBytes: blob.size,
        missingReferences: plan.missingReferences, missingAssetBytes: plan.missingAssetBytes, unavailableEngines: plan.unavailableEngines,
        importedReview: 'untrusted-references-only', qualification: 'verified-material-not-render-qualified' });
      const borrow = () => {
        checkStage(); if (operation.cleanup) throw failure('stage-retired', 'Sound import stage was discarded.'); operation.leases++; let released = false;
        const checkLease = () => { checkStage(); if (released) throw failure('stage-retired', 'Sound stage lease was released.'); };
        return Object.freeze({ signal, metadata, get prepared() { checkLease(); return prepared; },
          assetBlob(hash) { checkLease(); return assets.get(hash) || null; },
          release() { if (!released) { released = true; operation.leases--; release(); } } });
      };
      stage = Object.freeze({ metadata: () => Object.freeze({ ...metadata, retained: !operation.cleanup, activeLeases: operation.leases,
        retirement: operation.releaseError ? 'failed-or-unknown' : operation.released ? 'released' : 'retained' }), borrow,
      discard() { operation.retire(failure('stage-retired', 'Sound import stage was discarded.')); return stage.metadata(); } });
      stages.set(stage, borrow); clearTimeout(timer);
      timer = setTimeout(() => operation.retire(failure('stage-expired', 'Sound import stage expired.')), stageLifetimeMs); timer.unref?.();
      return stage;
    } catch (error) { operation.controller.abort(error); cleanup(); throw error; }
  };
  return Object.freeze({ stageArchive, diagnostics: () => Object.freeze({ pending: operations.size, maxPending, disposed,
    unknownRetirement: [...operations].filter(operation => operation.cleanup && !operation.released).length }),
  dispose() { if (!disposed) { disposed = true; for (const operation of operations) operation.retire(failure('owner-retired', 'Sound import owner retired.')); } } });
}
