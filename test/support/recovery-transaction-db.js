// A transactional storage seam: writes become visible only on completion.
export function recoveryTransactionDb() {
  const records = new Map(); let failAfter = Infinity;
  const db = { transaction(_store, mode) {
    const staged = new Map(records); let waiting = 0, aborted = false, completed = false, writes = 0;
    const transaction = { error: null, abort() { if (aborted || completed) return; aborted = true; queueMicrotask(() => transaction.onabort?.()); },
      objectStore() { return {
        get(key) { return request(() => staged.get(key)); },
        put(value) { return request(() => { if (++writes >= failAfter) { transaction.error = new Error('Injected transaction termination'); transaction.abort(); return; } staged.set(value.id, structuredClone(value)); return value.id; }); },
        delete(key) { return request(() => staged.delete(key)); }
      }; } };
    const request = operation => {
      waiting++; const result = { result: null, error: null };
      queueMicrotask(() => {
        if (!aborted) { result.result = operation(); if (!aborted) result.onsuccess?.(); }
        waiting--;
        if (!waiting && !aborted) queueMicrotask(() => {
          if (waiting || aborted || completed) return; completed = true;
          if (mode === 'readwrite') { records.clear(); for (const [key, value] of staged) records.set(key, value); }
          transaction.oncomplete?.();
        });
      }); return result;
    };
    return transaction;
  } };
  return { db, records, failAfter: value => { failAfter = value; } };
}
