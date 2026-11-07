export const RECOVERY_DATABASE_NAME = 'lemmings.procgen.sessions';
export const RECOVERY_DATABASE_VERSION = 6;
export const GENERATION_PIN_STORE = 'generationPins';
export const GENERATION_RETENTION_LOCK = 'lemmings-recovery-generation-retention-v1';
export function withBrowserGenerationRetentionLock(operation, { locks = globalThis.navigator?.locks, signal, required = false, ifAvailable = false } = {}) {
  signal?.throwIfAborted();
  if (!locks?.request) {
    if (required) throw Object.assign(new Error('Generation retention requires cross-context locking.'), { code: 'retention-lock-unavailable' });
    return operation();
  }
  const options = { mode: 'exclusive', ...(ifAvailable ? { ifAvailable: true } : signal ? { signal } : {}) };
  return locks.request(GENERATION_RETENTION_LOCK, options, lock => {
    if (!lock) throw Object.assign(new Error('Recovery publication owns the generation retention lock.'), { code: 'retention-lock-busy' });
    signal?.throwIfAborted(); return operation();
  });
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validScope = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('/') ? url.href : null; } catch { return null; } };
export function recoveryGenerationPin(session, slot, generation) {
  if (![0, 1].includes(slot) || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid recovery generation pin.');
  const identity = session.executionIdentity;
  const source = identity?.activeExecution === 'bound' && hash(identity.buildId) && validScope(identity.deploymentRoot)
    ? { status: 'bound', buildId: identity.buildId, scopeUrl: validScope(identity.deploymentRoot) }
    : identity?.activeExecution === 'unbound' ? { status: 'unbound', reason: String(identity.reason || 'unbound-source').slice(0, 120) }
      : { status: 'unknown', reason: 'legacy-or-incomplete-execution-provenance' };
  return Object.freeze({ id: `recovery:slot:${slot}`, schema: 'browser-generation-pin/v1', generation, source: Object.freeze(source) });
}
export function upgradeBrowserGenerationPins(db, transaction, oldVersion) {
  if (db.objectStoreNames.contains(GENERATION_PIN_STORE)) return;
  const store = db.createObjectStore(GENERATION_PIN_STORE, { keyPath: 'id' });
  if (oldVersion > 0) for (const slot of [0, 1]) {
    const request = transaction.objectStore('sessions').count(`recovery:slot:${slot}`);
    request.onsuccess = () => { if (request.result) store.put({ id: `recovery:slot:${slot}`, schema: 'browser-generation-pin/v1', generation: 0,
      source: { status: 'unknown', reason: 'pre-pin-recovery-generation' } }); };
  }
}
export async function readDurableBrowserGenerationPins({ indexedDB = globalThis.indexedDB, scopeUrl, timeoutMs = 1500 } = {}) {
  const scope = validScope(scopeUrl);
  if (!scope || !indexedDB?.open || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return { status: 'unknown', reason: 'pin-storage-unavailable', buildIds: [] };
  return new Promise(resolve => {
    let db = null, done = false, missing = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); try { db?.close(); } catch { /* Closing cannot change the observed read outcome. */ } resolve(Object.freeze(value)); };
    const unknown = reason => finish({ status: 'unknown', reason, buildIds: [] });
    const timer = setTimeout(() => unknown('pin-storage-timeout'), timeoutMs);
    let request;
    try {
      request = indexedDB.open(RECOVERY_DATABASE_NAME);
      request.onupgradeneeded = event => { db = request.result; missing = event.oldVersion === 0; request.transaction.abort(); };
      request.onerror = () => missing ? finish({ status: 'complete', buildIds: [], reason: 'no-project-storage' }) : unknown('pin-storage-open-failed');
      request.onblocked = () => unknown('pin-storage-blocked');
      request.onsuccess = () => {
        db = request.result; if (done) { try { db.close(); } catch { /* Late connection retired. */ } return; }
        if (!db.objectStoreNames.contains(GENERATION_PIN_STORE)) { unknown('legacy-recovery-pin-schema'); return; }
        try {
          const transaction = db.transaction(GENERATION_PIN_STORE, 'readonly'), store = transaction.objectStore(GENERATION_PIN_STORE), buildIds = new Set(); let uncertain = false;
          for (const slot of [0, 1]) {
            const read = store.get(`recovery:slot:${slot}`);
            read.onsuccess = () => {
              const pin = read.result; if (!pin) return;
              if (pin.schema !== 'browser-generation-pin/v1' || pin.id !== `recovery:slot:${slot}` || !Number.isSafeInteger(pin.generation) || pin.generation < 1 || !['bound', 'unbound'].includes(pin.source?.status)) { uncertain = true; return; }
              if (pin.source.status === 'bound') { if (!hash(pin.source.buildId) || !validScope(pin.source.scopeUrl)) uncertain = true; else if (pin.source.scopeUrl === scope) buildIds.add(pin.source.buildId); }
            };
            read.onerror = () => { uncertain = true; };
          }
          transaction.oncomplete = () => uncertain ? unknown('recovery-provenance-unresolved') : finish({ status: 'complete', buildIds: [...buildIds].sort(), reason: 'two-durable-recovery-slots' });
          transaction.onabort = () => unknown('pin-storage-read-failed');
        } catch { unknown('pin-storage-read-failed'); }
      };
    } catch { unknown('pin-storage-open-failed'); }
  });
}
