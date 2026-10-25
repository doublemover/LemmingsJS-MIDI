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
  if (!page || !['json-utf8-v1', 'gzip-json-v1'].includes(page.encoding) || !(page.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(page.rawBytes) || page.rawBytes < 1 || page.rawBytes > maxBytes || page.bytes.byteLength > maxBytes || !/^[a-f0-9]{64}$/.test(page.sha256 || '')) throw new Error('Invalid recovery page envelope.');
  if (await digest(page.bytes) !== page.sha256) throw new Error('Recovery page checksum differs.'); signal?.throwIfAborted();
  const bytes = page.encoding === 'gzip-json-v1' ? await collect(new Blob([page.bytes]).stream().pipeThrough(new DecompressionStream('gzip')), page.rawBytes, signal) : page.bytes;
  if (bytes.byteLength !== page.rawBytes) throw new Error('Recovery page length differs.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
