import { getOwnedSourceBankIdentity, OWNED_SOURCE_BANK_SCHEMA } from '../midi-ui/OwnedSourceBank.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'BackgroundJobError', code });
export async function computeOwnedSourceBank(id, { signal, current = () => true, crypto = globalThis.crypto, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) throw failure('stale-owner', 'Fixed bank source changed.'); };
  const expected = getOwnedSourceBankIdentity(id); check();
  const { createOwnedSourceBankPlanes } = await import('./OwnedSourceBankData.js'); check();
  const planes = createOwnedSourceBankPlanes(id), encoded = new Uint8Array(expected.bytes), view = new DataView(encoded.buffer); let offset = 0;
  for (const plane of planes) for (let index = 0; index < plane.length; index++) {
    if (!Number.isFinite(plane[index]) || Math.abs(plane[index]) > 2) throw failure('invalid-data', 'Invalid fixed source bank value.');
    view.setFloat32(offset, plane[index], true); offset += 4;
    if ((index & 16383) === 16383) { check(); await yieldControl(); }
  }
  const digest = await crypto.subtle.digest('SHA-256', encoded); check();
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (offset !== expected.bytes || hash !== expected.hash) throw failure('content-mismatch', 'Fixed source bank differs from its build identity.');
  return { schema: OWNED_SOURCE_BANK_SCHEMA, id, hash, bytes: expected.bytes, planes };
}
