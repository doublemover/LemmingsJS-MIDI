import { expect } from 'chai';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { verifyStoredCausalSources } from '../js/app/procgen/workstation/CausalStoredSourceVerification.js';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';

const fixture = async ({ refuseProofRelease = false } = {}) => {
  const memory = createMemoryCausalStore(), budget = createResourceBudget(), lifetime = new AbortController(), kinds = [];
  const diagnostics = { opened: 0, closed: 0, reads: 0, admitted: true, canonicalChecks: 0 }, control = { cancelAt: null, queryProofs: 0 };
  const jobs = createTestBackgroundJobs({ kernel: async (kind, input, options) => {
    kinds.push(kind);
    if (kind === 'verify-causal-sources' && input.selection) control.queryProofs += input.sources.filter(value => value.proof).length;
    if (kind === 'verify-causal-source' && input.selection && input.proof) control.queryProofs++;
    if (kind !== 'verify-stored-causal-sources') return runBackgroundJobKernel(kind, input, options);
    return verifyStoredCausalSources(input, { ...options, current: () => !lifetime.signal.aborted,
      verifySource: source => { diagnostics.canonicalChecks++; return runBackgroundJobKernel('verify-causal-source', source, { ...options, current: () => !lifetime.signal.aborted }); },
      createReader: async () => { diagnostics.opened++; return { close() { diagnostics.closed++; }, async read(ref) {
        diagnostics.admitted &&= budget.diagnostics().accountedBytes > 0; diagnostics.reads++;
        if (diagnostics.reads === control.cancelAt) lifetime.abort(new Error('Storage retired'));
        return memory.storage.loadCausalChunk(ref.id);
      } }; } });
  } });
  const storage = { ...memory.storage, openCausalWorkerSource: async () => ({ signal: lifetime.signal }) };
  const resourceBudget = { reserve: value => budget.reserve(value), release: value => refuseProofRelease && value.owner.endsWith('-proofs') ? false : budget.release(value) };
  const journal = createProcgenCausalJournal({ storage, resourceBudget, jobs, maxChunkRecords: 1 });
  const writer = await journal.createTake({ takeId: 'take:stored-worker', takeName: 'Stored worker', documentId: 'doc:stored-worker',
    sourceVersions: { generator: 'fixture' }, captureProfile: { version: 1 }, initialCheckpoint: { version: 2 }, mapping: { version: 1 } });
  for (let tick = 1; tick <= 65; tick++) { writer.append({ kind: 'marker', tick, generation: 1, payload: { name: 'Tick' + tick } }); await writer.flush(); }
  await writer.stop(); return { ...memory, journal, jobs, budget, lifetime, kinds, diagnostics, control };
};

describe('owned sequential stored causal verification', function() {
  this.timeout(15000);
  const input = () => ({ refs: [{ id: 'chunk:bounded', hash: '0'.repeat(64), bytes: 128, nodes: 16, firstSequence: 1 }], maxRecords: 64, maxChunkBytes: 4194304 });
  it('refuses unsupported inventories before opening storage', async () => {
    let opened = 0;
    for (const change of [value => { value.refs[0].nodes = -1; }, value => { value.refs = Array(4097).fill(value.refs[0]); }]) {
      const value = input(); change(value); let failure;
      try { await verifyStoredCausalSources(value, { estimatedPeakBytes: 1048576, verifySource() {}, createReader() { opened++; } }); } catch (error) { failure = error; }
      expect(failure).to.be.instanceOf(Error);
    }
    expect(opened).to.equal(0);
  });
  it('never upgrades storage and closes a late connection after an opening refusal', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    try {
      for (const event of ['onupgradeneeded', 'onblocked', 'onerror']) {
        let closed = 0, aborted = 0;
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
          const request = { transaction: { abort() { aborted++; } }, result: { close() { closed++; } } };
          queueMicrotask(() => { request[event](); queueMicrotask(() => request.onsuccess()); }); return request;
        } } });
        let failure; try { await verifyStoredCausalSources(input(), { estimatedPeakBytes: 1048576, verifySource() {} }); } catch (error) { failure = error; }
        expect(failure?.code).to.equal('source-storage-unavailable');
        await new Promise(resolve => setTimeout(resolve, 0)); expect(closed).to.equal(1); expect(aborted).to.equal(event === 'onupgradeneeded' ? 1 : 0);
      }
    } finally { if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else delete globalThis.indexedDB; }
  });
  it('aborts a pending readonly transaction and closes the connection on cancellation', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), controller = new AbortController(); let closed = 0, aborted = 0;
    try {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
        const database = { close() { closed++; }, transaction(_name, mode) {
          expect(mode).to.equal('readonly'); const transaction = { objectStore() { return { get() { queueMicrotask(() => controller.abort(new Error('Read canceled'))); return {}; } }; },
            abort() { aborted++; queueMicrotask(() => transaction.onabort()); } }; return transaction;
        } };
        const request = { result: database }; queueMicrotask(() => request.onsuccess()); return request;
      } } });
      let failure; try { await verifyStoredCausalSources(input(), { signal: controller.signal, estimatedPeakBytes: 1048576, verifySource() {} }); } catch (error) { failure = error; }
      expect(failure).to.include({ sourceId: 'chunk:bounded', firstSequence: 1 }); expect(aborted).to.equal(1); expect(closed).to.equal(1);
    } finally { if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else delete globalThis.indexedDB; }
  });
  it('uses one admitted worker for 65 immutable sources and returns exact compact metadata', async () => {
    const f = await fixture(), progress = [];
    try {
      expect((await f.journal.verify('take:stored-worker', { onProgress: value => progress.push(value) })).verifiedThroughSequence).to.equal(65);
      expect(f.kinds).to.deep.equal(['verify-causal-source', 'verify-stored-causal-sources']);
      expect(f.diagnostics).to.deep.equal({ opened: 1, closed: 1, reads: 65, admitted: true, canonicalChecks: 65 });
      expect(progress.at(-1)).to.include({ phase: 'verifying', completedChunks: 65, totalChunks: 65 });
      expect(progress.every((value, index) => !index || value.completedChunks >= progress[index - 1].completedChunks)).to.equal(true);
    } finally { await f.journal.releaseQualifications().completion; f.jobs.dispose(); }
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('closes its reader and identifies changed or missing bytes without trusting earlier verification', async () => {
    const f = await fixture(), chunk = [...f.chunks.values()][17], canonical = chunk.canonical;
    try {
      await f.journal.verify('take:stored-worker'); expect(f.diagnostics.canonicalChecks).to.equal(65); chunk.canonical = canonical.replace('Tick18', 'Tickx8');
      let failure; try { await f.journal.verify('take:stored-worker'); } catch (error) { failure = error; }
      expect(failure).to.include({ code: 'content-mismatch', sourceId: chunk.id, firstSequence: 18 });
      chunk.canonical = canonical; f.chunks.delete(chunk.id);
      try { await f.journal.verify('take:stored-worker'); } catch (error) { failure = error; }
      expect(failure).to.include({ code: 'missing-chunk', sourceId: chunk.id, firstSequence: 18 }); f.chunks.set(chunk.id, chunk);
      expect((await f.journal.verify('take:stored-worker')).verifiedThroughSequence).to.equal(65);
      expect(f.diagnostics.canonicalChecks).to.equal(65);
      expect(f.diagnostics.closed).to.equal(4);
    } finally { await f.journal.releaseQualifications().completion; f.jobs.dispose(); }
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('cancels sequential reads when the originating storage owner retires', async () => {
    const f = await fixture(); f.control.cancelAt = 3;
    try {
      let failure; try { await f.journal.verify('take:stored-worker'); } catch (error) { failure = error; }
      expect(failure).to.be.instanceOf(Error);
      await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.diagnostics).to.include({ opened: 1, closed: 1, reads: 3 });
    } finally { await f.journal.releaseQualifications().completion; f.jobs.dispose(); }
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('reuses only private canonical proofs for query decoding and still hashes corrupt current bytes', async () => {
    const f = await fixture(), chunk = [...f.chunks.values()][17], canonical = chunk.canonical;
    try {
      await f.journal.verify('take:stored-worker');
      const page = await f.journal.queryOwned({ takeId: 'take:stored-worker', firstSequence: 1, lastSequence: 65, limit: 16 });
      try { expect(page.value.records.map(value => value.sequence)).to.deep.equal(Array.from({ length: 16 }, (_, index) => index + 1)); }
      finally { page.release(); }
      expect(f.control.queryProofs).to.be.at.least(16);
      chunk.canonical = canonical.replace('Tick18', 'Tickx8'); let failure;
      try { await f.journal.queryOwned({ takeId: 'take:stored-worker', firstSequence: 18, lastSequence: 18, limit: 1 }); } catch (error) { failure = error; }
      expect(failure?.code).to.equal('content-mismatch'); chunk.canonical = canonical;
      const repaired = await f.journal.queryOwned({ takeId: 'take:stored-worker', firstSequence: 18, lastSequence: 18, limit: 1 });
      try { expect(repaired.value.records[0].payload.name).to.equal('Tick18'); } finally { repaired.release(); }
      expect(f.diagnostics.canonicalChecks).to.equal(65);
    } finally { await f.journal.releaseQualifications().completion; f.jobs.dispose(); }
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('keeps a refused canonical proof retirement charged and never silently reuses its metadata', async () => {
    const f = await fixture({ refuseProofRelease: true });
    try {
      await f.journal.verify('take:stored-worker'); const retirement = f.journal.releaseQualifications(); await retirement.completion;
      expect(retirement.outcome).not.to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.be.at.least(4 * 1048576);
      const prior = f.diagnostics.canonicalChecks; await f.journal.verify('take:stored-worker');
      expect(f.diagnostics.canonicalChecks - prior).to.equal(65);
    } finally { f.jobs.dispose(); }
  });
});
