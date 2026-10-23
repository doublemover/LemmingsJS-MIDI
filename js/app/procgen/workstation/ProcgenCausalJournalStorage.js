import { canonicalJournalText, journalError } from './CausalJournalCanonical.js';

const CAUSAL_JOURNAL_STORES = Object.freeze(['takeManifests', 'takeChunks', 'takeCheckpoints']);
const upgradeCausalJournalStores = database => {
  for (const name of CAUSAL_JOURNAL_STORES) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
};

// This adapter shares the project's connection, retirement and upgrade owner.
// A chunk, its checkpoint (if any), and its manifest prefix commit together.
const createCausalJournalStorage = ({ open, available, wrapFailure = error => error } = {}) => {
  const read = async (storeName, id) => {
    const database = await open();
    if (!available(database)) throw journalError('storage-unavailable', 'Project storage connection changed.');
    return new Promise((resolve, reject) => {
      try {
        const transaction = database.transaction(storeName, 'readonly'), request = transaction.objectStore(storeName).get(id);
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onabort = () => reject(wrapFailure(transaction.error || request.error));
      } catch (error) { reject(wrapFailure(error)); }
    });
  };
  const commitCausalTake = async ({ takeId, expectedRevision, manifest, chunk = null, checkpoint = null, commitId } = {}) => {
    if (typeof takeId !== 'string' || !takeId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        manifest?.takeId !== takeId || manifest.revision !== expectedRevision + 1 || manifest.lastCommitId !== commitId ||
        typeof commitId !== 'string' || !commitId || !Array.isArray(manifest.chunks) ||
        manifest.chunkCount !== manifest.chunks.length || !Number.isSafeInteger(manifest.durableSequence) || manifest.durableSequence < 0) throw new Error('Invalid causal journal transaction.');
    const canonicalManifest = canonicalJournalText(manifest, { maxBytes: 8 * 1048576 }).text;
    const database = await open();
    if (!available(database)) throw journalError('storage-unavailable', 'Project storage connection changed.');
    return new Promise((resolve, reject) => {
      let transaction, request, conflict = null, receipt = null;
      const abort = error => { conflict = error; try { transaction.abort(); } catch { reject(error); } };
      try {
        transaction = database.transaction(CAUSAL_JOURNAL_STORES, 'readwrite');
        const manifests = transaction.objectStore('takeManifests'); request = manifests.get(takeId);
        request.onsuccess = () => {
          try {
            const current = request.result?.manifest;
            if (current?.lastCommitId === commitId) {
              if (canonicalJournalText(current, { maxBytes: 8 * 1048576 }).text !== canonicalManifest) {
                abort(journalError('commit-conflict', 'A causal commit ID was reused with different content.')); return;
              }
              receipt = { takeId, revision: current.revision, durableSequence: current.durableSequence, repeated: true }; return;
            }
            if ((current?.revision || 0) !== expectedRevision || current && current.state !== 'recording') {
              abort(journalError('revision-conflict', 'Causal take changed or was already finalized.')); return;
            }
            if (chunk && (chunk.takeId !== takeId || chunk.ordinal !== (current?.chunkCount || 0) + 1 ||
                chunk.firstSequence !== (current?.durableSequence ?? manifest.prefix?.throughSequence ?? 0) + 1 ||
                chunk.lastSequence !== manifest.durableSequence || manifest.chunks.at(-1)?.id !== chunk.id ||
                typeof chunk.canonical !== 'string' || chunk.canonical.length > 16 * 1048576)) {
              abort(journalError('chunk-conflict', 'A causal chunk does not extend the durable prefix.')); return;
            }
            if (!chunk && current && (manifest.durableSequence !== current.durableSequence || manifest.chunkCount !== current.chunkCount)) {
              abort(journalError('prefix-conflict', 'A manifest-only commit cannot change the durable source prefix.')); return;
            }
            if (checkpoint && (checkpoint.takeId !== takeId || typeof checkpoint.canonical !== 'string' || checkpoint.canonical.length > 32 * 1048576)) {
              abort(journalError('checkpoint-conflict', 'Invalid causal component checkpoint.')); return;
            }
            if (chunk) transaction.objectStore('takeChunks').add(chunk);
            if (checkpoint) transaction.objectStore('takeCheckpoints').add(checkpoint);
            manifests.put({ id: takeId, manifest });
            receipt = { takeId, revision: manifest.revision, durableSequence: manifest.durableSequence, repeated: false };
          } catch (error) { abort(error); }
        };
        transaction.oncomplete = () => resolve(receipt);
        transaction.onabort = () => reject(conflict || wrapFailure(transaction.error || request.error));
      } catch (error) { reject(wrapFailure(error)); }
    });
  };
  const listCausalTakes = async ({ limit = 20, cursor = null } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor != null &&
        (typeof cursor !== 'string' || !cursor || cursor.length > 256)) throw new Error('Invalid causal take list window.');
    const database = await open();
    if (!available(database)) throw journalError('storage-unavailable', 'Project storage connection changed.');
    return new Promise((resolve, reject) => {
      const items = [];
      let nextCursor = null;
      try {
        const transaction = database.transaction('takeManifests', 'readonly');
        const request = transaction.objectStore('takeManifests').openCursor();
        request.onsuccess = () => {
          const entry = request.result;
          if (!entry) return;
          if (cursor != null && entry.key < cursor) { entry.continue(cursor); return; }
          if (cursor != null && entry.key === cursor) { entry.continue(); return; }
          if (items.length >= limit) { nextCursor = items.at(-1).takeId; return; }
          const manifest = entry.value.manifest;
          items.push(Object.freeze({ takeId: manifest.takeId, takeName: manifest.takeName, documentId: manifest.documentId,
            revision: manifest.revision, state: manifest.state, complete: manifest.state === 'finalized' && manifest.complete === true,
            durableSequence: manifest.durableSequence, admittedSequence: manifest.admittedSequence,
            canonicalHash: manifest.canonicalHash, sourceRange: manifest.coverage?.sourceRange
              ? Object.freeze({ firstTick: manifest.coverage.sourceRange.firstTick, lastTick: manifest.coverage.sourceRange.lastTick,
                worldId: manifest.coverage.sourceRange.worldId }) : null }));
          entry.continue();
        };
        transaction.oncomplete = () => resolve(Object.freeze({ items: Object.freeze(items), nextCursor, order: 'take-id-ascending' }));
        transaction.onabort = () => reject(wrapFailure(transaction.error || request.error));
      } catch (error) { reject(wrapFailure(error)); }
    });
  };
  return { commitCausalTake, listCausalTakes, loadCausalTake: async id => (await read('takeManifests', id))?.manifest ?? null,
    loadCausalChunk: id => read('takeChunks', id), loadCausalCheckpoint: id => read('takeCheckpoints', id) };
};

export { CAUSAL_JOURNAL_STORES, upgradeCausalJournalStores, createCausalJournalStorage };
