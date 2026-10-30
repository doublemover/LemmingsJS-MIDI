import { expect } from 'chai';
import { createCausalSourceJobs } from '../../js/app/procgen/workstation/CausalSourceJobs.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { canonicalDataText, hashDataText } from '../../js/core/CanonicalData.js';

const source = async value => { const encoded = canonicalDataText(value); return { canonical: encoded.text,
  ref: { id: 'fixture-checkpoint', hash: await hashDataText(encoded.text), bytes: encoded.bytes.byteLength, nodes: encoded.nodes } }; };
const waitTurn = () => new Promise(resolve => setTimeout(resolve, 0));

describe('admitted causal source verification', () => {
  it('retains only compact verification metadata after a large string source has been inspected', async () => {
    const record = await source({ value: 'a'.repeat(32768) }), budget = createResourceBudget(), admission = createBackgroundWorkerAdmission();
    const jobs = createBackgroundJobService({ admission, Worker: null }), storage = { loadCausalChunk() {}, loadCausalCheckpoint: async () => record };
    const reader = createCausalSourceJobs({ storage, resourceBudget: budget, jobs }), lease = await reader.read('checkpoint', record.ref, { metadataOnly: true });
    expect(lease.value).to.include({ kind: 'checkpoint', bytes: record.ref.bytes, nodes: record.ref.nodes });
    expect(lease.receipt.retainedBytes).to.be.lessThan(32768); lease.release(); expect(budget.diagnostics().accountedBytes).to.equal(0);
    jobs.dispose(); admission.dispose();
  });
  it('admits storage loading, verifies exact bytes/object inventory and retains the result until its reader closes', async () => {
    const record = await source({ version: 2, components: { playing: false }, values: [1, 2, 3] }), budget = createResourceBudget(); let admitted = false;
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    const storage = { loadCausalChunk() {}, async loadCausalCheckpoint() { admitted = budget.diagnostics().accountedBytes > 0; return record; } };
    const reader = createCausalSourceJobs({ storage, resourceBudget: budget, jobs }), lease = await reader.read('checkpoint', record.ref);
    expect(admitted).to.equal(true); expect(lease.value).to.deep.equal({ version: 2, components: { playing: false }, values: [1, 2, 3] });
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); lease.release(); expect(lease.release()).to.equal(false);
    expect(() => lease.value).to.throw('retired'); expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('does not trust a source hash when its declared node or byte inventory differs', async () => {
    const record = await source({ value: [1, 2] }), budget = createResourceBudget(), admission = createBackgroundWorkerAdmission();
    const jobs = createBackgroundJobService({ admission, Worker: null }), storage = { loadCausalChunk() {}, loadCausalCheckpoint: async () => record };
    const reader = createCausalSourceJobs({ storage, resourceBudget: budget, jobs });
    for (const ref of [{ ...record.ref, nodes: record.ref.nodes + 1 }, { ...record.ref, bytes: record.ref.bytes + 1 }]) {
      try { await reader.read('checkpoint', ref); expect.fail('mismatched inventory must fail'); } catch (error) { expect(['content-mismatch', 'memory-capacity']).to.include(error.code); }
    }
    expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('keeps an accepted storage read reserved through cancellation and actual settlement', async () => {
    const record = await source({ value: 42 }), budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(); let settle, entered;
    const loading = new Promise(resolve => { entered = resolve; });
    const jobs = createBackgroundJobService({ admission, Worker: null }), storage = { loadCausalChunk() {}, loadCausalCheckpoint() { entered(); return new Promise(resolve => { settle = resolve; }); } };
    const reader = createCausalSourceJobs({ storage, resourceBudget: budget, jobs }), controller = new AbortController();
    const pending = reader.read('checkpoint', record.ref, { signal: controller.signal }); pending.catch(() => {}); await loading;
    controller.abort(new Error('selection changed'));
    try { await pending; expect.fail('canceled read must reject'); } catch (error) { expect(error.message).to.equal('selection changed'); }
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); settle(record); await waitTurn(); await waitTurn();
    expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
});
