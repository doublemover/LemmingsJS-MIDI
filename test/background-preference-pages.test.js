import { expect } from 'chai';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { BACKGROUND_JOB_KINDS, BACKGROUND_WORKER_ONLY_JOB_KINDS } from '../js/app/resources/BackgroundJobKinds.js';

const options = { maxBytes: 2 * 1048576, maxNodes: 100000, estimatedPeakBytes: 9 * 1048576, yieldControl: async () => {} };
const failure = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected rejection'); };
describe('bounded preference page worker encoder', () => {
  it('requires a real worker and independently bounds each owned Unicode page', async () => {
    expect(BACKGROUND_JOB_KINDS).to.include('encode-preference-pages'); expect(BACKGROUND_WORKER_ONLY_JOB_KINDS).to.include('encode-preference-pages');
    const values = Array.from({ length: 8 }, (_, index) => ({ name: '音楽é😀', note: index }));
    const result = await runBackgroundJobKernel('encode-preference-pages', values.map(value => ({ value, maxBytes: 1024 })), options);
    expect(result.value.map(JSON.parse)).to.deep.equal(values); expect(result.retainedBytes).to.be.lessThan(options.estimatedPeakBytes);
  });
  for (const value of [[], Array(9).fill({ value: {}, maxBytes: 1024 }), [{ value: {}, maxBytes: 0 }], [{ value: {}, maxBytes: 17 * 1048576 }], [{ value: {}, maxBytes: 1024, extra: true }], [{ value: '音'.repeat(100), maxBytes: 100 }], [{ value: undefined, maxBytes: 1024 }]]) {
    it('refuses malformed, oversized or empty page groups ' + JSON.stringify(value).slice(0, 80), async () => {
      expect(await failure(() => runBackgroundJobKernel('encode-preference-pages', value, options))).to.exist;
    });
  }
  it('rejects accessors before invoking user hooks', async () => {
    let invoked = false; const value = { get note() { invoked = true; return 1; } };
    expect(await failure(() => runBackgroundJobKernel('encode-preference-pages', [{ value, maxBytes: 1024 }], options))).to.exist; expect(invoked).to.equal(false);
  });
});
