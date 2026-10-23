import { ResourceLoadError } from './ResourceLoadError.js';

export async function prepareAssetCollections(tasks, { signal, onProgress, concurrency = 3, operationId = null } = {}) {
  const controller = new AbortController(), cleanups = new Set(), results = new Array(tasks.length);
  const abort = () => controller.abort();
  let cursor = 0, completed = 0, terminal = null, retired = false;
  const notify = progress => { try { onProgress?.({ phase: 'collection', completed, total: tasks.length, operationId, ...progress }); } catch { /* Observers do not own preparation. */ } };
  const runCleanup = cleanup => {
    if (cleanup.done) return cleanup.promise;
    cleanup.done = true;
    try { cleanup.promise = Promise.resolve(cleanup.run()).catch(() => {}); }
    catch { cleanup.promise = Promise.resolve(); }
    return cleanup.promise;
  };
  const cancellation = new Promise((resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new ResourceLoadError('cancelled', 'asset-collections', { operationId })), { once: true });
  });
  cancellation.catch(() => {});
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const worker = async () => {
    while (!controller.signal.aborted && cursor < tasks.length) {
      const index = cursor++, task = tasks[index], owned = new Set();
      notify({ collection: task.id, state: 'loading' });
      const registerCleanup = run => {
        const cleanup = { run, done: false };
        cleanups.add(cleanup); owned.add(cleanup);
        if (retired || controller.signal.aborted) runCleanup(cleanup);
        return () => { cleanup.done = true; cleanups.delete(cleanup); owned.delete(cleanup); };
      };
      try {
        const value = await Promise.race([Promise.resolve().then(() => task.prepare({ signal: controller.signal, registerCleanup })), cancellation]);
        if (controller.signal.aborted) throw new ResourceLoadError('cancelled', task.id, { operationId });
        results[index] = { status: 'fulfilled', value };
        completed++; notify({ collection: task.id, state: 'ready' });
      } catch (cause) {
        const error = new ResourceLoadError(cause?.kind || 'decode', cause?.requestedUrl || task.id,
          { cause, status: cause?.status ?? null, operationId });
        error.collection = task.id;
        results[index] = { status: 'rejected', reason: error };
        for (const cleanup of owned) runCleanup(cleanup);
        completed++; notify({ collection: task.id, state: error.kind === 'cancelled' ? 'cancelled' : 'failed' });
        if (task.required !== false && !terminal) { terminal = error; controller.abort(); }
      }
    }
  };
  try {
    const count = Math.min(tasks.length, Number.isInteger(concurrency) ? Math.max(1, Math.min(8, concurrency)) : 3);
    await Promise.all(Array.from({ length: count }, worker));
    if (controller.signal.aborted) throw terminal || new ResourceLoadError('cancelled', 'asset-collections', { operationId });
    cleanups.clear();
    return results;
  } catch (error) {
    retired = true;
    controller.abort();
    await Promise.allSettled([...cleanups].map(runCleanup));
    throw error;
  } finally { signal?.removeEventListener('abort', abort); }
}
