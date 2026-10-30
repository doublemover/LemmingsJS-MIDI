import { expect } from 'chai';
import { soundFixture } from '../helpers/sound-content.js';
import { createLaneSoundTransaction } from '../../js/app/midi-ui/LaneSoundTransaction.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reject = async promise => { let error; try { await promise; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); return error; };
describe('transactional incoming-event lane audition', () => {
  let candidate;
  before(async () => { const fixture = await soundFixture(), patch = fixture.prepared.patches[0]; candidate = { reference: { schema: 'lemmings-sound-reference/v1', packHash: fixture.prepared.contentHash,
    patchId: patch.archivedDefinition.id, revision: patch.archivedDefinition.revision, definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: patch.dependencies }, definition: patch.archivedDefinition }; });
  const setup = ({ prepareGate, publishFailure = false, displayFailure = false, cleanupFailure = false } = {}) => {
    const budget = createResourceBudget(), calls = [], route = { key: 'old' }, source = { available: true, owner: {}, documentGeneration: 1, worldGeneration: 1, selectedLaneId: 'lane',
      lane: { id: 'lane', family: 'crystal', role: 'lead', patch: 'crystal-lead', worldThemeId: 'snow', soundChangePolicy: 'new-notes-only', gain: 1, instrumentControls: { macros: {} } } }; let history = 0;
    const owner = createLaneSoundTransaction({ resourceBudget: budget, getSource: () => source, prepare: async (laneId, reference, { signal }) => {
      if (prepareGate) await prepareGate.promise; signal.throwIfAborted(); let accepted = false, committed = false; const previous = route.key, scope = createProcgenRetirementScope();
      return { commit() { committed = true; route.key = reference.definitionHash; calls.push('commit'); }, accept() { accepted = true; calls.push('accept'); },
        release() { return scope.retire([{ name: 'renderer', run() { if (cleanupFailure) throw new Error('unknown'); if (committed && !accepted) route.key = previous; calls.push('release'); } }]); } };
    }, publish: (laneId, reference, patch) => { if (publishFailure) return false; history++; source.lane = { ...source.lane, ...patch, instrumentRef: reference }; owner.reconcile(); owner.lanes([source.lane]); if (displayFailure) throw new Error('view failed'); return source.lane; } });
    return { owner, source, calls, route, budget, get history() { return history; } };
  };
  it('previews only future incoming events without altering project/history and restores on release', async () => {
    const f = setup(), before = f.source.lane, lease = await f.owner.select(candidate, { laneId: 'lane', hold: true });
    expect(f.source.lane).to.equal(before); expect(f.history).to.equal(0); expect(f.owner.lanes([before])[0].instrumentRef.patchId).to.equal(candidate.reference.patchId);
    expect(f.route.key).to.equal(candidate.reference.definitionHash); const receipt = lease.cancel(); expect(f.route.key).to.equal('old'); await receipt.completion;
    expect(f.owner.lanes([before])[0]).to.equal(before); expect(f.budget.diagnostics().accountedBytes).to.equal(0); await f.owner.dispose().completion;
  });
  it('commits one musical edit and preserves unrelated accepted mix/routing changes', async () => {
    const f = setup(), lease = await f.owner.select(candidate, { laneId: 'lane', hold: true }); f.source.lane = { ...f.source.lane, gain: 0.23, channel: 7, externalProgram: 63 }; f.owner.reconcile();
    lease.commit(); expect(f.history).to.equal(1); expect(f.route.key).to.equal(candidate.reference.definitionHash);
    expect(f.source.lane).to.include({ gain: 0.23, channel: 7, externalProgram: 63, worldThemeId: 'snow' }); await f.owner.dispose().completion;
  });
  it('cancels slow preparation before it can overwrite a newer winning sound', async () => {
    const slow = gate(), f = setup(), source = new AbortController(); const pending = f.owner.select(async signal => { await slow.promise; signal.throwIfAborted(); return candidate; }, { laneId: 'lane', signal: source.signal });
    const rejected = reject(pending); source.abort(); await f.owner.select(candidate, { laneId: 'lane' }); slow.resolve(); await rejected;
    expect(f.history).to.equal(1); expect(f.route.key).to.equal(candidate.reference.definitionHash); await f.owner.dispose().completion;
  });
  it('rejects sound/control, selected-lane, world and document conflicts without stale restoration', async () => {
    for (const change of [f => { f.source.lane = { ...f.source.lane, instrumentControls: { macros: { flow: 0.5 } } }; }, f => { f.source.selectedLaneId = 'other'; }, f => { f.source.documentGeneration++; }, f => { f.source.worldGeneration++; }]) {
      const waiting = gate(), f = setup({ prepareGate: waiting }), pending = f.owner.select(candidate, { laneId: 'lane' }), rejected = reject(pending); change(f); f.owner.reconcile(); waiting.resolve(); await rejected;
      expect(f.history).to.equal(0); expect(f.route.key).to.equal('old'); await f.owner.dispose().completion;
    }
  });
  it('restores rejected publication, but keeps a published label and renderer together after presentation failure', async () => {
    const rejected = setup({ publishFailure: true }); await reject(rejected.owner.select(candidate, { laneId: 'lane' })); expect(rejected.route.key).to.equal('old'); expect(rejected.history).to.equal(0); await rejected.owner.dispose().completion;
    const published = setup({ displayFailure: true }); await published.owner.select(candidate, { laneId: 'lane' }); expect(published.route.key).to.equal(published.source.lane.instrumentRef.definitionHash); expect(published.history).to.equal(1); await published.owner.dispose().completion;
  });
  it('fences disposal and retains charges on unknown cleanup rather than freeing unacknowledged owners', async () => {
    const f = setup({ cleanupFailure: true }), lease = await f.owner.select(candidate, { laneId: 'lane', hold: true }), receipt = lease.cancel(); await receipt.completion;
    expect(receipt.outcome).to.equal('partial'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect((await reject(f.owner.select(candidate, { laneId: 'lane' }))).code).to.equal('sound-owner-unavailable'); await f.owner.dispose().completion;
  });
  it('rejects hidden physical/hardware edits and gives a named unsupported-crossfade fallback', async () => {
    const f = setup(); expect((await reject(f.owner.select(candidate, { laneId: 'lane', patch: { worldThemeId: 'fire' } }))).code).to.equal('invalid-sound-patch');
    f.source.lane.soundChangePolicy = 'crossfade-held'; expect((await reject(f.owner.select(candidate, { laneId: 'lane' }))).message).to.include('new-notes-only'); expect(f.calls).to.have.length(0); await f.owner.dispose().completion;
  });
  it('refuses an obsolete external recipe review before preparing or changing the previous sound', async () => {
    const f = setup();
    expect((await reject(f.owner.select(candidate, { laneId: 'lane', isCurrent: () => false }))).code).to.equal('sound-source-conflict');
    expect(f.calls).to.have.length(0); expect(f.history).to.equal(0); expect(f.route.key).to.equal('old'); await f.owner.dispose().completion;
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rechecks the external recipe after slow preparation even when the document and selected lane are unchanged', async () => {
    const waiting = gate(), f = setup({ prepareGate: waiting }); let reviewed = true;
    const pending = f.owner.select(candidate, { laneId: 'lane', isCurrent: () => reviewed }), rejected = reject(pending); reviewed = false; waiting.resolve();
    expect((await rejected).code).to.equal('sound-source-conflict'); expect(f.history).to.equal(0); expect(f.route.key).to.equal('old'); await f.owner.dispose().completion;
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retires a held preview when its external review expires immediately before commit', async () => {
    const f = setup(); let reviewed = true;
    const lease = await f.owner.select(candidate, { laneId: 'lane', hold: true, isCurrent: () => reviewed }); reviewed = false;
    expect(lease.isCurrent()).to.equal(false); expect(() => lease.commit()).to.throw('changed'); await lease.cancel().completion;
    expect(f.history).to.equal(0); expect(f.route.key).to.equal('old'); expect(f.owner.diagnostics().active).to.equal(false); await f.owner.dispose().completion;
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
