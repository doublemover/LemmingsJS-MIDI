import { expect } from 'chai';
import { createProcgenCausalJournal, verifyManifestHashes } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { canonicalJournalText } from '../js/app/procgen/workstation/CausalJournalCanonical.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';

const definition = takeId => ({ takeId, documentId: 'doc:test', sourceVersions: { generator: 'procgen-workstation-1', numeric: 'finite-f64-minus-zero-v1' },
  captureProfile: { version: 1, id: 'test', factKinds: ['MotionCommitted'], descriptorKinds: [], stateKinds: [] },
  initialCheckpoint: { version: 2, tick: 0 }, mapping: { version: 1, revision: 1, instruments: [] }, boundaryState: { voices: [] }, assetRefs: [] });
const marker = tick => ({ kind: 'marker', tick, generation: 1, payload: { name: `marker:${tick}` } });
const setup = options => {
  const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage, ...options });
  return { ...store, journal };
};

describe('durable causal take journal', function() {
  this.timeout(15000);
  it('retains sparse selected records through an owned query without retaining whole chunk inputs', async () => {
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    const { journal } = setup({ resourceBudget: budget, jobs, maxChunkRecords: 2 }), writer = await journal.createTake(definition('take:owned-query'));
    writer.appendMany([marker(1), marker(2)]); await writer.flush();
    writer.appendMany([marker(3), marker(4)]); await writer.flush(); writer.append(marker(5)); await writer.stop();
    await journal.openTake('take:owned-query'); const baseline = budget.diagnostics().accountedBytes;
    const query = await journal.queryOwned({ takeId: 'take:owned-query', kinds: ['marker'], limit: 2 });
    expect(query.value.records.map(record => record.tick)).to.deep.equal([1, 2]); expect(query.value.nextSequence).to.equal(3);
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(baseline); expect(admission.diagnostics().activeWorkers).to.equal(0);
    expect(admission.diagnostics().retainedResults).to.equal(1); query.value.records[0].payload.name = 'private-view-edit';
    query.release(); expect(query.release()).to.equal(false); expect(() => query.value).to.throw('retired');
    expect(admission.diagnostics().retainedResults).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(baseline);
    const second = await journal.queryOwned({ takeId: 'take:owned-query', firstSequence: 1, lastSequence: 1, limit: 1 });
    expect(second.value.records[0].payload.name).to.equal('marker:1'); second.release();
    await journal.releaseQualifications().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('publishes one new index reference per append with bounded compact metadata', async () => {
    const { journal, control, storage } = setup({ maxChunkRecords: 1 });
    const commit = storage.commitCausalTake, sizes = [];
    storage.commitCausalTake = update => {
      expect(update).not.to.have.property('manifest');
      expect(update.head).not.to.have.any.keys('chunks', 'checkpoints', 'sourceVersions', 'mapping');
      if (update.chunk) {
        expect(update.header).to.equal(null);
        sizes.push(canonicalJournalText({ head: update.head, chunkRef: update.chunkRef }).bytes.length);
      }
      return commit(update);
    };
    const writer = await journal.createTake(definition('take:incremental'));
    for (let tick = 1; tick <= 200; tick++) { writer.append(marker(tick)); await writer.flush(); }
    expect(control.indexReferences).to.equal(201);
    expect(Math.max(...sizes) - Math.min(...sizes)).to.be.lessThan(100);
    expect(control.manifestReads).to.equal(0);
    const snapshot = writer.manifest();
    expect(() => { snapshot.chunks.length = 0; }).to.throw(TypeError);
    expect(() => { snapshot.mapping.revision = 99; }).to.throw(TypeError);
    expect(writer.manifest().chunks).to.have.length(200); expect(writer.manifest().mapping.revision).to.equal(1);
    control.loseNextReceipt = true; await writer.stop();
    expect(control.manifestReads).to.equal(0); expect(control.headReads).to.equal(1);
    expect((await journal.verify('take:incremental')).verifiedThroughSequence).to.equal(200);
  });

  it('stores 10000 ordered boundaries in bounded chunks and reopens with hardware disarmed', async () => {
    const { journal, chunks } = setup(), writer = await journal.createTake(definition('take:10000'));
    for (let tick = 1; tick <= 10000; tick++) expect(writer.append(marker(tick)).status).to.equal('accepted');
    const stopped = await writer.stop();
    expect(stopped).to.include({ state: 'finalized', complete: true, durableSequence: 10000 });
    expect([...chunks.values()].every(chunk => JSON.parse(chunk.canonical).records.length <= 64)).to.equal(true);
    expect((await journal.verify('take:10000')).verifiedThroughSequence).to.equal(10000);
    const opened = await journal.openTake('take:10000');
    expect(opened.inspection).to.deep.equal({ paused: true, recording: false, hardware: false, thru: false, physicalLayers: false });
    const slice = await journal.query({ takeId: 'take:10000', firstTick: 5000, lastTick: 5002 });
    expect(slice.records.map(record => record.tick)).to.deep.equal([5000, 5001, 5002]);
  });

  it('preserves nested typed expression, more than 32 movement entries and negative zero', async () => {
    const { journal } = setup(), writer = await journal.createTake(definition('take:nested'));
    const payload = { pitch: { cents: 6012.345678901, referenceHz: 440, ratio: [5, 4] },
      expression: { body: { anchor: { x: -0, y: 1.125 } }, contact: { ancestry: ['source:a', 'source:b'] } },
      segments: Array.from({ length: 64 }, (_, index) => ({ x: index / 3, y: index / 7 })) };
    expect(writer.append({ kind: 'musical-intents', tick: 1, generation: 1, payload }).status).to.equal('accepted');
    await writer.stop();
    const captured = (await journal.query({ takeId: 'take:nested' })).records[0].payload;
    expect(captured).to.deep.equal(payload); expect(Object.is(captured.expression.body.anchor.x, -0)).to.equal(true);
    expect(canonicalJournalText({ x: -0 }).text).not.to.equal(canonicalJournalText({ x: 0 }).text);
  });

  it('splits dense queued chunks at the structural bound without splitting atomic groups', async () => {
    const budget = createResourceBudget(), jobs = createTestBackgroundJobs();
    const { journal, chunks } = setup({ resourceBudget: budget, jobs }), writer = await journal.createTake(definition('take:dense'));
    const dense = tick => ({ ...marker(tick), payload: { samples: Array(80000).fill(0) } });
    for (let tick = 1; tick <= 6; tick += 2) expect(writer.appendMany([dense(tick), dense(tick + 1)]).status).to.equal('accepted');
    expect((await writer.stop()).state).to.equal('finalized');
    expect(chunks.size).to.equal(3);
    for (const chunk of chunks.values()) {
      const body = JSON.parse(chunk.canonical), encoded = canonicalJournalText(body, { maxBytes: 4198400 });
      expect(encoded.nodes).to.equal(chunk.nodes); expect(encoded.nodes).to.be.at.most(200000);
      expect(body.records).to.have.length(2);
      expect(body.records[0].admissionGroup).to.deep.equal(body.records[1].admissionGroup);
    }
    expect((await journal.verify('take:dense')).verifiedThroughSequence).to.equal(6);
    const query = await journal.queryOwned({ takeId: 'take:dense', firstSequence: 3, lastSequence: 4, limit: 2 });
    expect(query.value.records.map(record => record.tick)).to.deep.equal([3, 4]);
    expect(query.value.records[1].payload.samples).to.have.length(80000); query.release();
    await journal.releaseQualifications().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); jobs.dispose();
  });

  it('refuses an indivisible group above the structural bound before advancing its durable prefix', async () => {
    const budget = createResourceBudget(), { journal, chunks } = setup({ resourceBudget: budget });
    const writer = await journal.createTake(definition('take:dense-refusal')); writer.append(marker(1)); await writer.flush();
    const dense = tick => ({ ...marker(tick), payload: { samples: Array(100000).fill(0) } });
    expect(writer.appendMany([dense(2), dense(3)])).to.include({ status: 'rejected', reason: 'capacity', durableSequence: 1, admittedSequence: 1, pendingBytes: 0 });
    expect(chunks.size).to.equal(1); expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect((await writer.stop()).state).to.equal('partial');
    expect((await journal.verify('take:dense-refusal')).verifiedThroughSequence).to.equal(1);
  });

  it('shares admitted immutable coverage above 64KiB across pages while retaining query ownership', async () => {
    const budget = createResourceBudget(), { journal } = setup({ resourceBudget: budget });
    const writer = await journal.createTake(definition('take:coverage-pages')); writer.appendMany([marker(1), marker(2)]);
    const coverage = { status: 'complete', gaps: Array.from({ length: 1200 }, (_, index) => ({ kind: 'effect-performance',
      firstTick: index * 2, lastTick: index * 2, generation: 1, reason: 'effect-performance-not-in-capture-profile' })) };
    expect(canonicalJournalText(coverage).bytes.length).to.be.greaterThan(65536); await writer.stop({ coverage });
    const first = await journal.queryOwned({ takeId: 'take:coverage-pages', limit: 1 });
    const second = await journal.queryOwned({ takeId: 'take:coverage-pages', firstSequence: first.value.nextSequence, limit: 1 });
    expect(first.value.coverage).to.deep.equal(coverage); expect(second.value.coverage).to.equal(first.value.coverage);
    expect(() => { first.value.coverage.gaps.length = 0; }).to.throw(TypeError);
    first.release(); await journal.releaseQualifications().completion;
    expect(second.value.coverage.gaps).to.have.length(1200); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    second.release(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('keeps the exact durable prefix on quota failure and releases pending memory only on explicit discard', async () => {
    const budget = createResourceBudget({ limitBytes: 8 * 1048576 });
    const { journal, control } = setup({ resourceBudget: budget }), writer = await journal.createTake(definition('take:quota'));
    writer.append(marker(1)); await writer.flush();
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    control.failNext = true; writer.append(marker(2));
    try { await writer.flush(); } catch { /* The live caller receives a partial status. */ }
    expect(writer.status()).to.include({ state: 'recovery-required', durableSequence: 1, admittedSequence: 2 });
    expect(writer.canReplaceDocument()).to.equal(false);
    control.failNext = true;
    const stopped = await writer.stop();
    expect(stopped.complete).to.equal(false);
    expect((await journal.openTake('take:quota')).effectiveStatus).to.equal('partial');
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    writer.discardPending({ reason: 'user-discarded-undurable-tail' });
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect(writer.canReplaceDocument()).to.equal(false);
    await writer.stop();
    expect((await journal.openTake('take:quota')).coverage.gaps).to.deep.include({ kind: 'all', firstSequence: 2,
      lastSequence: 2, firstTick: 2, lastTick: 2, generations: [1], reason: 'user-discarded-undurable-tail', discarded: true });
    expect(writer.canReplaceDocument()).to.equal(true);
  });

  it('keeps a selectively failed chunk retryable without publishing a terminal manifest', async () => {
    const store = createMemoryCausalStore(), commit = store.storage.commitCausalTake;
    let rejectChunks = true, finalizations = 0;
    store.storage.commitCausalTake = update => {
      if (update.chunk && rejectChunks) return Promise.reject(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
      if ((update.head || update.manifest).state !== 'recording') finalizations++;
      return commit(update);
    };
    const journal = createProcgenCausalJournal({ storage: store.storage }), writer = await journal.createTake(definition('take:retry'));
    writer.append(marker(1)); await writer.flush().catch(() => {});
    expect(await writer.stop()).to.include({ state: 'recovery-required', captureStopped: true, terminal: false });
    expect(finalizations).to.equal(0); expect(store.manifests.get('take:retry').state).to.equal('recording');
    rejectChunks = false;
    const [first, duplicate] = await Promise.all([writer.stop(), writer.stop()]);
    expect(first).to.deep.equal(duplicate); expect(first).to.include({ state: 'finalized', durableSequence: 1, pendingBytes: 0 });
    expect(store.chunks.size).to.equal(1); expect(finalizations).to.equal(1);
    expect((await journal.verify('take:retry')).status).to.equal('complete');
  });

  it('recovers a lost successful commit receipt without duplicating the source sequence', async () => {
    const { journal, control, chunks } = setup(), writer = await journal.createTake(definition('take:receipt'));
    control.loseNextReceipt = true; writer.append(marker(1));
    await writer.stop();
    expect(chunks.size).to.equal(1);
    expect((await journal.verify('take:receipt')).status).to.equal('complete');
  });

  it('names missing or corrupt chunks and protects finalization/source metadata', async () => {
    const { journal, chunks, manifests } = setup(), writer = await journal.createTake(definition('take:corrupt'));
    writer.append(marker(1)); await writer.stop();
    const [key, chunk] = [...chunks.entries()][0]; chunks.delete(key);
    let error; try { await journal.verify('take:corrupt'); } catch (failure) { error = failure; }
    expect(error).to.include({ code: 'missing-chunk', firstSequence: 1, chunkId: key });
    chunks.set(key, { ...chunk, canonical: chunk.canonical.replace('marker:1', 'marker:2') });
    try { await journal.verify('take:corrupt'); } catch (failure) { error = failure; }
    expect(error.code).to.equal('corrupt-chunk');
    chunks.set(key, chunk);
    const manifest = manifests.get('take:corrupt'); manifest.sourceVersions.generator = 'changed';
    try { await journal.verify('take:corrupt'); } catch (failure) { error = failure; }
    expect(error.code).to.equal('metadata-divergence');
  });

  it('branches a durable prefix by immutable references and keeps the original untouched', async () => {
    const { journal, chunks } = setup(), writer = await journal.createTake(definition('take:parent'));
    for (let tick = 1; tick <= 8; tick++) writer.append(marker(tick));
    await writer.stop();
    const parentBefore = JSON.stringify(await journal.openTake('take:parent')), originalChunks = chunks.size;
    const branch = await journal.branch({ parentTakeId: 'take:parent', throughSequence: 4, takeId: 'take:branch' });
    expect(branch.manifest().prefix).to.include({ version: 2, throughSequence: 4, parentRootHash: writer.manifest().rootHash });
    expect(branch.manifest().prefix).not.to.have.property('chunks');
    branch.append({ ...marker(5), payload: { name: 'alternate' } }); await branch.stop();
    expect(chunks.size).to.equal(originalChunks + 1);
    expect((await journal.query({ takeId: 'take:branch' })).records.map(record => record.payload.name))
      .to.deep.equal(['marker:1', 'marker:2', 'marker:3', 'marker:4', 'alternate']);
    expect(JSON.stringify(await journal.openTake('take:parent'))).to.equal(parentBefore);
    expect((await journal.verify('take:branch')).status).to.equal('complete');
    const seek = await journal.seek({ takeId: 'take:branch', sequence: 4 });
    expect(seek.checkpointSequence).to.equal(0);
    expect(seek.records.map(record => record.payload.name)).to.deep.equal(['marker:1', 'marker:2', 'marker:3', 'marker:4']);
  });

  it('seeks from a durable component checkpoint and rejects incompatible assets or stale queries', async () => {
    const { journal } = setup(), writer = await journal.createTake(definition('take:seek'));
    for (let tick = 1; tick <= 5; tick++) writer.append(marker(tick));
    const checkpoint = writer.checkpoint({ value: { tick: 5, world: { source: 'verified' } }, tick: 5, generation: 1 });
    writer.append(marker(6)); await checkpoint; await writer.stop();
    const plan = await journal.seek({ takeId: 'take:seek', sequence: 6 });
    expect(plan.checkpointSequence).to.equal(5); expect(plan.records.map(record => record.tick)).to.deep.equal([6]);
    expect(plan.inspection.hardware).to.equal(false);
    let error; try { await journal.seek({ takeId: 'take:seek', sequence: 6, assetRefs: ['wrong-asset'] }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('source-incompatible');
    try { await journal.query({ takeId: 'take:seek', takeRevision: 1 }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('stale-revision');
  });

  it('retains each ancestor cutoff when a branch reuses chunks spanning abandoned source records', async () => {
    const { journal } = setup(), writer = await journal.createTake(definition('take:ancestor'));
    for (let tick = 1; tick <= 8; tick++) writer.append(marker(tick));
    await writer.stop();
    const first = await journal.branch({ parentTakeId: 'take:ancestor', throughSequence: 4, takeId: 'take:first-branch' });
    first.append({ ...marker(5), payload: { name: 'first-branch:5' } });
    first.append({ ...marker(6), payload: { name: 'first-branch:6' } });
    await first.stop();
    const second = await journal.branch({ parentTakeId: 'take:first-branch', throughSequence: 5, takeId: 'take:second-branch' });
    second.append({ ...marker(6), payload: { name: 'second-branch:6' } }); await second.stop();
    const result = await journal.query({ takeId: 'take:second-branch' });
    expect(result.records.map(record => [record.sequence, record.payload.name])).to.deep.equal([
      [1, 'marker:1'], [2, 'marker:2'], [3, 'marker:3'], [4, 'marker:4'], [5, 'first-branch:5'], [6, 'second-branch:6']
    ]);
    expect((await journal.verify('take:second-branch')).verifiedThroughSequence).to.equal(6);
  });

  it('denies checkpoint memory before encoding and leaves no reservation or take record', async () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), { journal, manifests } = setup({ resourceBudget: budget });
    let error; try { await journal.createTake({ ...definition('take:denied'), initialCheckpoint: { data: 'x'.repeat(2000) } }); } catch (failure) { error = failure; }
    expect(error.name).to.equal('ResourceBudgetError'); expect(manifests.size).to.equal(0);
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('stores an immutable bounded take name in source metadata and detects name tampering', async () => {
    const { journal, manifests } = setup(), writer = await journal.createTake({ ...definition('take:named'), takeName: '  Brick chorus  ' });
    await writer.stop();
    expect((await journal.openTake('take:named')).takeName).to.equal('Brick chorus');
    manifests.get('take:named').takeName = 'changed title';
    let error; try { await journal.openTake('take:named', { force: true }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('metadata-divergence');
    try { await journal.createTake({ ...definition('take:too-long'), takeName: 'x'.repeat(121) }); } catch (failure) { error = failure; }
    expect(error.message).to.include('bounded name');
  });

  it('exposes pure manifest verification and binds finalized query indexes to their evidence hash', async () => {
    const { journal, manifests } = setup(), writer = await journal.createTake(definition('take:index-hash'));
    writer.append(marker(1)); await writer.stop();
    expect((await verifyManifestHashes(await journal.openTake('take:index-hash'))).effectiveStatus).to.equal('complete');
    manifests.get('take:index-hash').chunks[0].firstTick = 999;
    let error; try { await journal.openTake('take:index-hash', { force: true }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('finalization-divergence');
  });

  it('qualifies a finalized revision once for repeated tail, middle and replay pages', async () => {
    const { journal, storage, control } = setup({ maxChunkRecords: 1 });
    const writer = await journal.createTake(definition('take:qualified'));
    for (let tick = 1; tick <= 200; tick++) { writer.append(marker(tick)); await writer.flush(); }
    await writer.stop(); control.manifestReads = 0;
    for (const firstSequence of [199, 100, 200, 101, 198]) {
      const result = await journal.query({ takeId: 'take:qualified', firstSequence, lastSequence: firstSequence, limit: 1 });
      expect(result.records.map(record => record.sequence)).to.deep.equal([firstSequence]);
    }
    for (const firstTick of [90, 190, 91]) {
      const result = await journal.query({ takeId: 'take:qualified', firstTick, lastTick: firstTick, generation: 1, limit: 1 });
      expect(result.records.map(record => record.tick)).to.deep.equal([firstTick]);
    }
    expect(control.manifestReads).to.equal(1);
    const read = storage.loadCausalChunk;
    storage.loadCausalChunk = async id => {
      const value = await read(id); control.afterRead?.(); return value;
    };
    const signal = new AbortController(); control.afterRead = () => signal.abort();
    let error; try { await journal.query({ takeId: 'take:qualified', firstSequence: 200, signal: signal.signal }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('cancelled');
  });

  it('rejects a source revision changed while its requested records are being loaded', async () => {
    const { journal, storage, manifests } = setup(), writer = await journal.createTake(definition('take:mid-read'));
    writer.append(marker(1)); await writer.flush();
    const read = storage.loadCausalChunk;
    storage.loadCausalChunk = async id => { const result = await read(id); manifests.get('take:mid-read').revision++; return result; };
    let error; try { await journal.query({ takeId: 'take:mid-read' }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('stale-revision');
  });

  it('rejects conflicting component snapshots at one source boundary and verifies their encoded byte inventory', async () => {
    const { journal, checkpoints } = setup(), writer = await journal.createTake(definition('take:checkpoint-conflict'));
    writer.append(marker(1)); await writer.checkpoint({ value: { world: { tick: 1 } }, tick: 1, generation: 1 });
    let error; try { await writer.checkpoint({ value: { world: { tick: 999 } }, tick: 1, generation: 1 }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('checkpoint-conflict'); await writer.stop();
    const manifest = await journal.openTake('take:checkpoint-conflict'), ref = manifest.checkpoints.at(-1);
    expect(ref.bytes).to.equal(new TextEncoder().encode(checkpoints.get(ref.id).canonical).length);
    expect(await journal.readCheckpoint(ref)).to.deep.equal({ world: { tick: 1 } });
    try { await journal.readCheckpoint({ ...ref, bytes: ref.bytes - 1 }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('checkpoint-mismatch');
  });
});
