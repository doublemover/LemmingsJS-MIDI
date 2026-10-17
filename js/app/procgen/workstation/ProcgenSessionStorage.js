const SESSION_VERSION = 1;
const validateProcgenSession = value => {
  if (!value || value.format !== 'lemmings-procgen-session' || value.version !== SESSION_VERSION || !value.project || !value.world || !value.settings) throw new Error('This is not a supported ProcGen project.');
  if (!Number.isInteger(value.world.laneCount) || value.world.laneCount < 1 || value.world.laneCount > 1024 || !Number.isFinite(value.world.seed)) throw new Error('Invalid world settings.');
  return value;
};
const createProcgenSession = ({ name = 'Untitled session', project, settings, world, transport, patterns, camera, ui }) => ({
  format: 'lemmings-procgen-session', version: SESSION_VERSION, name: String(name).slice(0, 120), savedAt: new Date().toISOString(),
  project, settings: { ...settings }, world, transport, patterns, camera, ui
});
const createProcgenSessionStorage = (indexedDB = globalThis.indexedDB) => {
  let database;
  const open = () => database ||= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('Browser project storage is unavailable. Export a project file to save.')); return; }
    const request = indexedDB.open('lemmings.procgen.sessions', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const operation = async (mode, perform) => {
    const db = await open(); return new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', mode), request = perform(transaction.objectStore('sessions'));
      transaction.oncomplete = () => resolve(request.result); transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error || new Error('Project storage failed.'));
    });
  };
  return {
    async save(id, session) { validateProcgenSession(session); await operation('readwrite', store => store.put({ id, name: session.name, savedAt: session.savedAt, session })); return id; },
    async load(id) { const record = await operation('readonly', store => store.get(id)); if (!record) throw new Error('Project not found.'); return validateProcgenSession(record.session); },
    async list() { return (await operation('readonly', store => store.getAll())).map(({ id, name, savedAt }) => ({ id, name, savedAt })).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); },
    async remove(id) { await operation('readwrite', store => store.delete(id)); },
    async close() { (await database)?.close(); database = null; }
  };
};
const freshProcgenSeed = (crypto = globalThis.crypto, previous = null) => {
  const value = new Uint32Array(1); crypto?.getRandomValues?.(value);
  let seed = value[0] || ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  if (seed === previous) seed = (seed + 0x9e3779b9) >>> 0;
  return seed;
};
export { createProcgenSession, validateProcgenSession, createProcgenSessionStorage, freshProcgenSeed };
