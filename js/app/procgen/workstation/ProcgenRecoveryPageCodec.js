import { RECOVERY_CHUNK_BYTES, recoveryPartCount } from './ProcgenRecoveryChunks.js';
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const collect = async (stream, maxBytes, signal) => {
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maxBytes) throw new Error('Recovery page expansion exceeds its declared bound.'); chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
};
export async function encodeProcgenRecoveryPage(value, { maxBytes = 64 * 1048576, signal } = {}) {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  if (raw.byteLength > maxBytes) throw new Error('Recovery page exceeds its encode bound.');
  let bytes = raw, encoding = 'json-utf8-v1';
  if (typeof CompressionStream === 'function') {
    const compressed = await collect(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')), maxBytes + 1048576, signal);
    if (compressed.byteLength < raw.byteLength) { bytes = compressed; encoding = 'gzip-json-v1'; }
  }
  signal?.throwIfAborted(); return { encoding, rawBytes: raw.byteLength, bytes, sha256: await digest(bytes) };
}
export async function decodeProcgenRecoveryPage(page, { maxBytes = 64 * 1048576, signal } = {}) {
  if (!page || !['json-utf8-v1', 'gzip-json-v1'].includes(page.encoding) ||
    !Number.isSafeInteger(page.rawBytes) || page.rawBytes < 1 || page.rawBytes > maxBytes || !/^[a-f0-9]{64}$/.test(page.sha256 || '')) throw new Error('Invalid recovery page envelope.');
  let encoded = page.bytes;
  if (page.parts !== undefined) {
    if (encoded != null || !Number.isSafeInteger(page.storedBytes) || page.storedBytes < 1 || page.storedBytes > maxBytes || !Array.isArray(page.parts) ||
      page.parts.length < 2 || page.parts.length > 1024 || page.parts.length !== recoveryPartCount(page.storedBytes)) throw new Error('Invalid recovery page parts.');
    for (let index = 0; index < page.parts.length; index++) if (!(page.parts[index] instanceof Uint8Array) || page.parts[index].byteLength !== Math.min(RECOVERY_CHUNK_BYTES, page.storedBytes - index * RECOVERY_CHUNK_BYTES)) throw new Error('Recovery page part length differs.');
    signal?.throwIfAborted(); encoded = new Uint8Array(page.storedBytes);
    for (let index = 0; index < page.parts.length; index++) { signal?.throwIfAborted(); encoded.set(page.parts[index], index * RECOVERY_CHUNK_BYTES); }
  }
  if (!(encoded instanceof Uint8Array) || !encoded.byteLength || encoded.byteLength > maxBytes) throw new Error('Invalid recovery page bytes.');
  if (await digest(encoded) !== page.sha256) throw new Error('Recovery page checksum differs.'); signal?.throwIfAborted();
  const bytes = page.encoding === 'gzip-json-v1' ? await collect(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip')), page.rawBytes, signal) : encoded;
  if (bytes.byteLength !== page.rawBytes) throw new Error('Recovery page length differs.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
