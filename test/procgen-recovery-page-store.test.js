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
const setup = () => {
  const adapter = recoveryTransactionDb(), budget = createResourceBudget();
  const jobs = { async compute(request) {
    request.signal?.throwIfAborted(); const input = await request.prepareInput();
    const value = request.kind === 'encode-recovery-page' ? await encodeProcgenRecoveryPage(input) : await decodeProcgenRecoveryPage(input);
    return { value, release() {} };
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
    const before = structuredClone([...f.records]); f.failAfter(writes);
    let error; try { await f.store.save(session('interrupted'), { documentRevision: 1, tick: 1 }); } catch (value) { error = value; }
    expect(error).to.exist; expect([...f.records]).to.deep.equal(before); f.store.dispose();
  });
  it('rejects corrupt chunks and invalidates owned readers when storage closes', async () => {
    const f = setup(); await f.store.save(session('durable'), { documentRevision: 0, tick: 1 });
    const record = f.records.get('recovery:slot:1'), source = await f.store.load(record, { owned: true });
    f.records.get(record.paged.key).bytes[0] ^= 1;
    let error; try { await f.store.load(record, { owned: true }); } catch (value) { error = value; } expect(error.name).to.equal('RecoveryCandidateError');
    f.store.dispose(); expect(() => source.session).to.throw(); source.release();
  });
});
