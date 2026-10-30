import { ResourceLoadError } from './ResourceLoadError.js';
import { createProcgenRetirementScope } from '../../app/procgen/ProcgenRetirement.js';

export async function prepareAssetCollections(tasks, { signal, onProgress, concurrency = 3, operationId = null, cleanupDeadlineMs = 5000 } = {}) {
  if (!Array.isArray(tasks) || tasks.length > 256 || tasks.some(task => !task || typeof task.id !== 'string' || !task.id || task.id.length > 128 || typeof task.prepare !== 'function') ||
      !Number.isSafeInteger(cleanupDeadlineMs) || cleanupDeadlineMs < 1 || cleanupDeadlineMs > 30000) throw new TypeError('Invalid asset preparation scope.');
  const controller = new AbortController(), cleanups = new Set(), producers = [], results = new Array(tasks.length);
  const abort = () => controller.abort(signal?.reason);
  let cursor = 0, completed = 0, terminal = null, retired = false, transferred = false;
  const notify = progress => { try { onProgress?.({ phase: 'collection', completed, total: tasks.length, operationId, ...progress }); } catch { /* Observers do not own preparation. */ } };
  const runCleanup = cleanup => {
    if (cleanup.done) return cleanup.receipt;
    cleanup.done = true;
    cleanup.receipt = createProcgenRetirementScope({ deadlineMs: cleanupDeadlineMs }).retire([{ name: cleanup.name, run: cleanup.run }]);
    return cleanup.receipt;
  };
  const retireCleanups = owned => createProcgenRetirementScope({ deadlineMs: cleanupDeadlineMs }).retire([...owned].map(cleanup => ({ name: cleanup.name, run: () => runCleanup(cleanup) })));
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
        if (typeof run !== 'function' || cleanups.size >= 4096) throw new TypeError('Invalid asset cleanup registration.');
        const cleanup = { run, done: false, name: task.id + '-resource-' + owned.size };
        cleanups.add(cleanup); owned.add(cleanup);
        if (retired || transferred || controller.signal.aborted) runCleanup(cleanup);
        return () => {
          if (cleanup.done || retired || controller.signal.aborted) return false;
          cleanup.done = true; cleanups.delete(cleanup); owned.delete(cleanup); return true;
        };
      };
      try {
        const producer = Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new ResourceLoadError('cancelled', task.id, { operationId });
          return task.prepare({ signal: controller.signal, registerCleanup });
        });
        producers.push(producer);
        const value = await Promise.race([producer, cancellation]);
        if (controller.signal.aborted) throw new ResourceLoadError('cancelled', task.id, { operationId });
        results[index] = { status: 'fulfilled', value };
        completed++; notify({ collection: task.id, state: 'ready' });
      } catch (cause) {
        const error = new ResourceLoadError(cause?.kind || 'decode', cause?.requestedUrl || task.id,
          { cause, status: cause?.status ?? null, operationId });
        error.collection = task.id;
        results[index] = { status: 'rejected', reason: error };
        if (task.required !== false && !terminal) { terminal = error; controller.abort(error); }
        error.retirement = retireCleanups(owned);
        completed++; notify({ collection: task.id, state: error.kind === 'cancelled' ? 'cancelled' : 'failed' });
      }
    }
  };
  try {
    const count = Math.min(tasks.length, Number.isInteger(concurrency) ? Math.max(1, Math.min(8, concurrency)) : 3);
    await Promise.all(Array.from({ length: count }, worker));
    if (controller.signal.aborted) throw terminal || new ResourceLoadError('cancelled', 'asset-collections', { operationId });
    await Promise.all(results.filter(result => result?.status === 'rejected').map(result => result.reason.retirement.completion));
    transferred = true;
    cleanups.clear();
    return results;
  } catch (error) {
    retired = true;
    controller.abort(error);
    const reconciliation = Promise.allSettled(producers).then(async () => {
      const receipt = retireCleanups(cleanups); await receipt.completion; return receipt;
    });
    const receipt = createProcgenRetirementScope({ deadlineMs: cleanupDeadlineMs }).retire([
      ...[...cleanups].map(cleanup => ({ name: cleanup.name, run: () => runCleanup(cleanup) })),
      { name: 'late-asset-acquisitions', run: () => reconciliation }
    ]);
    error.retirement = receipt; error.retirementReconciliation = reconciliation;
    await receipt.completion;
    throw error;
  } finally { signal?.removeEventListener('abort', abort); }
}
