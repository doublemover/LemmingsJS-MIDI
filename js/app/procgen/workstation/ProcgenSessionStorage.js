import { checksumProcgenRecovery } from './ProcgenRecoveryChecksum.js';
import { upgradeCausalJournalStores, createCausalJournalStorage } from './ProcgenCausalJournalStorage.js';

const SESSION_VERSION = 1;
const namedError = (name, message) => Object.assign(new Error(message), { name });
const validateProcgenSession = value => {
  if (!value || value.format !== 'lemmings-procgen-session' || value.version !== SESSION_VERSION || !value.project || !value.world || !value.settings) throw new Error('This is not a supported ProcGen project.');
  if (typeof value.project !== 'object' || typeof value.world !== 'object' || typeof value.settings !== 'object' || Array.isArray(value.settings) ||
      !value.transport || typeof value.transport !== 'object' || !value.patterns || typeof value.patterns !== 'object' ||
      value.patterns.version !== 1 || !Number.isFinite(value.patterns.beat) || !value.patterns.lanes || typeof value.patterns.lanes !== 'object' ||
      !Array.isArray(value.patterns.pending) || !Array.isArray(value.patterns.active)) throw new Error('Project transport or pattern state is incomplete.');
  if (value.physicalState != null && (typeof value.physicalState !== 'object' || Array.isArray(value.physicalState) || value.physicalState.version !== 1) ||
      value.camera != null && (typeof value.camera !== 'object' || Array.isArray(value.camera)) ||
      value.ui != null && (typeof value.ui !== 'object' || Array.isArray(value.ui))) throw new Error('Project presentation state is invalid.');
  if (!Number.isInteger(value.world.laneCount) || value.world.laneCount < 1 || value.world.laneCount > 1024 || !Number.isFinite(value.world.seed)) throw new Error('Invalid world settings.');
  return value;
};
const createProcgenSession = ({ name = 'Untitled session', project, settings, world, transport, patterns, physicalTimeline = null, physicalState = null, camera, ui }) => ({
  format: 'lemmings-procgen-session', version: SESSION_VERSION, name: String(name).slice(0, 120), savedAt: new Date().toISOString(),
  project, settings: { ...settings }, world, transport, patterns, physicalTimeline, physicalState, camera, ui
});
let documentIdSequence = 0;
const createProcgenDocumentId = (crypto = globalThis.crypto) => {
  if (crypto?.randomUUID) return 'doc:' + crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  return 'doc:' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') + '-' + (++documentIdSequence);
};
const legacyDocumentId = key => 'doc:legacy:' + String(key).split('').map(unit => unit.charCodeAt(0).toString(16).padStart(4, '0')).join('');
const storageFailure = (error, fallback = 'Project storage failed.') => {
  const name = error?.name || '';
  const category = name === 'QuotaExceededError' ? 'quota' : name === 'ConflictError' ? 'conflict' : name === 'VersionError' || name === 'NotFoundError' ? 'schema' :
    name === 'AbortError' ? 'transaction-abort' : name === 'SecurityError' || name === 'InvalidStateError' ? 'unavailable' : 'transient';
  const messages = { quota: 'Project storage is full. Export this project or remove an old recovery.',
    conflict: 'This project changed in another tab. Open the latest version or save a copy.',
    schema: 'Project storage has an incompatible schema. Reload the application before retrying.',
    'transaction-abort': 'Project storage canceled the write. Retry the save; the previous project remains available.',
    unavailable: 'Browser project storage is unavailable. Export a project file to save.', transient: fallback };
  const failure = new Error(messages[category], { cause: error }); failure.name = 'ProcgenStorageError'; failure.category = category;
  return failure;
};
const createProcgenSessionStorage = (indexedDB = globalThis.indexedDB, { openTimeoutMs = 5000, onState = () => {}, keyRange = globalThis.IDBKeyRange } = {}) => {
  if (!Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1) throw new RangeError('Invalid project storage open timeout');
  let database = null, opening = null, generation = 0, retired = false, state = 'closed', lastError = null;
  const report = (next, error = null) => { state = next; lastError = error; onState({ state, error, generation }); };
  const invalidate = (db, reason) => {
    if (database !== db) return;
    database = null; generation++;
    try { db.close(); } catch { /* The connection was already closed. */ }
    if (!retired) report('unavailable', storageFailure(reason, 'Project storage connection closed. Retry the save.'));
  };
  const open = () => {
    if (retired) return Promise.reject(storageFailure(null, 'Project storage is closed.'));
    if (database) return Promise.resolve(database);
    if (opening) return opening.promise;
    const epoch = ++generation;
    report('opening');
    let resolveOpen, rejectOpen, timer = null, settled = false, request;
    const promise = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
    const owner = { promise, reject: reason => finish(reason) };
    opening = owner;
    const finish = (error, db = null) => {
      if (settled) { db?.close?.(); return; }
      settled = true; clearTimeout(timer);
      if (opening === owner) opening = null;
      if (error || retired || epoch !== generation) {
        db?.close?.();
        const failure = !retired && state === 'blocked' ? storageFailure(null, 'Another tab is using project storage. Close or reload that tab, then retry.') :
          storageFailure(error, retired ? 'Project storage is closed.' : 'Project storage could not open. Retry the save.');
        if (!retired && epoch === generation) report(state === 'blocked' ? 'blocked' : 'unavailable', failure);
        rejectOpen(failure); return;
      }
      database = db;
      db.onversionchange = event => invalidate(db, event);
      db.onclose = event => invalidate(db, event);
      report('ready'); resolveOpen(db);
    };
    if (!indexedDB) { finish(namedError('SecurityError', 'IndexedDB is unavailable')); return promise; }
    try {
      request = indexedDB.open('lemmings.procgen.sessions', 4);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' });
        const metadata = request.result.objectStoreNames.contains('projectMetadata') ? request.transaction.objectStore('projectMetadata') :
          request.result.createObjectStore('projectMetadata', { keyPath: 'id' });
        if (!metadata.indexNames.contains('byUpdated')) metadata.createIndex('byUpdated', ['savedAt', 'id']);
        upgradeCausalJournalStores(request.result);
      };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => report('blocked', storageFailure(null, 'Another tab is using project storage. Close or reload that tab, then retry.'));
      timer = setTimeout(() => finish(new Error('IndexedDB open timed out')), openTimeoutMs);
    } catch (error) { finish(error); }
    return promise;
  };
  const operation = async (mode, perform, storeName = 'sessions') => {
    const db = await open();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry the operation.');
    return new Promise((resolve, reject) => {
      let transaction, request, settled = false;
      const fail = error => { if (!settled) { settled = true; reject(storageFailure(error)); } };
      try {
        transaction = db.transaction(storeName, mode);
        request = perform(transaction.objectStore(storeName));
        transaction.oncomplete = () => { if (!settled) { settled = true; resolve(request?.result); } };
        transaction.onabort = () => fail(transaction.error || request?.error || namedError('AbortError', 'Transaction aborted'));
      } catch (error) { fail(error); }
    });
  };
  const saveDocument = async (id, expectedRevision, session, commitId) => {
    validateProcgenSession(session);
    if (typeof id !== 'string' || !id.startsWith('doc:') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        typeof commitId !== 'string' || !commitId) throw new TypeError('Invalid document save identity');
    const db = await open();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry the save.');
    return new Promise((resolve, reject) => {
      let transaction, receipt = null, conflict = null;
      try {
        transaction = db.transaction(['sessions', 'projectMetadata'], 'readwrite');
        const store = transaction.objectStore('sessions'), request = store.get(id);
        request.onsuccess = () => {
          const current = request.result;
          if (current && current.kind !== 'document') { conflict = storageFailure(namedError('ConflictError', 'Reserved document ID')); transaction.abort(); return; }
          if (current?.commitId === commitId) { receipt = { id, revision: current.revision, savedAt: current.savedAt, repeated: true }; return; }
          if ((current?.revision || 0) !== expectedRevision) { conflict = storageFailure(namedError('ConflictError', 'Document revision changed')); transaction.abort(); return; }
          receipt = { id, revision: expectedRevision + 1, savedAt: session.savedAt, repeated: false };
          store.put({ id, kind: 'document', revision: receipt.revision, commitId, name: session.name, savedAt: session.savedAt,
            createdAt: current?.createdAt || session.savedAt, session });
          transaction.objectStore('projectMetadata').put({ id, revision: receipt.revision, name: session.name,
            savedAt: session.savedAt, createdAt: current?.createdAt || session.savedAt });
        };
        transaction.oncomplete = () => resolve(receipt);
        transaction.onabort = () => reject(conflict || storageFailure(transaction.error || request.error || namedError('AbortError', 'Document write aborted')));
      } catch (error) { reject(storageFailure(error)); }
    });
  };
  const insertIfAbsent = async record => {
    const db = await open();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry migration.');
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(['sessions', 'projectMetadata'], 'readwrite'), store = transaction.objectStore('sessions');
        const request = store.get(record.id);
        request.onsuccess = () => {
          if (request.result) return;
          store.put(record);
          if (record.kind === 'document') transaction.objectStore('projectMetadata').put({ id: record.id, revision: record.revision,
            name: record.name, savedAt: record.savedAt, createdAt: record.createdAt });
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(storageFailure(transaction.error || request.error));
      } catch (error) { reject(storageFailure(error)); }
    });
  };
  const legacyBatch = async after => {
    const db = await open();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry migration.');
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction('sessions', 'readonly');
        const range = after == null ? null : keyRange.lowerBound(after, true);
        const request = transaction.objectStore('sessions').openCursor(range);
        const records = [];
        let scanned = 0, nextCursor = null;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (records.length === 16 || scanned === 64) { nextCursor = after; return; }
          scanned++; after = cursor.key;
          if (!cursor.value.kind && cursor.value.session) records.push(cursor.value);
          cursor.continue();
        };
        transaction.oncomplete = () => resolve({ records, nextCursor });
        transaction.onabort = () => reject(storageFailure(transaction.error || request.error));
      } catch (error) { reject(storageFailure(error)); }
    });
  };
  let migration = null, migrationDone = false;
  const migrateLegacy = () => {
    if (migrationDone) return Promise.resolve();
    if (migration) return migration;
    migration = (async () => {
      const marker = await operation('readonly', store => store.get('migration:v1'), 'projectMetadata');
      if (marker) { migrationDone = true; return; }
      const transfer = async record => {
        try { validateProcgenSession(record.session); } catch { return; }
        const recovery = record.id === '__recovery__', id = recovery ? 'recovery:latest' : legacyDocumentId(record.id);
        await insertIfAbsent({ id, kind: recovery ? 'recovery' : 'document', revision: 1,
          commitId: 'legacy-migration-v1', name: record.name, savedAt: record.savedAt,
          createdAt: record.savedAt, session: record.session });
      };
      if (keyRange?.lowerBound) {
        let after = null;
        do {
          const batch = await legacyBatch(after);
          for (const record of batch.records) await transfer(record);
          after = batch.nextCursor;
          if (after != null) await new Promise(resolve => setTimeout(resolve, 0));
        } while (after != null);
      } else {
        const records = await operation('readonly', store => store.getAll());
        for (const record of records) if (!record.kind && record.session) await transfer(record);
      }
      await operation('readwrite', store => store.put({ id: 'migration:v1', kind: 'migration' }), 'projectMetadata');
      migrationDone = true;
    })().finally(() => { migration = null; });
    return migration;
  };
  const causalJournalStorage = createCausalJournalStorage({ open, available: db => !retired && db === database, wrapFailure: storageFailure });
  return {
    ...causalJournalStorage,
    getState: () => ({ state, error: lastError, generation, retired }),
    saveDocument,
    async loadDocument(id) {
      const record = await operation('readonly', store => store.get(id));
      if (!record || record.kind !== 'document') throw new Error('Project not found.');
      return { id, revision: record.revision, name: record.name, savedAt: record.savedAt, session: validateProcgenSession(record.session) };
    },
    async listDocuments() {
      await migrateLegacy();
      const records = await operation('readonly', store => store.getAll(), 'projectMetadata');
      return records.filter(record => record.kind !== 'migration').map(({ id, revision, name, savedAt }) => ({ id, revision, name, savedAt }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
    },
    async listDocumentPage({ limit = 40, cursor = null, query = '' } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || typeof query !== 'string' || query.length > 120 ||
          cursor && (typeof cursor.savedAt !== 'string' || typeof cursor.id !== 'string')) throw new TypeError('Invalid project page request');
      await migrateLegacy();
      const db = await open();
      if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry the project list.');
      const needle = query.trim().toLocaleLowerCase();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction('projectMetadata', 'readonly');
          const index = transaction.objectStore('projectMetadata').index('byUpdated');
          const range = cursor ? keyRange?.upperBound([cursor.savedAt, cursor.id], true) : null;
          if (cursor && !range) throw new Error('Project paging key ranges are unavailable');
          const request = index.openCursor(range, 'prev'), items = [];
          const scanLimit = Math.max(200, limit * 8);
          let last = null, lastScanned = null, nextCursor = null, scanned = 0;
          request.onsuccess = () => {
            const entry = request.result;
            if (!entry) return;
            if (items.length === limit || scanned === scanLimit) { nextCursor = items.length === limit ? last : lastScanned; return; }
            scanned++; lastScanned = { savedAt: entry.value.savedAt, id: entry.value.id };
            const value = entry.value;
            if (value.kind === 'migration' || needle && !String(value.name).toLocaleLowerCase().includes(needle)) { entry.continue(); return; }
            items.push({ id: value.id, revision: value.revision, name: value.name, savedAt: value.savedAt });
            last = { savedAt: value.savedAt, id: value.id }; entry.continue();
          };
          transaction.oncomplete = () => resolve({ items, nextCursor, storageState: state });
          transaction.onabort = () => reject(storageFailure(transaction.error || request.error));
        } catch (error) { reject(storageFailure(error)); }
      });
    },
    async saveRecovery(session, { signal, documentRevision = null, tick = null } = {}) {
      validateProcgenSession(session);
      const checksum = await checksumProcgenRecovery(session, { signal });
      if (signal?.aborted) throw namedError('AbortError', 'Recovery write canceled');
      const db = await open();
      if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry recovery.');
      return new Promise((resolve, reject) => {
        let transaction, receipt;
        try {
          transaction = db.transaction('sessions', 'readwrite');
          const abort = () => { try { transaction.abort(); } catch { /* A completed transaction needs no cancellation. */ } };
          signal?.addEventListener('abort', abort, { once: true });
          const store = transaction.objectStore('sessions'), request = store.get('recovery:head');
          request.onsuccess = () => {
            if (signal?.aborted) { transaction.abort(); return; }
            const generation = (request.result?.generation || 0) + 1, slot = generation % 2;
            receipt = { generation, checksum, documentRevision, tick };
            store.put({ id: `recovery:slot:${slot}`, kind: 'recovery-generation', ...receipt,
              name: session.name, savedAt: session.savedAt, session });
            store.put({ id: 'recovery:head', kind: 'recovery-head', generation, slot, checksum });
          };
          transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(receipt); };
          transaction.onabort = () => { signal?.removeEventListener('abort', abort);
            reject(storageFailure(transaction.error || request.error || namedError('AbortError', 'Recovery transaction aborted'))); };
        } catch (error) { reject(storageFailure(error)); }
      });
    },
    async loadRecovery() {
      await migrateLegacy();
      const [head, first, second, legacy] = await Promise.all([
        operation('readonly', store => store.get('recovery:head')),
        operation('readonly', store => store.get('recovery:slot:0')),
        operation('readonly', store => store.get('recovery:slot:1')),
        operation('readonly', store => store.get('recovery:latest'))
      ]);
      for (const record of [first, second].filter(item => item && head && Number.isSafeInteger(item.generation) &&
        item.generation <= head.generation && (item.generation !== head.generation || item.checksum === head.checksum))
        .sort((a, b) => b.generation - a.generation)) {
        try {
          if (record.kind === 'recovery-generation' && record.checksum === await checksumProcgenRecovery(record.session))
            return validateProcgenSession(record.session);
        } catch { /* Try the previous complete generation. */ }
      }
      return legacy ? validateProcgenSession(legacy.session) : null;
    },
    async removeRecovery() { await operation('readwrite', store => {
      for (const id of ['recovery:latest', 'recovery:head', 'recovery:slot:0']) store.delete(id);
      return store.delete('recovery:slot:1');
    }); },
    async estimateUsage() {
      const estimate = await globalThis.navigator?.storage?.estimate?.();
      return estimate ? { usage: estimate.usage ?? null, quota: estimate.quota ?? null } : null;
    },
    async save(id, session) { validateProcgenSession(session); await operation('readwrite', store => store.put({ id, name: session.name, savedAt: session.savedAt, session })); return id; },
    async load(id) { const record = await operation('readonly', store => store.get(id)); if (!record) throw new Error('Project not found.'); return validateProcgenSession(record.session); },
    async list() { return (await operation('readonly', store => store.getAll())).map(({ id, name, savedAt }) => ({ id, name, savedAt })).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); },
    async remove(id) { await operation('readwrite', store => store.delete(id)); },
    close() {
      if (retired) return;
      retired = true; generation++;
      const pending = opening; opening = null;
      pending?.reject(new Error('Project storage closed'));
      const db = database; database = null;
      db?.close(); report('closed');
    }
  };
};
const freshProcgenSeed = (crypto = globalThis.crypto, previous = null) => {
  const value = new Uint32Array(1); crypto?.getRandomValues?.(value);
  let seed = value[0] || ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  if (seed === previous) seed = (seed + 0x9e3779b9) >>> 0;
  return seed;
};
export { createProcgenSession, validateProcgenSession, createProcgenSessionStorage, createProcgenDocumentId, freshProcgenSeed };
