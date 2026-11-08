import { expect } from 'chai';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { getActiveExecutionIdentity } from '../js/runtime/ActiveExecutionIdentity.js';
import { checksumProcgenRecovery } from '../js/app/procgen/workstation/ProcgenRecoveryChecksum.js';

const rejects = async (work, text) => { let error; try { await work; } catch (failure) { error = failure; } expect(error).to.be.instanceOf(Error); expect(error.message).to.include(text); return error; };
describe('owned pure background computations', () => {
  const specification = extra => ({ kind: 'parse-json', ownerId: 'import', ownerEpoch: 1, sourceRevision: 'doc:1', inputBytes: 100,
    estimatedPeakBytes: 1048576, prepareInput: () => '{"value":12}', ...extra });
  for (const kind of ['compose-sound-seed-components', 'qualify-original-shape-refinement', 'solve-shape-body', 'build-shape-body-content', 'render-shape-body-calibration', 'fit-sound-seed-modes', 'decompose-sound-seed', 'analyze-sound-seed-window', 'render-scene-rehearsal']) it('requires an admitted worker for ' + kind + ' even with a small request envelope', async () => {
    const jobs = createBackgroundJobService({ Worker: null }); let produced = false;
    const error = await rejects(jobs.compute(specification({ kind, inputBytes: 1, prepareInput: () => { produced = true; return {}; } })), 'requires its admitted worker');
    expect(error.code).to.equal('worker-required'); expect(produced).to.equal(false); jobs.dispose();
  });
  it('exposes actual input-producer quiescence after cancellation, including a frozen cancellation reason', async () => {
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    let accepted, releaseInput, retired = 0;
    const started = new Promise(resolve => { accepted = resolve; }), input = new Promise(resolve => { releaseInput = resolve; }), controller = new AbortController();
    const work = jobs.compute(specification({ signal: controller.signal, prepareInput: () => { accepted(); return input; }, releasePreparedInput: () => { retired++; } }));
    await started; controller.abort(Object.freeze(new Error('source-canceled')));
    const error = await rejects(work, 'source-canceled'); let quiescent = false;
    error.backgroundRetirementCompletion.then(() => { quiescent = true; }); await Promise.resolve();
    expect(quiescent).to.equal(false); expect(retired).to.equal(0); expect(admission.diagnostics().memory.accountedBytes).to.be.greaterThan(0);
    releaseInput('{"value":12}'); const receipt = await error.backgroundRetirementCompletion;
    expect(['released', 'canceled']).to.include(receipt.phase); expect(retired).to.equal(1); expect(admission.diagnostics().memory.accountedBytes).to.equal(0);
    jobs.dispose(); admission.dispose();
  });
  it('keeps a computed result charged until publication releases it, independently of runnable worker slots', async () => {
    const admission = createBackgroundWorkerAdmission({ maxWorkers: 1 }), jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} });
    const result = await jobs.compute(specification());
    expect(result.value).to.deep.equal({ value: 12 }); expect(result.receipt).to.include({ state: 'computed', publication: 'not-committed', method: 'bounded-main-thread-fallback' });
    expect(admission.diagnostics()).to.include({ activeWorkers: 0, retainedResults: 1 });
    expect(result.receipt.retainedBytes).to.be.lessThan(1048576);
    expect(admission.diagnostics().memory.accountedBytes).to.be.greaterThan(0);
    result.release(); result.release(); expect(admission.diagnostics().memory.accountedBytes).to.equal(0);
    expect(() => result.value).to.throw('released'); jobs.dispose(); admission.dispose();
  });
  it('invalidates a canceled computed result while retaining its memory until the consumer acknowledges release', async () => {
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} }), canceled = new AbortController();
    const result = await jobs.compute(specification({ signal: canceled.signal, retainInput: true })); canceled.abort();
    expect(result.signal.aborted).to.equal(true); expect(() => result.value).to.throw();
    expect(admission.diagnostics().memory.accountedBytes).to.be.greaterThan(0);
    result.release(); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('reserves before preparing input and rejects worker-free oversized parsing honestly', async () => {
    const admission = createBackgroundWorkerAdmission({ maxWorkers: 1 }), jobs = createBackgroundJobService({ admission, Worker: null }); let prepared = 0;
    await rejects(jobs.compute(specification({ inputBytes: 200000, prepareInput: () => { prepared++; expect(admission.diagnostics().memory.accountedBytes).to.be.greaterThan(0); return '0'; } })), 'needs a worker');
    expect(prepared).to.equal(0); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('settles cancellation before held preparation completes and retains its memory until terminal ownership is known', async () => {
    const admission = createBackgroundWorkerAdmission({ maxWorkers: 1 }), jobs = createBackgroundJobService({ admission, Worker: null });
    const canceled = new AbortController(); let prepared, release;
    const started = new Promise(resolve => { prepared = resolve; });
    const pending = jobs.compute(specification({ signal: canceled.signal, prepareInput: () => { prepared(); return new Promise(resolve => { release = resolve; }); } }));
    await started; canceled.abort(); await rejects(pending, 'aborted');
    expect(admission.diagnostics().memory.accountedBytes).to.be.greaterThan(0);
    release('0'); await new Promise(resolve => setTimeout(resolve, 0));
    expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('rechecks document ownership before accepting a worker result and terminates the worker once', async () => {
    let current = true, pending, terminated = 0;
    class Worker {
      postMessage(message) { if (message.type !== 'input-end') { queueMicrotask(() => this.onmessage({ data: { ...message, type: 'input-ack', sequence: message.sequence } })); return; } pending = () => this.onmessage({ data: { ...message, type: 'computed', result: { value: {}, inputBytes: 1, nodes: 1 }, executionIdentity: getActiveExecutionIdentity('browser-background-jobs') } }); }
      terminate() { terminated++; }
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker });
    const computation = jobs.compute(specification({ isCurrent: () => current }));
    while (!pending) await new Promise(resolve => setTimeout(resolve, 0)); current = false; pending();
    await rejects(computation, 'no longer belongs'); expect(terminated).to.equal(1); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('checks JSON depth, escaped output capacity, unsupported values and unchanged snapshot buffers', async () => {
    const options = { estimatedPeakBytes: 1048576, maxBytes: 4096, yieldControl: async () => {} };
    expect((await runBackgroundJobKernel('parse-json', '{"a":[1,2,3]}', options)).value).to.deep.equal({ a: [1, 2, 3] });
    await rejects(runBackgroundJobKernel('parse-json', '['.repeat(49) + '0' + ']'.repeat(49), options), 'nesting');
    await rejects(runBackgroundJobKernel('encode-json', '\u0000'.repeat(1000), options), 'representation bound');
    await rejects(runBackgroundJobKernel('encode-json', { value: Infinity }, options), 'finite');
    const original = new Uint8Array([1, 2, 3]), hash = await runBackgroundJobKernel('asset-hash', original, options);
    expect(hash.value).to.match(/^[a-f0-9]{64}$/); expect([...original]).to.deep.equal([1, 2, 3]); expect(original.buffer.byteLength).to.equal(3);
    if (typeof globalThis.SharedArrayBuffer === 'function') await rejects(runBackgroundJobKernel('asset-hash', new Uint8Array(new globalThis.SharedArrayBuffer(8)), options), 'shared live memory');
  });
  it('keeps byte hashing native and provides a genuinely cooperative checksum fallback', async () => {
    let workers = 0, yields = 0;
    class Worker { constructor() { workers++; throw new Error('Native hashing must not create a worker.'); } }
    const admission = createBackgroundWorkerAdmission(), native = createBackgroundJobService({ admission, Worker });
    const bytes = new Uint8Array([1, 2, 3]), hash = await native.compute(specification({ kind: 'asset-hash', inputBytes: 3, prepareInput: () => bytes }));
    expect(hash.value).to.match(/^[a-f0-9]{64}$/); expect(hash.receipt.method).to.equal('native-crypto'); hash.release(); expect(workers).to.equal(0);
    const cooperative = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => { yields++; } });
    const data = Array.from({ length: 20000 }, (_, index) => index % 8);
    const result = await cooperative.compute(specification({ kind: 'recovery-checksum', inputBytes: 200000, estimatedPeakBytes: 4 * 1048576, prepareInput: () => data }));
    expect(result.value).to.equal(await checksumProcgenRecovery(data)); expect(result.receipt.method).to.equal('cooperative-main-thread-fallback'); expect(yields).to.be.greaterThan(1);
    result.release(); native.dispose(); cooperative.dispose(); admission.dispose();
  });
});
