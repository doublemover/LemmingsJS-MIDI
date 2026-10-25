import { expect } from 'chai';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

describe('shared background worker and queued-input admission', () => {
  const request = (id, extra = {}) => ({ kind: 'parse-json', ownerId: id, ownerEpoch: 1, sourceRevision: 'content:1', estimatedPeakBytes: 4096, ...extra });
  for (const kind of ['qualify-original-shape-refinement', 'solve-shape-body', 'build-shape-body-content', 'render-shape-body-calibration', 'fit-sound-seed-modes', 'decompose-sound-seed', 'analyze-sound-seed-window', 'render-scene-rehearsal']) it('admits the registered ' + kind + ' producer and retains storage until consumer release', async () => {
    const service = createBackgroundWorkerAdmission({ maxWorkers: 1 }), owner = await service.acquire(request(kind, { kind })); expect(service.diagnostics().activeWorkers).to.equal(1);
    owner.release(); expect(service.diagnostics().memory.accountedBytes).to.equal(0); service.dispose();
  });
  it('reports observed queue waiting separately from synchronous resource admission', async () => {
    let clock = 10; const service = createBackgroundWorkerAdmission({ maxWorkers: 1, now: () => clock });
    const first = await service.acquire(request('first')), waiting = service.acquire(request('second')); clock = 47; first.release();
    const second = await waiting; expect(second.getState().queueWaitMs).to.equal(37); expect(service.diagnostics()).to.include({ queueWaitMs: 37, peakQueueWaitMs: 37 }); second.release(); service.dispose();
  });
  it('reserves before granting execution, bounds runnable workers and releases all independent ownership', async () => {
    const budget = createResourceBudget({ limitBytes: 1048576 }), service = createBackgroundWorkerAdmission({ resourceBudget: budget, maxWorkers: 1 });
    const first = await service.acquire(request('import')), second = service.acquire(request('recovery', { inputBytes: 1000 }));
    expect(service.diagnostics()).to.include({ activeWorkers: 1, queuedJobs: 1, queuedInputBytes: 1000 });
    expect(budget.diagnostics().categories.candidate.entries).to.equal(2);
    first.release(); const next = await second;
    expect(service.diagnostics()).to.include({ activeWorkers: 1, queuedJobs: 0, peakWorkers: 1 });
    next.release(); expect(budget.diagnostics().accountedBytes).to.equal(0); service.dispose();
  });
  it('cancels queued requests without starting them and keeps failed active retirement charged', async () => {
    const service = createBackgroundWorkerAdmission({ maxWorkers: 1 }), canceled = new AbortController();
    const first = await service.acquire(request('held', { onCancel: (_reason, lease) => lease.retainUnknown(new Error('Worker termination failed.')) }));
    const queued = service.acquire(request('abandoned', { signal: canceled.signal, inputBytes: 128 }));
    canceled.abort(); let error; try { await queued; } catch (failure) { error = failure; }
    expect(error.name).to.equal('AbortError'); expect(service.diagnostics().queuedInputBytes).to.equal(0);
    service.dispose(); expect(first.getState().phase).to.equal('failed-or-unknown');
    expect(service.diagnostics()).to.include({ activeWorkers: 1, failedOrUnknown: 1 });
    expect(service.diagnostics().memory.unreleasedEstimatedBytes).to.be.greaterThan(0);
  });
  it('ages background work ahead of a new interactive request and rejects retained-input overflow before allocation', async () => {
    let time = 0; const service = createBackgroundWorkerAdmission({ maxWorkers: 1, maxQueuedInputBytes: 100, now: () => time });
    const held = await service.acquire(request('held')), order = [];
    const background = service.acquire(request('search', { priority: 'background', inputBytes: 50 })).then(lease => { order.push('search'); return lease; });
    time = 5000;
    const interactive = service.acquire(request('import', { priority: 'interactive', inputBytes: 50 })).then(lease => { order.push('import'); return lease; });
    let error; try { await service.acquire(request('overflow', { inputBytes: 1 })); } catch (failure) { error = failure; }
    expect(error.message).to.include('retained input capacity');
    held.release(); const search = await background; expect(order).to.deep.equal(['search']); search.release();
    const imported = await interactive; imported.release(); expect(order).to.deep.equal(['search', 'import']); service.dispose();
  });
  it('keeps computed bytes reserved after freeing their worker slot', async () => {
    const service = createBackgroundWorkerAdmission({ maxWorkers: 1 }), first = await service.acquire(request('encode'));
    first.computationFinished(); const next = await service.acquire(request('hash', { kind: 'asset-hash' }));
    expect(service.diagnostics()).to.include({ activeWorkers: 1, retainedResults: 1 });
    first.release(); next.release(); expect(service.diagnostics().memory.accountedBytes).to.equal(0); service.dispose();
  });
});
