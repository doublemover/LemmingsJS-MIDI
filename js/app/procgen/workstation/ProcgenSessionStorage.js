const SESSION_VERSION = 1;
const namedError = (name, message) => Object.assign(new Error(message), { name });
const validateProcgenSession = value => {
  if (!value || value.format !== 'lemmings-procgen-session' || value.version !== SESSION_VERSION || !value.project || !value.world || !value.settings) throw new Error('This is not a supported ProcGen project.');
  if (!Number.isInteger(value.world.laneCount) || value.world.laneCount < 1 || value.world.laneCount > 1024 || !Number.isFinite(value.world.seed)) throw new Error('Invalid world settings.');
  return value;
};
const createProcgenSession = ({ name = 'Untitled session', project, settings, world, transport, patterns, physicalTimeline = null, camera, ui }) => ({
  format: 'lemmings-procgen-session', version: SESSION_VERSION, name: String(name).slice(0, 120), savedAt: new Date().toISOString(),
  project, settings: { ...settings }, world, transport, patterns, physicalTimeline, camera, ui
});
const storageFailure = (error, fallback = 'Project storage failed.') => {
  const name = error?.name || '';
  const category = name === 'QuotaExceededError' ? 'quota' : name === 'VersionError' || name === 'NotFoundError' ? 'schema' :
    name === 'AbortError' ? 'transaction-abort' : name === 'SecurityError' || name === 'InvalidStateError' ? 'unavailable' : 'transient';
  const messages = { quota: 'Project storage is full. Export this project or remove an old recovery.',
    schema: 'Project storage has an incompatible schema. Reload the application before retrying.',
    'transaction-abort': 'Project storage canceled the write. Retry the save; the previous project remains available.',
    unavailable: 'Browser project storage is unavailable. Export a project file to save.', transient: fallback };
  const failure = new Error(messages[category], { cause: error }); failure.name = 'ProcgenStorageError'; failure.category = category;
  return failure;
};
const createProcgenSessionStorage = (indexedDB = globalThis.indexedDB, { openTimeoutMs = 5000, onState = () => {} } = {}) => {
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
      request = indexedDB.open('lemmings.procgen.sessions', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' }); };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => report('blocked', storageFailure(null, 'Another tab is using project storage. Close or reload that tab, then retry.'));
      timer = setTimeout(() => finish(new Error('IndexedDB open timed out')), openTimeoutMs);
    } catch (error) { finish(error); }
    return promise;
  };
  const operation = async (mode, perform) => {
    const db = await open();
    if (retired || db !== database) throw storageFailure(null, 'Project storage connection changed. Retry the operation.');
    return new Promise((resolve, reject) => {
      let transaction, request, settled = false;
      const fail = error => { if (!settled) { settled = true; reject(storageFailure(error)); } };
      try {
        transaction = db.transaction('sessions', mode);
        request = perform(transaction.objectStore('sessions'));
        transaction.oncomplete = () => { if (!settled) { settled = true; resolve(request?.result); } };
        transaction.onabort = () => fail(transaction.error || request?.error || namedError('AbortError', 'Transaction aborted'));
      } catch (error) { fail(error); }
    });
  };
  return {
    getState: () => ({ state, error: lastError, generation, retired }),
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
export { createProcgenSession, validateProcgenSession, createProcgenSessionStorage, freshProcgenSeed };
