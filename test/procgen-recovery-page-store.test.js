import { sealMidiProjectSnapshot } from '../js/midi/project/MidiProjectSnapshot.js';
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
  for (const boundary of [1, 2, 3, 4, 5, 6, 7]) for (const failureName of ['AbortError', 'QuotaExceededError']) it(`retains complete data and source pins at write boundary ${boundary} after ${failureName}`, async () => {
    const f = setup(); await f.store.save(session('previous'), { documentRevision: 0, tick: 1 });
    const before = structuredClone([...f.records]), pinsBefore = structuredClone([...f.pins]); f.failAfter(boundary, failureName);
    const next = { ...session('new'), world: structuredClone(base) }; next.recoveryJournal = { ...next.recoveryJournal, pages: [structuredClone(page)] };
    let failure; try { await f.store.save(next, { documentRevision: 1, tick: 1 }); } catch (error) { failure = error; }
    expect(failure).to.exist; expect([...f.records]).to.deep.equal(before); expect([...f.pins]).to.deep.equal(pinsBefore);
    const restored = await f.store.load(f.records.get('recovery:slot:1'), { owned: true }); expect(restored.session.name).to.equal('previous'); restored.release(); f.store.dispose();
  });
  for (const offset of [1, 2, 3, 4]) it(`never publishes a manifest after worker failure at encoded chunk ${offset}`, async () => {
    let fail = Infinity; const f = setup({ failWorkerAt: count => count === fail }); await f.store.save(session('previous'), { documentRevision: 0, tick: 1 });
    const before = structuredClone([...f.records]); fail = f.store.stats().encodedPages + offset;
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
    expect(receipt.durable).to.equal(true); expect(receipt.retirement.status).to.equal('unknown'); expect(receipt.retirement.failureCount).to.equal(4);
    expect(f.records.get('recovery:head').generation).to.equal(receipt.generation); expect(f.store.stats().retirementFailures).to.equal(4);
    const source = await f.store.load(f.records.get('recovery:slot:1'), { owned: true }); expect(() => source.release()).to.throw('unresolved'); expect(() => source.release()).to.throw('unresolved'); f.store.dispose();
  });
  it('re-encodes only a changed sealed lane and its manifest, not every authored pattern', async () => {
    const f = setup(), project = sealMidiProjectSnapshot({ name: 'immutable', global: { scale: [0, 2, 4] }, procgen: { revision: 0, lanes: [{ id: 'a', patterns: [{ steps: [{ enabled: true }] }] }, { id: 'b', patterns: [{ steps: [{ enabled: false }] }] }] } });
    await f.store.save({ ...session('first'), project }, { documentRevision: 0, tick: 1 });
    const encoded = f.store.stats().encodedPages;
    const changed = sealMidiProjectSnapshot({ ...project, procgen: { ...project.procgen, revision: 1, lanes: [project.procgen.lanes[0], { ...project.procgen.lanes[1], patterns: [{ steps: [{ enabled: true }] }] }] } });
    await f.store.save({ ...session('second'), project: changed }, { documentRevision: 1, tick: 1 });
    expect(f.store.stats().encodedPages - encoded).to.equal(2);
    const source = await f.store.load(f.records.get('recovery:slot:0'), { owned: true }); expect(source.session.project).to.deep.equal(changed); source.release(); f.store.dispose();
  });
  it('does not reuse a mutable lane merely because its identity or shallow freeze is unchanged', async () => {
    const f = setup(), lane = Object.freeze({ patterns: [{ steps: [{ enabled: false }] }] }), project = { procgen: { lanes: [lane] } };
    await f.store.save({ ...session('first'), project }, { documentRevision: 0, tick: 1 }); lane.patterns[0].steps[0].enabled = true;
    await f.store.save({ ...session('changed'), project }, { documentRevision: 1, tick: 1 });
    const source = await f.store.load(f.records.get('recovery:slot:0'), { owned: true }); expect(source.session.project.procgen.lanes[0].patterns[0].steps[0].enabled).to.equal(true); source.release(); f.store.dispose();
  });
  it('reads a legacy v1 manifest without requiring project-page migration first', async () => {
    const f = setup(), original = session('legacy'), refs = [], put = async value => {
      const page = await encodeProcgenRecoveryPage(value), key = 'recovery:chunk:legacy:' + refs.length;
      const ref = { key, sha256: page.sha256, encoding: page.encoding, rawBytes: page.rawBytes, storedBytes: page.bytes.byteLength }; refs.push(ref); f.records.set(key, { id: key, kind: 'recovery-chunk', ...page }); return ref;
    };
    const baseRef = await put(base), pageRef = await put(page), { world: _world, recoveryJournal, ...header } = original;
    const root = await put({ schema: 'procgen-paged-recovery/v1', session: header, base: baseRef, journal: { ...recoveryJournal, pages: [pageRef] } });
    const source = await f.store.load({ generation: 1, checksum: root.sha256, paged: root, references: refs.map(ref => ref.key), storedBytes: refs.reduce((sum, ref) => sum + ref.storedBytes, 0) }, { owned: true });
    expect(source.session).to.deep.equal(original); source.release(); f.store.dispose();
  });
  it('rejects extra unreachable pages and duplicate recorded references', async () => {
    const f = setup(); await f.store.save(session('complete'), { documentRevision: 0, tick: 1 }); const record = f.records.get('recovery:slot:1');
    for (const references of [[...record.references, record.references[0]], [...record.references, 'recovery:chunk:missing']]) {
      let failure; try { await f.store.load({ ...record, references }, { owned: true }); } catch (error) { failure = error; }
      expect(failure?.name).to.equal('RecoveryCandidateError'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    } f.store.dispose();
  });
  it('keeps every fragmented binary write atomic, bounded and reachable across failure boundaries', async function() {
    this.timeout(60000);
    let seed = 123456; const text = Array.from({ length: 256 * 1024 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return String.fromCharCode(32 + ((seed >>> 0) % 95)); }).join('');
    const large = () => ({ ...session('fragmented'), world: structuredClone(base), project: { procgen: { lanes: [{ payload: text }] } }, recoveryJournal: { ...session('x').recoveryJournal, pages: [structuredClone(page)] } });
    const complete = setup(); await complete.store.save(large(), { documentRevision: 0, tick: 1 });
    const chunks = [...complete.records.values()].filter(value => value.id.startsWith('recovery:chunk:'));
    expect(chunks.some(value => value.kind === 'recovery-chunk-part')).to.equal(true);
    expect(complete.store.stats().maximumStoredPayloadBytes).to.be.at.most(65536);
    const source = await complete.store.load(complete.records.get('recovery:slot:1'), { owned: true }); expect(source.session.project.procgen.lanes[0].payload).to.equal(text); source.release(); complete.store.dispose();
    for (let boundary = 1; boundary <= chunks.length + 3; boundary++) {
      const f = setup(); await f.store.save(session('previous'), { documentRevision: 0, tick: 1 });
      const before = structuredClone([...f.records]), pins = structuredClone([...f.pins]); f.failAfter(boundary, 'QuotaExceededError');
      let failure; try { await f.store.save(large(), { documentRevision: 1, tick: 1 }); } catch (error) { failure = error; }
      expect(failure, 'fragment write ' + boundary).to.exist; expect([...f.records]).to.deep.equal(before); expect([...f.pins]).to.deep.equal(pins); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose();
    }
  });
  it('rejects corrupt chunks and invalidates owned readers when storage closes', async () => {
    const f = setup(); await f.store.save(session('durable'), { documentRevision: 0, tick: 1 });
    const record = f.records.get('recovery:slot:1'), source = await f.store.load(record, { owned: true });
    f.records.get(record.paged.key).bytes[0] ^= 1;
    let error; try { await f.store.load(record, { owned: true }); } catch (value) { error = value; } expect(error.name).to.equal('RecoveryCandidateError');
    f.store.dispose(); expect(() => source.session).to.throw(); source.release();
  });
});
