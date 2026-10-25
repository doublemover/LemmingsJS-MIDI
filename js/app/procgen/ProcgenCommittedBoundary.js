const observers = new WeakMap(), notifying = new WeakSet();
export const isNotifyingProcgenBoundary = world => notifying.has(world);
export function subscribeProcgenCommittedBoundary(world, listener) {
  if (typeof listener !== 'function') throw new Error('Invalid committed boundary observer.');
  const set = observers.get(world) || new Set(); if (set.size >= 8) throw new Error('Committed boundary observer capacity exceeded.'); set.add(listener); observers.set(world, set);
  return () => { set.delete(listener); if (!set.size) observers.delete(world); };
}
export function publishProcgenCommittedBoundary(world) {
  if (notifying.has(world)) throw new Error('Committed boundary publication cannot recurse.');
  notifying.add(world); try { for (const listener of observers.get(world) || []) listener(); } finally { notifying.delete(world); }
}
