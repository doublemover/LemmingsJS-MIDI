export const PROPERTY_LIMITS = Object.freeze({ wireBytes: 262144, decodedBytes: 524288, headerBytes: 1024, chunks: 512, jsonDepth: 32, jsonItems: 16384 });
const ascii = bytes => { let text = ''; for (let start = 0; start < bytes.length; start += 4096) { const part = bytes.subarray ? bytes.subarray(start, start + 4096) : bytes.slice(start, start + 4096); if ([...part].some(byte => byte > 127)) throw new Error('Property JSON must use ASCII with escaped Unicode'); text += String.fromCharCode(...part); } return text; };
const inspectJson = (value, maximumBytes) => {
  const queue = [[value, 0]], seen = new WeakSet(); let items = 0, estimate = 0;
  while (queue.length) {
    const [node, depth] = queue.pop();
    if (++items > PROPERTY_LIMITS.jsonItems || depth > PROPERTY_LIMITS.jsonDepth) throw new Error('Property JSON depth/item capacity');
    if (typeof node === 'string') estimate += node.length * 2 + 16;
    else if (typeof node === 'number') { if (!Number.isFinite(node)) throw new Error('Non-finite property value'); estimate += 24; }
    else if (node && typeof node === 'object') {
      if (seen.has(node) || !Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) throw new Error('Property values must be plain JSON trees');
      seen.add(node); const entries = Object.entries(node);
      if (entries.length + queue.length + items > PROPERTY_LIMITS.jsonItems) throw new Error('Property JSON item capacity');
      estimate += 32 + entries.length * 16;
      for (const [key, child] of entries) {
        if (['__proto__', 'prototype', 'constructor'].includes(key) || key.length > 256) throw new Error('Unsafe property JSON key');
        estimate += key.length * 2; queue.push([child, depth + 1]);
      }
    } else if (node !== null && typeof node !== 'boolean') throw new Error('Unsupported property JSON value');
    if (estimate > maximumBytes * 8) throw new Error('Property JSON retained-data capacity');
  }
  return { items, retainedEstimate: estimate };
};
const freezeJson = value => {
  const queue = [value];
  while (queue.length) { const node = queue.pop(); if (!node || typeof node !== 'object') continue; for (const child of Object.values(node)) if (child && typeof child === 'object') queue.push(child); Object.freeze(node); }
  return value;
};
export function parsePropertyJson(bytes, maximumBytes = PROPERTY_LIMITS.decodedBytes) {
  if (bytes.length > maximumBytes) throw new Error('Property JSON byte capacity');
  const text = ascii(bytes); let depth = 0, quoted = false, escaped = false, tokens = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === '[' || character === '{') { if (++depth > PROPERTY_LIMITS.jsonDepth) throw new Error('Property JSON depth capacity'); }
    else if (character === ']' || character === '}') depth--;
    else if (character === ',' || character === ':') { if (++tokens > PROPERTY_LIMITS.jsonItems * 2) throw new Error('Property JSON token capacity'); }
  }
  const value = JSON.parse(text), metrics = inspectJson(value, maximumBytes);
  return Object.freeze({ value: freezeJson(value), ...metrics });
}
export function propertyJsonBytes(value, maximumBytes = PROPERTY_LIMITS.decodedBytes) {
  inspectJson(value, maximumBytes);
  const text = JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  if (text.length > maximumBytes) throw new Error('Property JSON byte capacity');
  return new TextEncoder().encode(text);
}
export function encodeMcoded7(bytes) {
  if (bytes.length > PROPERTY_LIMITS.decodedBytes) throw new Error('Property binary byte capacity');
  const output = new Uint8Array(bytes.length + Math.ceil(bytes.length / 7)); let cursor = 0;
  for (let start = 0; start < bytes.length; start += 7) {
    const count = Math.min(7, bytes.length - start), header = cursor++;
    for (let index = 0; index < count; index++) { output[header] |= (bytes[start + index] >> 7) << (6 - index); output[cursor++] = bytes[start + index] & 127; }
  }
  return output;
}
export function decodeMcoded7(bytes) {
  if (bytes.length > PROPERTY_LIMITS.wireBytes || bytes.length % 8 === 1) throw new Error('Malformed or excessive Mcoded7 data');
  const output = new Uint8Array(bytes.length - Math.ceil(bytes.length / 8)); let cursor = 0;
  for (let start = 0; start < bytes.length; start += 8) {
    const count = Math.min(7, bytes.length - start - 1), header = bytes[start];
    if (header > 127 || header & ((1 << (7 - count)) - 1)) throw new Error('Non-canonical Mcoded7 tail');
    for (let index = 0; index < count; index++) { const byte = bytes[start + index + 1]; if (byte > 127) throw new Error('Invalid Mcoded7 data byte'); output[cursor++] = byte | (header >> (6 - index) & 1) << 7; }
  }
  return output;
}
const transform = async (bytes, compress, maximumBytes, signal) => {
  const Constructor = compress ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof Constructor !== 'function') throw new Error('This browser cannot process negotiated zlib properties');
  const reader = new Blob([bytes]).stream().pipeThrough(new Constructor('deflate')).getReader(), chunks = []; let size = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Property data conversion cancelled');
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximumBytes) throw new Error('Property compression/decompression capacity'); chunks.push(value);
    }
    if (signal?.aborted) throw new Error('Property data conversion cancelled');
    const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
};
export async function encodePropertyData(value, { encoding = 'ASCII', binary = false, signal } = {}) {
  if (binary && (!Array.isArray(value) && !ArrayBuffer.isView(value) || !Number.isSafeInteger(value.length) || value.length > PROPERTY_LIMITS.decodedBytes || Array.from(value).some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))) throw new Error('Invalid or excessive binary property data');
  let bytes = binary ? Uint8Array.from(value) : propertyJsonBytes(value);
  if (bytes.length > PROPERTY_LIMITS.decodedBytes) throw new Error('Property data byte capacity');
  if (encoding === 'zlib+Mcoded7') bytes = await transform(bytes, true, PROPERTY_LIMITS.wireBytes, signal);
  if (encoding === 'Mcoded7' || encoding === 'zlib+Mcoded7') bytes = encodeMcoded7(bytes);
  else if (encoding !== 'ASCII' || bytes.some(byte => byte > 127)) throw new Error('Unsupported property encoding');
  if (bytes.length > PROPERTY_LIMITS.wireBytes) throw new Error('Encoded property byte capacity');
  return bytes;
}
export async function decodePropertyData(bytes, { encoding = 'ASCII', mediaType = 'application/json', signal } = {}) {
  if (bytes.length > PROPERTY_LIMITS.wireBytes) throw new Error('Property wire byte capacity');
  let decoded = bytes;
  if (encoding === 'Mcoded7' || encoding === 'zlib+Mcoded7') decoded = decodeMcoded7(bytes);
  else if (encoding !== 'ASCII') throw new Error('Unnegotiated property encoding');
  if (encoding === 'zlib+Mcoded7') decoded = await transform(decoded, false, PROPERTY_LIMITS.decodedBytes, signal);
  if (decoded.length > PROPERTY_LIMITS.decodedBytes) throw new Error('Decoded property byte capacity');
  if (mediaType === 'application/json') return Object.freeze({ ...parsePropertyJson(decoded), mediaType, byteSize: decoded.length });
  if (mediaType === 'text/html' || mediaType.includes('javascript') || mediaType.includes('xml') || mediaType.includes('svg')) throw new Error('Executable device media is unsupported');
  return Object.freeze({ value: Object.freeze(Array.from(decoded)), mediaType, byteSize: decoded.length, retainedEstimate: decoded.length * 8 + 64, interpretation: 'opaque-read-only-bytes' });
}
