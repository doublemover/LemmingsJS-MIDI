const YIELD_AFTER_MS = 4;
const TEXT_SLICE = 1024;

// The detached recovery snapshot is walked incrementally. This checksum detects
// interrupted or corrupt local writes; it is not an authenticity signature.
export async function checksumProcgenRecovery(value, { signal, now = () => globalThis.performance?.now?.() ?? Date.now(),
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  let first = 0x811c9dc5, second = 0x9e3779b9, visited = 0, sliceStart = now();
  const add = unit => {
    first = Math.imul(first ^ unit, 0x01000193);
    second = Math.imul(second ^ unit, 0x85ebca6b);
  };
  const stack = [{ kind: 'value', value }], active = new WeakSet();
  const text = value => stack.push({ kind: 'text', value: String(value), offset: 0 });
  while (stack.length) {
    if (signal?.aborted) throw Object.assign(new Error('Recovery checksum canceled.'), { name: 'AbortError' });
    const item = stack.pop();
    if (item.kind === 'text') {
      const end = Math.min(item.offset + TEXT_SLICE, item.value.length);
      for (let index = item.offset; index < end; index++) add(item.value.charCodeAt(index));
      if (end < item.value.length) stack.push({ ...item, offset: end });
    } else if (item.kind === 'leave') {
      active.delete(item.value); add(0xff);
    } else if (item.kind === 'array') {
      if (item.index < item.value.length) {
        stack.push({ ...item, index: item.index + 1 });
        if (Object.hasOwn(item.value, item.index)) stack.push({ kind: 'value', value: item.value[item.index] });
        else stack.push({ kind: 'hole' });
      }
    } else if (item.kind === 'hole') add(0xfe);
    else if (item.kind === 'object') {
      if (item.index < item.keys.length) {
        const key = item.keys[item.index];
        stack.push({ ...item, index: item.index + 1 });
        stack.push({ kind: 'value', value: item.value[key] });
        text(key);
      }
    } else if (item.kind === 'bytes') {
      const end = Math.min(item.offset + TEXT_SLICE, item.value.byteLength);
      for (let index = item.offset; index < end; index++) add(item.value[index]);
      if (end < item.value.byteLength) stack.push({ ...item, offset: end });
    } else {
      const current = item.value;
      if (current === null) add(0);
      else if (current === undefined) add(1);
      else if (typeof current === 'boolean') add(current ? 2 : 3);
      else if (typeof current === 'number') { add(4); text(Object.is(current, -0) ? '-0' : String(current)); }
      else if (typeof current === 'string') { add(5); text(current.length); text(current); }
      else if (typeof current === 'object') {
        if (active.has(current)) throw new TypeError('Recovery snapshot contains a cycle.');
        active.add(current); stack.push({ kind: 'leave', value: current });
        if (ArrayBuffer.isView(current)) {
          add(6); text(current.constructor.name); text(current.byteLength);
          stack.push({ kind: 'bytes', value: new Uint8Array(current.buffer, current.byteOffset, current.byteLength), offset: 0 });
        } else if (current instanceof ArrayBuffer) {
          add(9); text(current.byteLength);
          stack.push({ kind: 'bytes', value: new Uint8Array(current), offset: 0 });
        } else if (Array.isArray(current)) {
          add(7); text(current.length); stack.push({ kind: 'array', value: current, index: 0 });
        } else {
          if (![Object.prototype, null].includes(Object.getPrototypeOf(current))) throw new TypeError('Unsupported recovery snapshot object.');
          const keys = Object.keys(current).sort();
          add(8); text(keys.length); stack.push({ kind: 'object', value: current, keys, index: 0 });
        }
      } else throw new TypeError('Unsupported recovery snapshot value.');
    }
    if ((++visited % 64 === 0 || item.kind === 'text' || item.kind === 'bytes') && now() - sliceStart >= YIELD_AFTER_MS) {
      await yieldTask(); sliceStart = now();
    }
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
