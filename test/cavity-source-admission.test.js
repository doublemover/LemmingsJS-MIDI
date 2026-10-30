import { expect } from 'chai';
import { createCavitySourceAdmission } from '../js/app/procgen/workstation/CavitySourceAdmission.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createCausalIntentDispatcher } from '../js/app/procgen/workstation/CausalIntentDispatcher.js';

const intent = (kind = 'begin') => ({ version: 1, kind, worldId: 'source', generation: 1, voiceId: 'voice', onsetId: 'onset', intentId: 'intent:' + kind, sourceEventIds: ['contact'], topologyBinding: { componentId: 'component', boundTopologyRevision: 1 }, pitch: { cents: 5700 } });
const setup = () => {
  const budget = createResourceBudget(), context = { currentTime: 0, sampleRate: 48000, state: 'running' }, calls = [], execution = {}; let release, ready = false;
  const gate = new Promise(resolve => { release = () => { ready = true; resolve(); }; }), body = { qualification: () => ({ version: 1 }), canEmit: () => ready, ensure: () => gate };
  const backend = { registerExecution: () => ({ status: 'accepted', execution }), begin: (value, frame) => { calls.push({ kind: 'begin', value, frame }); return { status: 'accepted', stage: 'scheduled' }; }, end: (voice, options, frame) => { calls.push({ kind: 'end', frame }); return { status: 'accepted', stage: 'scheduled' }; }, retireExecution: () => true, cancelGenerationWithReceipt: () => true };
  const owner = createCavitySourceAdmission({ backend, getBody: () => body, getContext: () => context, resourceBudget: budget });
  return { budget, context, calls, execution, release, body, owner, backend };
};
describe('bounded cavity source preparation admission', () => {
  it('keeps unknown cancellation charged and blocks reuse after a deferred native end fails', async () => {
    const f = setup(); f.backend.end = () => ({ status: 'deferred', completion: Promise.reject(new Error('native end failed')) }); f.backend.cancelGenerationWithReceipt = () => { throw new Error('native cancellation unknown'); };
    const begin = f.owner.begin(intent(), 4800, f.execution), end = f.owner.end('voice', { mode: 'one-shot' }, 4800, f.execution, intent('end')); f.release(); await begin.completion; expect((await end.completion).status).to.equal('rejected'); await new Promise(resolve => setImmediate(resolve)); expect(f.owner.cavityDiagnostics().retirementError).to.equal('native cancellation unknown'); expect(f.owner.begin({ ...intent(), voiceId: 'later' }, 4800, f.execution).status).to.equal('rejected');
    const retired = f.owner.disposeCavityBuffer(); await retired.completion; expect(retired.outcome).not.to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
  it('settles the canonical dispatcher deferred begin/end receipts through its cancellable completion contract', async () => {
    const f = setup(), receipts = [], dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'local', backend: f.owner }], toTargetFrame: () => 4800, executionEpoch: () => 'fixture', onReceipt: receipt => receipts.push(receipt) });
    try { const first = dispatcher.dispatch([{ ...intent(), route: 'local' }, { ...intent('end'), route: 'local', terminationReason: 'one-shot' }], { worldId: 'source', generation: 1, batchId: 'source:1', tick: 1 }); expect(first.map(receipt => receipt.status)).to.deep.equal(['deferred', 'deferred']); f.release(); await new Promise(resolve => setImmediate(resolve)); expect(receipts.filter(receipt => receipt.previousAdmissionStatus === 'deferred' && receipt.status === 'accepted')).to.have.length(2); expect(dispatcher.diagnostics().admissions.pending).to.have.length(0); expect(f.calls.map(call => call.kind)).to.deep.equal(['begin', 'end']); }
    finally { f.release(); await dispatcher.dispose().completion; await f.owner.disposeCavityBuffer().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('delivers one independently owned begin/end in order at their unchanged source frames', async () => {
    const f = setup(), original = intent();
    try { const begin = f.owner.begin(original, 4800, f.execution), end = f.owner.end('voice', { mode: 'one-shot', seconds: 0.04 }, 4800, f.execution, intent('end')); expect(begin.status).to.equal('deferred'); expect(end.status).to.equal('deferred'); original.pitch.cents = 0; f.release(); expect((await begin.completion).status).to.equal('accepted'); expect((await end.completion).status).to.equal('accepted'); expect(f.calls.map(call => [call.kind, call.frame])).to.deep.equal([['begin', 4800], ['end', 4800]]); expect(f.calls[0].value.pitch.cents).to.equal(5700); }
    finally { f.release(); await f.owner.disposeCavityBuffer().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('refuses an expired original frame without a catch-up attack and retains producer storage through actual settlement', async () => {
    const f = setup(), begin = f.owner.begin(intent(), 4800, f.execution); f.context.currentTime = 1; f.release();
    expect((await begin.completion).status).to.equal('rejected'); expect(f.calls).to.have.length(0); await f.owner.disposeCavityBuffer().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('cancels a pending source and waits for its actual preparation producer before releasing storage', async () => {
    const f = setup(), begin = f.owner.begin(intent(), 4800, f.execution); expect(begin.cancel('explicit-cancel')).to.equal(true); expect((await begin.completion).reason).to.equal('explicit-cancel'); const retired = f.owner.disposeCavityBuffer(); expect(retired.outcome).to.equal('pending'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); f.release(); await retired.completion; expect(f.calls).to.have.length(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('refuses delivery when its selected geometry changes during preparation', async () => {
    const f = setup(), begin = f.owner.begin(intent(), 4800, f.execution); f.body.canEmit = () => false; f.release(); expect((await begin.completion).status).to.equal('rejected'); expect(f.calls).to.have.length(0); await f.owner.disposeCavityBuffer().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
