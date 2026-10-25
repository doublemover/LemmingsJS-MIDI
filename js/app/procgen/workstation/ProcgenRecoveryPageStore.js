import { GENERATION_PIN_STORE, recoveryGenerationPin, withBrowserGenerationRetentionLock } from '../../../runtime/BrowserGenerationPins.js';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult, resourceRetirementSummary } from '../../resources/ResourceRetirement.js';
import { validateProcgenRecoveryJournalCooperative } from './ProcgenRecoveryJournal.js';
const chunkPrefix = 'recovery:chunk:';
const reference = (key, page) => Object.freeze({ key, sha256: page.sha256, rawBytes: page.rawBytes, storedBytes: page.bytes.byteLength, encoding: page.encoding });
const validReference = ref => ref && typeof ref.key === 'string' && ref.key.startsWith(chunkPrefix) && ref.key.length < 256 && /^[a-f0-9]{64}$/.test(ref.sha256 || '') && Number.isSafeInteger(ref.rawBytes) && ref.rawBytes > 0 && ref.rawBytes <= 64 * 1048576;

// Immutable base/pages are encoded once. The two manifest generations and every
// newly referenced chunk commit in one transaction; failed writes publish no head.
export function createProcgenRecoveryPageStore({ open, jobs, resourceBudget, isCurrent, validateSession }) {
  let cache = new WeakMap(); const entriesByKey = new Map(), controllers = new Set(); let serial = 0, retired = false, writing = false;
  const linked = source => {
    const controller = new AbortController(), abort = () => controller.abort(source.reason);
    source?.addEventListener('abort', abort, { once: true }); if (source?.aborted) abort(); controllers.add(controller);
    return { signal: controller.signal, release() { source?.removeEventListener('abort', abort); controllers.delete(controller); } };
  };
  const stats = { retirementFailures: 0, encodedPages: 0, reusedPages: 0, encodeMs: 0, decodeMs: 0, commitMs: 0 };
  const compute = async (kind, input, signal, epoch, maxBytes = 64 * 1048576, peak = maxBytes * (kind === 'decode-recovery-page' ? 32 : 8) + 1048576) => { const started = performance.now(); const result = await jobs.compute({ kind, ownerId: 'recovery-pages', ownerEpoch: epoch,
    sourceRevision: `recovery-page:${++serial}`, estimatedPeakBytes: Math.min(384 * 1048576, peak),
    priority: 'recovery', budgetAdapter: resourceBudget, signal, maxBytes, prepareInput: () => input, isCurrent: () => !retired && isCurrent() }); stats[kind === 'decode-recovery-page' ? 'decodeMs' : 'encodeMs'] += performance.now() - started; return result; };
  const check = signal => { signal?.throwIfAborted(); if (retired || !isCurrent()) throw new Error('Recovery page owner retired.'); };
  return {
    async save(session, { signal, documentRevision, tick } = {}) {
      check(signal); validateSession(session); if (writing) throw new Error('An incremental recovery write is already pending.');
      if (!Number.isSafeInteger(documentRevision) || documentRevision < 0 || !Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid incremental recovery revision.');
      const retained = [], writes = [], published = [], removedKeys = [], nonce = crypto.randomUUID(), lifetime = linked(signal); signal = lifetime.signal; writing = true; let durableReceipt = null, operationError = null;
      const encode = async (value, kind, maxBytes, peak) => {
        const prior = cache.get(value); if (prior?.stored) { stats.reusedPages++; return prior.ref; }
        const result = await compute('encode-recovery-page', value, signal, documentRevision, maxBytes, peak); stats.encodedPages++; retained.push(result); check(signal);
        const page = result.value, key = chunkPrefix + nonce + ':' + writes.length, ref = reference(key, page), entry = { ref, stored: false };
        cache.set(value, entry); entriesByKey.set(key, entry); published.push(entry); writes.push({ id: key, kind: 'recovery-chunk', content: kind, ...page }); return ref;
      };
      try {
        const base = await encode(session.world, 'checkpoint', Math.min(64 * 1048576, Math.max(1048576, (session.world.graph?.estimatedBytes || 8 * 1048576) * 2)), (session.world.graph?.estimatedBytes || 8 * 1048576) * 4 + 1048576), pages = [];
        for (const page of session.recoveryJournal.pages) pages.push(await encode(page, 'journal', 1048576));
        const { world: _world, recoveryJournal: journal, ...header } = session;
        const { pages: _pages, ...journalHeader } = journal;
        const manifest = { schema: 'procgen-paged-recovery/v1', session: header, base, journal: { ...journalHeader, pages } };
        const root = await encode(manifest, 'manifest', Math.min(64 * 1048576, 2 * 1048576 + session.world.laneCount * 32768 + pages.length * 512)), references = [root.key, base.key, ...pages.map(page => page.key)];
        check(signal); const db = await open(); check(signal);
        const commitStarted = performance.now();
        const receipt = await withBrowserGenerationRetentionLock(() => new Promise((resolve, reject) => {
          check(signal);
          const transaction = db.transaction(['sessions', GENERATION_PIN_STORE], 'readwrite'), store = transaction.objectStore('sessions'); let result, failed;
          const abort = () => { try { transaction.abort(); } catch { /* Completion already owns the transaction. */ } };
          signal?.addEventListener('abort', abort, { once: true });
          const head = store.get('recovery:head');
          head.onsuccess = () => {
            try {
              check(signal); const generation = (head.result?.generation || 0) + 1;
              if (!Number.isSafeInteger(generation)) throw new Error('Recovery generation exhausted.');
              const slot = generation % 2, old = store.get(`recovery:slot:${slot}`), other = store.get(`recovery:slot:${1 - slot}`);
              other.onsuccess = () => {
                try {
                  check(signal); const keep = new Set([...references, ...(other.result?.references || [])]);
                  for (const key of old.result?.references || []) if (!keep.has(key)) { store.delete(key); removedKeys.push(key); }
                  for (const chunk of writes) store.put(chunk);
                  result = { generation, checksum: root.sha256, documentRevision, tick, journalSequence: journal.sequence };
                  transaction.objectStore(GENERATION_PIN_STORE).put(recoveryGenerationPin(session, slot, generation));
                  store.put({ id: `recovery:slot:${slot}`, kind: 'recovery-generation', ...result, paged: root, references, storedBytes: root.storedBytes + base.storedBytes + pages.reduce((sum, ref) => sum + ref.storedBytes, 0), name: session.name, savedAt: session.savedAt });
                  store.put({ id: 'recovery:head', kind: 'recovery-head', generation, slot, checksum: root.sha256 });
                } catch (error) { failed = error; transaction.abort(); }
              };
            } catch (error) { failed = error; transaction.abort(); }
          };
          transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); for (const entry of published) entry.stored = true; for (const key of removedKeys) { const entry = entriesByKey.get(key); if (entry) entry.stored = false; entriesByKey.delete(key); } resolve(result); };
          transaction.onabort = () => { signal?.removeEventListener('abort', abort); reject(failed || transaction.error || new Error('Paged recovery transaction aborted.')); };
        }), { signal });
        stats.commitMs += performance.now() - commitStarted; durableReceipt = { ...receipt, durable: true, canceledAfterCommit: signal.aborted }; return durableReceipt;
      } catch (error) { operationError = error; throw error; } finally { writing = false; for (const entry of published) if (!entry.stored) entriesByKey.delete(entry.ref.key); writes.length = 0; const errors = [];
        for (const result of retained) try { retireBackgroundResult(result); } catch (error) { errors.push(error); } lifetime.release(); stats.retirementFailures += errors.length;
        const retirement = resourceRetirementSummary(errors); if (durableReceipt) durableReceipt.retirement = retirement; else if (operationError && errors.length) operationError.resourceRetirement = retirement;
      }
    },
    async load(record, { signal, owned = false } = {}) {
      check(signal); const retained = [], inputToken = {}; let encoded = null;
      if (!Number.isSafeInteger(record.storedBytes) || record.storedBytes < 1 || record.storedBytes > 128 * 1048576 || !Array.isArray(record.references) || record.references.length > 8194 || record.references.some(key => typeof key !== 'string' || !key.startsWith(chunkPrefix))) throw Object.assign(new Error('Invalid recovery read footprint.'), { name: 'RecoveryCandidateError' });
      resourceBudget?.reserve({ token: inputToken, owner: 'recovery-page-read', category: 'checkpoint', bytes: record.storedBytes * 2 + record.references.length * 256, pinned: true, reloadable: false });
      const lifetime = linked(signal); signal = lifetime.signal;
      const decode = async ref => {
        if (!validReference(ref)) throw Object.assign(new Error('Invalid recovery chunk reference.'), { name: 'RecoveryCandidateError' });
        const page = encoded.get(ref.key); check(signal);
        if (!page || page.kind !== 'recovery-chunk' || page.sha256 !== ref.sha256 || page.rawBytes !== ref.rawBytes || page.encoding !== ref.encoding) throw Object.assign(new Error('Recovery chunk is missing or differs.'), { name: 'RecoveryCandidateError' });
        const result = await compute('decode-recovery-page', page, signal, record.generation, Math.min(64 * 1048576, Math.max(8192, ref.rawBytes + 4096))); retained.push(result); return result.value;
      };
      let released = false, releaseError = null;
      const release = () => { if (releaseError) throw releaseError; if (released) return; released = true; encoded = null; const errors = [];
        for (const result of retained.splice(0)) try { retireBackgroundResult(result); } catch (error) { errors.push(error); }
        try { requireSynchronousResourceAcknowledgement(resourceBudget?.release({ token: inputToken, owner: 'recovery-page-read' }), 'Recovery encoded source'); } catch (error) { errors.push(error); } lifetime.release();
        if (errors.length) { stats.retirementFailures += errors.length; releaseError = new AggregateError(errors, 'Recovery source retirement is unresolved.'); throw releaseError; }
      };
      try {
        const db = await open(); check(signal); encoded = await new Promise((resolve, reject) => {
          const transaction = db.transaction('sessions', 'readonly'), store = transaction.objectStore('sessions'), values = new Map(); let bytes = 0;
          for (const key of record.references) { const request = store.get(key); request.onsuccess = () => {
            if (request.result) { bytes += request.result.bytes?.byteLength || 0; values.set(key, request.result); }
            if (bytes > record.storedBytes) transaction.abort();
          }; }
          transaction.oncomplete = () => resolve(values); transaction.onabort = () => reject(Object.assign(new Error('Recovery chunk read was incomplete.'), { name: 'RecoveryCandidateError' }));
        });
        const manifest = await decode(record.paged);
        if (manifest.schema !== 'procgen-paged-recovery/v1' || !Array.isArray(manifest.journal?.pages) || manifest.journal.pages.length > 8192 || record.checksum !== record.paged.sha256) throw Object.assign(new Error('Invalid recovery manifest.'), { name: 'RecoveryCandidateError' });
        const world = await decode(manifest.base), pages = [];
        for (const ref of manifest.journal.pages) pages.push(await decode(ref));
        let session = { ...manifest.session, world, recoveryJournal: { ...manifest.journal, pages } }; await validateProcgenRecoveryJournalCooperative(session.recoveryJournal, { signal }); validateSession(session); check(signal);
        if (!owned) {
          if (manifest.base.rawBytes + record.paged.rawBytes + manifest.journal.pages.reduce((sum, ref) => sum + ref.rawBytes, 0) > 128 * 1024) throw new Error('Large recovery reads require an explicit owned source lease.');
          const value = structuredClone(session); release(); session = null; return value; }
        return Object.freeze({ schema: 'procgen-owned-source/v1', kind: 'recovery', generation: record.generation, checksum: record.checksum,
          verification: 'checksum-verified-recovery', signal,
          get session() { check(signal); if (!session) throw new Error('Recovery source released.'); return session; }, release() { session = null; release(); } });
      } catch (error) { try { release(); } catch (retirementError) { error.retirementError = retirementError; } if (!signal?.aborted && !['AbortError', 'BackgroundJobError'].includes(error.name)) error.name = 'RecoveryCandidateError'; throw error; }
    },
    invalidateCache() { cache = new WeakMap(); entriesByKey.clear(); },
    stats: () => ({ ...stats, writing }),
    dispose() { retired = true; for (const controller of controllers) controller.abort(new Error('Recovery storage retired.')); }
  };
}
