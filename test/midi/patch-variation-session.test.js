import { expect } from 'chai';
import { createPatchVariationSession } from '../../js/app/midi-ui/PatchVariationSession.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const source = (revision = 1) => ({ identity: { documentId: 'document', documentRevision: revision, laneId: 'lane', takeId: 'take', takeRevision: 1,
  parentHash: String(revision).repeat(64), parentPackHash: 'a'.repeat(64) }, prepared: { contentHash: 'a'.repeat(64) },
reference: { packHash: 'a'.repeat(64), definitionHash: String(revision).repeat(64), revision, definition: { name: 'Parent' } }, descriptor: {} });
const candidate = (slot, suffix = '', extra = '') => ({ id: 'candidate.' + slot + suffix, slot, state: 'compiled', name: 'Candidate ' + slot,
  provenance: { changes: [{ parameter: 'size', previous: 1, value: 1.1, unit: 'ratio' }] }, compiled: { pack: extra }, qualification: 'compiled-data-not-render-qualified' });
const generate = async options => { for (let slot = 0; slot < options.count; slot++) options.onCandidate(candidate(slot)); return { counts: { compiled: 4, rejected: 0 } }; };
const rejects = async (action, code) => { let error; try { await action(); } catch (failure) { error = failure; } expect(error?.code).to.equal(code); };
const fixture = async (callbacks = {}) => {
  let current = source(); const session = createPatchVariationSession({ getSourceIdentity: () => current.identity, generate, ...callbacks });
  await session.bind(current);
  return { session, setSource: value => { current = value; }, getSource: () => current };
};

describe('source-bound bounded variation session', () => {
  it('keeps four stable slots and four exact pins while new batches replace only unpinned rows', async () => {
    const { session } = await fixture(); await session.generate({ seed: 1 });
    const old = session.snapshot().rows; for (const row of old) session.pin(row.id);
    await session.generate({ seed: 2 });
    expect(session.snapshot().pins.map(row => row.id)).to.deep.equal(old.map(row => row.id));
    expect(session.snapshot().rows.map(row => row.id)).not.to.deep.equal(old.map(row => row.id));
    expect(session.snapshot().rows.every(row => !row.pinned)).to.equal(true);
    expect(() => session.pin(session.snapshot().rows[0].id)).to.throw('at most four');
    for (const row of old) session.unpin(row.id);
    expect(session.snapshot().pins).to.have.length(0); await session.dispose(); expect(session.snapshot().retainedBytes).to.equal(0);
  });
  it('delivers two rapid batches in reverse order without replacing the new slots or an early pin', async () => {
    const waits = [], fixtureState = await fixture({ generate: async options => { const gate = deferred(); waits.push({ gate, options }); await gate.promise;
      for (let slot = 0; slot < 4; slot++) options.onCandidate(candidate(slot, '.' + options.seed)); return { counts: { compiled: 4, rejected: 0 } }; } });
    const { session } = fixtureState;
    const first = session.generate({ seed: 1 }); waits[0].options.onCandidate(candidate(0, '.early')); session.pin(session.snapshot().rows[0].id);
    const second = session.generate({ seed: 2 });
    await rejects(() => session.generate({ seed: 3 }), 'generation-busy');
    waits[1].gate.resolve(); await second; waits[0].gate.resolve(); await first;
    expect(session.snapshot().rows.map(row => row.candidateId)).to.deep.equal([0, 1, 2, 3].map(slot => 'candidate.' + slot + '.2'));
    expect(session.snapshot().pins[0].candidateId).to.equal('candidate.0.early'); await session.dispose();
  });
  it('retains old pins as inspect-only after a same-name parent revision or lane/take/document change', async () => {
    const { session, setSource } = await fixture(); await session.generate({}); const id = session.snapshot().rows[0].id; session.pin(id);
    const changed = source(2); setSource(changed); await session.bind(changed);
    expect(session.snapshot().pins[0]).to.include({ sourceCurrent: false, candidateId: 'candidate.0' });
    await rejects(() => session.compare(id), 'changed-source'); await rejects(() => session.apply(id), 'changed-source'); await session.dispose();
  });
  it('requires explicit comparison and Keep before Apply and never plays on focus, pin or generation', async () => {
    const calls = []; let releases = 0;
    const { session } = await fixture({ compare: async ({ candidate: value }) => { calls.push('compare:' + value.id); return { admission: { exact: value.id }, release: () => { releases++; } }; },
      keep: async ({ candidate: value }) => { calls.push('keep:' + value.id); return { hash: value.id }; },
      apply: async ({ candidate: value, admission, kept, isCurrent }) => { expect(isCurrent()).to.equal(true); expect(admission.exact).to.equal(value.id); expect(kept.hash).to.equal(value.id); calls.push('apply:' + value.id); } });
    await session.generate({}); const id = session.snapshot().rows[0].id; session.pin(id); expect(calls).to.deep.equal([]);
    await rejects(() => session.apply(id), 'not-admitted'); await session.keep(id); await rejects(() => session.apply(id), 'not-admitted');
    await session.compare(id); await session.apply(id); await session.stop();
    expect(calls).to.deep.equal(['keep:candidate.0', 'compare:candidate.0', 'apply:candidate.0']); expect(releases).to.equal(1); await session.dispose();
  });
  it('retains compiled candidates when the reference take, capability or capacity is unavailable', async () => {
    const f = await fixture({ maxRetainedBytes: 65536 }); const missingTake = source(); missingTake.identity.takeId = null; missingTake.identity.takeRevision = null;
    f.setSource(missingTake); await f.session.bind(missingTake); await f.session.generate({}); const id = f.session.snapshot().rows[0].id;
    await rejects(() => f.session.compare(id), 'capability-unavailable'); await f.session.dispose();
    const ready = await fixture({ compare: async () => { throw new Error('Should not run'); } }); const missing = source(); missing.identity.takeId = null; ready.setSource(missing); await ready.session.bind(missing); await ready.session.generate({});
    await rejects(() => ready.session.compare(ready.session.snapshot().rows[0].id), 'missing-reference-take'); await ready.session.dispose();
    const pressure = await fixture({ maxRetainedBytes: 65536, generate: async options => { for (let slot = 0; slot < 4; slot++) options.onCandidate(candidate(slot, '', 'x'.repeat(40000))); return { counts: { compiled: 4, rejected: 0 } }; } });
    await pressure.session.generate({}); expect(pressure.session.snapshot().rows.every(row => row.code === 'capacity')).to.equal(true); expect(pressure.session.snapshot().retainedBytes).to.equal(0); await pressure.session.dispose();
  });
  it('retires stale comparison completion once without stealing a newer cue', async () => {
    const gate = deferred(), started = deferred(); let releases = 0;
    const f = await fixture({ compare: async ({ candidate: value }) => { if (value.slot === 0) { started.resolve(); await gate.promise; } return { admission: {}, release: () => { releases++; } }; } });
    await f.session.generate({}); const rows = f.session.snapshot().rows;
    const old = f.session.compare(rows[0].id); await started.promise; await f.session.compare(rows[1].id); gate.resolve();
    await rejects(() => old, 'changed-source'); expect(f.session.snapshot().comparison.id).to.equal(rows[1].id); expect(releases).to.equal(1);
    await f.session.dispose(); expect(releases).to.equal(2);
  });
  it('does not publish Keep or apply after an identity changes during the callback', async () => {
    const gate = deferred(); const f = await fixture({ keep: async ({ isCurrent }) => { await gate.promise; expect(isCurrent()).to.equal(false); return { saved: true }; } });
    await f.session.generate({}); const id = f.session.snapshot().rows[0].id, action = f.session.keep(id);
    f.setSource(source(2)); gate.resolve(); await rejects(() => action, 'changed-source'); expect(f.session.snapshot().rows[0].kept).to.equal(false); await f.session.dispose();
  });
  it('blocks admission after unresolved cue retirement and waits for canceled generation during disposal', async () => {
    const f = await fixture({ compare: async () => ({ admission: {}, release: () => ({ outcome: 'unknown' }) }) }); await f.session.generate({});
    await f.session.compare(f.session.snapshot().rows[0].id); await rejects(() => f.session.stop(), 'unknown-retirement');
    expect(f.session.snapshot().unknownRetirement).to.equal(true); await rejects(() => f.session.generate({}), 'changed-source'); await f.session.dispose();
    const gate = deferred(), g = await fixture({ generate: async () => { await gate.promise; return { counts: { compiled: 0, rejected: 4 } }; } });
    const pending = g.session.generate({}); let retired = false; const disposal = g.session.dispose().then(() => { retired = true; });
    await Promise.resolve(); expect(retired).to.equal(false); gate.resolve(); await pending; await disposal; expect(retired).to.equal(true);
  });
});
