import { expect } from 'chai';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';

const request = { kind: 'parse-json', ownerId: 'initial', ownerEpoch: 1, sourceRevision: 'doc:1', estimatedPeakBytes: 8192 };
const refusal = async work => { try { await work; } catch (error) { return error; } throw new Error('Expected admission refusal'); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const adapter = (budget, reserve) => ({ reserve, release: budget.release, inspectReservation: budget.inspectReservation, diagnostics: budget.diagnostics });

describe('initial background reservation ownership', () => {
  for (const target of ['shared', 'external']) for (const when of ['before', 'after']) for (const mode of ['throw', 'false']) it('rolls back ' + target + ' ' + mode + ' ' + when + ' its side effect before any producer', async () => {
    const shared = createResourceBudget(), external = createResourceBudget(), actual = target === 'shared' ? shared : external; let fault = true;
    const wrapped = adapter(actual, value => { if (!fault) return actual.reserve(value); fault = false; if (when === 'after') actual.reserve(value); if (mode === 'throw') throw new Error('Partial reserve'); return false; });
    const service = createBackgroundWorkerAdmission({ resourceBudget: target === 'shared' ? wrapped : shared });
    const error = await refusal(service.acquire({ ...request, budgetAdapter: target === 'external' ? wrapped : external }));
    expect(await error.backgroundRetirementCompletion).to.include({ phase: 'released', admission: 'not-granted' });
    expect(shared.diagnostics().residentBytes).to.equal(0); expect(external.diagnostics().residentBytes).to.equal(0); expect(service.diagnostics()).to.include({ activeWorkers: 0, failedAdmissionRetirements: 0 });
    const current = await service.acquire({ ...request, budgetAdapter: target === 'external' ? wrapped : external }); current.release(); service.dispose();
    expect(shared.diagnostics().residentBytes + external.diagnostics().residentBytes).to.equal(0);
  });
  for (const target of ['shared', 'external']) for (const outcome of ['resolve', 'reject-before', 'reject-after', 'false-after']) it('owns ' + target + ' async admission through ' + outcome + ' and rejects before publication', async () => {
    const shared = createResourceBudget(), external = createResourceBudget(), actual = target === 'shared' ? shared : external; let settle;
    const wrapped = adapter(actual, value => new Promise((resolve, reject) => { settle = () => { if (outcome !== 'reject-before') actual.reserve(value); if (outcome.startsWith('reject')) reject(new Error('Late reservation fault')); else resolve(outcome === 'false-after' ? false : true); }; }));
    const service = createBackgroundWorkerAdmission({ resourceBudget: target === 'shared' ? wrapped : shared, maxWorkers: 1, maxQueuedJobs: 0 });
    const error = await refusal(service.acquire({ ...request, budgetAdapter: target === 'external' ? wrapped : external }));
    expect(error.message).to.include('synchronously'); expect(service.diagnostics()).to.include({ activeWorkers: 0, failedAdmissionRetirements: 1 });
    expect((await refusal(service.acquire({ ...request, ownerId: 'blocked' }))).message).to.include('capacity');
    wrapped.release = () => { throw new Error('Replaced method must not run'); }; wrapped.inspectReservation = () => { throw new Error('Replaced inspection must not run'); };
    settle(); expect(await error.backgroundRetirementCompletion).to.include({ phase: 'released' });
    expect(shared.diagnostics().residentBytes + external.diagnostics().residentBytes).to.equal(0); expect(service.diagnostics().failedAdmissionRetirements).to.equal(0); service.dispose();
  });
  for (const when of ['before', 'after']) it('keeps the shared guard through an external rollback failure ' + when + ' release and retries exact-token retirement', async () => {
    const shared = createResourceBudget(), external = createResourceBudget(); let fault = true;
    const wrapped = adapter(external, value => { external.reserve(value); throw new Error('Partial admission'); });
    wrapped.release = value => { if (fault) { fault = false; if (when === 'after') external.release(value); throw new Error('Rollback failed'); } return external.release(value); };
    const service = createBackgroundWorkerAdmission({ resourceBudget: shared }); const error = await refusal(service.acquire({ ...request, budgetAdapter: wrapped }));
    expect(await error.backgroundRetirementCompletion).to.include({ phase: 'failed-or-unknown' }); expect(shared.diagnostics().residentBytes).to.equal(8192); expect(service.diagnostics().failedAdmissionRetirements).to.equal(1);
    expect(await service.retryFailedAdmissions()).to.have.length(1); expect(service.diagnostics().failedAdmissionRetirements).to.equal(0); expect(shared.diagnostics().residentBytes + external.diagnostics().residentBytes).to.equal(0); service.dispose();
  });
  it('awaits an unexpected asynchronous rollback release while retaining the shared accounting guard', async () => {
    const shared = createResourceBudget(), external = createResourceBudget(); let settle;
    const wrapped = adapter(external, value => { external.reserve(value); throw new Error('Partial admission'); });
    wrapped.release = value => new Promise(resolve => { settle = () => resolve(external.release(value)); });
    const service = createBackgroundWorkerAdmission({ resourceBudget: shared }); const error = await refusal(service.acquire({ ...request, budgetAdapter: wrapped })); await flush();
    expect(shared.diagnostics().residentBytes).to.equal(8192); expect(external.diagnostics().residentBytes).to.equal(8192); expect(service.diagnostics().failedAdmissionRetirements).to.equal(1);
    settle(); expect(await error.backgroundRetirementCompletion).to.include({ phase: 'released' }); expect(shared.diagnostics().residentBytes + external.diagnostics().residentBytes).to.equal(0); service.dispose();
  });
  it('does not interpret an opaque false release as confirmed absence', async () => {
    const shared = createResourceBudget(); let acknowledged = false;
    const wrapped = { reserve() { throw new Error('Unconfirmed reservation'); }, release() { return acknowledged; } };
    const service = createBackgroundWorkerAdmission({ resourceBudget: shared, maxWorkers: 1, maxQueuedJobs: 0 }); const error = await refusal(service.acquire({ ...request, budgetAdapter: wrapped }));
    expect(await error.backgroundRetirementCompletion).to.include({ phase: 'failed-or-unknown' }); expect(await error.retryBackgroundAdmissionRetirement()).to.include({ phase: 'failed-or-unknown' }); expect(shared.diagnostics().residentBytes).to.equal(8192);
    acknowledged = true; expect(await error.retryBackgroundAdmissionRetirement()).to.include({ phase: 'released' }); expect(shared.diagnostics().residentBytes).to.equal(0); service.dispose();
  });
  it('never prepares input after asynchronous budget refusal and joins retirement through service disposal', async () => {
    const shared = createResourceBudget(), external = createResourceBudget(); let settle, produced = 0;
    const wrapped = adapter(external, value => new Promise(resolve => { settle = () => { external.reserve(value); resolve(); }; }));
    const admission = createBackgroundWorkerAdmission({ resourceBudget: shared }), service = createBackgroundJobService({ admission, Worker: null });
    const error = await refusal(service.compute({ ...request, budgetAdapter: wrapped, prepareInput: () => { produced++; return '{"value":1}'; } }));
    expect(produced).to.equal(0); service.dispose(); admission.dispose(); expect(admission.diagnostics().failedAdmissionRetirements).to.equal(1);
    settle(); expect(await error.backgroundRetirementCompletion).to.include({ phase: 'released' }); expect(admission.diagnostics()).to.include({ retired: true, failedAdmissionRetirements: 0 }); expect(produced).to.equal(0); expect(shared.diagnostics().residentBytes + external.diagnostics().residentBytes).to.equal(0);
  });
  it('inspects only the requested owned token and publishes an immutable reservation observation', () => {
    const budget = createResourceBudget(), token = {}; budget.reserve({ token, owner: 'one', generation: 1, bytes: 4096, category: 'candidate' });
    const value = budget.inspectReservation({ token, owner: 'one' }); expect(Object.isFrozen(value)).to.equal(true); expect(value).to.include({ owner: 'one', bytes: 4096, accountedBytes: 5120 });
    expect(budget.inspectReservation({ token: {} })).to.equal(null); expect(budget.inspectReservation({ token, owner: 'other' })).to.equal(null); budget.release({ token, owner: 'one' }); expect(budget.inspectReservation({ token })).to.equal(null);
  });
});

describe('unsupported asynchronous exact reservation inspection', () => {
  for (const rejects of [false, true]) it('contains ' + (rejects ? 'rejection' : 'resolution') + ' and retains uncertainty until synchronous confirmation', async () => {
    const shared = createResourceBudget(); let exact = false, inspections = 0;
    const wrapped = { reserve() { throw new Error('Unconfirmed reservation'); }, release() { return false; }, inspectReservation() { inspections++; return exact ? null : rejects ? Promise.reject(new Error('Delayed inspection failure')) : Promise.resolve(null); } };
    const service = createBackgroundWorkerAdmission({ resourceBudget: shared });
    const error = await refusal(service.acquire({ ...request, budgetAdapter: wrapped }));
    expect(await error.backgroundRetirementCompletion).to.include({ phase: 'failed-or-unknown' }); await flush();
    expect(inspections).to.equal(1); expect(shared.diagnostics().residentBytes).to.equal(8192); expect(service.diagnostics().failedAdmissionRetirements).to.equal(1);
    exact = true; expect(await error.retryBackgroundAdmissionRetirement()).to.include({ phase: 'released' });
    expect(shared.diagnostics().residentBytes).to.equal(0); expect(service.diagnostics().failedAdmissionRetirements).to.equal(0); service.dispose();
  });
});
