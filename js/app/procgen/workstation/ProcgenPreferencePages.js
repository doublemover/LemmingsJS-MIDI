import { encodeRecoveryProject, decodeRecoveryProject } from './ProcgenRecoveryProjectPages.js';
import { isSealedMidiProjectNode, copyMidiProjectSnapshot } from '../../../midi/project/MidiProjectSnapshot.js';
import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult, awaitBackgroundFailureRetirement } from '../../resources/ResourceRetirement.js';

const PREFIX = 'preferences:page:', HEAD = 'preferences:head', STAGES = 'preferences:stages', slotKey = slot => 'preferences:slot:' + slot;
const MAX_REFS = 1152, MAX_PENDING_BYTES = 32 * 1048576, MAX_PROJECT_UTF8_BYTES = 64 * 1048576, STAGE_LEASE_MS = 120000;
const fail = message => { throw Object.assign(new Error('Project preferences: ' + message), { code: 'invalid-preferences' }); };
const conflict = () => { throw Object.assign(new Error('Preferences changed in another tab; retry against the current source.'), { name: 'ConflictError' }); };
const boundedJson = (value, bytes) => { try { return JSON.stringify(value).length * 2 <= bytes; } catch { return false; } };
const validRef = ref => ref && /^preferences:page:[a-f0-9]{32}:[a-f0-9]{64}$/.test(ref.key) && /^[a-f0-9]{16}$/.test(ref.checksum) &&
  Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= MAX_PENDING_BYTES && Number.isSafeInteger(ref.utf8Bytes) && ref.utf8Bytes > 0 && ref.utf8Bytes <= 16 * 1048576;
const validRoot = root => {
  if (!root) return true;
  if (root.kind !== 'preference-generation' || !Number.isSafeInteger(root.generation) || root.generation < 1 || !Number.isSafeInteger(root.revision) || root.revision < 0 ||
      root.metadata?.version !== 1 || root.metadata.documentRevision !== root.revision || !Array.isArray(root.references) || root.references.length > MAX_REFS ||
      !root.references.every(validRef) || !root.layout || !boundedJson(root.metadata, 262144) || !boundedJson(root.layout, 1048576)) return false;
  const expected = new Map(root.references.map(ref => [ref.key, ref])), used = new Set();
  if (expected.size !== root.references.length || root.references.reduce((sum, ref) => sum + ref.utf8Bytes, 0) > MAX_PROJECT_UTF8_BYTES) return false;
  const reference = ref => {
    const known = expected.get(ref?.key);
    if (!validRef(ref) || known?.bytes !== ref.bytes || known.utf8Bytes !== ref.utf8Bytes || known.checksum !== ref.checksum) return false;
    used.add(ref.key); return true;
  };
  const fields = (entries, excluded) => {
    if (!Array.isArray(entries) || entries.length > 64) return false; const keys = new Set();
    return entries.every(entry => {
      if (!entry || typeof entry.key !== 'string' || !entry.key.length || entry.key.length > 128 || ['__proto__', 'prototype', 'constructor', excluded].includes(entry.key) || keys.has(entry.key) || Object.hasOwn(entry, 'page') === Object.hasOwn(entry, 'value')) return false;
      keys.add(entry.key); const value = entry.value;
      return Object.hasOwn(entry, 'page') ? reference(entry.page) : value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 4096;
    });
  };
  const layout = root.layout;
  return layout?.schema === 'procgen-recovery-project/v1' && fields(layout.fields, 'procgen') && fields(layout.procgen?.fields, 'lanes') &&
    Array.isArray(layout.procgen.lanes) && layout.procgen.lanes.length <= 1024 && layout.procgen.lanes.every(reference) && used.size === expected.size;
};
// Local corruption detection, matching recovery's two accumulators; not authenticity.
const checksumText = text => {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) { const unit = text.charCodeAt(index); first = Math.imul(first ^ unit, 0x01000193); second = Math.imul(second ^ unit, 0x85ebca6b); }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
};
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

export function createProcgenPreferencePages({ open, jobs, resourceBudget, isCurrent, now = Date.now }) {
  let cache = new WeakMap(), retired = false, writing = false, serial = 0;
  const controllers = new Set(), retained = new Set(), owner = 'authored-preferences';
  const stats = { encodedPages: 0, reusedPages: 0, workerJobs: 0, committed: 0, readPages: 0, pendingBytes: 0, peakPendingBytes: 0,
    stagedBytes: 0, stagedBatches: 0, discardedStages: 0, transactionMaximumSliceMs: 0, readMaximumSliceMs: 0, retirementFailures: 0 };
  const check = context => { context.signal.throwIfAborted(); if (retired || !isCurrent(context.db) || !context.current()) fail('source ownership changed.'); };
  const linked = (signal, current = () => true) => {
    const controller = new AbortController(), abort = () => controller.abort(signal.reason); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); controllers.add(controller);
    return { signal: controller.signal, current, db: null, release() { controllers.delete(controller); signal?.removeEventListener('abort', abort); } };
  };
  const releaseEntry = entry => {
    try { requireSynchronousResourceAcknowledgement(resourceBudget?.release({ token: entry, owner }), 'Preference page'); retained.delete(entry); stats.pendingBytes -= entry.bytes; entry.text = null; }
    catch (error) { entry.retirementFailed = true; stats.retirementFailures++; return error; } return null;
  };
  const retain = text => {
    const bytes = text.length * 2 + 1024; if (stats.pendingBytes + bytes > MAX_PENDING_BYTES) fail('pending pages exceed their retained byte bound.');
    const entry = { text, bytes }; requireSynchronousResourceAcknowledgement(resourceBudget?.reserve({ token: entry, owner, category: 'checkpoint', bytes, pinned: true, reloadable: false }), 'Preference page admission');
    retained.add(entry); stats.pendingBytes += bytes; stats.peakPendingBytes = Math.max(stats.peakPendingBytes, stats.pendingBytes); return entry;
  };
  const transaction = (context, mode, work, { cleanup = false } = {}) => new Promise((resolve, reject) => {
    let tx, failure = null, output;
    const abort = () => { try { tx?.abort(); } catch {} }, detach = () => context.signal.removeEventListener('abort', abort);
    const run = callback => event => {
      const start = performance.now();
      try { if (!cleanup) check(context); callback(event); } catch (error) { failure = error; abort(); }
      finally { stats.transactionMaximumSliceMs = Math.max(stats.transactionMaximumSliceMs, performance.now() - start); }
    };
    try {
      if (!cleanup) check(context); tx = context.db.transaction('sessions', mode); if (!cleanup) context.signal.addEventListener('abort', abort, { once: true });
      tx.oncomplete = () => { detach(); resolve(output); }; tx.onabort = () => { detach(); reject(failure || context.signal.reason || tx.error || new Error('Preference transaction aborted.')); };
      const store = tx.objectStore('sessions'), sequence = operations => { const iterator = operations[Symbol.iterator](), next = run(() => { const item = iterator.next(); if (!item.done) item.value().onsuccess = next; }); next(); };
      work({ store, run, sequence, result: value => { output = value; } });
    } catch (error) { abort(); detach(); reject(error); }
  });
  const registry = value => {
    const entries = value?.entries || [];
    if (!Array.isArray(entries) || entries.length > 16 || entries.some(entry => !/^preferences:stage:[a-f0-9]{32}$/.test(entry.id) || !Number.isSafeInteger(entry.deadline)) || new Set(entries.map(entry => entry.id)).size !== entries.length) fail('invalid staging registry.'); return entries;
  };
  const stageReferences = (record, id) => {
    if (!record || record.kind !== 'preference-stage' || !Array.isArray(record.references) || record.references.length > MAX_REFS || record.references.some(ref => !validRef(ref) || !ref.key.startsWith(PREFIX + id.slice('preferences:stage:'.length) + ':'))) fail('invalid staged pages.'); return record.references;
  };
  const discard = (context, stageId, expiredOnly = false) => transaction(context, 'readwrite', ({ store, run, sequence }) => {
    const registryRequest = store.get(STAGES), request = store.get(stageId);
    request.onsuccess = run(() => {
      const entries = registry(registryRequest.result), refs = request.result ? stageReferences(request.result, stageId) : [];
      if (expiredOnly && entries.some(entry => entry.id === stageId && entry.deadline > now())) return;
      sequence((function* () { for (const ref of refs) yield () => store.delete(ref.key); yield () => store.delete(stageId); yield () => store.put({ id: STAGES, entries: entries.filter(entry => entry.id !== stageId) }); })());
    });
  }, { cleanup: true });
  const beginStage = async (context, id) => {
    const expired = await transaction(context, 'readonly', ({ store, run, result }) => {
      const request = store.get(STAGES); request.onsuccess = run(() => result(registry(request.result).filter(entry => entry.deadline <= now()).map(entry => entry.id)));
    });
    for (const old of expired) { await discard(context, old, true); stats.discardedStages++; check(context); }
    await transaction(context, 'readwrite', ({ store, run }) => {
      const request = store.get(STAGES); request.onsuccess = run(() => {
        const entries = registry(request.result); if (entries.length === 16) fail('too many active preference writers.');
        store.put({ id: STAGES, entries: [...entries, { id, deadline: now() + STAGE_LEASE_MS }] }); store.put({ id, kind: 'preference-stage', references: [] });
      });
    });
  };
  const roots = async (context, allocated = null, decoded = null) => transaction(context, 'readonly', ({ store, run, result }) => {
    const requests = [HEAD, slotKey(0), slotKey(1)].map(key => store.get(key));
    requests[2].onsuccess = run(() => {
      const values = requests.map(request => request.result), [head] = values;
      if (!values.slice(1).every(validRoot)) fail('invalid retained generations.');
      if (head && (head.kind !== 'preference-head' || !Number.isSafeInteger(head.generation) || head.generation < 1 || ![0, 1].includes(head.slot) || values[head.slot + 1]?.generation !== head.generation)) fail('invalid committed head.');
      if (!head && values.slice(1).some(Boolean)) fail('retained generations have no committed head.');
      context.published = !!head; result(values); if (!head || !decoded) return;
      const refs = values[head.slot + 1].references; let index = 0;
      const next = run(() => {
        if (index === refs.length) return; const ref = refs[index++], request = store.get(ref.key);
        request.onsuccess = run(() => {
          const start = performance.now(), stored = request.result;
          if (stored?.kind !== 'preference-page' || typeof stored.text !== 'string' || stored.text.length * 2 !== ref.bytes || checksumText(stored.text) !== ref.checksum) fail('page is missing or differs.');
          const entry = retain(stored.text); allocated.push(entry);
          if (ref.bytes <= 128 * 1024) {
            decoded.set(ref.key, { value: JSON.parse(stored.text) }); const error = releaseEntry(entry); if (error) throw error; allocated.pop();
          } else decoded.set(ref.key, entry);
          stats.readPages++; stats.readMaximumSliceMs = Math.max(stats.readMaximumSliceMs, performance.now() - start); next();
        });
      }); next();
    });
  });
  const compute = async (kind, value, context, peak, maxBytes) => {
    check(context); if (serial === Number.MAX_SAFE_INTEGER) fail('job identity exhausted.'); stats.workerJobs++;
    try {
      return await jobs.compute({ kind, ownerId: owner, ownerEpoch: 1, sourceRevision: 'preferences:' + (++serial), estimatedPeakBytes: peak,
        maxBytes, priority: 'recovery', budgetAdapter: resourceBudget, signal: context.signal, isCurrent: () => !retired && isCurrent(context.db) && context.current(), prepareInput: () => value });
    } catch (error) { await awaitBackgroundFailureRetirement(error); throw error; }
  };
  return {
    async save(value, { revision, signal, isCurrent: current = () => true } = {}) {
      value = copyMidiProjectSnapshot(value);
      if (!Number.isSafeInteger(revision) || revision < 0 || value?.version !== 1 || !value.project) fail('invalid authored revision.');
      if (writing) fail('a write is already pending.'); writing = true;
      const context = linked(signal, current), references = new Map(), cacheUpdates = [], allocated = new Set(), staged = [];
      let committed = false, receipt = null, originalError = null, stageStarted = false, stageId;
      try {
        const stageToken = crypto.randomUUID().replaceAll('-', ''); stageId = 'preferences:stage:' + stageToken;
        context.db = await open(); check(context); const prior = await roots(context), priorGeneration = prior[0]?.generation || 0;
        const known = new Set(prior.slice(1).flatMap(root => root?.references.map(ref => ref.key) || [])), tasks = [];
        const metadata = { version: 1, documentRevision: revision, ui: value.ui || {}, transport: value.transport || {} };
        if (!boundedJson(metadata, 262144)) fail('presentation metadata exceeds its bound.');
        const draft = await encodeRecoveryProject(value.project, async (source, kind, maxBytes, _peak, reusable) => {
          check(context); const existing = reusable && cache.get(source);
          if (existing && known.has(existing.key)) { references.set(existing.key, existing); stats.reusedPages++; return existing; }
          const marker = { pendingPreferencePage: tasks.length }; tasks.push({ source, kind, maxBytes, reusable, marker }); return marker;
        });
        await beginStage(context, stageId); stageStarted = true;
        for (let offset = 0; offset < tasks.length;) {
          const group = [tasks[offset++]]; if (group[0].kind === 'project-lane') while (group.length < 8 && tasks[offset]?.kind === 'project-lane') group.push(tasks[offset++]);
          const peak = group[0].kind === 'project-lane' ? group.length * 9 * 1048576 : 32 * 1048576, batch = []; let result;
          try {
            result = await compute('encode-preference-pages', group.map(task => ({ value: task.source, maxBytes: task.maxBytes })), context, peak, 64 * 1048576); check(context);
            if (!Array.isArray(result.value) || result.value.length !== group.length) fail('page encoder returned an incomplete result.');
            for (let index = 0; index < group.length; index++) {
              const text = result.value[index]; if (typeof text !== 'string') fail('page encoder returned invalid text.');
              const utf8 = new TextEncoder().encode(text); if (utf8.length > group[index].maxBytes) fail('encoded page exceeds its byte bound.');
              const entry = retain(text); allocated.add(entry); batch.push(entry);
              const key = PREFIX + stageToken + ':' + await digest(utf8); check(context);
              const ref = Object.freeze({ key, bytes: text.length * 2, utf8Bytes: utf8.length, checksum: checksumText(text) }); references.set(key, ref);
              entry.id = key; staged.push(ref); Object.assign(group[index].marker, ref); delete group[index].marker.pendingPreferencePage;
              if (group[index].reusable && isSealedMidiProjectNode(group[index].source)) cacheUpdates.push([group[index].source, ref]); stats.encodedPages++;
            }
            if (references.size > MAX_REFS || [...references.values()].reduce((sum, ref) => sum + ref.utf8Bytes, 0) > MAX_PROJECT_UTF8_BYTES) fail('encoded project exceeds its byte bound.');
            await transaction(context, 'readwrite', ({ store, run, sequence }) => {
              const registryRequest = store.get(STAGES), stageRequest = store.get(stageId);
              stageRequest.onsuccess = run(() => {
                const entries = registry(registryRequest.result); if (!stageRequest.result || !entries.some(entry => entry.id === stageId)) conflict();
                sequence((function* () {
                  for (const entry of batch) yield () => store.put({ id: entry.id, kind: 'preference-page', text: entry.text });
                  yield () => store.put({ id: stageId, kind: 'preference-stage', references: staged });
                  yield () => store.put({ id: STAGES, entries: entries.map(entry => entry.id === stageId ? { id: stageId, deadline: now() + STAGE_LEASE_MS } : entry) });
                })());
              });
            });
            stats.stagedBatches++; stats.stagedBytes += batch.reduce((sum, entry) => sum + entry.bytes, 0);
          } finally {
            if (result) retireBackgroundResult(result);
            const errors = batch.map(entry => { const error = releaseEntry(entry); if (!error) allocated.delete(entry); return error; }).filter(Boolean);
            if (errors.length) throw new AggregateError(errors, 'Preference batch cleanup is incomplete.');
          }
          await yieldBackgroundTask({ signal: context.signal }); check(context);
        }
        const refs = [...references.values()]; if (!validRoot({ kind: 'preference-generation', generation: 1, revision, metadata, layout: draft, references: refs })) fail('invalid generation layout.');
        receipt = await transaction(context, 'readwrite', ({ store, run, sequence, result }) => {
          const headRequest = store.get(HEAD), registryRequest = store.get(STAGES), stageRequest = store.get(stageId);
          stageRequest.onsuccess = run(() => {
            const entries = registry(registryRequest.result); if ((headRequest.result?.generation || 0) !== priorGeneration || !stageRequest.result || !entries.some(entry => entry.id === stageId)) conflict();
            const generation = priorGeneration + 1; if (!Number.isSafeInteger(generation)) fail('generation exhausted.');
            const slot = generation % 2, old = prior[slot + 1], other = prior[2 - slot], keep = new Set([...refs, ...(other?.references || [])].map(ref => ref.key));
            result({ durable: true, generation, revision });
            sequence((function* () {
              for (const ref of old?.references || []) if (!keep.has(ref.key)) yield () => store.delete(ref.key);
              yield () => store.put({ id: slotKey(slot), kind: 'preference-generation', generation, revision, metadata, layout: draft, references: refs });
              yield () => store.delete(stageId);
              yield () => store.put({ id: STAGES, entries: entries.filter(entry => entry.id !== stageId) });
              yield () => store.put({ id: HEAD, kind: 'preference-head', generation, slot });
            })());
          });
        });
        committed = true; stats.committed++; for (const [source, ref] of cacheUpdates) cache.set(source, ref); return receipt;
      } catch (error) { originalError = error; throw error; } finally {
        const errors = [...allocated].map(releaseEntry).filter(Boolean);
        if (stageStarted && !committed) try { await discard(context, stageId); } catch (error) { if (originalError) originalError.stagingRetirementError = error; else errors.push(error); }
        context.release(); writing = false;
        if (errors.length && committed) receipt.retirement = { state: 'partial', failures: errors.map(error => String(error.message || error).slice(0, 512)) };
        if (errors.length && !committed) throw new AggregateError([...(originalError ? [originalError] : []), ...errors], 'Preference page cleanup is incomplete.', { cause: originalError });
      }
    },
    async load({ signal, includeProject = true } = {}) {
      const context = linked(signal), allocated = [], decoded = includeProject ? new Map() : null;
      try {
        context.db = await open(); check(context); const saved = await roots(context, allocated, decoded); if (!saved[0]) return null;
        const root = saved[saved[0].slot + 1]; if (!includeProject) return root.metadata;
        const project = await decodeRecoveryProject(root.layout, async ref => {
          check(context); const stored = decoded.get(ref.key); if (Object.hasOwn(stored, 'value')) return stored.value;
          let result; try { result = await compute('parse-json', stored.text, context, Math.min(384 * 1048576, ref.bytes * 24 + 1048576), ref.utf8Bytes); check(context); return copyMidiProjectSnapshot(result.value); } finally { if (result) retireBackgroundResult(result); }
        }); return { ...root.metadata, project };
      } catch (error) {
        if (context.published) error.preferenceSourcePublished = true;
        if (context.published && !context.signal.aborted && !error.code && !(error instanceof AggregateError)) error.code = 'invalid-preferences'; throw error;
      } finally {
        const errors = allocated.map(releaseEntry).filter(Boolean); decoded?.clear(); context.release();
        if (errors.length) throw Object.assign(new AggregateError(errors, 'Preference read cleanup is incomplete.'), { preferenceSourcePublished: !!context.published });
      }
    },
    diagnostics: () => ({ ...stats, writing, retired }),
    dispose() { retired = true; for (const controller of controllers) controller.abort(new Error('Preference storage retired.')); cache = new WeakMap(); for (const entry of retained) if (entry.retirementFailed) releaseEntry(entry); }
  };
}
