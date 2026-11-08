const owners = new WeakMap();

/** @template T @param {{midiPreviewRouter: T}} host @param {(router: T) => void} listener */
export function subscribeMidiPreviewRouter(host, listener) {
  if (!host || typeof listener !== 'function') throw new TypeError('A preview router subscription requires its host and listener.');
  let owner = owners.get(host);
  if (!owner) { owner = { listeners: new Set(), revision: 0 }; owners.set(host, owner); }
  if (owner.listeners.size >= 32) throw new Error('Preview router subscription capacity exceeded.');
  const entry = { listener }; owner.listeners.add(entry);
  return () => owner.listeners.delete(entry);
}

/** @template T @param {{midiPreviewRouter: T}} host */
export function notifyMidiPreviewRouter(host) {
  const owner = owners.get(host); if (!owner) return;
  const router = host.midiPreviewRouter, revision = ++owner.revision, failures = [];
  for (const entry of [...owner.listeners]) {
    if (owner.revision !== revision || host.midiPreviewRouter !== router) break;
    if (!owner.listeners.has(entry)) continue;
    try { entry.listener(router); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Preview router subscribers failed after publication.');
}
