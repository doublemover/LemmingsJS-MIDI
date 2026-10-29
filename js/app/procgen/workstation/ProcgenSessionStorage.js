import { getActiveExecutionIdentity, getApplicationDeploymentRoot } from '../../../runtime/ActiveExecutionIdentity.js';
import { RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION, GENERATION_PIN_STORE, recoveryGenerationPin, upgradeBrowserGenerationPins, withBrowserGenerationRetentionLock } from '../../../runtime/BrowserGenerationPins.js';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult, resourceRetirementSummary, awaitBackgroundFailureRetirement } from '../../resources/ResourceRetirement.js';
import { createProcgenRecoveryPageStore } from './ProcgenRecoveryPageStore.js';
import { createProcgenPreferencePages } from './ProcgenPreferencePages.js';
import { validateProcgenRecoveryJournal } from './ProcgenRecoveryJournal.js';
import { backgroundJobService } from '../../resources/BackgroundJobService.js';
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
  if (value.executionIdentity != null && (typeof value.executionIdentity !== 'object' || Array.isArray(value.executionIdentity) || JSON.stringify(value.executionIdentity).length > 4096)) throw new Error('Invalid bounded session execution provenance.');
  if (value.recoveryJournal != null) validateProcgenRecoveryJournal(value.recoveryJournal);
  return value;
};
const createProcgenSession = ({ name = 'Untitled session', project, settings, world, transport, patterns, physicalTimeline = null, physicalState = null, recoveryJournal = null, camera, ui, executionIdentity = { ...getActiveExecutionIdentity(), deploymentRoot: getApplicationDeploymentRoot()?.href || null } }) => ({
  format: 'lemmings-procgen-session', version: SESSION_VERSION, name: String(name).slice(0, 120), savedAt: new Date().toISOString(),
  executionIdentity, project, settings: { ...settings }, world, transport, patterns, physicalTimeline, physicalState, ...(recoveryJournal ? { recoveryJournal } : {}), camera, ui
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
const createProcgenSessionStorage = (indexedDB = globalThis.indexedDB, { openTimeoutMs = 5000, onState = () => {}, keyRange = globalThis.IDBKeyRange,
  backgroundJobs = backgroundJobService, budgetAdapter = null } = {}) => {
  if (!Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1) throw new RangeError('Invalid project storage open timeout');
  let database = null, opening = null, generation = 0, retired = false, state = 'closed', lastError = null;
  const lifetime = new AbortController(); let checksumSequence = 0;
  const checksumSnapshot = async (prepareSnapshot, { signal, laneCount = 1024 } = {}) => {
    const controller = new AbortController(), cancel = () => controller.abort(signal?.reason || lifetime.signal.reason);
    signal?.addEventListener('abort', cancel, { once: true }); lifetime.signal.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted || lifetime.signal.aborted) cancel();
    let computed = null, snapshot = null, released = false, releaseError = null;
    const jobAborted = () => controller.abort(computed?.signal?.reason);
    const release = () => { if (releaseError) throw releaseError; if (released) return; released = true; signal?.removeEventListener('abort', cancel); lifetime.signal.removeEventListener('abort', cancel); computed?.signal?.removeEventListener('abort', jobAborted); snapshot = null; try { retireBackgroundResult(computed); } catch (error) { releaseError = error; throw error; } };
    try {
      if (checksumSequence === Number.MAX_SAFE_INTEGER) throw new Error('Recovery checksum operation identity exhausted.');
      computed = await backgroundJobs.compute({ kind: 'recovery-checksum', ownerId: 'procgen-recovery-storage', ownerEpoch: generation,
        sourceRevision: `recovery:${++checksumSequence}`, inputBytes: 0, estimatedPeakBytes: 128 * 1048576 + Math.max(1, Math.min(1024, laneCount || 1024)) * 131072,
        priority: 'recovery', budgetAdapter, signal: controller.signal, retainInput: true, isCurrent: () => !retired,
        prepareInput: async () => { snapshot = await prepareSnapshot(); validateProcgenSession(snapshot); return snapshot; }, releasePreparedInput: () => { snapshot = null; } });
      computed.signal?.addEventListener('abort', jobAborted, { once: true }); if (computed.signal?.aborted) jobAborted();
      controller.signal.throwIfAborted();
      return { checksum: computed.value, get snapshot() { controller.signal.throwIfAborted(); if (!snapshot) throw namedError('AbortError', 'Checkpoint source was released'); return snapshot; }, signal: controller.signal, release };
    } catch (error) {
      try { await awaitBackgroundFailureRetirement(error); }
      finally { release(); }
      throw error;
    }
  };
  const ownedSource = (computed, metadata) => {
    let owner = computed;
    return Object.freeze({ schema: 'procgen-owned-source/v1', ...metadata, signal: computed.signal,
      get session() { if (!owner) throw namedError('AbortError', 'Checkpoint source was released'); return owner.snapshot; },
      release() { if (!owner) return; const previous = owner; owner = null; previous.release(); } });
  };
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
      request = indexedDB.open(RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION);
      request.onupgradeneeded = event => {
        if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' });
        const metadata = request.result.objectStoreNames.contains('projectMetadata') ? request.transaction.objectStore('projectMetadata') :
          request.result.createObjectStore('projectMetadata', { keyPath: 'id' });
        if (!metadata.indexNames.contains('byUpdated')) metadata.createIndex('byUpdated', ['savedAt', 'id']);
        if (event.oldVersion === 0) metadata.put({ id: 'migration:v1', kind: 'migration', revision: 0 });
        upgradeCausalJournalStores(request.result, request.transaction);
        upgradeBrowserGenerationPins(request.result, request.transaction, event.oldVersion);
      };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => report('blocked', storageFailure(null, 'Another tab is using project storage. Close or reload that tab, then retry.'));
      timer = setTimeout(() => finish(new Error('IndexedDB open timed out')), openTimeoutMs);
    } catch (error) { finish(error); }
    return promise;
  };
  const operation = async (mode, perform, storeName = 'sessions', signal = null) => {
    signal?.throwIfAborted();
    const db = await open();
    signal?.throwIfAborted();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry the operation.');
    return new Promise((resolve, reject) => {
      let transaction, request, settled = false;
      const abort = () => { try { transaction?.abort(); } catch { /* The transaction already settled. */ } };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const fail = error => { if (!settled) { settled = true; cleanup(); reject(storageFailure(error)); } };
      try {
        transaction = db.transaction(storeName, mode);
        signal?.addEventListener('abort', abort, { once: true });
        request = perform(transaction.objectStore(Array.isArray(storeName) ? storeName[0] : storeName), transaction);
        transaction.oncomplete = () => { if (!settled) { settled = true; cleanup(); resolve(request?.result); } };
        transaction.onabort = () => fail(transaction.error || request?.error || namedError('AbortError', 'Transaction aborted'));
      } catch (error) { abort(); fail(error); }
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
            savedAt: session.savedAt, createdAt: current?.createdAt || session.savedAt, laneCount: session.world.laneCount });
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
            name: record.name, savedAt: record.savedAt, createdAt: record.createdAt, laneCount: record.session.world.laneCount });
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(storageFailure(transaction.error || request.error));
      } catch (error) { reject(storageFailure(error)); }
    });
  };
  const legacyBatch = async (after, signal) => {
    signal?.throwIfAborted();
    const db = await open();
    signal?.throwIfAborted();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry migration.');
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(['sessions', 'projectMetadata'], 'readonly'), store = transaction.objectStore('sessions');
        const abort = () => { try { transaction.abort(); } catch { /* The transaction already settled. */ } };
        signal?.addEventListener('abort', abort, { once: true });
        const range = after == null ? null : keyRange.lowerBound(after, true);
        const keysOnly = typeof store.openKeyCursor === 'function';
        const request = keysOnly ? store.openKeyCursor(range) : store.openCursor(range);
        const records = [];
        let scanned = 0, nextCursor = null;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (records.length === 1 || scanned === 64) { nextCursor = after; return; }
          scanned++; after = cursor.key;
          if (!keysOnly) {
            if (!cursor.value.kind && cursor.value.session) records.push(cursor.value);
            cursor.continue(); return;
          }
          const key = cursor.primaryKey;
          const metadata = transaction.objectStore('projectMetadata').get(String(key).startsWith('doc:') ? key : legacyDocumentId(key));
          metadata.onsuccess = () => {
            if (metadata.result) { cursor.continue(); return; }
            const payload = store.get(key);
            payload.onsuccess = () => { if (payload.result && !payload.result.kind && payload.result.session) records.push(payload.result); cursor.continue(); };
          };
        };
        transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve({ records, nextCursor }); };
        transaction.onabort = () => { signal?.removeEventListener('abort', abort); reject(storageFailure(transaction.error || request.error)); };
      } catch (error) { reject(storageFailure(error)); }
    });
  };
  let migration = null;
  const migrateLegacy = async signal => {
    signal?.throwIfAborted();
    while (migration) {
      try { await migration; } catch { /* Another caller can retry a canceled or failed migration. */ }
      signal?.throwIfAborted();
    }
    const work = (async () => {
      let complete = false;
      do {
        signal?.throwIfAborted();
        const marker = await operation('readonly', store => store.get('migration:v1'), 'projectMetadata', signal);
        if (marker && !marker.pending) return;
        const transfer = async record => {
          signal?.throwIfAborted();
          try { validateProcgenSession(record.session); } catch { return; }
          const recovery = record.id === '__recovery__', id = recovery ? 'recovery:latest' : legacyDocumentId(record.id);
          await insertIfAbsent({ id, kind: recovery ? 'recovery' : 'document', revision: 1,
            commitId: 'legacy-migration-v1', name: record.name, savedAt: record.savedAt,
            createdAt: record.savedAt, session: record.session });
        };
        if (keyRange?.lowerBound) {
          let after = null;
          do {
            const batch = await legacyBatch(after, signal);
            for (const record of batch.records) await transfer(record);
            after = batch.nextCursor;
            if (after != null) await new Promise(resolve => setTimeout(resolve, 0));
          } while (after != null);
        } else {
          const records = await operation('readonly', store => store.getAll(), 'sessions', signal);
          for (const record of records) if (!record.kind && record.session) await transfer(record);
        }
        complete = await operation('readwrite', store => {
          const request = store.get('migration:v1'), result = { result: false };
          request.onsuccess = () => {
            if ((request.result?.revision || 0) !== (marker?.revision || 0)) return;
            store.put({ id: 'migration:v1', kind: 'migration', revision: marker?.revision || 0 }); result.result = true;
          };
          return result;
        }, 'projectMetadata', signal);
      } while (!complete);
    })();
    migration = work;
    try { await work; } finally { if (migration === work) migration = null; }
  };
  const recoveryPages = createProcgenRecoveryPageStore({ open, jobs: backgroundJobs, resourceBudget: budgetAdapter, isCurrent: () => !retired, validateSession: validateProcgenSession });
  const preferencePages = createProcgenPreferencePages({ open,
    jobs: backgroundJobs, resourceBudget: budgetAdapter, isCurrent: db => !retired && (!db || db === database) });
  const causalJournalStorage = createCausalJournalStorage({ open, available: db => !retired && db === database, wrapFailure: storageFailure });
  return {
    ...causalJournalStorage,
    savePreferences: (value, options) => preferencePages.save(value, options),
    loadPreferences: options => preferencePages.load(options),
    getPreferenceDiagnostics: () => preferencePages.diagnostics(),
    openCausalWorkerSource: typeof globalThis.Worker === 'function' && indexedDB === globalThis.indexedDB ? async () => {
      const db = await open(); if (retired || database !== db) throw new Error('Causal source connection changed.');
      return { signal: lifetime.signal, isCurrent: () => !retired && database === db };
    } : null,
    supportsRecoveryFactory: true,
    getState: () => ({ state, error: lastError, generation, retired, recoveryPages: recoveryPages.stats(), preferencePages: preferencePages.diagnostics() }),
    saveDocument,
    async loadDocument(id, { signal } = {}) {
      const record = await operation('readonly', store => store.get(id), 'sessions', signal);
      if (!record || record.kind !== 'document') throw new Error('Project not found.');
      return { id, revision: record.revision, name: record.name, savedAt: record.savedAt, session: validateProcgenSession(record.session) };
    },
    async loadDocumentOwned(id, { signal } = {}) {
      let record, computed;
      try {
        const metadata = await operation('readonly', store => store.get(id), 'projectMetadata', signal);
        const laneCount = Number.isInteger(metadata?.laneCount) && metadata.laneCount >= 1 && metadata.laneCount <= 1024 ? metadata.laneCount : 1024;
        computed = await checksumSnapshot(async () => {
          record = await operation('readonly', store => store.get(id), 'sessions', signal);
          if (!record || record.kind !== 'document') throw new Error('Project not found.');
          if (metadata?.laneCount != null && (metadata.revision !== record.revision || laneCount !== record.session?.world?.laneCount)) throw namedError('ConflictError', 'Stored project admission metadata changed. Select the project again.');
          return record.session;
        }, { signal, laneCount });
        const result = ownedSource(computed, { kind: 'document', id, revision: record.revision, name: record.name, savedAt: record.savedAt,
          checksum: computed.checksum, verification: 'stored-document-snapshot' });
        record = null; computed = null; return result;
      } finally { computed?.release(); }
    },
    async listDocuments() {
      await migrateLegacy();
      const records = await operation('readonly', store => store.getAll(), 'projectMetadata');
      return records.filter(record => record.kind !== 'migration').map(({ id, revision, name, savedAt }) => ({ id, revision, name, savedAt }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
    },
    async listDocumentPage({ limit = 40, cursor = null, query = '', signal } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || typeof query !== 'string' || query.length > 120 ||
          cursor && (typeof cursor.savedAt !== 'string' || typeof cursor.id !== 'string')) throw new TypeError('Invalid project page request');
      await migrateLegacy(signal);
      const db = await open();
      signal?.throwIfAborted();
      if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry the project list.');
      const needle = query.trim().toLocaleLowerCase();
      return new Promise((resolve, reject) => {
        let transaction;
        const abort = () => { try { transaction?.abort(); } catch { /* The transaction already settled. */ } };
        try {
          transaction = db.transaction('projectMetadata', 'readonly');
          const index = transaction.objectStore('projectMetadata').index('byUpdated');
          const range = cursor ? keyRange?.upperBound([cursor.savedAt, cursor.id], true) : null;
          if (cursor && !range) throw new Error('Project paging key ranges are unavailable');
          const request = index.openCursor(range, 'prev'), items = [];
          signal?.addEventListener('abort', abort, { once: true });
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
          transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve({ items, nextCursor, storageState: state }); };
          transaction.onabort = () => { signal?.removeEventListener('abort', abort); reject(storageFailure(transaction.error || request.error)); };
        } catch (error) { abort(); signal?.removeEventListener('abort', abort); reject(storageFailure(error)); }
      });
    },
    async saveRecovery(source, { signal, documentRevision = null, tick = null, laneCount = source?.world?.laneCount, snapshotMetadata = null, incremental = false } = {}) {
      if (incremental) {
        const token = {}, bytes = 8 * 1048576 + Math.max(1, Math.min(1024, laneCount || 1024)) * 131072;
        budgetAdapter?.reserve({ token, owner: 'incremental-recovery-snapshot', category: 'checkpoint', bytes, pinned: true, reloadable: false });
        let durableReceipt = null, operationError = null;
        try {
          signal?.throwIfAborted(); if (retired) throw new Error('Project storage closed.');
          const session = typeof source === 'function' ? await source() : source;
          if (snapshotMetadata) { const metadata = snapshotMetadata(); documentRevision = metadata.documentRevision; tick = metadata.tick; }
          durableReceipt = await recoveryPages.save(session, { signal, documentRevision, tick }); return durableReceipt;
        } catch (error) { operationError = error; throw error; } finally {
          try { requireSynchronousResourceAcknowledgement(budgetAdapter?.release({ token, owner: 'incremental-recovery-snapshot' }), 'Recovery snapshot storage'); }
          catch (error) { if (durableReceipt) durableReceipt.retirement = resourceRetirementSummary([...(durableReceipt.retirement?.failures || []), error]); else if (operationError) operationError.retirementError = error; else throw error; }
        }
      }
      if (typeof globalThis.structuredClone !== 'function') throw new Error('This browser cannot create an isolated recovery snapshot. Export the project to keep a copy.');
      if (typeof source !== 'function') validateProcgenSession(source);
      if (snapshotMetadata != null && typeof snapshotMetadata !== 'function') throw new TypeError('Recovery metadata requires an owned snapshot callback.');
      const computed = await checksumSnapshot(async () => {
        const snapshot = globalThis.structuredClone(typeof source === 'function' ? await source() : source);
        if (snapshotMetadata) { const metadata = snapshotMetadata(); documentRevision = metadata.documentRevision; tick = metadata.tick; }
        if (documentRevision != null && (!Number.isSafeInteger(documentRevision) || documentRevision < 0) || tick != null && (!Number.isSafeInteger(tick) || tick < 0))
          throw new TypeError('Invalid recovery snapshot revision or tick.');
        return snapshot;
      }, { signal, laneCount });
      const { checksum, snapshot: session } = computed;
      signal = computed.signal; let durableReceipt = null, operationError = null;
      try {
        if (signal?.aborted) throw namedError('AbortError', 'Recovery write canceled');
        const db = await open();
        if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry recovery.');
        return await withBrowserGenerationRetentionLock(() => new Promise((resolve, reject) => {
          signal?.throwIfAborted(); if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry recovery.');
          let transaction, receipt;
          try {
            transaction = db.transaction(['sessions', GENERATION_PIN_STORE], 'readwrite');
            const abort = () => { try { transaction.abort(); } catch { /* A completed transaction needs no cancellation. */ } };
            signal?.addEventListener('abort', abort, { once: true });
            const store = transaction.objectStore('sessions'), request = store.get('recovery:head');
            request.onsuccess = () => {
              if (signal?.aborted) { transaction.abort(); return; }
              const generation = (request.result?.generation || 0) + 1, slot = generation % 2;
              receipt = { generation, checksum, documentRevision, tick };
              transaction.objectStore(GENERATION_PIN_STORE).put(recoveryGenerationPin(session, slot, generation));
              store.put({ id: `recovery:slot:${slot}`, kind: 'recovery-generation', ...receipt,
                name: session.name, savedAt: session.savedAt, session });
              store.put({ id: 'recovery:head', kind: 'recovery-head', generation, slot, checksum });
            };
            transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); durableReceipt = { ...receipt, durable: true, canceledAfterCommit: signal.aborted }; resolve(durableReceipt); };
            transaction.onabort = () => { signal?.removeEventListener('abort', abort);
              reject(storageFailure(transaction.error || request.error || namedError('AbortError', 'Recovery transaction aborted'))); };
          } catch (error) { reject(storageFailure(error)); }
        }), { signal });
      } catch (error) { operationError = error; throw error; } finally { try { computed.release(); if (durableReceipt) durableReceipt.retirement = resourceRetirementSummary([]); } catch (error) { if (durableReceipt) durableReceipt.retirement = resourceRetirementSummary([error]); else if (operationError) operationError.retirementError = error; else throw error; } }
    },
    async loadRecovery({ requireVerified = false, signal, owned = false } = {}) {
      await migrateLegacy();
      const head = await operation('readonly', store => store.get('recovery:head'));
      const slots = head && Number.isSafeInteger(head.generation) && head.generation >= 0 ? [head.generation % 2, 1 - head.generation % 2] : [];
      for (const slot of slots) {
        let record, computed;
        try {
          record = await operation('readonly', store => store.get(`recovery:slot:${slot}`));
          if (record?.paged && record.generation <= head.generation && (record.generation !== head.generation || record.checksum === head.checksum)) return await recoveryPages.load(record, { signal, owned });
          computed = await checksumSnapshot(async () => {
            record = await operation('readonly', store => store.get(`recovery:slot:${slot}`));
            if (!record || record.kind !== 'recovery-generation' || !Number.isSafeInteger(record.generation) || record.generation > head.generation ||
                record.generation === head.generation && record.checksum !== head.checksum) throw namedError('RecoveryCandidateError', 'Recovery candidate was not committed.');
            try { validateProcgenSession(record.session); } catch { throw namedError('RecoveryCandidateError', 'Recovery candidate has an unsupported session header.'); }
            return record.session;
          }, { signal });
          if (computed.checksum === record.checksum) {
            if (owned) {
              const result = ownedSource(computed, { kind: 'recovery', generation: record.generation, checksum: record.checksum, verification: 'checksum-verified-recovery' });
              record = null; computed = null; return result;
            }
            return validateProcgenSession(record.session);
          }
        } catch (error) {
          if (retired || signal?.aborted || error.name !== 'RecoveryCandidateError' && !(error.name === 'BackgroundJobError' && error.code === 'invalid-data')) throw error;
        } finally { computed?.release(); }
      }
      if (requireVerified || owned) {
        const legacyCount = await operation('readonly', store => store.count('recovery:latest'));
        if (legacyCount) throw new Error('Legacy recovery has no checksum; open it explicitly as a legacy project.');
        return null;
      }
      const legacy = await operation('readonly', store => store.get('recovery:latest'));
      return legacy ? validateProcgenSession(legacy.session) : null;
    },
    loadRecoveryOwned(options = {}) { return this.loadRecovery({ ...options, requireVerified: true, owned: true }); },
    async removeRecovery() { if (recoveryPages.stats().writing) throw new Error('Wait for recovery publication before removing it.'); await operation('readwrite', store => {
      const first = store.get('recovery:slot:0'), second = store.get('recovery:slot:1');
      second.onsuccess = () => {
        for (const key of new Set([...(first.result?.references || []), ...(second.result?.references || [])])) if (typeof key === 'string' && key.startsWith('recovery:chunk:')) store.delete(key);
        for (const id of ['recovery:latest', 'recovery:head', 'recovery:slot:0', 'recovery:slot:1']) store.delete(id);
      }; return second;
    }); recoveryPages.invalidateCache(); },
    async estimateUsage() {
      const estimate = await globalThis.navigator?.storage?.estimate?.();
      return estimate ? { usage: estimate.usage ?? null, quota: estimate.quota ?? null } : null;
    },
    async save(id, session) {
      validateProcgenSession(session);
      await operation('readwrite', (store, transaction) => {
        const metadata = transaction.objectStore('projectMetadata'), marker = metadata.get('migration:v1');
        marker.onsuccess = () => {
          const revision = (marker.result?.revision || 0) + 1;
          if (!Number.isSafeInteger(revision)) { transaction.abort(); return; }
          store.put({ id, name: session.name, savedAt: session.savedAt, session });
          metadata.put({ id: 'migration:v1', kind: 'migration', revision, pending: true });
        };
        return marker;
      }, ['sessions', 'projectMetadata']);
      return id;
    },
    async load(id) { const record = await operation('readonly', store => store.get(id)); if (!record) throw new Error('Project not found.'); return validateProcgenSession(record.session); },
    async list() { return (await operation('readonly', store => store.getAll())).filter(value => value.session && typeof value.savedAt === 'string').map(({ id, name, savedAt }) => ({ id, name, savedAt })).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); },
    async remove(id) { await operation('readwrite', (store, transaction) => { transaction.objectStore('projectMetadata').delete(id); return store.delete(id); }, ['sessions', 'projectMetadata']); },
    close() {
      if (retired) return;
      retired = true; generation++; recoveryPages.dispose(); preferencePages.dispose();
      lifetime.abort(namedError('AbortError', 'Project storage closed'));
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
