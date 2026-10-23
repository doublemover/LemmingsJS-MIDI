const MAX_DEPTH = 48;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const estimateJournalBytes = (value, { maxBytes = 1048576, maxNodes = 200000 } = {}) => {
  let nodes = 0;
  const active = new Set();
  const size = (current, depth) => {
    if (++nodes > maxNodes || depth > MAX_DEPTH) throw new Error('Causal journal structural estimate exceeded.');
    if (current === null) return 4;
    if (typeof current === 'boolean') return 5;
    if (typeof current === 'number') { if (!Number.isFinite(current)) throw new Error('Causal journal numbers must be finite.'); return 32; }
    if (typeof current === 'string') return current.length * 6 + 2;
    if (!current || typeof current !== 'object' || active.has(current) ||
        !Array.isArray(current) && ![Object.prototype, null].includes(Object.getPrototypeOf(current))) throw new Error('Unsupported causal journal estimate.');
    active.add(current);
    let bytes = 2;
    if (Array.isArray(current)) for (const child of current) bytes += 1 + size(child, depth + 1);
    else for (const key of Object.keys(current)) {
      if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe causal journal property.');
      if (current[key] !== undefined) bytes += key.length * 6 + 4 + size(current[key], depth + 1);
    }
    active.delete(current);
    if (bytes > maxBytes * 6) throw new Error('Causal journal estimated byte budget exceeded.');
    return bytes;
  };
  return size(value, 0);
};
const canonicalJournalText = (value, { maxBytes = 1048576, maxNodes = 200000 } = {}) => {
  let nodes = 0;
  const active = new Set();
  const encode = (current, depth) => {
    if (++nodes > maxNodes || depth > MAX_DEPTH) throw new Error('Causal journal data exceeds its structural budget.');
    if (current === null || typeof current === 'boolean') return String(current);
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('Causal journal numbers must be finite.');
      return Object.is(current, -0) ? '-0' : String(current);
    }
    if (typeof current === 'string') {
      if (current.length > maxBytes) throw new Error('Causal journal string exceeds its byte budget.');
      return JSON.stringify(current);
    }
    if (!current || typeof current !== 'object' || active.has(current) ||
        !Array.isArray(current) && ![Object.prototype, null].includes(Object.getPrototypeOf(current))) throw new Error('Unsupported causal journal data.');
    active.add(current);
    let text;
    if (Array.isArray(current)) {
      const items = [];
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(current, index) || current[index] === undefined) throw new Error('Causal journal arrays must have explicit values.');
        items.push(encode(current[index], depth + 1));
      }
      text = '[' + items.join(',') + ']';
    } else {
      const items = [];
      for (const key of Object.keys(current).sort()) {
        if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe causal journal property.');
        if (current[key] !== undefined) items.push(JSON.stringify(key) + ':' + encode(current[key], depth + 1));
      }
      text = '{' + items.join(',') + '}';
    }
    active.delete(current);
    if (text.length > maxBytes) throw new Error('Causal journal record exceeds its byte budget.');
    return text;
  };
  const text = encode(value, 0), bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes) throw new Error('Causal journal record exceeds its byte budget.');
  return { text, bytes };
};
const freezeJournalData = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJournalData(child);
    Object.freeze(value);
  }
  return value;
};
const cloneJournalData = (value, options) => freezeJournalData(JSON.parse(canonicalJournalText(value, options).text));
const hashJournalText = async (text, crypto = globalThis.crypto) => {
  if (!crypto?.subtle?.digest) throw new Error('SHA-256 is unavailable for canonical causal capture.');
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const hashJournalData = (value, options) => hashJournalText(canonicalJournalText(value, options).text);
const journalError = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'CausalJournalError', code, ...detail });

export { canonicalJournalText, estimateJournalBytes, freezeJournalData, cloneJournalData, hashJournalText, hashJournalData, journalError };
