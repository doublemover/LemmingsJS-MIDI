import { expect } from 'chai';
import { createSharedContentJobs } from '../js/app/resources/SharedContentJobs.js';

describe('independent leases for shared pure content jobs', () => {
  const request = extra => ({ kind: 'asset-hash', contentHash: 'a'.repeat(64), decoderVersion: 'hash-v1', inputBytes: 100,
    estimatedPeakBytes: 4096, prepareInput: () => new Uint8Array([1]), ...extra });
  it('shares one computation while canceling and releasing consumers independently', async () => {
    let finish, computed = 0, retired = 0, computationSignal;
    const shared = createSharedContentJobs({ jobs: { compute(options) {
      computed++; computationSignal = options.signal;
      return new Promise(resolve => { finish = () => resolve({ value: 'hash', receipt: {}, release() { retired++; }, retirementState: () => ({ phase: retired ? 'released' : 'computed' }) }); });
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
    const shared = createSharedContentJobs({ jobs: { compute: async () => ({ value: {}, receipt: {}, release() { retired++; }, retirementState: () => ({ phase: retired ? 'released' : 'computed' }) }) } });
    const canceled = new AbortController(), result = await shared.acquire(request({ signal: canceled.signal }));
    canceled.abort(); expect(result.signal.aborted).to.equal(true); expect(() => result.value).to.throw('retired'); expect(retired).to.equal(0);
    result.release(); expect(retired).to.equal(1); shared.dispose();
  });
  for (const ack of [false, Promise.resolve(true)]) it('retains unresolved last-result release and refuses a duplicate computation', async () => {
    let computes = 0;
    const shared = createSharedContentJobs({ jobs: { compute: async () => { computes++; return { value: {}, receipt: {}, release: () => ack, retirementState: () => ({ phase: 'computed' }) }; } } });
    const result = await shared.acquire(request()); expect(() => result.release()).to.throw('acknowledge'); expect(() => result.release()).to.throw('acknowledge');
    expect(result.retirementState().phase).to.equal('failed-or-unknown'); expect(shared.diagnostics()).to.include({ entries: 1, failedOrUnknown: 1 });
    expect(() => shared.acquire(request())).to.throw('unresolved retirement'); expect(computes).to.equal(1); shared.dispose();
  });
  it('does not mask failed duplicate-input retirement or cancel the surviving consumer', async () => {
    let release = false; const shared = createSharedContentJobs({ jobs: { compute: async () => ({ value: 1, receipt: {}, release() { release = true; }, retirementState: () => ({ phase: release ? 'released' : 'computed' }) }) } });
    const first = await shared.acquire(request()); expect(() => shared.acquire(request({ releasePreparedInput: () => false }))).to.throw('acknowledge');
    expect(first.value).to.equal(1); expect(shared.diagnostics().orphanedInputs).to.equal(1); first.release(); expect(shared.diagnostics().failedOrUnknown).to.equal(1); shared.dispose();
  });
  it('keeps a canceled identity occupied until backend retirement is acknowledged', async () => {
    let rejectJob, finishRetirement;
    const completion = new Promise(resolve => { finishRetirement = resolve; });
    const shared = createSharedContentJobs({ jobs: { compute: () => new Promise((_resolve, reject) => { rejectJob = reject; }) } });
    const controller = new AbortController(), pending = shared.acquire(request({ signal: controller.signal })).catch(error => error); await Promise.resolve(); controller.abort(); await pending;
    expect(() => shared.acquire(request())).to.throw('unresolved retirement');
    rejectJob(Object.assign(new Error('worker canceled'), { backgroundRetirement: { phase: 'canceling' }, backgroundRetirementCompletion: completion })); await new Promise(resolve => setTimeout(resolve, 0));
    expect(shared.diagnostics().entries).to.equal(1); finishRetirement({ phase: 'canceled' }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(shared.diagnostics().entries).to.equal(0); shared.dispose();
  });
  it('shares additional deterministic encoders with independent result ownership', async () => {
    let computed = 0, released = false;
    const shared = createSharedContentJobs({ jobs: { compute: async () => { computed++; return { value: 'encoded', receipt: {}, release() { released = true; }, retirementState: () => ({ phase: released ? 'released' : 'computed' }) }; } } });
    const [a, b] = await Promise.all([shared.acquire(request({ kind: 'encode-canonical-json' })), shared.acquire(request({ kind: 'encode-canonical-json' }))]);
    a.release(); expect(a.retirementState().phase).to.equal('released'); expect(b.value).to.equal('encoded'); expect(released).to.equal(false); b.release(); expect(computed).to.equal(1); expect(released).to.equal(true); shared.dispose();
  });
  it('preserves unknown input cleanup instead of converting a false acknowledgment into success', async () => {
    const shared = createSharedContentJobs({ jobs: { compute: async options => {
      await options.prepareInput(); options.releasePreparedInput(); throw new Error('must not continue after failed cleanup');
    } } });
    let error; try { await shared.acquire(request({ releasePreparedInput: () => false })); } catch (value) { error = value; }
    expect(error.message).to.include('acknowledge'); expect(error.backgroundRetirement.phase).to.equal('failed-or-unknown'); expect(shared.diagnostics().failedOrUnknown).to.equal(1); shared.dispose();
  });
  it('propagates service retirement to delivered consumers without releasing their ownership early', async () => {
    const controller = new AbortController(); let released = false;
    const shared = createSharedContentJobs({ jobs: { compute: async () => ({ signal: controller.signal, value: {}, receipt: {}, release() { released = true; }, retirementState: () => ({ phase: released ? 'released' : 'computed' }) }) } });
    const result = await shared.acquire(request()); controller.abort(new Error('service retired'));
    expect(result.signal.aborted).to.equal(true); expect(released).to.equal(false); expect(result.retirementState().phase).to.equal('canceling'); result.release(); expect(released).to.equal(true); shared.dispose();
  });
  it('bounds pending identities and retires late results when the last waiting consumer leaves', async () => {
    let finish, retired = 0;
    const shared = createSharedContentJobs({ maxEntries: 1, jobs: { compute: () => new Promise(resolve => { finish = () => resolve({ value: 1, receipt: {}, release() { retired++; }, retirementState: () => ({ phase: retired ? 'released' : 'computed' }) }); }) } });
    const canceled = new AbortController(), pending = shared.acquire(request({ signal: canceled.signal })).catch(error => error);
    expect(() => shared.acquire(request({ contentHash: 'b'.repeat(64) }))).to.throw('limit reached');
    await Promise.resolve(); canceled.abort(); await pending; finish(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(retired).to.equal(1); expect(shared.diagnostics().entries).to.equal(0); shared.dispose();
  });
});
