import { canonicalDataText, freezeData, cloneData, hashDataText } from '../../../core/CanonicalData.js';

const MAX_DEPTH = 48;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const estimateJournalBytes = (value, { maxBytes = 1048576, maxNodes = 200000 } = {}, inventory = null) => {
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
  const bytes = size(value, 0); if (inventory) inventory.nodes = nodes; return bytes;
};
const estimateJournalFootprint = (value, options) => { const inventory = { nodes: 0 }, bytes = estimateJournalBytes(value, options, inventory); return { bytes, nodes: inventory.nodes }; };
const canonicalJournalText = (value, options) => canonicalDataText(value, { ...options, domain: 'Causal journal' });
const freezeJournalData = freezeData;
const cloneJournalData = (value, options) => cloneData(value, { ...options, domain: 'Causal journal' });
const hashJournalText = async (text, crypto = globalThis.crypto) => {
  if (!crypto?.subtle?.digest) throw new Error('SHA-256 is unavailable for canonical causal capture.');
  return hashDataText(text, crypto);
};
const hashJournalData = (value, options) => hashJournalText(canonicalJournalText(value, options).text);
const journalError = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'CausalJournalError', code, ...detail });

export { canonicalJournalText, estimateJournalBytes, estimateJournalFootprint, freezeJournalData, cloneJournalData, hashJournalText, hashJournalData, journalError };
