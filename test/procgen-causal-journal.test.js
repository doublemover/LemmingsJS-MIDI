import { expect } from 'chai';
import { createProcgenCausalJournal, verifyManifestHashes } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { canonicalJournalText } from '../js/app/procgen/workstation/CausalJournalCanonical.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

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

  it('keeps the exact durable prefix on quota failure and releases pending memory only on explicit discard', async () => {
    const budget = createResourceBudget({ limitBytes: 8 * 1048576 });
    const { journal, control } = setup({ resourceBudget: budget }), writer = await journal.createTake(definition('take:quota'));
    writer.append(marker(1)); await writer.flush();
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    control.failNext = true; writer.append(marker(2));
    try { await writer.flush(); } catch { /* The live caller receives a partial status. */ }
    expect(writer.status()).to.include({ state: 'partial', durableSequence: 1, admittedSequence: 2 });
    expect(writer.canReplaceDocument()).to.equal(false);
    control.failNext = true;
    const stopped = await writer.stop();
    expect(stopped.complete).to.equal(false);
    expect((await journal.openTake('take:quota')).effectiveStatus).to.equal('partial');
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    writer.discardPending({ reason: 'user-discarded-undurable-tail' });
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect(writer.canReplaceDocument()).to.equal(true);
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
    let error; try { await journal.openTake('take:named'); } catch (failure) { error = failure; }
    expect(error.code).to.equal('metadata-divergence');
    try { await journal.createTake({ ...definition('take:too-long'), takeName: 'x'.repeat(121) }); } catch (failure) { error = failure; }
    expect(error.message).to.include('bounded name');
  });

  it('exposes pure manifest verification and binds finalized query indexes to their evidence hash', async () => {
    const { journal, manifests } = setup(), writer = await journal.createTake(definition('take:index-hash'));
    writer.append(marker(1)); await writer.stop();
    expect((await verifyManifestHashes(await journal.openTake('take:index-hash'))).effectiveStatus).to.equal('complete');
    manifests.get('take:index-hash').chunks[0].firstTick = 999;
    let error; try { await journal.query({ takeId: 'take:index-hash', firstTick: 1, lastTick: 1 }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('finalization-divergence');
  });
});
