import { checksumProcgenRecovery } from '../procgen/workstation/ProcgenRecoveryChecksum.js';
import { decodeGroundAssetSnapshot } from './GroundAssetDecode.js';
import { canonicalDataText } from '../../core/CanonicalData.js';

export const BACKGROUND_JOB_PROTOCOL = 1;
export const BACKGROUND_JOB_KINDS = Object.freeze(['parse-json', 'encode-json', 'encode-canonical-json', 'recovery-checksum', 'asset-hash', 'asset-decode']);
const MAX_BYTES = 64 * 1048576, MAX_NODES = 4000000;
const problem = (code, message) => Object.assign(new Error(message), { code, name: 'BackgroundJobError' });
const shared = value => typeof globalThis.SharedArrayBuffer === 'function' && (value instanceof globalThis.SharedArrayBuffer || value?.buffer instanceof globalThis.SharedArrayBuffer);
const encodedLength = text => {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
};
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
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const guard = (signal, current) => { signal?.throwIfAborted(); if (current && !current()) throw problem('stale-owner', 'Background job source ownership changed.'); };
const inspectText = async (text, { maxBytes, maxNodes, estimatedPeakBytes, signal, current, onProgress, yieldControl }) => {
  if (typeof text !== 'string' || text.length > maxBytes) throw problem('input-capacity', 'JSON input exceeds the admitted byte bound.');
  let depth = 0, quoted = false, escaped = false, token = true, nodes = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') { quoted = true; token = false; nodes++; }
    else if (char === '{' || char === '[') { if (++depth > 48) throw problem('structure-capacity', 'JSON exceeds the supported nesting depth.'); token = true; nodes++; }
    else if (char === '}' || char === ']') { depth--; token = false; }
    else if (char === ':' || char === ',') token = true;
    else if (char !== ' ' && char !== '\n' && char !== '\t' && char !== '\r' && token) { token = false; nodes++; }
    if (nodes > maxNodes || text.length * 8 + nodes * 32 > estimatedPeakBytes) throw problem('memory-capacity', 'JSON structure exceeds its admitted memory estimate.');
    if ((index & 65535) === 65535) { guard(signal, current); onProgress({ phase: 'validating-json', completedUnits: index + 1, totalUnits: text.length }); await yieldControl(); }
  }
  guard(signal, current);
  const bytes = encodedLength(text); if (bytes > maxBytes) throw problem('input-capacity', 'JSON UTF-8 input exceeds the admitted byte bound.');
  return { bytes, nodes };
};
const inspectValue = async (value, { maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, signal, current, onProgress, yieldControl }, { allowBinary = false } = {}) => {
  const stack = [{ value, depth: 0 }], active = new WeakSet(); let units = 0, bytes = 0, nodes = 0;
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
    if (input === null || type === 'boolean' || type === 'number') { if (type === 'number' && !Number.isFinite(input)) throw problem('invalid-data', 'JSON numbers must be finite.'); bytes += String(input).length; }
    else if (type === 'string') { if (input.length > Math.min(maxBytes, maxStringBytes)) throw problem('input-capacity', 'Background string exceeds its byte bound.'); bytes += jsonStringBytes(input); }
    else if (type === 'undefined') bytes += 4;
    else if (type !== 'object' || active.has(input)) throw problem('invalid-data', 'Background input must contain only acyclic snapshot data.');
    else if (shared(input)) throw problem('shared-live-input', 'Background jobs require owned snapshot buffers, not shared live memory.');
    else if (allowBinary && (input instanceof ArrayBuffer || ArrayBuffer.isView(input))) bytes += input.byteLength;
    else {
      if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw problem('invalid-data', 'Unsupported background snapshot object.');
      active.add(input); stack.push({ value: input, leave: true });
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || Object.hasOwn(input, 'toJSON')) throw problem('invalid-data', 'Background arrays cannot define serialization behavior.');
        if (input.length + nodes > maxNodes) throw problem('structure-capacity', 'Background array exceeds its element bound.');
        bytes += input.length + 2;
        if (bytes > maxBytes || bytes * 6 + nodes * 32 > estimatedPeakBytes) throw problem('memory-capacity', 'Background array exceeds its admitted representation bound.');
        stack.push({ value: input, depth: item.depth, index: 0, array: true });
        if (++units % 2048 === 0) { guard(signal, current); onProgress({ phase: 'validating-snapshot', completedUnits: units, totalUnits: null }); await yieldControl(); }
        continue;
      }
      const keys = []; for (const key in input) if (Object.hasOwn(input, key)) {
        if (keys.length + nodes >= maxNodes || bytes * 6 + (keys.length + nodes) * 64 > estimatedPeakBytes) throw problem('structure-capacity', 'Background snapshot exceeds its property staging bound.'); keys.push(key);
        if (keys.length % 2048 === 0) { guard(signal, current); await yieldControl(); }
      }
      bytes += keys.length * 4 + 2;
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
  guard(signal, current); return { bytes, nodes };
};

export async function runBackgroundJobKernel(kind, input, { signal, current, maxBytes = MAX_BYTES, estimatedPeakBytes,
  maxNodes = MAX_NODES, maxStringBytes = MAX_BYTES, maxDecodedBytes, crypto = globalThis.crypto, onProgress = () => {}, yieldControl = yieldTask, expectedInputHash = null } = {}) {
  if (!BACKGROUND_JOB_KINDS.includes(kind) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES ||
      !Number.isSafeInteger(maxStringBytes) || maxStringBytes < 1 || maxStringBytes > MAX_BYTES ||
      expectedInputHash != null && !/^[a-f0-9]{64}$/.test(expectedInputHash)) throw problem('invalid-contract', 'Unsupported background job kernel contract.');
  guard(signal, current);
  if (kind === 'asset-decode') return decodeGroundAssetSnapshot(input, { signal, current, maxBytes, estimatedPeakBytes, maxDecodedBytes, crypto, onProgress, yieldControl });
  if (expectedInputHash != null || kind === 'asset-hash') {
    if (shared(input)) throw problem('shared-live-input', 'Background hash input cannot refer to shared live memory.');
    if (typeof input !== 'string' && !(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) throw problem('invalid-data', 'Hash jobs require immutable byte or text input.');
    const count = typeof input === 'string' ? encodedLength(input) : input.byteLength;
    if (count > maxBytes || count * 6 > estimatedPeakBytes) throw problem('memory-capacity', 'Hash input exceeds the admitted byte bound.');
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const result = await crypto.subtle.digest('SHA-256', bytes); guard(signal, current);
    const hash = [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (expectedInputHash != null && expectedInputHash !== hash) throw problem('content-mismatch', 'Background job input differs from its content reference.');
    if (kind === 'asset-hash') return { value: hash, inputBytes: count, nodes: 1 };
  }
  const options = { maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, signal, current, onProgress, yieldControl };
  if (kind === 'parse-json') {
    const metadata = await inspectText(input, options); guard(signal, current);
    const value = JSON.parse(input); guard(signal, current); return { value, inputBytes: metadata.bytes, nodes: metadata.nodes };
  }
  const metadata = await inspectValue(input, options, { allowBinary: kind === 'recovery-checksum' });
  if (kind === 'recovery-checksum') return { value: await checksumProcgenRecovery(input, { signal, yieldTask: yieldControl }), inputBytes: metadata.bytes, nodes: metadata.nodes };
  const value = kind === 'encode-canonical-json' ? canonicalDataText(input, { maxBytes, maxNodes }).text : JSON.stringify(input); guard(signal, current);
  if (typeof value !== 'string' || encodedLength(value) > maxBytes) throw problem('output-capacity', 'Encoded background result exceeds its byte bound.');
  return { value, inputBytes: metadata.bytes, nodes: metadata.nodes };
}
