const sealed = new WeakSet();
const unsafe = new Set(['__proto__', 'prototype', 'constructor', 'toJSON']);

// Only this verifier's completed trees qualify for identity-based durable reuse.
// Object.isFrozen alone says nothing about mutable descendants or accessors.
function buildMidiProjectSnapshot(value, copy) {
  const active = new WeakSet(), copies = new WeakMap(); let nodes = 0;
  const visit = (node, depth) => {
    if (node === null) return node;
    if (typeof node !== 'object') {
      if (!['undefined', 'boolean', 'number', 'string'].includes(typeof node) || typeof node === 'number' && !Number.isFinite(node)) throw new Error('Invalid authored snapshot scalar.');
      return node;
    }
    if (sealed.has(node)) return node;
    if (copy && copies.has(node)) { if (active.has(node)) throw new Error('Authored snapshot exceeds its tree bound.'); return copies.get(node); }
    if (++nodes > 4000000 || depth > 48 || active.has(node)) throw new Error('Authored snapshot exceeds its tree bound.');
    const array = Array.isArray(node), prototype = Object.getPrototypeOf(node);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('Authored snapshots require plain data.');
    const keys = Object.getOwnPropertyNames(node).filter(key => !(array && key === 'length'));
    if (keys.length > 262144 || Object.getOwnPropertySymbols(node).length) throw new Error('Invalid authored snapshot properties.');
    const result = copy ? array ? new Array(node.length) : Object.create(prototype) : node;
    if (copy) copies.set(node, result); active.add(node);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (unsafe.has(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('Authored snapshots cannot contain accessors or unsafe properties.');
      const child = visit(descriptor.value, depth + 1);
      if (copy) Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true });
    }
    active.delete(node); Object.freeze(result); sealed.add(result); return result;
  };
  return visit(value, 0);
}
export const sealMidiProjectSnapshot = value => buildMidiProjectSnapshot(value, false);
export const copyMidiProjectSnapshot = value => buildMidiProjectSnapshot(value, true);
export const isSealedMidiProjectNode = value => !!value && typeof value === 'object' && sealed.has(value);
