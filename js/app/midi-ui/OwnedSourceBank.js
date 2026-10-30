import { OWNED_SOURCE_BANK_IDENTITIES } from './OwnedSourceBankIdentities.js';

export const OWNED_SOURCE_BANK_SCHEMA = 'lemmings-owned-source-bank/v1';
export const CHOIR_HARMONICS = Object.freeze([1, 2, 4, 8, 16, 32, 64, 128]);
export const SPECTRUM_HARMONICS = Object.freeze([1, 2, 4, 8, 16]);
export function getOwnedSourceBankIdentity(id) {
  const identity = Object.hasOwn(OWNED_SOURCE_BANK_IDENTITIES, id) && OWNED_SOURCE_BANK_IDENTITIES[id];
  if (!identity) throw new TypeError('Unknown fixed source bank.');
  return identity;
}
export function validateOwnedSourceBank(bank, id) {
  const expected = getOwnedSourceBankIdentity(id), buffers = new Set();
  if (bank?.schema !== OWNED_SOURCE_BANK_SCHEMA || bank.id !== id || bank.hash !== expected.hash || bank.bytes !== expected.bytes ||
      !Array.isArray(bank.planes) || bank.planes.length !== expected.lengths.length) throw new TypeError('Invalid fixed source bank identity.');
  for (let index = 0; index < expected.lengths.length; index++) {
    const plane = bank.planes[index];
    if (!(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.byteOffset || plane.byteLength !== plane.buffer.byteLength ||
        plane.length !== expected.lengths[index] || buffers.has(plane.buffer)) throw new TypeError('Invalid fixed source bank storage.');
    buffers.add(plane.buffer);
  }
  return bank;
}
