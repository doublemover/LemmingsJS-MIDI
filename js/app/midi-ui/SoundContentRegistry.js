import { hashData } from '../../core/CanonicalData.js';
import { prepareSoundContentPack } from '../../midi/content/SoundContentPack.js';
import { borrowSoundContentStage } from './SoundContentReader.js';

const STORES = ['packs', 'packHeaders', 'packIdentities', 'patches', 'assets', 'assetHeaders', 'references', 'state'];
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const failure = (code, message, cause) => Object.assign(new Error(message), { name: 'SoundContentError', code, cause });
const storageError = error => error?.name === 'SoundContentError' ? error : failure(error?.name === 'QuotaExceededError' ? 'storage-full' : 'storage-unavailable', 'Sound library storage did not complete.', error);

export function createSoundContentRegistry({ indexedDB = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange, resourceBudget,
  openTimeoutMs = 5000, transactionTimeoutMs = 30000, maxPacks = 256, maxPatches = 2048, maxAssets = 1024,
  maxPayloadBytes = 256 * 1048576, maxManifestBytes = 32 * 1048576, maxReferences = 4096, onState = () => {} } = {}) {
  if (!resourceBudget?.reserve || !resourceBudget?.release || !Number.isInteger(openTimeoutMs) || openTimeoutMs < 1 || openTimeoutMs > 30000 ||
      !Number.isInteger(transactionTimeoutMs) || transactionTimeoutMs < 1 || transactionTimeoutMs > 120000 ||
      ![maxPacks, maxPatches, maxAssets, maxPayloadBytes, maxManifestBytes, maxReferences].every(value => Number.isSafeInteger(value) && value > 0) ||
      maxPacks > 1024 || maxPatches > 8192 || maxAssets > 4096 || maxPayloadBytes > 1024 * 1048576 || maxManifestBytes > 128 * 1048576 || maxReferences > 16384 || typeof onState !== 'function')
    throw new TypeError('Invalid sound registry limits.');
  let database = null, opening = null, closed = false, state = 'idle'; const transactions = new Set(), ownedReads = new Set();
  const report = (next, error = null) => { state = next; try { onState(Object.freeze({ state, code: error?.code || null })); } catch { /* Observers cannot own database operations. */ } };
  const open = () => {
    if (closed) return Promise.reject(failure('owner-retired', 'Sound library is closed.'));
    if (database) return Promise.resolve(database);
    if (opening) return opening.promise;
    let resolveOpen, rejectOpen, settled = false, timer = null;
    const promise = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
    const owner = { promise, fail: error => finish(error) }; opening = owner; report('opening');
    const finish = (error, db = null) => {
      if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); if (opening === owner) opening = null;
      if (error || closed) { db?.close(); const reason = storageError(error || failure('owner-retired', 'Sound library is closed.')); report(closed ? 'closed' : state === 'blocked' ? 'blocked' : 'unavailable', reason); rejectOpen(reason); return; }
      database = db;
      const invalidate = () => { if (database === db) { database = null; db.close(); if (!closed) report('unavailable'); } };
      db.onversionchange = invalidate; db.onclose = invalidate; report('ready'); resolveOpen(db);
    };
    try {
      if (!indexedDB) throw failure('storage-unavailable', 'IndexedDB is unavailable for the sound library.');
      const request = indexedDB.open('lemmings.sound.content', 1);
      request.onupgradeneeded = () => {
        if (closed || settled) { request.transaction.abort(); return; }
        for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onsuccess = () => finish(null, request.result); request.onerror = () => finish(request.error);
      request.onblocked = () => report('blocked', failure('storage-blocked', 'Another tab is blocking the sound library upgrade.'));
      timer = setTimeout(() => finish(failure(state === 'blocked' ? 'storage-blocked' : 'storage-timeout', 'Sound library open deadline exceeded.')), openTimeoutMs);
    } catch (error) { finish(error); }
    return promise;
  };
  const transact = async (names, mode, perform, { signal, isCurrent = () => true } = {}) => {
    signal?.throwIfAborted(); if (closed || !isCurrent()) throw failure('stale-owner', 'Sound library operation no longer owns its source.');
    if (transactions.size >= 4) throw failure('registry-capacity', 'Sound library has too many pending transactions.');
    const db = await open(); signal?.throwIfAborted();
    if (closed || db !== database || !isCurrent()) throw failure('stale-owner', 'Sound library connection or source changed.');
    return new Promise((resolve, reject) => {
      let transaction, result, reason = null, timer = null;
      const abort = error => { reason ||= error; try { transaction.abort(); } catch { /* A committing transaction reports its actual terminal outcome. */ } };
      const cancel = () => abort(signal.reason || failure('cancelled', 'Sound library operation canceled.'));
      const check = () => { signal?.throwIfAborted(); if (closed || db !== database || !isCurrent()) throw failure('stale-owner', 'Sound library operation no longer owns its source.'); };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); transactions.delete(owner); };
      const owner = { abort };
      try {
        check(); if (transactions.size >= 4) throw failure('registry-capacity', 'Sound library has too many pending transactions.');
        transaction = db.transaction(names, mode); transactions.add(owner);
        transaction.oncomplete = () => { cleanup(); resolve(result); };
        transaction.onabort = () => { cleanup(); reject(storageError(reason || transaction.error || failure('transaction-aborted', 'Sound library transaction aborted.'))); };
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => abort(failure('storage-timeout', 'Sound library transaction deadline exceeded.')), transactionTimeoutMs);
        const request = (store, method, args, callback = () => {}) => {
          check(); const pending = transaction.objectStore(store)[method](...args);
          pending.onsuccess = () => { try { check(); callback(pending.result); } catch (error) { abort(error); } };
          pending.onerror = () => { reason ||= pending.error; };
          return pending;
        };
        perform({ request, check, result: value => { result = value; } });
      } catch (error) { if (transaction) abort(error); else { cleanup(); reject(storageError(error)); } }
    });
  };
  const commitStage = async (stage, { signal, isCurrent = () => true } = {}) => {
    const lease = borrowSoundContentStage(stage);
    const controller = new AbortController(), cancel = () => controller.abort(signal?.aborted ? signal.reason : lease.signal.reason);
    signal?.addEventListener('abort', cancel, { once: true }); lease.signal.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted || lease.signal.aborted) cancel();
    try {
      controller.signal.throwIfAborted(); const prepared = lease.prepared, pack = prepared.pack;
      const qualification = lease.metadata.mode === 'reference-only' ? 'reference-only' : 'verified-material-not-render-qualified';
      const patchRecords = [];
      for (const entry of pack.patches) { controller.signal.throwIfAborted(); patchRecords.push({ id: entry.definition.id + '@' + entry.definition.revision, contentHash: await hashData(entry) }); }
      controller.signal.throwIfAborted();
      return await transact(STORES, 'readwrite', ({ request, check, result }) => {
        let pending = 0; const previous = { patches: new Map(), assets: new Map() };
        const get = (store, id, callback, method = 'get') => { pending++; request(store, method, [id], value => { callback(value); if (!--pending) publish(); }); };
        const publish = () => {
          check();
          if (!!previous.pack !== !!previous.header || previous.pack && !previous.state) throw failure('corrupt-registry', 'Sound library pack metadata is incomplete.');
          if (previous.identity && previous.identity.contentHash !== prepared.contentHash) throw failure('immutable-conflict', 'The sound pack ID/version already has different immutable bytes.');
          const inventory = { id: 'inventory', packs: 0, patches: 0, assets: 0, payloadBytes: 0, manifestBytes: 0, references: 0, ...previous.state };
          if (!['packs', 'patches', 'assets', 'payloadBytes', 'manifestBytes', 'references'].every(key => Number.isSafeInteger(inventory[key]) && inventory[key] >= 0)) throw failure('corrupt-registry', 'Sound library accounting is invalid.');
          const addedPatches = patchRecords.filter(entry => !previous.patches.has(entry.id));
          for (const entry of patchRecords) if (previous.patches.has(entry.id) && previous.patches.get(entry.id).contentHash !== entry.contentHash)
            throw failure('immutable-conflict', 'A patch ID/revision already has different immutable bytes: ' + entry.id);
          const addedAssets = [], available = [];
          for (const file of pack.files) {
            const prior = previous.assets.get(file.sha256), blob = lease.assetBlob(file.sha256);
            if (prior && prior.bytes !== file.bytes || blob && blob.size !== file.bytes) throw failure('immutable-conflict', 'Asset content reference has a conflicting byte inventory.');
            if (prior || blob) available.push(file.sha256);
            if (!prior && blob) addedAssets.push({ file, blob });
          }
          if (!previous.pack) { inventory.packs++; inventory.manifestBytes += prepared.manifestBytes; }
          inventory.patches += addedPatches.length; inventory.assets += addedAssets.length; inventory.payloadBytes += addedAssets.reduce((sum, entry) => sum + entry.file.bytes, 0);
          if (inventory.packs > maxPacks || inventory.patches > maxPatches || inventory.assets > maxAssets || inventory.payloadBytes > maxPayloadBytes || inventory.manifestBytes > maxManifestBytes)
            throw failure('registry-capacity', 'Sound library inventory exceeds its configured storage limits.');
          const archived = previous.header?.archived || false;
          request('packs', 'put', [{ id: prepared.contentHash, pack, manifestBytes: prepared.manifestBytes }]);
          request('packIdentities', 'put', [{ id: pack.id + '@' + pack.version, contentHash: prepared.contentHash }]);
          request('packHeaders', 'put', [{ id: prepared.contentHash, originId: pack.id, version: pack.version, name: pack.name, author: pack.author,
            patchCount: pack.patches.length, assetCount: pack.files.length, availableAssets: available.length, manifestBytes: prepared.manifestBytes, archived,
            installedAt: previous.header?.installedAt || Date.now(), qualification }]);
          for (const entry of addedPatches) request('patches', 'add', [entry]);
          for (const { file, blob } of addedAssets) {
            request('assets', 'add', [{ id: file.sha256, blob }]); request('assetHeaders', 'add', [{ id: file.sha256, bytes: file.bytes }]);
          }
          request('state', 'put', [inventory]);
          result(Object.freeze({ state: 'committed', contentHash: prepared.contentHash, originId: pack.id, version: pack.version,
            deduplicated: !!previous.pack, addedPatches: addedPatches.length, addedAssets: addedAssets.length, archived,
            qualification, laneApplication: 'not-requested' }));
        };
        get('state', 'inventory', value => { previous.state = value; });
        get('packs', prepared.contentHash, value => { previous.pack = value > 0; }, 'count');
        get('packHeaders', prepared.contentHash, value => { previous.header = value; });
        get('packIdentities', pack.id + '@' + pack.version, value => { previous.identity = value; });
        for (const entry of patchRecords) get('patches', entry.id, value => { if (value) previous.patches.set(entry.id, value); });
        for (const file of pack.files) get('assetHeaders', file.sha256, value => { if (value) previous.assets.set(file.sha256, value); });
      }, { signal: controller.signal, isCurrent });
    } finally { signal?.removeEventListener('abort', cancel); lease.signal.removeEventListener('abort', cancel); lease.release(); }
  };
  const listPacks = ({ after = null, limit = 25, includeArchived = false, signal } = {}) => {
    if (after != null && !hash(after) || !Number.isInteger(limit) || limit < 1 || limit > 50 || typeof includeArchived !== 'boolean' || after && !keyRange?.lowerBound) throw new TypeError('Invalid sound library page.');
    return transact(['packHeaders'], 'readonly', ({ request, result }) => {
      const entries = []; let scanned = 0, last = after;
      request('packHeaders', 'openCursor', [after ? keyRange.lowerBound(after, true) : null], value => {
        if (!value) { result(Object.freeze({ entries: Object.freeze(entries), next: null })); return; }
        last = value.key; scanned++; if (includeArchived || !value.value.archived) entries.push(Object.freeze(value.value));
        if (entries.length >= limit || scanned >= 128) result(Object.freeze({ entries: Object.freeze(entries), next: last }));
        else value.continue();
      });
    }, { signal });
  };
  const readOwned = async (store, contentHash, estimatedBytes, { signal } = {}) => {
    if (!hash(contentHash)) throw new TypeError('Invalid content hash.');
    const token = {}, owner = { releaseError: null }; let held = false, value = null, released = false;
    const release = () => {
      if (released) { if (owner.releaseError) throw owner.releaseError; return; } released = true; value = null;
      try {
        if (held) {
          const ack = resourceBudget.release({ token, owner: 'sound-library-read' });
          if (ack === false || ack && typeof ack.then === 'function') {
            if (ack?.then) Promise.resolve(ack).catch(() => {});
            throw failure('retirement-unknown', 'Sound library read reservation release was not acknowledged synchronously.');
          }
        }
        ownedReads.delete(owner);
      } catch (error) { owner.releaseError = error; throw error; }
    };
    try {
      signal?.throwIfAborted(); if (closed || ownedReads.size >= 8) throw failure('registry-capacity', 'Sound library read admission is unavailable.');
      resourceBudget.reserve({ token, owner: 'sound-library-read', category: 'candidate', bytes: estimatedBytes, pinned: true, reloadable: false }); held = true; ownedReads.add(owner);
      value = await transact([store], 'readonly', ({ request, result }) => request(store, 'get', [contentHash], result), { signal });
      signal?.throwIfAborted(); if (!value) { release(); return null; }
      return Object.freeze({ get value() { if (released || closed || signal?.aborted) throw failure('owner-retired', 'Sound library read was retired.'); return value; }, release });
    } catch (error) { release(); throw error; }
  };
  const loadPack = async (contentHash, { engineDescriptors = [], signal } = {}) => {
    const lease = await readOwned('packs', contentHash, 32 * 1048576, { signal }); if (!lease) return null;
    try {
      let prepared = await prepareSoundContentPack(lease.value.pack, { engineDescriptors, signal });
      if (prepared.contentHash !== contentHash) throw failure('content-mismatch', 'Stored sound manifest failed its immutable hash check.');
      lease.value;
      return Object.freeze({ get prepared() { lease.value; return prepared; }, release() { prepared = null; lease.release(); } });
    } catch (error) { lease.release(); throw error; }
  };
  const loadAsset = async (contentHash, bytes, { signal } = {}) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 16 * 1048576) throw new TypeError('Invalid asset byte bound.');
    const lease = await readOwned('assets', contentHash, Math.max(4096, bytes), { signal }); if (!lease) return null;
    try {
      if (!(lease.value.blob instanceof Blob) || lease.value.blob.size !== bytes) throw failure('content-mismatch', 'Stored sound asset has an invalid byte inventory.');
      return Object.freeze({ get blob() { return lease.value.blob; }, release: lease.release });
    } catch (error) { lease.release(); throw error; }
  };
  const setArchived = (contentHash, archived, { signal } = {}) => {
    if (!hash(contentHash) || typeof archived !== 'boolean') throw new TypeError('Invalid sound library archive request.');
    return transact(['packHeaders'], 'readwrite', ({ request, result }) => request('packHeaders', 'get', [contentHash], header => {
      if (!header) throw failure('missing-pack', 'Sound pack is not installed.'); request('packHeaders', 'put', [{ ...header, archived }]);
      result(Object.freeze({ contentHash, archived, material: 'retained', projectReferences: 'preserved' }));
    }), { signal });
  };
  const setProjectReference = (projectId, contentHash, retained, { signal } = {}) => {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 160 || !hash(contentHash) || typeof retained !== 'boolean') throw new TypeError('Invalid project content reference.');
    return transact(['references', 'packHeaders', 'state'], 'readwrite', ({ request, result }) => {
      let header, previous, inventory, pending = 3; const id = projectId + ':' + contentHash;
      const publish = () => {
        if (--pending) return;
        if (retained && !header) throw failure('missing-pack', 'Project reference requires an installed pack.');
        const next = { id: 'inventory', packs: 0, patches: 0, assets: 0, payloadBytes: 0, manifestBytes: 0, references: 0, ...inventory };
        next.references += retained ? previous ? 0 : 1 : previous ? -1 : 0;
        if (!Number.isSafeInteger(next.references) || next.references < 0 || next.references > maxReferences) throw failure('registry-capacity', 'Sound library project references exceed their bounds.');
        if (retained) request('references', 'put', [{ id, projectId, contentHash }]); else request('references', 'delete', [id]);
        request('state', 'put', [next]); result(Object.freeze({ projectId, contentHash, retained }));
      };
      request('packHeaders', 'get', [contentHash], value => { header = value; publish(); });
      request('references', 'get', [id], value => { previous = value; publish(); });
      request('state', 'get', ['inventory'], value => { inventory = value; publish(); });
    }, { signal });
  };
  return Object.freeze({ commitStage, listPacks, loadPack, loadAsset, setArchived, setProjectReference,
    diagnostics: () => Object.freeze({ state, transactions: transactions.size, ownedReads: ownedReads.size,
      unknownRetirement: [...ownedReads].filter(owner => owner.releaseError).length, closed }),
    close() { if (closed) return; closed = true; opening?.fail(failure('owner-retired', 'Sound library is closed.'));
      for (const owner of transactions) owner.abort(failure('owner-retired', 'Sound library is closed.'));
      database?.close(); database = null; report('closed'); }
  });
}
