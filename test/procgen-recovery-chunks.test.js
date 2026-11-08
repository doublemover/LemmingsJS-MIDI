import { expect } from 'chai';
import { storedRecoveryChunks, readRecoveryChunk, recoveryReferenceKeys, RECOVERY_CHUNK_BYTES } from '../js/app/procgen/workstation/ProcgenRecoveryChunks.js';
import { decodeProcgenRecoveryPage } from '../js/app/procgen/workstation/ProcgenRecoveryPageCodec.js';

const fixture = async () => {
  const value = { text: 'x'.repeat(RECOVERY_CHUNK_BYTES * 2 + 17) }, bytes = new TextEncoder().encode(JSON.stringify(value));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  const page = { id: 'recovery:chunk:large', kind: 'recovery-chunk', encoding: 'json-utf8-v1', rawBytes: bytes.length, bytes, sha256 };
  const ref = { key: page.id, encoding: page.encoding, rawBytes: bytes.length, storedBytes: bytes.length, sha256, partCount: 3 };
  return { value, page, ref, records: new Map([...storedRecoveryChunks(page)].map(record => [record.id, record])) };
};
describe('bounded physical recovery storage', () => {
  it('copies only exact owned slabs, preserves source bytes and assembles inside the decoder', async () => {
    const { value, page, ref, records } = await fixture();
    expect([...records.keys()]).to.deep.equal(recoveryReferenceKeys(ref)); expect(records.get(ref.key).bytes).to.equal(undefined);
    for (const record of [...records.values()].slice(1)) { expect(record.bytes.length).to.be.at.most(RECOVERY_CHUNK_BYTES); expect(record.bytes.buffer.byteLength).to.equal(record.bytes.length); expect(record.bytes.buffer).not.to.equal(page.bytes.buffer); }
    const encoded = await readRecoveryChunk(ref, records); expect(encoded.bytes).to.equal(undefined); expect(await decodeProcgenRecoveryPage(encoded)).to.deep.equal(value);
  });
  it('rejects missing, reordered, truncated, corrupt and ambiguous binary parts', async () => {
    const { ref, records } = await fixture(), keys = recoveryReferenceKeys(ref);
    const missing = new Map(records); missing.delete(keys[2]); let failure;
    try { await readRecoveryChunk(ref, missing); } catch (error) { failure = error; } expect(failure).to.exist;
    const page = await readRecoveryChunk(ref, records);
    for (const changed of [{ ...page, parts: [...page.parts].reverse() }, { ...page, parts: page.parts.slice(1) }, { ...page, bytes: new Uint8Array(1) }, { ...page, parts: page.parts.map((part, index) => { const copy = part.slice(); if (!index) copy[0] ^= 1; return copy; }) }]) {
      failure = null; try { await decodeProcgenRecoveryPage(changed); } catch (error) { failure = error; } expect(failure).to.exist;
    }
  });
  it('keeps old small single-record chunks compatible and stops canceled part assembly', async () => {
    const { ref, records } = await fixture(), controller = new AbortController(); controller.abort(new Error('retired'));
    let failure; try { await readRecoveryChunk(ref, records, { signal: controller.signal }); } catch (error) { failure = error; } expect(failure.message).to.equal('retired');
    const small = { id: 'recovery:chunk:small', bytes: new Uint8Array(3) }; expect([...storedRecoveryChunks(small)]).to.deep.equal([small]);
  });
});
