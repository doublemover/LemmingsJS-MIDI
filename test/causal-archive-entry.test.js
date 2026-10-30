import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { canonicalJournalText } from '../js/app/procgen/workstation/CausalJournalCanonical.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const fixture = () => {
  const canonical = canonicalJournalText({ version: 1, takeId: 'take:entry', ordinal: 0, firstSequence: 1, lastSequence: 1, previousHash: 'a'.repeat(64),
    records: [{ sequence: 1, kind: 'marker', tick: 4, generation: 2, text: 'A real record 😀' }] }).text;
  return { kind: 'chunk', canonical, ref: { id: 'chunk:entry', takeId: 'take:entry', ordinal: 0, firstSequence: 1, lastSequence: 1,
    firstTick: 4, lastTick: 4, generations: [2], kinds: ['marker'], bytes: Buffer.byteLength(canonical), hash: digest(canonical) } };
};
const inspect = entry => runBackgroundJobKernel('inspect-causal-archive-entry', JSON.stringify(entry), { maxBytes: 1048576, estimatedPeakBytes: 8 * 1048576 });
describe('admitted causal archive record inspection', () => {
  it('verifies canonical source bytes and returns only bounded sequence metadata', async () => {
    const input = fixture(), result = await inspect(input);
    expect(result.value).to.deep.equal({ kind: 'chunk', ref: input.ref, body: { firstSequence: 1, lastSequence: 1, previousHash: 'a'.repeat(64) } });
    expect(result.value).not.to.have.property('canonical'); expect(result.retainedBytes).to.be.lessThan(16384);
  });
  it('rejects inconsistent source bytes, byte inventories and record indexes', async () => {
    for (const change of [entry => { entry.canonical += ' '; }, entry => { entry.ref.bytes++; }, entry => { entry.ref.firstTick++; }]) {
      const input = fixture(); change(input); let error;
      try { await inspect(input); } catch (failure) { error = failure; }
      expect(error).to.be.instanceOf(Error);
    }
  });
  it('does not carry unrelated fields or unverified large canonical records to the UI', async () => {
    const input = fixture(); input.privateProject = { hidden: true }; let error;
    try { await inspect(input); } catch (failure) { error = failure; }
    expect(error.message).to.include('unsupported fields');
    const checkpoint = { kind: 'checkpoint', canonical: '{"world":{"seed":42}}', ref: { id: 'checkpoint:entry' } };
    checkpoint.ref.hash = digest(checkpoint.canonical);
    expect((await inspect(checkpoint)).value).to.deep.equal({ kind: 'checkpoint', ref: checkpoint.ref });
  });
});
