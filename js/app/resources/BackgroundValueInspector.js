import { backgroundJobError as problem, checkBackgroundJob as guard } from './BackgroundJsonInspector.js';

export const shared = value => typeof globalThis.SharedArrayBuffer === 'function' && (value instanceof globalThis.SharedArrayBuffer || value?.buffer instanceof globalThis.SharedArrayBuffer);
const jsonStringBytes = text => {
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index), next = text.charCodeAt(index + 1);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32 || code >= 0xdc00 && code <= 0xdfff || code >= 0xd800 && code <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff)) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; index++; }
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
  }
  return bytes;
};

export const inspectValue = async (value, { maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, signal, current, onProgress, yieldControl }, { allowBinary = false } = {}) => {
  const stack = [{ value, depth: 0 }], active = new WeakSet(); let units = 0, bytes = 0, nodes = 0, binaryBytes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item.leave) { active.delete(item.value); continue; }
    if (item.array) {
      if (item.index < item.value.length) {
        const index = item.index++; stack.push(item);
        const descriptor = Object.getOwnPropertyDescriptor(item.value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !allowBinary && descriptor.value === undefined) throw problem('invalid-data', 'Background arrays require explicit snapshot values.');
        stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
      continue;
    }
    if (++nodes > maxNodes || item.depth > 48) throw problem('structure-capacity', 'Background input exceeds its structural bound.');
    const input = item.value, type = typeof input;
    if (input === null || type === 'boolean' || type === 'number') { if (type === 'number' && !Number.isFinite(input)) throw problem('invalid-data', 'JSON numbers must be finite.'); bytes += Object.is(input, -0) ? 2 : String(input).length; }
    else if (type === 'string') { if (input.length > Math.min(maxBytes, maxStringBytes)) throw problem('input-capacity', 'Background string exceeds its byte bound.'); bytes += jsonStringBytes(input); }
    else if (type === 'undefined') bytes += 4;
    else if (type !== 'object' || active.has(input)) throw problem('invalid-data', 'Background input must contain only acyclic snapshot data.');
    else if (shared(input)) throw problem('shared-live-input', 'Background jobs require owned snapshot buffers, not shared live memory.');
    else if (allowBinary && (input instanceof ArrayBuffer || ArrayBuffer.isView(input))) { bytes += input.byteLength; binaryBytes += input.byteLength; }
    else {
      if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw problem('invalid-data', 'Unsupported background snapshot object.');
      active.add(input); stack.push({ value: input, leave: true });
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || Object.hasOwn(input, 'toJSON')) throw problem('invalid-data', 'Background arrays cannot define serialization behavior.');
        if (input.length + nodes > maxNodes) throw problem('structure-capacity', 'Background array exceeds its element bound.');
        bytes += Math.max(0, input.length - 1) + 2;
        if (bytes > maxBytes || bytes * 6 + nodes * 32 > estimatedPeakBytes) throw problem('memory-capacity', 'Background array exceeds its admitted representation bound.');
        stack.push({ value: input, depth: item.depth, index: 0, array: true });
        if (++units % 2048 === 0) { guard(signal, current); onProgress({ phase: 'validating-snapshot', completedUnits: units, totalUnits: null }); await yieldControl(); }
        continue;
      }
      const keys = []; for (const key in input) if (Object.hasOwn(input, key)) {
        if (keys.length + nodes >= maxNodes || bytes * 6 + (keys.length + nodes) * 64 > estimatedPeakBytes) throw problem('structure-capacity', 'Background snapshot exceeds its property staging bound.'); keys.push(key);
        if (keys.length % 2048 === 0) { guard(signal, current); await yieldControl(); }
      }
      bytes += Math.max(0, keys.length * 2 - 1) + 2;
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index], descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw problem('invalid-data', 'Background snapshots cannot contain getters.');
        if (key.length > maxStringBytes) throw problem('input-capacity', 'Background property exceeds its byte bound.');
        bytes += jsonStringBytes(key); stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    }
    if (bytes > maxBytes || bytes * 6 + nodes * 32 > estimatedPeakBytes) throw problem('memory-capacity', 'Background input exceeds its admitted representation bound.');
    if (++units % 2048 === 0) { guard(signal, current); onProgress({ phase: 'validating-snapshot', completedUnits: units, totalUnits: null }); await yieldControl(); }
  }
  guard(signal, current); return { bytes, nodes, binaryBytes };
};
