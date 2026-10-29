import { expect } from 'chai';
import { createProcgenPreferencePages } from '../js/app/procgen/workstation/ProcgenPreferencePages.js';
import { sealMidiProjectSnapshot } from '../js/midi/project/MidiProjectSnapshot.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { recoveryTransactionDb } from './support/recovery-transaction-db.js';

const authored = (note = 60, lanes = 9) => sealMidiProjectSnapshot({ version: 1, project: { version: 1, name: 'Score', settings: { bpm: 120 },
  procgen: { enabled: true, lanes: Array.from({ length: lanes }, (_, index) => ({ id: 'lane-' + index, pattern: { note: note + index }, unicode: '音楽é😀' })) } },
ui: { tab: 'Lane', recording: false }, transport: { bpm: 120, playing: false } });
const changed = (value, note) => sealMidiProjectSnapshot({ ...value, project: { ...value.project, procgen: { ...value.project.procgen,
  lanes: value.project.procgen.lanes.map((lane, index) => index ? lane : { ...lane, pattern: { note } }) } } });
const setup = ({ budget = createResourceBudget(), beforeCompute = async () => {}, releasePhase = 'released', now = Date.now } = {}) => {
  const adapter = recoveryTransactionDb(), calls = []; let releases = 0;
  const store = createProcgenPreferencePages({ open: async () => adapter.db, resourceBudget: budget, isCurrent: () => true, now,
    jobs: { async compute(request) {
      calls.push(request); await beforeCompute(request); request.signal.throwIfAborted(); const input = await request.prepareInput();
      const value = request.kind === 'encode-preference-pages' ? input.map(page => JSON.stringify(page.value)) : JSON.parse(input); let released = false;
      return { value, release() { releases++; released = true; }, retirementState: () => ({ phase: released ? releasePhase : 'computed' }) };
    } } });
  return { ...adapter, store, budget, calls, releases: () => releases };
};
const failure = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected rejection'); };
const currentRoot = f => { const head = f.records.get('preferences:head'); return f.records.get('preferences:slot:' + head.slot); };

describe('bounded atomic authored preference pages', () => {
  it('round trips exact authored data through bounded worker groups and releases every prepared page', async () => {
    const f = setup(), value = authored(); expect(await f.store.load()).to.equal(null);
    expect(await f.store.save(value, { revision: 7 })).to.deep.equal({ durable: true, generation: 1, revision: 7 });
    expect(await f.store.load()).to.deep.equal({ ...value, documentRevision: 7 });
    expect(f.calls.map(call => call.kind)).to.deep.equal(Array(3).fill('encode-preference-pages'));
    expect(f.calls.every(call => call.estimatedPeakBytes <= 72 * 1048576)).to.equal(true);
    expect(f.releases()).to.equal(3); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    expect(f.store.diagnostics()).to.include({ pendingBytes: 0, committed: 1, encodedPages: 10, readPages: 10 }); f.store.dispose();
  });
  it('reencodes only the changed sealed lane and never trusts an arbitrary frozen mutable tree', async () => {
    const f = setup(), value = authored(); await f.store.save(value, { revision: 0 }); const count = f.store.diagnostics().encodedPages;
    await f.store.save(changed(value, 95), { revision: 1 }); expect(f.store.diagnostics().encodedPages - count).to.equal(1);
    const mutable = Object.freeze({ ...structuredClone(value), ui: { tab: 'first' } }); let finish;
    const g = setup({ beforeCompute: () => finish ? Promise.resolve() : new Promise(resolve => { finish = resolve; }) });
    const saving = g.store.save(mutable, { revision: 2 }); await new Promise(resolve => setTimeout(resolve, 0)); mutable.ui.tab = 'mutated'; finish(); await saving;
    expect((await g.store.load()).ui.tab).to.equal('first'); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose(); g.store.dispose();
  });
  it('keeps exactly two reachable generations and reencodes undo sources whose old pages were collected', async () => {
    const f = setup(), initial = authored(); let value = initial;
    for (let revision = 0; revision < 4; revision++) { value = changed(value, 80 + revision); await f.store.save(value, { revision }); }
    const reachable = new Set([0, 1].flatMap(slot => f.records.get('preferences:slot:' + slot).references.map(ref => ref.key)));
    expect([...f.records.keys()].filter(key => key.startsWith('preferences:page:')).sort()).to.deep.equal([...reachable].sort());
    const count = f.store.diagnostics().encodedPages; await f.store.save(initial, { revision: 4 });
    expect(f.store.diagnostics().encodedPages - count).to.equal(1); expect((await f.store.load()).project).to.deep.equal(initial.project); f.store.dispose();
  });
  for (const phase of [1, 2, 3, 4]) for (const write of phase === 1 ? [1, 2] : [1, 2, 3]) for (const name of ['AbortError', 'QuotaExceededError']) it('retains prior pages and head after ' + name + ' in phase ' + phase + ' at write ' + write, async () => {
    const f = setup(), value = authored(60, 1); await f.store.save(value, { revision: 0 }); const before = structuredClone([...f.records]);
    const original = f.db.transaction.bind(f.db); let transactions = 0;
    f.db.transaction = (stores, mode) => { if (mode === 'readwrite') f.failAfter(++transactions === phase ? write : Infinity, name); return original(stores, mode); };
    const next = sealMidiProjectSnapshot({ ...changed(value, 72), project: { ...changed(value, 72).project, settings: { bpm: 130 } } });
    expect((await failure(() => f.store.save(next, { revision: 1 }))).name).to.equal(name);
    expect([...f.records]).to.deep.equal(before); expect((await f.store.load()).project).to.deep.equal(value.project);
    expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose();
  });
  for (const corrupt of ['missing', 'checksum', 'layout', 'references', 'metadata', 'head', 'orphan']) it('refuses corrupt committed ' + corrupt + ' without publishing replacement data', async () => {
    const f = setup(); await f.store.save(authored(), { revision: 2 }); const root = currentRoot(f), ref = root.references[0];
    if (corrupt === 'missing') f.records.delete(ref.key);
    if (corrupt === 'checksum') f.records.get(ref.key).text = 'x'.repeat(ref.bytes / 2);
    if (corrupt === 'layout') root.layout.fields.push({ key: '__proto__', value: null });
    if (corrupt === 'references') root.references.push({ ...ref });
    if (corrupt === 'metadata') root.metadata.documentRevision++;
    if (corrupt === 'head') f.records.get('preferences:head').generation++;
    if (corrupt === 'orphan') f.records.delete('preferences:head');
    expect((await failure(() => f.store.load())).code).to.equal('invalid-preferences'); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose();
  });
  it('reads metadata without loading authored project pages', async () => {
    const f = setup(); await f.store.save(authored(), { revision: 3 }); const ref = currentRoot(f).references[0]; f.records.delete(ref.key);
    expect(await f.store.load({ includeProject: false })).to.deep.equal({ version: 1, documentRevision: 3, ui: { tab: 'Lane', recording: false }, transport: { bpm: 120, playing: false } });
    expect(f.store.diagnostics().readPages).to.equal(0); f.store.dispose();
  });
  it('refuses a concurrent head replacement while preserving the other writer', async () => {
    let replace = false; const f = setup({ beforeCompute: async () => { if (replace) {
      replace = false; const head = f.records.get('preferences:head'), root = currentRoot(f);
      f.records.set(head.id, { ...head, generation: head.generation + 2 }); f.records.set(root.id, { ...root, generation: root.generation + 2 });
    } } });
    const value = authored(); await f.store.save(value, { revision: 0 }); replace = true;
    expect((await failure(() => f.store.save(changed(value, 75), { revision: 1 }))).name).to.equal('ConflictError');
    expect(f.records.get('preferences:head').generation).to.equal(3); expect((await f.store.load()).project).to.deep.equal(value.project); f.store.dispose();
  });
  it('rejects cancellation and concurrent writes and retains accounting until worker retirement', async () => {
    let finish; const f = setup({ beforeCompute: () => new Promise(resolve => { finish = resolve; }) }), controller = new AbortController();
    const saving = failure(() => f.store.save(authored(), { revision: 0, signal: controller.signal })); await new Promise(resolve => setTimeout(resolve, 0));
    expect((await failure(() => f.store.save(authored(), { revision: 1 }))).message).to.include('already pending');
    controller.abort(new Error('Document replaced')); finish(); expect((await saving).message).to.include('Document replaced');
    expect([...f.records.keys()]).to.deep.equal(['preferences:stages']); expect(f.records.get('preferences:stages').entries).to.deep.equal([]); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose();
  });
  it('refuses prepared page admission without mutating the durable head', async () => {
    const f = setup({ budget: createResourceBudget({ limitBytes: 4096 }) }); expect(await failure(() => f.store.save(authored(), { revision: 0 }))).to.exist;
    expect([...f.records.keys()]).to.deep.equal(['preferences:stages']); expect(f.records.get('preferences:stages').entries).to.deep.equal([]); expect(f.budget.diagnostics().accountedBytes).to.equal(0); expect(f.releases()).to.equal(2); f.store.dispose();
  });
  it('refuses publication after failed batch retirement and retains its unresolved accounting', async () => {
    const tokens = new Set(); let refuse = true;
    const f = setup({ budget: { reserve({ token }) { tokens.add(token); }, release({ token }) { if (refuse) return false; tokens.delete(token); } } });
    expect(await failure(() => f.store.save(authored(60, 1), { revision: 1 }))).to.be.instanceOf(AggregateError); expect(f.records.has('preferences:head')).to.equal(false);
    expect(tokens.size).to.equal(1); expect(f.store.diagnostics().pendingBytes).to.be.greaterThan(0); refuse = false; f.store.dispose(); expect(tokens.size).to.equal(0);
  });
  it('does not commit pages after unresolved worker result retirement', async () => {
    const f = setup({ releasePhase: 'retiring' }); expect((await failure(() => f.store.save(authored(), { revision: 0 }))).name).to.equal('ResourceOwnershipError');
    expect([...f.records.keys()]).to.deep.equal(['preferences:stages']); expect(f.records.get('preferences:stages').entries).to.deep.equal([]); expect(f.store.diagnostics().pendingBytes).to.equal(0); f.store.dispose();
  });
  it('parses a large Unicode page in a bounded worker and detaches its owned result', async () => {
    const f = setup(), value = authored(60, 1), large = sealMidiProjectSnapshot({ ...value, project: { ...value.project, text: { content: '音'.repeat(80000) } } });
    await f.store.save(large, { revision: 1 }); expect((await f.store.load()).project).to.deep.equal(large.project);
    expect(f.calls.some(call => call.kind === 'parse-json')).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose();
  });
  it('stages a score larger than the live page allowance without retaining all encoded strings', async () => {
    const f = setup({ budget: createResourceBudget({ limitBytes: 128 * 1024 }) }), value = authored(60, 128);
    const large = sealMidiProjectSnapshot({ ...value, project: { ...value.project, procgen: { ...value.project.procgen,
      lanes: value.project.procgen.lanes.map(lane => ({ ...lane, content: 'x'.repeat(4096) })) } } });
    await f.store.save(large, { revision: 1 }); expect(f.store.diagnostics().stagedBytes).to.be.greaterThan(1048576);
    expect(f.store.diagnostics().peakPendingBytes).to.be.lessThan(128 * 1024); expect((await f.store.load()).project).to.deep.equal(large.project);
    expect(f.records.get('preferences:stages').entries).to.deep.equal([]); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.store.dispose();
  });
  it('reclaims expired abandoned stages while keeping unexpired writes and committed pages', async () => {
    const f = setup({ now: () => 500000 }), value = authored(60, 1); await f.store.save(value, { revision: 0 });
    const oldId = 'preferences:stage:' + 'a'.repeat(32), activeId = 'preferences:stage:' + 'b'.repeat(32), ref = currentRoot(f).references[0];
    const oldRef = { ...ref, key: 'preferences:page:' + 'a'.repeat(32) + ':' + 'c'.repeat(64) };
    f.records.set(oldRef.key, { id: oldRef.key, kind: 'preference-page', text: 'abandoned' });
    f.records.set(oldId, { id: oldId, kind: 'preference-stage', references: [oldRef] }); f.records.set(activeId, { id: activeId, kind: 'preference-stage', references: [] });
    f.records.set('preferences:stages', { id: 'preferences:stages', entries: [{ id: oldId, deadline: 0 }, { id: activeId, deadline: 600000 }] });
    await f.store.save(changed(value, 72), { revision: 1 }); expect(f.records.has(oldRef.key)).to.equal(false); expect(f.records.has(oldId)).to.equal(false);
    expect(f.records.has(activeId)).to.equal(true); expect(f.records.has(ref.key)).to.equal(true); expect((await f.store.load()).project).to.deep.equal(changed(value, 72).project); f.store.dispose();
  });
});
