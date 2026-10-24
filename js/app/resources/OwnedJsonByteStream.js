const own = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('JSON streaming requires owned data properties.'); return descriptor.value;
};
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

export async function* encodeOwnedJsonLine(value, { maxBytes = 96 * 1048576, maxNodes = 400000, signal, yieldControl = yieldTask } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1048576 || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 4000000 || typeof yieldControl !== 'function')
    throw new TypeError('Invalid JSON streaming bounds.');
  const active = new Set(), encoder = new TextEncoder(); let nodes = 0, outputBytes = 0, buffer = '', units = 0, emitted = 0;
  const string = function*(text) {
    if (text.length > maxBytes) throw new RangeError('JSON stream string exceeds its byte bound.'); yield '"';
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 2048);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const quoted = JSON.stringify(text.slice(offset, end)); yield quoted.slice(1, -1); offset = end;
    }
    yield '"';
  };
  const render = function*(current, depth) {
    if (++nodes > maxNodes || depth > 48) throw new RangeError('JSON stream exceeds its structural bound.');
    if (current === null || typeof current === 'boolean') { yield String(current); return; }
    if (typeof current === 'number') { if (!Number.isFinite(current)) throw new TypeError('JSON stream numbers must be finite.'); yield Object.is(current, -0) ? '-0' : String(current); return; }
    if (typeof current === 'string') { yield* string(current); return; }
    if (!current || typeof current !== 'object' || active.has(current) || !Object.isFrozen(current) ||
        (Array.isArray(current) ? Object.getPrototypeOf(current) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(current))))
      throw new TypeError('JSON streaming requires a frozen, acyclic, owned data snapshot.');
    active.add(current);
    if (Array.isArray(current)) {
      if (current.length + nodes > maxNodes) throw new RangeError('JSON stream array exceeds its structural bound.'); yield '[';
      for (let index = 0; index < current.length; index++) { if (index) yield ','; yield* render(own(current, index), depth + 1); } yield ']';
    } else {
      let first = true; yield '{';
      for (const key in current) if (Object.hasOwn(current, key)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe JSON stream property.');
        const child = own(current, key); if (child === undefined) continue;
        if (!first) yield ','; first = false; yield* string(key); yield ':'; yield* render(child, depth + 1);
      }
      yield '}';
    }
    active.delete(current);
  };
  const bytes = text => {
    const encoded = encoder.encode(text); outputBytes += encoded.byteLength;
    if (outputBytes > maxBytes) throw new RangeError('JSON stream output exceeds its byte bound.'); return encoded;
  };
  for (const text of render(value, 0)) {
    signal?.throwIfAborted();
    if (buffer.length + text.length > 16384) { if (buffer) { yield bytes(buffer); emitted++; } buffer = ''; }
    buffer += text;
    if (++units % 2048 === 0 || emitted >= 16) { signal?.throwIfAborted(); await yieldControl(); emitted = 0; }
  }
  buffer += '\n'; if (buffer) yield bytes(buffer);
}
