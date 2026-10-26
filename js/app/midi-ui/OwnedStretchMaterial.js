import { getApplicationBuild, getApplicationDeploymentRoot } from '../../runtime/ActiveExecutionIdentity.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const fail = message => Object.assign(new Error('Stretch material: ' + message), { code: 'owned-stretch-material-unavailable' });
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const wait = (promise, signal) => {
  signal?.throwIfAborted(); if (!signal) return promise;
  return new Promise((resolve, reject) => { const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)); });
};

// One immutable application-generation source. A canceled consumer does not
// cancel another consumer's cache fetch. Fetch/copy storage belongs to this owner
// until stream cancellation/completion is acknowledged; borrowed Blob readers
// keep their independent artifact reservation until their own release.
export function createOwnedStretchMaterial({ resourceBudget, fetchImpl = globalThis.fetch, getBuild = getApplicationBuild, getRoot = getApplicationDeploymentRoot, onState = () => {} } = {}) {
  if (!resourceBudget || typeof fetchImpl !== 'function' || typeof getBuild !== 'function' || typeof getRoot !== 'function') throw new TypeError('An owned core source needs the shared budget and exact application generation.');
  const scope = createProcgenRetirementScope(), unknown = new Set(), waiters = new Set(); let current = null, pending = null, disposed = false, ordinal = 0, error = null;
  const boundary = () => { const build = getBuild(), root = getRoot(); if (!build || !/^[a-f0-9]{64}$/.test(build.buildId || '') || !(root instanceof URL) || !['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('/')) throw fail('Use an immutable built application with its locally packaged core.'); return { buildId: build.buildId, root: root.href }; };
  const same = selected => { try { const now = boundary(); return now.buildId === selected.buildId && now.root === selected.root; } catch { return false; } };
  const state = () => Object.freeze({ ready: !!current?.artifact.metadata().retained && same(current.boundary), active: !!pending, disposed, unknownRetirement: unknown.size, waitingConsumers: waiters.size, error,
    assetHash: OWNED_STRETCH_CORE.wasmSha256, bytes: OWNED_STRETCH_CORE.wasmBytes, buildId: current?.boundary.buildId ?? null, qualification: 'verified-core-material-only;not-runtime-or-quality-evidence' });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  const ensure = () => {
    if (disposed || unknown.size) return Promise.reject(fail('The core source has retired or its fetch ownership is unresolved.'));
    const selected = boundary(); if (current?.artifact.metadata().retained && same(current.boundary)) return Promise.resolve(current);
    if (pending) return pending.promise;
    const operation = { ordinal: ++ordinal, controller: new AbortController(), reservation: null, reader: null, readerDone: false, unknown: false, artifact: null, timer: null, promise: null }; pending = operation; error = null;
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || pending !== operation || !same(selected)) throw fail('The application generation changed during core preparation.'); };
    operation.promise = (async () => {
      try {
        operation.reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'owned-stretch-material', generation: operation.ordinal, category: 'candidate', kind: 'bounded-core-fetch-and-copy', bytes: 2 * 1048576 + OWNED_STRETCH_CORE.wasmBytes * 4 }); check();
        operation.timer = setTimeout(() => { error = 'The core fetch exceeded its preparation deadline.'; operation.controller.abort(fail(error)); report(); }, 30000);
        const url = new URL(selected.buildId + '/' + OWNED_STRETCH_CORE.runtimePath, selected.root), response = await fetchImpl(url.href, { credentials: 'same-origin', redirect: 'error', signal: operation.controller.signal });
        operation.reader = response.body?.getReader?.() || null; check();
        if (!response.ok || !operation.reader) throw fail('The exact core is absent from this application generation. Prepare the runtime assets before building.');
        const declared = response.headers?.get?.('content-length'); if (declared != null && (!/^\d+$/.test(declared) || Number(declared) !== OWNED_STRETCH_CORE.wasmBytes)) throw fail('The core response differs from its pinned byte length.');
        const bytes = new Uint8Array(OWNED_STRETCH_CORE.wasmBytes); let offset = 0;
        while (true) { const result = await operation.reader.read(); check(); if (result.done) { operation.readerDone = true; break; } const chunk = result.value;
          if (!(chunk instanceof Uint8Array) || chunk.byteLength > OWNED_STRETCH_CORE.wasmBytes || offset + chunk.byteLength > bytes.length) throw fail('The core response exceeded its immutable bounded inventory.'); bytes.set(chunk, offset); offset += chunk.byteLength;
        }
        if (offset !== bytes.byteLength || await digest(bytes) !== OWNED_STRETCH_CORE.wasmSha256) throw fail('The core response changed or was truncated.'); check();
        operation.artifact = prepareExportArtifact({ bytes, immutableSourceRef: OWNED_STRETCH_CORE.wasmSha256, formatVersion: OWNED_STRETCH_CORE.schema, mediaType: 'application/wasm', suggestedFilename: 'signalsmith-stretch-core.wasm', maxBytes: OWNED_STRETCH_CORE.wasmBytes, lifetimeMs: 24 * 60 * 60 * 1000, budgetAdapter: resourceBudget });
        if (await operation.artifact.digest() !== OWNED_STRETCH_CORE.wasmSha256) throw fail('The retained immutable core differs from its verified source.'); check();
      } catch (caught) { error = String(caught.message).slice(0, 512); throw caught; }
      finally {
        clearTimeout(operation.timer);
        try { if (operation.reader && !operation.readerDone) await operation.reader.cancel(fail('Core fetch retired.')); operation.reader?.releaseLock(); }
        catch (caught) { operation.unknown = true; unknown.add(operation); error = String(caught.message).slice(0, 512); }
        if (!operation.unknown) { try { operation.reservation?.release(); } catch (caught) { operation.unknown = true; unknown.add(operation); error = String(caught.message).slice(0, 512); } }
      }
      if (operation.unknown) throw fail('The core fetch did not acknowledge retirement; its workspace remains charged.'); check();
      current?.artifact.discard(); const record = { boundary: selected, artifact: operation.artifact }; operation.artifact = null; current = record; return record;
    })().finally(async () => {
      if (operation.artifact && !operation.unknown) { operation.artifact.discard(); await operation.artifact.digest(); }
      if (pending === operation) pending = null; report();
    }); report(); return operation.promise;
  };
  return Object.freeze({ state,
    async borrow({ signal, isCurrent = () => true } = {}) {
      signal?.throwIfAborted(); if (!isCurrent() || waiters.size >= 8) throw fail('The requesting source changed or bounded core-consumer capacity is occupied.');
      const waiter = {}; waiters.add(waiter); let loading;
      try { loading = ensure(); } catch (caught) { waiters.delete(waiter); throw caught; }
      // Keep a canceled waiter's small slot until the shared fetch settles. This
      // bounds abandoned Promise reactions during repeated consumer cancellation.
      loading.then(() => waiters.delete(waiter), () => waiters.delete(waiter));
      const record = await wait(loading, signal); signal?.throwIfAborted(); if (disposed || !isCurrent() || !same(record.boundary)) throw fail('The source or build changed before its core reader was admitted.'); return record.artifact.borrow();
    },
    dispose() {
      if (scope.getReceipt()) return scope.getReceipt(); disposed = true; pending?.controller.abort(fail('Core source owner retired.')); const settled = pending?.promise.catch(() => {});
      return scope.retire([{ name: 'core-fetch-producer', run: async () => { await settled; if (unknown.size) throw fail('Core fetch retirement remains unknown; its reserved workspace is retained.'); } },
        { name: 'immutable-core-cache', run: async () => { await settled; if (current) { current.artifact.discard(); await current.artifact.digest(); current = null; } } }]);
    }
  });
}
