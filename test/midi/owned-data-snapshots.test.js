import { expect } from 'chai';
import { createOwnedResourceReservation } from '../../js/app/resources/OwnedResourceReservation.js';
import { createOwnedDataSnapshots } from '../../js/app/resources/OwnedDataSnapshot.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

describe('independent owned data snapshots', () => {
  it('keeps refused producer retirement visible without retrying its callback', async () => {
    let attempts = 0; const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    try {
      await jobs.compute({ kind: 'encode-json', ownerId: 'refused-input', ownerEpoch: 1, sourceRevision: 1, inputBytes: 32, maxBytes: 1024,
        estimatedPeakBytes: 32768, budgetAdapter: budget, prepareInput: () => ({ value: 1 }), releasePreparedInput: () => { attempts++; return false; } });
      expect.fail('refused input retirement must reject');
    } catch (error) { expect(error.code).to.equal('input-retirement-unknown'); }
    expect(attempts).to.equal(1); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    expect(jobs.diagnostics().failedOrUnknown).to.equal(1); jobs.dispose(); admission.dispose(); expect(attempts).to.equal(1);
  });
  it('keeps a published snapshot through cancellation of its original request and isolates private edits', async () => {
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    const source = createOwnedResourceReservation({ budget, owner: 'snapshot-source', kind: 'source', bytes: 4096 });
    const snapshots = createOwnedDataSnapshots({ resourceBudget: budget, jobs }), controller = new AbortController(), input = { values: [1, 2, 3], revision: 4 };
    const result = await snapshots.prepare(input, { signal: controller.signal, sourceRevision: 'source:4', maxBytes: 1024, inputFootprintBytes: source.receipt().declaredBytes });
    source.release(); controller.abort(new Error('replacement started'));
    expect(result.value).to.deep.equal(input); result.value.values[0] = 99; expect(input.values[0]).to.equal(1);
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect(admission.diagnostics().retainedResults).to.equal(1);
    result.release(); expect(result.release()).to.equal(false); expect(() => result.value).to.throw('retired');
    expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('keeps accepted computation reserved after logical cancellation until the actual source task settles', async () => {
    let acknowledge, entered; const gate = new Promise(resolve => { acknowledge = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission();
    const jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: () => { entered(); return gate; } });
    const source = createOwnedResourceReservation({ budget, owner: 'snapshot-source', kind: 'source', bytes: 4096 });
    const snapshots = createOwnedDataSnapshots({ resourceBudget: budget, jobs }), controller = new AbortController();
    const preparing = snapshots.prepare({ value: 1 }, { signal: controller.signal, sourceRevision: 'source:1', maxBytes: 1024, inputFootprintBytes: 4096 }); preparing.catch(() => {});
    await started; controller.abort(new Error('source replaced'));
    try { await preparing; expect.fail('canceled snapshot must reject'); } catch (error) { expect(error.message).to.equal('source replaced'); }
    source.release(); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    acknowledge(); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
    expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('refuses a snapshot profile before computing when declared clone overlap exceeds the global limit', async () => {
    let computed = 0; const budget = createResourceBudget(), snapshots = createOwnedDataSnapshots({ resourceBudget: budget, jobs: { compute() { computed++; } } });
    try { await snapshots.prepare({}, { sourceRevision: 1, inputFootprintBytes: 256 * 1048576 }); expect.fail('oversized profile must reject'); }
    catch (error) { expect(error.name).to.equal('DataSnapshotError'); }
    expect(computed).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});

describe('acknowledged resizable resource ownership', () => {
  it('keeps an existing reservation usable after an ordinary capacity denial', () => {
    const budget = createResourceBudget({ limitBytes: 16384 }), owned = createOwnedResourceReservation({ budget, owner: 'score', kind: 'workspace', bytes: 4096 });
    owned.resize(8192); expect(() => owned.resize(32768)).to.throw(); expect(owned.isActive()).to.equal(true);
    expect(owned.receipt().declaredBytes).to.equal(8192); owned.release(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('caches a refused bookkeeping release without calling the adapter again', () => {
    let attempts = 0; const budget = { reserve() {}, release() { attempts++; return false; } };
    const owned = createOwnedResourceReservation({ budget, owner: 'score', kind: 'workspace' });
    expect(() => owned.release()).to.throw(); expect(() => owned.release()).to.throw(); expect(attempts).to.equal(1);
    expect(owned.receipt().state).to.equal('failed-or-unknown'); expect(owned.isActive()).to.equal(false);
  });
});
