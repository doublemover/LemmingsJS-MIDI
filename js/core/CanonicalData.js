const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ownedFrozenGraphs = new WeakSet();
const plain = value => Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ownValue = (value, key, domain) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error(domain + ' requires own data properties.');
  return descriptor.value;
};

export function canonicalDataText(value, { maxBytes = 1048576, maxNodes = 200000, domain = 'Canonical data' } = {}) {
  let nodes = 0;
  const active = new Set();
  const quote = current => {
    if (current.length * 6 + 2 <= maxBytes) return JSON.stringify(current);
    let length = 2;
    for (let index = 0; index < current.length; index++) {
      const code = current.charCodeAt(index), next = current.charCodeAt(index + 1);
      length += code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : code < 32 || code >= 0xdc00 && code <= 0xdfff ||
        code >= 0xd800 && code <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff) ? 6 : 1;
      if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { length++; index++; }
      if (length > maxBytes) throw new Error(domain + ' string exceeds its byte budget.');
    }
    return JSON.stringify(current);
  };
  const encode = (current, depth) => {
    if (++nodes > maxNodes || depth > 48) throw new Error(domain + ' exceeds its structural budget.');
    if (current === null || typeof current === 'boolean') return String(current);
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error(domain + ' numbers must be finite.');
      return Object.is(current, -0) ? '-0' : String(current);
    }
    if (typeof current === 'string') {
      if (current.length > maxBytes) throw new Error(domain + ' string exceeds its byte budget.');
      return quote(current);
    }
    if (!current || typeof current !== 'object' || active.has(current) || !plain(current)) throw new Error('Unsupported ' + domain.toLowerCase() + '.');
    active.add(current);
    const items = []; let length = 2;
    const append = item => {
      length += item.length + (items.length ? 1 : 0);
      if (length > maxBytes) throw new Error(domain + ' record exceeds its byte budget.');
      items.push(item);
    };
    if (Array.isArray(current)) {
      if (current.length + nodes > maxNodes) throw new Error(domain + ' exceeds its structural budget.');
      for (let index = 0; index < current.length; index++) {
        const child = ownValue(current, index, domain);
        if (child === undefined) throw new Error(domain + ' arrays must have explicit values.');
        append(encode(child, depth + 1));
      }
    } else {
      const keys = [];
      for (const key in current) if (Object.hasOwn(current, key)) {
        if (keys.length + nodes >= maxNodes) throw new Error(domain + ' exceeds its structural budget.');
        keys.push(key);
      }
      for (const key of keys.sort()) {
        if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe ' + domain.toLowerCase() + ' property.');
        const child = ownValue(current, key, domain);
        if (child !== undefined) append(quote(key) + ':' + encode(child, depth + 1));
      }
    }
    active.delete(current);
    const text = Array.isArray(current) ? '[' + items.join(',') + ']' : '{' + items.join(',') + '}';
    if (text.length > maxBytes) throw new Error(domain + ' record exceeds its byte budget.');
    return text;
  };
  const text = encode(value, 0), bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes) throw new Error(domain + ' record exceeds its byte budget.');
  return { text, bytes, nodes };
}

export const freezeData = value => {
  if (value && typeof value === 'object' && !ownedFrozenGraphs.has(value)) {
    for (const child of Object.values(value)) freezeData(child); Object.freeze(value); ownedFrozenGraphs.add(value);
  }
  return value;
};
export const cloneData = (value, options) => freezeData(JSON.parse(canonicalDataText(value, options).text));
export const hashDataText = async (text, crypto = globalThis.crypto) => {
  if (!crypto?.subtle?.digest) throw new Error('SHA-256 is unavailable for canonical data.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
export const hashData = (value, options) => hashDataText(canonicalDataText(value, options).text);
