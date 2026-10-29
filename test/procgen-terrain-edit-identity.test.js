import { expect } from 'chai';
import { ProcgenTerrainEdits } from '../js/app/procgen/ProcgenTerrainRetention.js';
import { captureTerrainEditIdentity } from '../js/app/procgen/ProcgenTerrainEditIdentity.js';

describe('logical terrain edit identity', () => {
  it('normalizes resident, compressed and raw cold patches without restoring or reordering storage', () => {
    const edits = new ProcgenTerrainEdits(16, 2), sparse = new Uint8Array(16), dense = new Uint8Array(16).fill(2);
    sparse.fill(3, 4, 7); edits.set(9, sparse); edits.set(1, dense); edits.set(5, new Uint8Array(16));
    const before = edits.snapshot(), identity = captureTerrainEditIdentity(edits);
    expect(identity).to.deep.equal({ codec: 'logical-edit-runs-v1', chunkLength: 16, patches: [{ key: 1, runs: [[0, 16, 2]] }, { key: 9, runs: [[4, 3, 3]] }] });
    expect(edits.snapshot()).to.deep.equal(before);
    edits.compactExcept(new Set(), 1); expect(captureTerrainEditIdentity(edits)).to.deep.equal(identity);
    edits.get(9); edits.get(1); expect(captureTerrainEditIdentity(edits)).to.deep.equal(identity);
  });
  it('merges adjacent equal cold runs into the same canonical interval', () => {
    const edits = new ProcgenTerrainEdits(16, 1);
    edits.cold.set(7, { runs: Uint16Array.of(2, 3, 5, 4), values: Uint8Array.of(2, 2), bytes: 10 });
    expect(captureTerrainEditIdentity(edits).patches).to.deep.equal([{ key: 7, runs: [[2, 7, 2]] }]);
  });
  it('uses native map traversal and intrinsic byte lengths without invoking owner hooks', () => {
    const edits = new ProcgenTerrainEdits(16, 1), patch = new Uint8Array(16); patch[2] = 1; edits.set(3, patch);
    const expected = captureTerrainEditIdentity(edits); let touched = 0;
    const getter = () => { touched++; throw new Error('Unexpected query'); };
    for (const map of [edits, edits.cold]) for (const key of ['get', 'entries', 'values', 'keys', Symbol.iterator]) Object.defineProperty(map, key, { get: getter });
    Object.defineProperty(patch, 'length', { get: getter });
    expect(captureTerrainEditIdentity(edits)).to.deep.equal(expected); expect(touched).to.equal(0);
  });
  it('rejects inconsistent raw patches, duplicate keys and malformed cold intervals', () => {
    const invalid = [
      edits => Map.prototype.set.call(edits, 0, new Uint8Array(15)),
      edits => Map.prototype.set.call(edits, -1, new Uint8Array(16)),
      edits => { edits.set(1, new Uint8Array(16)); edits.cold.set(1, { raw: new Uint8Array(16) }); },
      edits => edits.cold.set(0, null),
      edits => edits.cold.set(0, { raw: new Float32Array(16) }),
      edits => edits.cold.set(0, { runs: Uint16Array.of(0, 0), values: Uint8Array.of(2) }),
      edits => edits.cold.set(0, { runs: Uint16Array.of(15, 2), values: Uint8Array.of(2) }),
      edits => edits.cold.set(0, { runs: Uint16Array.of(0, 4, 3, 4), values: Uint8Array.of(2, 3) }),
      edits => edits.cold.set(0, { runs: Uint16Array.of(0, 1), values: Uint8Array.of(0) }),
      edits => edits.cold.set(0, { runs: Uint16Array.of(0), values: Uint8Array.of(1) }),
      edits => edits.cold.set(0, { runs: new DataView(new ArrayBuffer(4)), values: Uint8Array.of(1) })
    ];
    for (const mutate of invalid) {
      const edits = new ProcgenTerrainEdits(16, 1); mutate(edits);
      try { captureTerrainEditIdentity(edits); throw new Error('Unexpected valid edit'); } catch (error) { expect(error.code).to.equal('invalid-terrain-edit-state'); }
    }
  });
  it('refuses accessor-backed owner and cold-record fields without executing them', () => {
    let touched = 0; const getter = () => { touched++; throw new Error('Unexpected accessor'); };
    for (const field of ['chunkLength', 'cold', 'raw', 'runs']) {
      const edits = new ProcgenTerrainEdits(16, 1);
      if (field === 'chunkLength' || field === 'cold') Object.defineProperty(edits, field, { get: getter });
      else { const record = { values: Uint8Array.of(1) }; Object.defineProperty(record, field, { get: getter }); edits.cold.set(0, record); }
      expect(() => captureTerrainEditIdentity(edits)).to.throw('inconsistent');
    }
    expect(touched).to.equal(0);
  });
});
