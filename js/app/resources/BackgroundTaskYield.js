export async function yieldBackgroundTask({ signal, scheduler = globalThis.scheduler, timer = callback => setTimeout(callback, 0) } = {}) {
  signal?.throwIfAborted();
  if (typeof scheduler?.postTask === 'function') {
    try { await scheduler.postTask(() => {}, { priority: 'background', ...(signal ? { signal } : {}) }); signal?.throwIfAborted(); return; }
    catch { signal?.throwIfAborted(); }
  }
  await new Promise(resolve => timer(resolve)); signal?.throwIfAborted();
}
