import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { generateDeliveryTrace, replayDeliveryTrace, shrinkDeliveryTrace } from './support/export-delivery-model.js';

describe('generated serial-reference export delivery schedules', function() {
  this.timeout(30000);
  for (const seed of [1, 2, 3, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff, 0x80000000, 0xffffffff])
    it('retains exact source ownership after every transition seed=' + seed, async () => {
      const trace = generateDeliveryTrace(seed, { steps: 32 });
      try { const result = await replayDeliveryTrace(trace); expect(result).to.include({ valid: true, transitions: trace.length }); }
      catch (error) { error.message += '\nReplay: ' + JSON.stringify({ schema: 'export-delivery-model/v1', seed, trace: error.modelTrace }); throw error; }
    });
  it('keeps cancel-before-open, late writes and reversed close/abort acknowledgments distinct', async () => {
    for (const kinds of [
      ['start', 'cancel', 'resolve-open', 'resolve-abort'],
      ['start', 'resolve-open', 'cancel', 'resolve-abort', 'resolve-write'],
      ['start', 'resolve-open', 'cancel', 'resolve-write', 'resolve-abort'],
      ['start', 'resolve-open', 'resolve-write', 'cancel', 'resolve-close', 'resolve-abort'],
      ['start', 'resolve-open', 'resolve-write', 'cancel', 'resolve-abort', 'resolve-close'],
      ['start', 'resolve-open', 'resolve-write', 'refuse-close', 'cancel', 'resolve-abort'],
      ['start', 'resolve-open', 'resolve-write', 'reject-close', 'resolve-abort', 'start', 'resolve-open', 'resolve-write', 'resolve-close'],
      ['start', 'reject-open', 'start', 'resolve-open', 'borrow-neighbor', 'expire', 'resolve-abort', 'resolve-write', 'release-neighbor'],
      ['start', 'borrow-neighbor', 'mutate-input', 'resolve-open', 'discard', 'resolve-abort', 'resolve-write', 'release-neighbor']
    ]) expect(await replayDeliveryTrace(kinds.map(kind => ({ kind })))).to.include({ valid: true });
  });
  it('rejects empty or missing-owner schedules instead of accepting invalid shrink candidates', async () => {
    expect(await replayDeliveryTrace([])).to.include({ valid: false });
    expect(await replayDeliveryTrace([{ kind: 'resolve-write' }])).to.include({ valid: false });
    expect(await replayDeliveryTrace([{ kind: 'start' }, { kind: 'resolve-close' }])).to.include({ valid: false });
  });
  it('shrinks a deliberately premature source release into the same replayable ownership failure', async () => {
    const { trace, minimum } = JSON.parse(await readFile(new URL('./fixtures/export-delivery-premature-release.json', import.meta.url)));
    const fails = async candidate => {
      try { await replayDeliveryTrace(candidate, { prematureReleaseOnAbort: true }); return false; }
      catch (error) { if (!error.message.includes('delivery-model:source-lease-count')) throw error; return true; }
    };
    expect(await fails(trace)).to.equal(true); const result = await shrinkDeliveryTrace(trace, fails);
    expect(result.trace).to.deep.equal(minimum); expect(result.attempts).to.be.greaterThan(0);
    expect(await replayDeliveryTrace(result.trace)).to.include({ valid: true });
  });
});
