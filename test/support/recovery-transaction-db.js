// A transactional storage seam: writes become visible only on completion.
export function recoveryTransactionDb() {
  const records = new Map(), pins = new Map(); let failAfter = Infinity, failureName = 'Error', afterCommit = null;
  const db = { transaction(_store, mode) {
    const staged = new Map(records), stagedPins = new Map(pins); let waiting = 0, aborted = false, completed = false, writes = 0;
    const transaction = { error: null, abort() { if (aborted || completed) return; aborted = true; queueMicrotask(() => transaction.onabort?.()); },
      objectStore(name) { const selected = name === 'generationPins' ? stagedPins : staged; return {
        get(key) { return request(() => selected.get(key)); },
        put(value) { return request(() => { if (++writes >= failAfter) { transaction.error = Object.assign(new Error('Injected transaction termination'), { name: failureName }); transaction.abort(); return; } selected.set(value.id, structuredClone(value)); return value.id; }); },
        delete(key) { return request(() => selected.delete(key)); }
      }; } };
    const request = operation => {
      waiting++; const result = { result: null, error: null };
      queueMicrotask(() => {
        if (!aborted) { result.result = operation(); if (!aborted) result.onsuccess?.(); }
        waiting--;
        if (!waiting && !aborted) queueMicrotask(() => {
          if (waiting || aborted || completed) return; completed = true;
          if (mode === 'readwrite') { records.clear(); for (const [key, value] of staged) records.set(key, value); pins.clear(); for (const [key, value] of stagedPins) pins.set(key, value); afterCommit?.(); }
          transaction.oncomplete?.();
        });
      }); return result;
    };
    return transaction;
  } };
  return { db, records, pins, failAfter: (value, name = 'Error') => { failAfter = value; failureName = name; }, afterCommit: callback => { afterCommit = callback; } };
}
