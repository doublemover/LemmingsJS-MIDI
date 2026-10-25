import { MAX_RECOVERY_REFERENCES, recoveryPartCount, recoveryReferenceKeys, storedRecoveryChunks, readRecoveryChunk } from './ProcgenRecoveryChunks.js';
import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';
import { encodeRecoveryProject, decodeRecoveryProject } from './ProcgenRecoveryProjectPages.js';
import { GENERATION_PIN_STORE, recoveryGenerationPin, withBrowserGenerationRetentionLock } from '../../../runtime/BrowserGenerationPins.js';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult, resourceRetirementSummary } from '../../resources/ResourceRetirement.js';
import { validateProcgenRecoveryJournalCooperative } from './ProcgenRecoveryJournal.js';
const chunkPrefix = 'recovery:chunk:';
const validKeys = keys => Array.isArray(keys) && keys.length <= MAX_RECOVERY_REFERENCES && keys.every(key => typeof key === 'string' && key.startsWith(chunkPrefix) && key.length < 256) && new Set(keys).size === keys.length;
const reference = (key, page) => Object.freeze({ key, sha256: page.sha256, rawBytes: page.rawBytes, storedBytes: page.bytes.byteLength, encoding: page.encoding, ...(recoveryPartCount(page.bytes.byteLength) ? { partCount: recoveryPartCount(page.bytes.byteLength) } : {}) });
const validReference = ref => ref && typeof ref.key === 'string' && ref.key.startsWith(chunkPrefix) && ref.key.length < 256 && /^[a-f0-9]{64}$/.test(ref.sha256 || '') && Number.isSafeInteger(ref.rawBytes) && ref.rawBytes > 0 && ref.rawBytes <= 64 * 1048576 && Number.isSafeInteger(ref.storedBytes) && ref.storedBytes > 0 && ref.storedBytes <= 64 * 1048576 && ['json-utf8-v1', 'gzip-json-v1'].includes(ref.encoding) && (ref.partCount === undefined || Number.isSafeInteger(ref.partCount) && ref.partCount > 1 && ref.partCount <= 1024 && ref.partCount === recoveryPartCount(ref.storedBytes));

// Immutable base/pages are encoded once. The two manifest generations and every
// newly referenced chunk commit in one transaction; failed writes publish no head.
export function createProcgenRecoveryPageStore({ open, jobs, resourceBudget, isCurrent, validateSession }) {
  let cache = new WeakMap(); const entriesByKey = new Map(), controllers = new Set(); let serial = 0, retired = false, writing = false;
  const linked = source => {
    const controller = new AbortController(), abort = () => controller.abort(source.reason);
    source?.addEventListener('abort', abort, { once: true }); if (source?.aborted) abort(); controllers.add(controller);
    return { signal: controller.signal, release() { source?.removeEventListener('abort', abort); controllers.delete(controller); } };
  };
  const stats = { resultCopyMs: 0, resultCopyMaximumSliceMs: 0, resultCopyPackets: 0, inputCopyMs: 0, inputCopyMaximumSliceMs: 0, inputCopyPackets: 0, workerQueueWaitMs: 0, workerJobs: 0, retirementFailures: 0, encodedPages: 0, reusedPages: 0, encodeMs: 0, decodeMs: 0, commitMs: 0, transactionMaximumSliceMs: 0, maximumStoredPayloadBytes: 0, maximumReadPayloadBytes: 0 };
  const compute = async (kind, input, signal, epoch, maxBytes = 64 * 1048576, peak = maxBytes * (kind === 'decode-recovery-page' ? 32 : 8) + 1048576) => { const started = performance.now(); const result = await jobs.compute({ kind, ownerId: 'recovery-pages', ownerEpoch: epoch,
    sourceRevision: `recovery-page:${++serial}`, estimatedPeakBytes: Math.min(384 * 1048576, peak),
    priority: 'recovery', budgetAdapter: resourceBudget, signal, maxBytes, prepareInput: () => input, isCurrent: () => !retired && isCurrent() }); stats.resultCopyMs += result.receipt?.outputTransport?.elapsedMs || 0; stats.resultCopyMaximumSliceMs = Math.max(stats.resultCopyMaximumSliceMs, result.receipt?.outputTransport?.maximumSliceMs || 0); stats.resultCopyPackets += result.receipt?.outputTransport?.packets || 0; stats.inputCopyMs += result.receipt?.inputTransport?.elapsedMs || 0; stats.inputCopyMaximumSliceMs = Math.max(stats.inputCopyMaximumSliceMs, result.receipt?.inputTransport?.maximumSliceMs || 0); stats.inputCopyPackets += result.receipt?.inputTransport?.packets || 0; stats.workerQueueWaitMs += result.receipt?.queueWaitMs || 0; stats.workerJobs++; stats[kind === 'decode-recovery-page' ? 'decodeMs' : 'encodeMs'] += performance.now() - started; return result; };
  const check = signal => { signal?.throwIfAborted(); if (retired || !isCurrent()) throw new Error('Recovery page owner retired.'); };
  return {
    async save(session, { signal, documentRevision, tick } = {}) {
      check(signal); validateSession(session); if (writing) throw new Error('An incremental recovery write is already pending.');
      if (!Number.isSafeInteger(documentRevision) || documentRevision < 0 || !Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid incremental recovery revision.');
      const retained = [], writes = [], published = [], removedKeys = [], referenced = new Map(), transactionToken = {}, nonce = crypto.randomUUID(), lifetime = linked(signal); signal = lifetime.signal; writing = true; let durableReceipt = null, operationError = null, transactionReserved = false, pageSliceStarted = performance.now();
      const encode = async (value, kind, maxBytes, peak, reusable = true) => {
        check(signal); if (performance.now() - pageSliceStarted >= 3) { await yieldBackgroundTask({ signal }); pageSliceStarted = performance.now(); }
        const prior = reusable && cache.get(value); if (prior?.stored) { stats.reusedPages++; referenced.set(prior.ref.key, prior.ref); return prior.ref; }
        const result = await compute('encode-recovery-page', value, signal, documentRevision, maxBytes, peak); stats.encodedPages++; retained.push(result); pageSliceStarted = performance.now(); check(signal);
        const page = result.value, key = chunkPrefix + nonce + ':' + writes.length, ref = reference(key, page), entry = { ref, stored: false };
        if (reusable && value && typeof value === 'object') cache.set(value, entry); entriesByKey.set(key, entry); published.push(entry); referenced.set(key, ref); writes.push({ id: key, kind: 'recovery-chunk', content: kind, ...page }); return ref;
      };
      try {
        const base = await encode(session.world, 'checkpoint', Math.min(64 * 1048576, Math.max(1048576, (session.world.graph?.estimatedBytes || 8 * 1048576) * 2)), (session.world.graph?.estimatedBytes || 8 * 1048576) * 4 + 1048576), pages = [];
        for (const page of session.recoveryJournal.pages) pages.push(await encode(page, 'journal', 1048576));
        const { world: _world, recoveryJournal: journal, project, patterns, physicalState, ...header } = session;
        const { pages: _pages, ...journalHeader } = journal;
        const projectPages = await encodeRecoveryProject(project, encode);
        const patternsPage = patterns == null ? null : await encode(patterns, 'patterns', 16 * 1048576, 129 * 1048576, false);
        const physicalPage = physicalState == null ? null : await encode(physicalState, 'physical-state', 16 * 1048576, 129 * 1048576, false);
        const manifest = { schema: 'procgen-paged-recovery/v2', session: header, project: projectPages, patterns: patternsPage, physicalState: physicalPage, base, journal: { ...journalHeader, pages } };
        const root = await encode(manifest, 'manifest', 8 * 1048576, 65 * 1048576, false);
        let referenceCount = 0, storedBytes = 0;
        for (const ref of referenced.values()) { referenceCount += 1 + (ref.partCount || 0); storedBytes += ref.storedBytes; }
        if (referenceCount > MAX_RECOVERY_REFERENCES || storedBytes > 128 * 1048576) throw new Error('Recovery generation exceeds its durable page bound.');
        resourceBudget?.reserve({ token: transactionToken, owner: 'recovery-transaction', category: 'checkpoint', bytes: 131072 + MAX_RECOVERY_REFERENCES * 512, pinned: true, reloadable: false }); transactionReserved = true;
        const references = []; for (const ref of referenced.values()) references.push(...recoveryReferenceKeys(ref));
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
                  check(signal);
                  if (!validKeys(old.result?.references || []) || !validKeys(other.result?.references || [])) throw new Error('Invalid prior recovery reachability.');
                  const keep = new Set([...references, ...(other.result?.references || [])]);
                  for (const key of old.result?.references || []) if (!keep.has(key)) removedKeys.push(key);
                  result = { generation, checksum: root.sha256, documentRevision, tick, journalSequence: journal.sequence };
                  const operations = function* () {
                    for (const key of removedKeys) yield () => store.delete(key);
                    for (const chunk of writes) for (const record of storedRecoveryChunks(chunk)) yield () => { stats.maximumStoredPayloadBytes = Math.max(stats.maximumStoredPayloadBytes, record.bytes?.byteLength || 0); return store.put(record); };
                    yield () => transaction.objectStore(GENERATION_PIN_STORE).put(recoveryGenerationPin(session, slot, generation));
                    yield () => store.put({ id: `recovery:slot:${slot}`, kind: 'recovery-generation', ...result, paged: root, references, storedBytes, name: session.name, savedAt: session.savedAt });
                    yield () => store.put({ id: 'recovery:head', kind: 'recovery-head', generation, slot, checksum: root.sha256 });
                  }();
                  const next = () => {
                    const started = performance.now();
                    try { check(signal); const operation = operations.next(); if (!operation.done) operation.value().onsuccess = next; }
                    catch (error) { failed = error; transaction.abort(); }
                    finally { stats.transactionMaximumSliceMs = Math.max(stats.transactionMaximumSliceMs, performance.now() - started); }
                  }; next();
                } catch (error) { failed = error; transaction.abort(); }
              };
            } catch (error) { failed = error; transaction.abort(); }
          };
          transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); for (const entry of published) entry.stored = true; for (const key of removedKeys) { const entry = entriesByKey.get(key); if (entry) entry.stored = false; entriesByKey.delete(key); } resolve(result); };
          transaction.onabort = () => { signal?.removeEventListener('abort', abort); reject(failed || transaction.error || new Error('Paged recovery transaction aborted.')); };
        }), { signal });
        stats.commitMs += performance.now() - commitStarted; durableReceipt = { ...receipt, durable: true, canceledAfterCommit: signal.aborted }; return durableReceipt;
      } catch (error) { operationError = error; throw error; } finally { writing = false; for (const entry of published) if (!entry.stored) entriesByKey.delete(entry.ref.key); writes.length = 0; const errors = [];
        for (const result of retained) try { retireBackgroundResult(result); } catch (error) { errors.push(error); }
        if (transactionReserved) try { requireSynchronousResourceAcknowledgement(resourceBudget?.release({ token: transactionToken, owner: 'recovery-transaction' }), 'Recovery transaction staging'); } catch (error) { errors.push(error); } lifetime.release(); stats.retirementFailures += errors.length;
        const retirement = resourceRetirementSummary(errors); if (durableReceipt) durableReceipt.retirement = retirement; else if (operationError && errors.length) operationError.resourceRetirement = retirement;
      }
    },
    async load(record, { signal, owned = false } = {}) {
      check(signal); const retained = [], inputToken = {}, decoded = new Map(), used = new Set(); let encoded = null, decodedRawBytes = 0;
      if (!Number.isSafeInteger(record.storedBytes) || record.storedBytes < 1 || record.storedBytes > 128 * 1048576 || !validKeys(record.references)) throw Object.assign(new Error('Invalid recovery read footprint.'), { name: 'RecoveryCandidateError' });
      resourceBudget?.reserve({ token: inputToken, owner: 'recovery-page-read', category: 'checkpoint', bytes: record.storedBytes * 2 + record.references.length * 256, pinned: true, reloadable: false });
      const lifetime = linked(signal); signal = lifetime.signal;
      const decode = async ref => {
        if (!validReference(ref)) throw Object.assign(new Error('Invalid recovery chunk reference.'), { name: 'RecoveryCandidateError' });
        for (const key of recoveryReferenceKeys(ref)) used.add(key);
        const previous = decoded.get(ref.key); if (previous) { if (JSON.stringify(previous.ref) !== JSON.stringify(ref)) throw new Error('Conflicting recovery chunk reference.'); return previous.value; }
        check(signal); const page = await readRecoveryChunk(ref, encoded, { signal, isCurrent: () => !retired && isCurrent() });
        const result = await compute('decode-recovery-page', page, signal, record.generation, Math.min(64 * 1048576, Math.max(8192, ref.rawBytes + 4096 + (ref.partCount || 0) * 128))); retained.push(result); decodedRawBytes += ref.rawBytes; decoded.set(ref.key, { ref, value: result.value }); return result.value;
      };
      let released = false, releaseError = null;
      const release = () => { if (releaseError) throw releaseError; if (released) return; released = true; encoded = null; decoded.clear(); used.clear(); const errors = [];
        for (const result of retained.splice(0)) try { retireBackgroundResult(result); } catch (error) { errors.push(error); }
        try { requireSynchronousResourceAcknowledgement(resourceBudget?.release({ token: inputToken, owner: 'recovery-page-read' }), 'Recovery encoded source'); } catch (error) { errors.push(error); } lifetime.release();
        if (errors.length) { stats.retirementFailures += errors.length; releaseError = new AggregateError(errors, 'Recovery source retirement is unresolved.'); throw releaseError; }
      };
      try {
        const db = await open(); check(signal); encoded = await new Promise((resolve, reject) => {
          const transaction = db.transaction('sessions', 'readonly'), store = transaction.objectStore('sessions'), values = new Map(); let bytes = 0;
          let index = 0, failed;
          const abort = () => { try { transaction.abort(); } catch { /* The completion callback owns a finished transaction. */ } };
          signal.addEventListener('abort', abort, { once: true });
          const next = () => {
            const started = performance.now();
            try { check(signal); if (index === record.references.length) return;
              const key = record.references[index++], request = store.get(key); request.onsuccess = () => {
                if (!request.result) { failed = new Error('Missing recovery chunk.'); abort(); return; }
                bytes += request.result.bytes?.byteLength || 0; stats.maximumReadPayloadBytes = Math.max(stats.maximumReadPayloadBytes, request.result.bytes?.byteLength || 0); values.set(key, request.result);
                if (bytes > record.storedBytes) abort(); else next();
              };
            } catch (error) { failed = error; abort(); }
            finally { stats.transactionMaximumSliceMs = Math.max(stats.transactionMaximumSliceMs, performance.now() - started); }
          }; next();
          transaction.oncomplete = () => { signal.removeEventListener('abort', abort); if (bytes !== record.storedBytes) reject(new Error('Recovery stored length differs.')); else resolve(values); };
          transaction.onabort = () => { signal.removeEventListener('abort', abort); reject(Object.assign(failed || new Error('Recovery chunk read was incomplete.'), { name: 'RecoveryCandidateError' })); };
        });
        const manifest = await decode(record.paged);
        if (!['procgen-paged-recovery/v1', 'procgen-paged-recovery/v2'].includes(manifest.schema) || !Array.isArray(manifest.journal?.pages) || manifest.journal.pages.length > 8192 || record.checksum !== record.paged.sha256) throw Object.assign(new Error('Invalid recovery manifest.'), { name: 'RecoveryCandidateError' });
        const world = await decode(manifest.base), pages = [];
        for (const ref of manifest.journal.pages) pages.push(await decode(ref));
        const components = manifest.schema === 'procgen-paged-recovery/v2' ? { project: await decodeRecoveryProject(manifest.project, decode), patterns: manifest.patterns ? await decode(manifest.patterns) : null, physicalState: manifest.physicalState ? await decode(manifest.physicalState) : null } : {};
        if (used.size !== record.references.length || record.references.some(key => !used.has(key))) throw new Error('Recovery manifest has unreachable or missing pages.');
        let session = { ...manifest.session, ...components, world, recoveryJournal: { ...manifest.journal, pages } }; await validateProcgenRecoveryJournalCooperative(session.recoveryJournal, { signal }); validateSession(session); check(signal);
        if (!owned) {
          if (decodedRawBytes > 128 * 1024) throw new Error('Large recovery reads require an explicit owned source lease.');
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
