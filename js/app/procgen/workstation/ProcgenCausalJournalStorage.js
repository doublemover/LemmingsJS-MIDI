import { journalError } from './CausalJournalCanonical.js';
import { causalTakeHeader, causalTakeHead, causalTakeSummary, prepareCausalCommit, validateCausalExtension } from './CausalJournalLayout.js';

const CAUSAL_JOURNAL_STORES = Object.freeze(['takeHeaders', 'takeHeads', 'takeSummaries', 'takeChunkIndex', 'takeCheckpointIndex', 'takeChunks', 'takeCheckpoints']);
const upgradeCausalJournalStores = (database, transaction = null) => {
  for (const name of CAUSAL_JOURNAL_STORES) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name,
    { keyPath: name === 'takeChunkIndex' || name === 'takeCheckpointIndex' ? ['takeId', 'ordinal'] : 'id' });
  if (!transaction || !database.objectStoreNames.contains('takeManifests')) return;
  const request = transaction.objectStore('takeManifests').openCursor();
  request.onsuccess = () => {
    const cursor = request.result; if (!cursor) return;
    const manifest = cursor.value.manifest, header = causalTakeHeader(manifest), head = causalTakeHead(manifest);
    transaction.objectStore('takeHeaders').add({ id: manifest.takeId, header });
    transaction.objectStore('takeHeads').add({ id: manifest.takeId, ...head, contentHash: null });
    transaction.objectStore('takeSummaries').add(causalTakeSummary(header, head));
    for (const ref of manifest.chunks) transaction.objectStore('takeChunkIndex').add({ takeId: manifest.takeId, ordinal: ref.ordinal, ref });
    for (let index = 0; index < manifest.checkpoints.length; index++) transaction.objectStore('takeCheckpointIndex').add({ takeId: manifest.takeId, ordinal: index + 1, ref: manifest.checkpoints[index] });
    cursor.delete(); cursor.continue();
  };
};

const createCausalJournalStorage = ({ open, available, wrapFailure = error => error } = {}) => {
  const connection = async () => {
    const database = await open();
    if (!available(database)) throw journalError('storage-unavailable', 'Project storage connection changed.');
    return database;
  };
  const read = async (storeName, id) => {
    const database = await connection();
    return new Promise((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly'), request = transaction.objectStore(storeName).get(id);
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onabort = () => reject(wrapFailure(transaction.error || request.error));
      } catch (error) { reject(wrapFailure(error)); }
    });
  };
  const loadCausalTakeHead = id => read('takeHeads', id);
  const commitCausalTake = async input => {
    const update = await prepareCausalCommit(input);
    const { takeId, expectedRevision, head, header, chunk, chunkRef, checkpoint, checkpointRef, commitId, contentHash } = update;
    const database = await connection();
    return new Promise((resolve, reject) => {
      let transaction, request, conflict = null, receipt = null;
      const abort = error => { conflict = error; try { transaction.abort(); } catch { reject(error); } };
      try {
        transaction = database.transaction(CAUSAL_JOURNAL_STORES, 'readwrite');
        const heads = transaction.objectStore('takeHeads'); request = heads.get(takeId);
        request.onsuccess = () => {
          try {
            const current = request.result;
            if (current?.lastCommitId === commitId) {
              if (current.contentHash !== contentHash) { abort(journalError('commit-conflict', 'A causal commit ID was reused with different content.')); return; }
              receipt = { takeId, revision: current.revision, durableSequence: current.durableSequence, contentHash, repeated: true }; return;
            }
            validateCausalExtension(current, update);
            if (chunk) {
              transaction.objectStore('takeChunks').add(chunk);
              transaction.objectStore('takeChunkIndex').add({ takeId, ordinal: chunk.ordinal, ref: chunkRef });
            }
            if (checkpoint) {
              transaction.objectStore('takeCheckpoints').add(checkpoint);
              transaction.objectStore('takeCheckpointIndex').add({ takeId, ordinal: head.checkpointCount, ref: checkpointRef });
            }
            if (expectedRevision === 0) transaction.objectStore('takeHeaders').add({ id: takeId, header });
            heads.put({ id: takeId, ...head, contentHash });
            const publishSummary = selectedHeader => transaction.objectStore('takeSummaries').put(causalTakeSummary(selectedHeader, head));
            if (header) publishSummary(header);
            else {
              // Summary provenance comes from its own compact row; appends never
              // deserialize a source header or historical index.
              const summary = transaction.objectStore('takeSummaries').get(takeId);
              summary.onsuccess = () => {
                if (!summary.result) { abort(journalError('missing-summary', 'Causal take summary is missing.')); return; }
                publishSummary(summary.result);
              };
            }
            receipt = { takeId, revision: head.revision, durableSequence: head.durableSequence, contentHash, repeated: false };
          } catch (error) { abort(error); }
        };
        transaction.oncomplete = () => resolve(receipt);
        transaction.onabort = () => reject(conflict || wrapFailure(transaction.error || request.error));
      } catch (error) { reject(wrapFailure(error)); }
    });
  };
  const listCausalTakeIndex = async ({ takeId, kind = 'chunk', cursor = 0, limit = 128, revision = null, signal } = {}) => {
    if (typeof takeId !== 'string' || !takeId || !['chunk', 'checkpoint'].includes(kind) || !Number.isSafeInteger(cursor) || cursor < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new Error('Invalid causal index page.');
    if (signal?.aborted) throw journalError('cancelled', 'Causal index read canceled.');
    const head = await loadCausalTakeHead(takeId);
    if (!head) throw journalError('missing-take', 'Causal take is missing.');
    if (revision != null && head.revision !== revision) throw journalError('stale-revision', 'The requested take revision is no longer current.');
    const count = kind === 'chunk' ? head.chunkCount : head.checkpointCount, last = Math.min(count, cursor + limit);
    const database = await connection();
    return new Promise((resolve, reject) => {
      const items = [], requests = [];
      let transaction, failure = null;
      const cancel = () => { failure = journalError('cancelled', 'Causal index read canceled.'); transaction?.abort(); };
      try {
        transaction = database.transaction(kind === 'chunk' ? 'takeChunkIndex' : 'takeCheckpointIndex', 'readonly');
        const store = transaction.objectStore(kind === 'chunk' ? 'takeChunkIndex' : 'takeCheckpointIndex');
        for (let ordinal = cursor + 1; ordinal <= last; ordinal++) requests.push(store.get([takeId, ordinal]));
        signal?.addEventListener('abort', cancel, { once: true });
        transaction.oncomplete = () => {
          signal?.removeEventListener('abort', cancel);
          for (const request of requests) {
            if (!request.result) { reject(journalError('missing-index', 'A causal take index row is missing.')); return; }
            items.push(request.result.ref);
          }
          resolve({ items, revision: head.revision, nextCursor: last < count ? last : null });
        };
        transaction.onabort = () => { signal?.removeEventListener('abort', cancel); reject(failure || wrapFailure(transaction.error)); };
        if (signal?.aborted) cancel();
      } catch (error) { signal?.removeEventListener('abort', cancel); reject(wrapFailure(error)); }
    });
  };
  const loadCausalTake = async (id, { signal, maxIndexRows = 69632 } = {}) => {
    const head = await loadCausalTakeHead(id); if (!head) return null;
    if (!Number.isSafeInteger(maxIndexRows) || maxIndexRows < 1 || head.chunkCount + head.checkpointCount > maxIndexRows) throw journalError('capacity', 'Causal take index exceeds its read budget.');
    const stored = await read('takeHeaders', id);
    if (!stored) throw journalError('missing-header', 'Causal take source header is missing.');
    const result = { ...stored.header, ...head, chunks: [], checkpoints: [] };
    delete result.id; delete result.contentHash; delete result.checkpointCount;
    for (const kind of ['chunk', 'checkpoint']) {
      let cursor = 0;
      do {
        const page = await listCausalTakeIndex({ takeId: id, kind, cursor, revision: head.revision, signal });
        result[kind === 'chunk' ? 'chunks' : 'checkpoints'].push(...page.items); cursor = page.nextCursor;
      } while (cursor != null);
    }
    const current = await loadCausalTakeHead(id);
    if (current?.revision !== head.revision || current?.contentHash !== head.contentHash) throw journalError('stale-revision', 'Causal take changed while reading its index.');
    return result;
  };
  const listCausalTakes = async ({ limit = 20, cursor = null, signal } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor != null &&
        (typeof cursor !== 'string' || !cursor || cursor.length > 256)) throw new Error('Invalid causal take list window.');
    if (signal?.aborted) throw journalError('cancelled', 'Causal take browsing canceled.');
    const database = await connection();
    return new Promise((resolve, reject) => {
      const items = []; let nextCursor = null, transaction, failure = null;
      const cancel = () => { failure = journalError('cancelled', 'Causal take browsing canceled.'); transaction?.abort(); };
      try {
        transaction = database.transaction('takeSummaries', 'readonly');
        const request = transaction.objectStore('takeSummaries').openCursor();
        signal?.addEventListener('abort', cancel, { once: true });
        request.onsuccess = () => {
          const entry = request.result; if (!entry) return;
          if (cursor != null && entry.key < cursor) { entry.continue(cursor); return; }
          if (cursor != null && entry.key === cursor) { entry.continue(); return; }
          if (items.length >= limit) { nextCursor = items.at(-1).takeId; return; }
          const { id, ...summary } = entry.value; items.push(Object.freeze(summary)); entry.continue();
        };
        transaction.oncomplete = () => { signal?.removeEventListener('abort', cancel); resolve(Object.freeze({ items: Object.freeze(items), nextCursor, order: 'take-id-ascending' })); };
        transaction.onabort = () => { signal?.removeEventListener('abort', cancel); reject(failure || wrapFailure(transaction.error || request.error)); };
        if (signal?.aborted) cancel();
      } catch (error) { signal?.removeEventListener('abort', cancel); reject(wrapFailure(error)); }
    });
  };
  return { causalIndexVersion: 2, commitCausalTake, loadCausalTakeHead, listCausalTakeIndex, listCausalTakes, loadCausalTake,
    loadCausalChunk: id => read('takeChunks', id), loadCausalCheckpoint: id => read('takeCheckpoints', id) };
};

export { CAUSAL_JOURNAL_STORES, upgradeCausalJournalStores, createCausalJournalStorage };
