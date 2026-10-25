import { expect } from 'chai';
import { createProcgenRecoveryPageStore } from '../js/app/procgen/workstation/ProcgenRecoveryPageStore.js';
import { encodeProcgenRecoveryPage, decodeProcgenRecoveryPage } from '../js/app/procgen/workstation/ProcgenRecoveryPageCodec.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { recoveryTransactionDb } from './support/recovery-transaction-db.js';

const boundary = tick => ({ worldId: 'world:fixture', tick, generation: 0, seed: 7, terrainRevision: 0, nextActorId: 1, simulationTimeMs: tick * 60, causalSequence: tick });
const base = { laneCount: 1, seed: 7, graph: { nodes: [], owners: [], estimatedBytes: 4096 } };
const page = Object.freeze([Object.freeze({ sequence: 1, kind: 'step', eventTimeMs: 0, speedFactor: 1, boundary: boundary(1) })]);
const session = name => ({ name, world: base, savedAt: '2026-10-25T00:00:00Z', project: { procgen: { lanes: [{}] } },
  recoveryJournal: { schema: 'procgen-recovery-journal/v1', initial: boundary(0), final: boundary(1), sequence: 1, pages: [page] } });
const setup = ({ releasePhase = 'released', failWorkerAt = () => false } = {}) => {
  const adapter = recoveryTransactionDb(), budget = createResourceBudget(); let workerCalls = 0;
  const jobs = { async compute(request) {
    request.signal?.throwIfAborted(); if (failWorkerAt(++workerCalls)) throw Object.assign(new Error('Injected worker termination'), { name: 'BackgroundJobError' }); const input = await request.prepareInput();
    const value = request.kind === 'encode-recovery-page' ? await encodeProcgenRecoveryPage(input) : await decodeProcgenRecoveryPage(input);
    let released = false; return { value, release() { released = true; }, retirementState: () => ({ phase: released ? releasePhase : 'computed' }) };
  } };
  const store = createProcgenRecoveryPageStore({ open: async () => adapter.db, jobs, resourceBudget: budget, isCurrent: () => true, validateSession() {} });
  return { ...adapter, store, budget };
};
describe('atomic incremental recovery page publication', () => {
  it('reuses immutable base/pages and keeps two reachable generations only', async () => {
    const f = setup();
    for (let revision = 0; revision < 5; revision++) await f.store.save(session('revision ' + revision), { documentRevision: revision, tick: 1 });
    expect(f.store.stats().reusedPages).to.equal(8);
    const head = f.records.get('recovery:head'), record = f.records.get(`recovery:slot:${head.slot}`);
    const source = await f.store.load(record, { owned: true }); expect(source.session.name).to.equal('revision 4');
    expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    source.release(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    const reachable = new Set([0, 1].flatMap(slot => f.records.get(`recovery:slot:${slot}`).references));
    expect([...f.records.keys()].filter(key => key.startsWith('recovery:chunk:')).sort()).to.deep.equal([...reachable].sort()); f.store.dispose();
  });
  for (const writes of [1, 2, 3]) it(`preserves the previous manifest when terminated at write ${writes}`, async () => {
    const f = setup(); await f.store.save(session('durable'), { documentRevision: 0, tick: 1 });
    const before = structuredClone([...f.records]), pinsBefore = structuredClone([...f.pins]); f.failAfter(writes);
    let error; try { await f.store.save(session('interrupted'), { documentRevision: 1, tick: 1 }); } catch (value) { error = value; }
    expect(error).to.exist; expect([...f.records]).to.deep.equal(before); expect([...f.pins]).to.deep.equal(pinsBefore); f.store.dispose();
  });
  for (const boundary of [1, 2, 3, 4, 5, 6]) for (const failureName of ['AbortError', 'QuotaExceededError']) it(`retains complete data and source pins at write boundary ${boundary} after ${failureName}`, async () => {
    const f = setup(); await f.store.save(session('previous'), { documentRevision: 0, tick: 1 });
    const before = structuredClone([...f.records]), pinsBefore = structuredClone([...f.pins]); f.failAfter(boundary, failureName);
    const next = { ...session('new'), world: structuredClone(base) }; next.recoveryJournal = { ...next.recoveryJournal, pages: [structuredClone(page)] };
    let failure; try { await f.store.save(next, { documentRevision: 1, tick: 1 }); } catch (error) { failure = error; }
    expect(failure).to.exist; expect([...f.records]).to.deep.equal(before); expect([...f.pins]).to.deep.equal(pinsBefore);
    const restored = await f.store.load(f.records.get('recovery:slot:1'), { owned: true }); expect(restored.session.name).to.equal('previous'); restored.release(); f.store.dispose();
  });
  for (const offset of [1, 2, 3]) it(`never publishes a manifest after worker failure at encoded chunk ${offset}`, async () => {
    let fail = Infinity; const f = setup({ failWorkerAt: count => count === fail }); await f.store.save(session('previous'), { documentRevision: 0, tick: 1 });
    const before = structuredClone([...f.records]); fail = 3 + offset;
    const next = { ...session('new'), world: structuredClone(base) }; next.recoveryJournal = { ...next.recoveryJournal, pages: [structuredClone(page)] };
    let failure; try { await f.store.save(next, { documentRevision: 1, tick: 1 }); } catch (error) { failure = error; }
    expect(failure?.name).to.equal('BackgroundJobError'); expect([...f.records]).to.deep.equal(before); f.store.dispose();
  });
  it('commits recovery source pins with the two rotating durable slots, never the current writer identity', async () => {
    const f = setup(), deploymentRoot = 'https://app.invalid/lemmings/';
    for (let revision = 0; revision < 3; revision++) await f.store.save({ ...session('source ' + revision), executionIdentity: { activeExecution: 'bound', buildId: String(revision).repeat(64), deploymentRoot } }, { documentRevision: revision, tick: 1 });
    expect(f.pins.size).to.equal(2); expect(f.pins.get('recovery:slot:1').source.buildId).to.equal('2'.repeat(64)); expect(f.pins.get('recovery:slot:0').source.buildId).to.equal('1'.repeat(64));
    for (const [key, pin] of f.pins) expect(pin.generation).to.equal(f.records.get(key).generation); f.store.dispose();
  });
  it('reports a completed commit even when cancellation arrives before its completion callback', async () => {
    const f = setup(), controller = new AbortController(); f.afterCommit(() => controller.abort(new Error('late cancellation')));
    const receipt = await f.store.save(session('committed'), { signal: controller.signal, documentRevision: 4, tick: 1 });
    expect(receipt).to.include({ durable: true, canceledAfterCommit: true, documentRevision: 4 }); expect(receipt.retirement.status).to.equal('complete');
    const source = await f.store.load(f.records.get('recovery:slot:1'), { owned: true }); expect(source.session.name).to.equal('committed'); source.release(); f.store.dispose();
  });
  it('distinguishes durable data from unknown worker-result cleanup', async () => {
    const f = setup({ releasePhase: 'failed-or-unknown' });
    const receipt = await f.store.save(session('durable-but-cleanup-unknown'), { documentRevision: 5, tick: 1 });
    expect(receipt.durable).to.equal(true); expect(receipt.retirement.status).to.equal('unknown'); expect(receipt.retirement.failureCount).to.equal(3);
    expect(f.records.get('recovery:head').generation).to.equal(receipt.generation); expect(f.store.stats().retirementFailures).to.equal(3);
    const source = await f.store.load(f.records.get('recovery:slot:1'), { owned: true }); expect(() => source.release()).to.throw('unresolved'); expect(() => source.release()).to.throw('unresolved'); f.store.dispose();
  });
  it('rejects corrupt chunks and invalidates owned readers when storage closes', async () => {
    const f = setup(); await f.store.save(session('durable'), { documentRevision: 0, tick: 1 });
    const record = f.records.get('recovery:slot:1'), source = await f.store.load(record, { owned: true });
    f.records.get(record.paged.key).bytes[0] ^= 1;
    let error; try { await f.store.load(record, { owned: true }); } catch (value) { error = value; } expect(error.name).to.equal('RecoveryCandidateError');
    f.store.dispose(); expect(() => source.session).to.throw(); source.release();
  });
});
