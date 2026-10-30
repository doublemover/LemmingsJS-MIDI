import { MAX_OWNED_PCM_BYTES, MAX_OWNED_PCM_BANKS, validOwnedPcmDescriptor, validOwnedPcmPlanes, validOwnedPcmSetDescriptor } from '../../midi/content/OwnedPcmFormat.js';
import { verifyOwnedPcmPayload } from './OwnedPcmVerification.js';
import { hashData, freezeData, canonicalDataText } from '../../core/CanonicalData.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'CausalRenderError', code: 'pcm-set-identity-mismatch' }); };
export async function createOwnedPcmSetDescriptor(banks, { signal } = {}) {
  if (!Array.isArray(banks) || !banks.length || banks.length > MAX_OWNED_PCM_BANKS || banks.some(value => !validOwnedPcmDescriptor(value))) fail('PCM set requires complete immutable bank descriptors.');
  banks = [...banks].sort((a, b) => a.assetHash < b.assetHash ? -1 : a.assetHash > b.assetHash ? 1 : 0);
  const bytes = banks.reduce((sum, bank) => sum + bank.bytes, 0); if (bytes > MAX_OWNED_PCM_BYTES || new Set(banks.map(bank => bank.assetHash)).size !== banks.length) fail('PCM set contains duplicate assets or exceeds aggregate storage.');
  signal?.throwIfAborted(); const pcmHash = await hashData(banks.map(bank => ({ assetHash: bank.assetHash, pcmHash: bank.pcmHash })), { maxBytes: 131072, maxNodes: 8192 }); signal?.throwIfAborted();
  const fields = { schema: 'lemmings-owned-pcm-set/v1', banks, assetHashes: banks.map(bank => bank.assetHash), bytes, pcmHash }, bankHash = await hashData(fields, { maxBytes: 131072, maxNodes: 8192 }); signal?.throwIfAborted();
  return freezeData({ ...fields, bankHash });
}
export async function verifyOwnedPcmSetPayload(payload, expectedRefs, options = {}) {
  const descriptor = payload?.descriptor;
  if (!validOwnedPcmSetDescriptor(descriptor) || !Array.isArray(payload.banks) || payload.banks.length !== descriptor.banks.length || !Array.isArray(expectedRefs) || !expectedRefs.length || expectedRefs.length > MAX_OWNED_PCM_BANKS || expectedRefs.some(ref => !/^[a-f0-9]{64}$/.test(ref?.sha256))) fail('Owned sample rendering requires its exact complete PCM set.');
  const refs = new Map(expectedRefs.map(ref => [ref.sha256, ref]));
  if (refs.size !== descriptor.banks.length || descriptor.assetHashes.some(hash => !refs.has(hash))) fail('PCM set differs from the patch asset inventory.');
  let actualBytes = 0; const buffers = new Set();
  for (const bank of payload.banks) {
    if (!validOwnedPcmPlanes(bank?.planes, bank?.descriptor, buffers)) fail('Invalid PCM set plane inventory.');
    const owned = new Set();
    for (const plane of bank.planes) { if (!(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || buffers.has(plane.buffer)) fail('PCM set banks require independently owned buffers.'); owned.add(plane.buffer); actualBytes += plane.byteLength; }
    for (const buffer of owned) buffers.add(buffer);
  }
  if (actualBytes !== descriptor.bytes || actualBytes > MAX_OWNED_PCM_BYTES) fail('Actual PCM planes exceed the admitted set.');
  const banks = [];
  for (let index = 0; index < payload.banks.length; index++) { const bank = payload.banks[index]; if (bank?.descriptor?.assetHash !== descriptor.assetHashes[index]) fail('PCM set order differs from its asset indices.');
    const verified = await verifyOwnedPcmPayload(bank, refs.get(bank.descriptor.assetHash), options); if (canonicalDataText(verified.descriptor).text !== canonicalDataText(descriptor.banks[index]).text) fail('PCM set bank metadata changed.'); banks.push(verified);
  }
  const expected = await createOwnedPcmSetDescriptor(banks.map(bank => bank.descriptor), options); if (canonicalDataText(expected).text !== canonicalDataText(descriptor).text) fail('PCM set identity differs from its complete decoded material.');
  return Object.freeze({ descriptor: expected, banks: Object.freeze(banks) });
}
