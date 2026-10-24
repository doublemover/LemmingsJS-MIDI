import { expect } from 'chai';
import { createSharedContentJobs } from '../js/app/resources/SharedContentJobs.js';

describe('independent leases for shared pure content jobs', () => {
  const request = extra => ({ kind: 'asset-hash', contentHash: 'a'.repeat(64), decoderVersion: 'hash-v1', inputBytes: 100,
    estimatedPeakBytes: 4096, prepareInput: () => new Uint8Array([1]), ...extra });
  it('shares one computation while canceling and releasing consumers independently', async () => {
    let finish, computed = 0, retired = 0, computationSignal;
    const shared = createSharedContentJobs({ jobs: { compute(options) {
      computed++; computationSignal = options.signal;
      return new Promise(resolve => { finish = () => resolve({ value: 'hash', receipt: {}, release() { retired++; } }); });
    } } });
    const canceled = new AbortController(), first = shared.acquire(request({ signal: canceled.signal })), second = shared.acquire(request());
    const cancellation = first.catch(error => error); await Promise.resolve(); canceled.abort();
    expect(await cancellation).to.be.instanceOf(Error); expect(computationSignal.aborted).to.equal(false);
    finish(); const result = await second;
    expect(result.value).to.equal('hash'); expect(computed).to.equal(1); expect(retired).to.equal(0);
    result.release(); result.release(); expect(retired).to.equal(1); expect(shared.diagnostics().entries).to.equal(0);
    shared.dispose();
  });
  it('keeps delivered data charged after cancellation until its consumer releases it', async () => {
    let retired = 0;
    const shared = createSharedContentJobs({ jobs: { compute: async () => ({ value: {}, receipt: {}, release() { retired++; } }) } });
    const canceled = new AbortController(), result = await shared.acquire(request({ signal: canceled.signal }));
    canceled.abort(); expect(result.signal.aborted).to.equal(true); expect(() => result.value).to.throw('retired'); expect(retired).to.equal(0);
    result.release(); expect(retired).to.equal(1); shared.dispose();
  });
  it('bounds pending identities and retires late results when the last waiting consumer leaves', async () => {
    let finish, retired = 0;
    const shared = createSharedContentJobs({ maxEntries: 1, jobs: { compute: () => new Promise(resolve => { finish = () => resolve({ value: 1, receipt: {}, release() { retired++; } }); }) } });
    const canceled = new AbortController(), pending = shared.acquire(request({ signal: canceled.signal })).catch(error => error);
    expect(() => shared.acquire(request({ contentHash: 'b'.repeat(64) }))).to.throw('limit reached');
    await Promise.resolve(); canceled.abort(); await pending; finish(); await Promise.resolve(); await Promise.resolve();
    expect(retired).to.equal(1); expect(shared.diagnostics().entries).to.equal(0); shared.dispose();
  });
});
