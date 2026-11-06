import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
export const OWNED_STATE_BUNDLE_ABI = 'owned-state-bundle-le-v1';
export const OWNED_STATE_BUNDLE_HEADER = 32768;
const MAX_BYTES = 96 * 1048576, MAGIC = 'LMSTATE1';
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'incompatible-owned-state-bundle' }); };
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) { let value = index; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); crcTable[index] = value >>> 0; }
const checksum = bytes => { let value = 0xffffffff; for (let index = 0; index < bytes.length; index++) value = value >>> 8 ^ crcTable[(value ^ (index >= 24 && index < 28 ? 0 : bytes[index])) & 255]; return (value ^ 0xffffffff) >>> 0; };
const owned = bytes => bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer && !bytes.byteOffset && bytes.length === bytes.buffer.byteLength;
const shape = components => {
  if (!Array.isArray(components) || components.length > 512 || components.some(row => typeof row?.key !== 'string' || !row.key || row.key.length > 256 || !owned(row.bytes)) || new Set(components.map(row => row.key)).size !== components.length) fail('State components require unique bounded identities and independent transfer buffers.');
  const bytes = OWNED_STATE_BUNDLE_HEADER + components.reduce((sum, row) => sum + row.bytes.length, 0);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES) fail('Combined state exceeds its bounded transfer profile.'); return bytes;
};
export function writeOwnedStateBundle(destination, { identity, frontier, components }) {
  const length = shape(components);
  if (!owned(destination) || destination.length !== length || components.some(row => row.bytes.buffer === destination.buffer)) fail('State bundle requires exclusive exact-sized storage.');
  const header = canonicalDataText({ abi: OWNED_STATE_BUNDLE_ABI, identity, frontier, components: components.map(row => ({ key: row.key, bytes: row.bytes.length })) }, { maxBytes: OWNED_STATE_BUNDLE_HEADER - 64, maxNodes: 16384 }).text.replace(/[\u007f-\uffff]/g, value => '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0'));
  if (header.length > OWNED_STATE_BUNDLE_HEADER - 64) fail('Combined state frontier exceeds its fixed header.');
  destination.fill(0); const view = new DataView(destination.buffer);
  for (let index = 0; index < MAGIC.length; index++) destination[index] = MAGIC.charCodeAt(index);
  view.setUint32(8, 1, true); view.setUint32(12, header.length, true); view.setUint32(16, length, true); view.setUint32(20, components.length, true);
  for (let index = 0; index < header.length; index++) destination[64 + index] = header.charCodeAt(index);
  let offset = OWNED_STATE_BUNDLE_HEADER; for (const row of components) { destination.set(row.bytes, offset); offset += row.bytes.length; }
  view.setUint32(24, checksum(destination), true);
  return Object.freeze({ abi: OWNED_STATE_BUNDLE_ABI, bytes: length, components: components.length });
}
export function readOwnedStateBundle(bytes, identity, expectedKeys) {
  if (!owned(bytes) || bytes.length < OWNED_STATE_BUNDLE_HEADER || bytes.length > MAX_BYTES || !Array.isArray(expectedKeys) || expectedKeys.length > 512) fail('Invalid owned state bundle capacity.');
  const view = new DataView(bytes.buffer), length = view.getUint32(12, true), count = view.getUint32(20, true);
  if ([...MAGIC].some((value, index) => bytes[index] !== value.charCodeAt(0)) || view.getUint32(8, true) !== 1 || !length || length > OWNED_STATE_BUNDLE_HEADER - 64 || view.getUint32(16, true) !== bytes.length || count !== expectedKeys.length || view.getUint32(24, true) !== checksum(bytes)) fail('State bundle header, extent or checksum differs.');
  for (let index = 28; index < 64; index++) if (bytes[index]) fail('Noncanonical reserved state header.');
  for (let index = 64 + length; index < OWNED_STATE_BUNDLE_HEADER; index++) if (bytes[index]) fail('Noncanonical state header padding.');
  let text = ''; for (let index = 64; index < 64 + length; index++) { if (bytes[index] < 32 || bytes[index] > 126) fail('Invalid state header encoding.'); text += String.fromCharCode(bytes[index]); }
  const header = JSON.parse(text);
  if (header.abi !== OWNED_STATE_BUNDLE_ABI || canonicalDataText(header.identity).text !== canonicalDataText(identity).text || !Array.isArray(header.components) || header.components.length !== count || header.components.some((row, index) => row?.key !== expectedKeys[index] || !Number.isSafeInteger(row.bytes) || row.bytes < 0)) fail('State bundle belongs to another engine, graph, rate or component inventory.');
  if (OWNED_STATE_BUNDLE_HEADER + header.components.reduce((sum, row) => sum + row.bytes, 0) !== bytes.length) fail('State component extents disagree.');
  canonicalDataText(header.frontier, { maxBytes: OWNED_STATE_BUNDLE_HEADER - 64, maxNodes: 16384 });
  let offset = OWNED_STATE_BUNDLE_HEADER;
  const components = header.components.map(row => { const result = { key: row.key, bytes: bytes.slice(offset, offset + row.bytes) }; offset += row.bytes; return result; });
  return Object.freeze({ frontier: freezeData(header.frontier), components: Object.freeze(components) });
}
export const ownedStateTransferBytes = kernel => {
  const length = typeof kernel.stateByteLength === 'function' ? kernel.stateByteLength() : kernel.stateByteLength ?? kernel.snapshotBytes;
  if (!Number.isSafeInteger(length) || length < 1 || length > 64 * 1048576 || typeof kernel.snapshotInto !== 'function' || typeof kernel.restoreFrom !== 'function') fail('An owned component lacks its exact state transfer adapter.');
  return length;
};
