import { captureProcgenCheckpointCooperative } from './ProcgenCheckpoint.js';
export function createPhysicalAuthoringHistory({ resourceBudget = null, maxBytes = 32 * 1048576, captureCheckpoint = captureProcgenCheckpointCooperative } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1048576 || maxBytes > 128 * 1048576) throw new Error('Invalid physical history capacity.');
  const retained = new Map(), owned = new Set(); let bytes = 0, disposed = false;
  const release = record => {
    if (!owned.has(record)) return true;
    if (record.pending) return false;
    try { const acknowledged = resourceBudget?.release({ token: record.token, owner: 'physical-authoring-history' });
      if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') { if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {}); throw new Error('Physical history retirement did not acknowledge synchronously.'); }
    }
    catch (error) { record.retirementError = error.message; return false; }
    owned.delete(record); bytes -= record.bytes; record.session = null; return true;
  };
  return {
    async capture(world, project, makeSession, { signal, isCurrent } = {}) {
      if (disposed || typeof isCurrent !== 'function' || !isCurrent() || world._stepping || world._disposed) throw new Error('Physical history needs an exclusive paused source.');
      const available = maxBytes - bytes, allocation = Math.min(available, Math.floor(maxBytes / 2), Math.max(524288, 8 * 1048576 + world.laneCount * 65536));
      if (allocation < 524288) throw new Error('Physical history is full; discard old physical history before authoring.');
      const metadataBudget = Math.min(524288, Math.floor(allocation / 4));
      const controller = new AbortController(), cancel = () => controller.abort(signal?.reason); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
      let complete; const completion = new Promise(resolve => { complete = resolve; });
      const record = { token: {}, bytes: allocation, session: null, retirementError: null, pending: true, controller, completion }; try { resourceBudget?.reserve({ token: record.token, owner: 'physical-authoring-history', category: 'checkpoint', bytes: allocation, pinned: true, reloadable: false }); } catch (error) { signal?.removeEventListener('abort', cancel); complete(); throw error; }
      owned.add(record); bytes += allocation;
      try {
        const checkpoint = await captureCheckpoint(world, { signal: controller.signal, isCurrent: () => !disposed && isCurrent(), maxGraphBytes: Math.max(4096, allocation - metadataBudget) });
        controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw new Error('Physical history source was replaced.'); record.session = makeSession(checkpoint, project);
        const metadata = { ...record.session, world: null, project: null }; if (JSON.stringify(metadata).length * 2 > metadataBudget) throw new Error('Physical history metadata exceeds its reserved bound.');
        let promoted = false;
        return Object.freeze({ bytes: allocation, session: () => record.session, promote(key) {
          if (disposed || !owned.has(record) || !record.session || promoted) throw new Error('Physical history capsule is retired or already published.');
          const previous = retained.get(key); if (previous && !release(previous)) throw new Error('Previous physical history retirement is unknown.'); retained.set(key, record); promoted = true;
        }, discard: () => promoted ? false : release(record) });
      } catch (error) { record.pending = false; release(record); throw error; }
      finally { record.pending = false; signal?.removeEventListener('abort', cancel); complete(); }
    },
    get: key => retained.get(key)?.session ?? null,
    bytesFor: key => retained.get(key)?.bytes ?? 0,
    prune(keys) { for (const [key, record] of retained) if (!keys.has(key) && release(record)) retained.delete(key); },
    clear() { for (const [key, record] of retained) if (release(record)) retained.delete(key); },
    diagnostics: () => ({ retained: retained.size, owned: owned.size, reservedBytes: bytes, maximumBytes: maxBytes, retainedLimitBytes: Math.floor(maxBytes / 2), retirementUnknown: [...owned].filter(record => record.retirementError).length }),
    async dispose() { disposed = true; const pending = [...owned].filter(record => record.pending); for (const record of pending) record.controller.abort(); await Promise.all(pending.map(record => record.completion)); for (const record of [...owned]) release(record); for (const [key, record] of retained) if (!owned.has(record)) retained.delete(key); if (owned.size) throw new Error('Physical history reservation retirement is unknown.'); }
  };
}
