// A controlled native adapter: overlapping transactions serialize, requests
// observe a private snapshot, and only commit publishes its complete write set.
export function createScheduledCacheDatabase({ onCreate = () => {}, onActivate = () => {}, onCommit = () => {}, onAbort = () => {} } = {}) {
  const stores = new Map(['entries', 'payloads', 'meta'].map(name => [name, new Map()])), transactions = []; let serial = 0;
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const live = tx => tx.state === 'queued' || tx.state === 'active';
  const head = () => transactions.find(live);
  const connection = owner => {
    let closed = false;
    return { close() { closed = true; }, transaction(names, mode = 'readonly') {
      if (closed) throw new Error('Scheduled native connection is closed.');
      const scopes = typeof names === 'string' ? [names] : [...names];
      if (!scopes.length || scopes.some(name => !stores.has(name)) || !['readonly', 'readwrite'].includes(mode)) throw new Error('Unsupported scheduled native scope.');
      const tx = { id: ++serial, owner, scopes, mode, state: 'queued', requests: [], local: null, oncomplete: null, onabort: null, onerror: null };
      const request = action => {
        if (!live(tx)) throw new Error('Scheduled native transaction is retired.');
        const pending = { result: undefined, error: null, onsuccess: null, onerror: null };
        tx.requests.push({ pending, action }); return pending;
      };
      tx.abort = () => {
        if (!live(tx)) return;
        tx.state = 'aborted'; tx.error = Object.assign(new Error('Scheduled native abort.'), { name: 'AbortError' });
        for (const { pending } of tx.requests.splice(0)) { pending.error = tx.error; pending.onerror?.(); }
        onAbort(tx); tx.onabort?.();
      };
      tx.objectStore = name => {
        if (!scopes.includes(name)) throw new Error('Store is outside the transaction scope.');
        const writable = () => { if (mode !== 'readwrite') throw new Error('Readonly scheduled native transaction.'); };
        const cursor = (keysOnly = false, sort = false) => {
          let keys = null, index = 0;
          const pending = { result: undefined, error: null, onsuccess: null, onerror: null };
          const advance = () => tx.requests.push({ pending, action() {
            const map = tx.local.get(name);
            keys ||= [...map.keys()].sort((a, b) => sort ? (map.get(a).lastAccess || 0) - (map.get(b).lastAccess || 0) : String(a).localeCompare(String(b)));
            while (index < keys.length && !map.has(keys[index])) index++;
            if (index >= keys.length) return null;
            const key = keys[index]; return { key, primaryKey: key, ...(keysOnly ? {} : { value: clone(map.get(key)) }), continue() { index++; advance(); } };
          } });
          advance(); return pending;
        };
        return { get(key) { return request(() => clone(tx.local.get(name).get(key))); },
          put(value) { writable(); const copied = clone(value), key = name === 'meta' ? value.key : value.url; return request(() => { tx.local.get(name).set(key, copied); return key; }); },
          delete(key) { writable(); return request(() => { tx.local.get(name).delete(key); }); },
          openCursor() { return cursor(); }, openKeyCursor() { return cursor(true); }, index() { return { openCursor: () => cursor(false, true) }; } };
      };
      transactions.push(tx); onCreate(tx); return tx;
    } };
  };
  const step = () => {
    const tx = head(); if (!tx) return false;
    if (tx.state === 'queued') { tx.state = 'active'; tx.local = new Map(tx.scopes.map(name => [name, new Map([...stores.get(name)].map(([key, value]) => [key, clone(value)]))])); onActivate(tx); }
    const next = tx.requests.shift();
    if (next) {
      try { next.pending.result = next.action(); next.pending.onsuccess?.(); }
      catch (error) { next.pending.error = error; next.pending.onerror?.(); tx.abort(); }
    } else {
      if (tx.mode === 'readwrite') for (const name of tx.scopes) stores.set(name, tx.local.get(name));
      tx.state = 'committed'; onCommit(tx); tx.oncomplete?.();
    }
    return true;
  };
  return { connection, step, transactions, stores, pending: () => transactions.filter(live),
    indexedDB(owner) { return { open() { const pending = {}; queueMicrotask(() => { pending.result = connection(owner); pending.onsuccess?.(); }); return pending; } }; } };
}
