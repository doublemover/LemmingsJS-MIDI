import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';
export const RECOVERY_CHUNK_BYTES = 65536;
export const MAX_RECOVERY_REFERENCES = 12288;
export const recoveryPartCount = bytes => bytes > RECOVERY_CHUNK_BYTES ? Math.ceil(bytes / RECOVERY_CHUNK_BYTES) : 0;
export const recoveryPartKey = (key, index) => `${key}:part:${index}`;
export const recoveryReferenceKeys = ref => [ref.key, ...Array.from({ length: ref.partCount || 0 }, (_, index) => recoveryPartKey(ref.key, index))];

export function* storedRecoveryChunks(chunk) {
  const partCount = recoveryPartCount(chunk.bytes.byteLength);
  if (!partCount) { yield chunk; return; }
  const { bytes, ...metadata } = chunk;
  yield { ...metadata, partCount, storedBytes: bytes.byteLength };
  for (let index = 0; index < partCount; index++) yield { id: recoveryPartKey(chunk.id, index), kind: 'recovery-chunk-part', owner: chunk.id, index,
    bytes: bytes.slice(index * RECOVERY_CHUNK_BYTES, Math.min(bytes.byteLength, (index + 1) * RECOVERY_CHUNK_BYTES)) };
}

export async function readRecoveryChunk(ref, records, { signal, isCurrent = () => true, yieldTask = yieldBackgroundTask } = {}) {
  const page = records.get(ref.key);
  if (!page || page.kind !== 'recovery-chunk' || page.sha256 !== ref.sha256 || page.rawBytes !== ref.rawBytes || page.encoding !== ref.encoding) throw new Error('Recovery chunk metadata differs.');
  if (!ref.partCount) {
    if (page.partCount || !(page.bytes instanceof Uint8Array) || page.bytes.byteLength !== ref.storedBytes) throw new Error('Recovery chunk length differs.');
    return page;
  }
  if (page.bytes != null || page.partCount !== ref.partCount || page.storedBytes !== ref.storedBytes || ref.partCount !== recoveryPartCount(ref.storedBytes) || ref.partCount > 1024) throw new Error('Invalid recovery chunk fragmentation.');
  const parts = [];
  for (let index = 0; index < ref.partCount; index++) {
    signal?.throwIfAborted(); if (!isCurrent()) throw new Error('Recovery source retired while reading parts.');
    const part = records.get(recoveryPartKey(ref.key, index)), expectedBytes = Math.min(RECOVERY_CHUNK_BYTES, ref.storedBytes - index * RECOVERY_CHUNK_BYTES);
    if (!part || part.kind !== 'recovery-chunk-part' || part.owner !== ref.key || part.index !== index || !(part.bytes instanceof Uint8Array) || part.bytes.byteLength !== expectedBytes) throw new Error('Recovery chunk part is missing or differs.');
    parts.push(part.bytes);
    if ((index + 1) % 64 === 0) await yieldTask({ signal });
  }
  return { encoding: page.encoding, sha256: page.sha256, rawBytes: page.rawBytes, storedBytes: page.storedBytes, parts };
}
