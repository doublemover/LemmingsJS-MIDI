import { expect } from 'chai';
import { runCanonicalSnapshotKernel } from '../js/app/resources/CanonicalSnapshotKernel.js';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
const limits = { maxBytes: 1048576, maxNodes: 100000, estimatedPeakBytes: 16 * 1048576 };
const reject = async (input, options, code) => { let failure; try { await runCanonicalSnapshotKernel('snapshot-canonical-data', input, { ...limits, ...options }); } catch (error) { failure = error; } expect(failure?.code).to.equal(code); };
describe('isolated canonical snapshot worker kernel', () => {
  it('owns an independent canonical snapshot with unchanged public accounting', async () => {
    const input = { z: ['Å', 42, null, false], a: { nested: true } };
    const result = await runCanonicalSnapshotKernel('snapshot-canonical-data', input, limits);
    expect(result.value).to.deep.equal(input); expect(result.value).not.to.equal(input); expect(result.value.z).not.to.equal(input.z);
    expect(result).to.deep.equal(await runBackgroundJobKernel('snapshot-canonical-data', input, limits));
    input.a.nested = false; expect(result.value.a.nested).to.equal(true); expect(result.inputBytes).to.be.greaterThan(30);
  });
  it('rejects getters without invoking them and refuses binary or shared live state', async () => {
    let reads = 0; const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { reads++; return 1; } });
    await reject(getter, {}, 'invalid-data'); expect(reads).to.equal(0);
    await reject({ bytes: new Uint8Array(4) }, {}, 'invalid-data');
    if (typeof SharedArrayBuffer === 'function') await reject({ bytes: new SharedArrayBuffer(4) }, {}, 'shared-live-input');
  });
  it('enforces finite, acyclic, bounded snapshot data and the clone overlap', async () => {
    const cycle = {}; cycle.self = cycle; await reject(cycle, {}, 'invalid-data'); await reject({ n: NaN }, {}, 'invalid-data');
    await reject({ text: 'x'.repeat(10000) }, { maxBytes: 128 }, 'input-capacity');
    await reject(Array(40).fill(1), { estimatedPeakBytes: 4096 }, 'memory-capacity');
  });
  it('checks source ownership before validation and after cooperative work', async () => {
    await reject({}, { current: () => false }, 'stale-owner');
    let current = true, yields = 0;
    await reject(Array.from({ length: 5000 }, (_, i) => i), { current: () => current, yieldControl: async () => { yields++; current = false; } }, 'stale-owner');
    expect(yields).to.equal(1);
  });
  it('preserves cancellation and validates its direct worker contract', async () => {
    const controller = new AbortController(), reason = new Error('owned cancellation'); controller.abort(reason);
    let failure; try { await runCanonicalSnapshotKernel('snapshot-canonical-data', {}, { ...limits, signal: controller.signal }); } catch (error) { failure = error; } expect(failure).to.equal(reason);
    for (const options of [{ maxNodes: 0 }, { estimatedPeakBytes: 1024 }, { maxBytes: 67108865 }, { expectedInputHash: 'bad' }]) await reject({}, options, 'invalid-contract');
    try { await runCanonicalSnapshotKernel('asset-hash', {}, limits); throw Error('expected failure'); } catch (error) { expect(error.code).to.equal('invalid-contract'); }
  });
});
