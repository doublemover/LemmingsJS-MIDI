import { expect } from 'chai';
import { createCausalIntentDispatcher } from '../../js/app/procgen/workstation/CausalIntentDispatcher.js';

const turn = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const job = () => { let resolve, reject; const completion = new Promise((yes, no) => { resolve = yes; reject = no; }); return { completion, resolve, reject }; };
const batch = { worldId: 'world', generation: 7, batchId: 'batch' };
const intent = (patch = {}) => ({ version: 1, kind: 'begin', worldId: 'world', generation: 7, batchId: 'batch', intentId: 'intent', onsetId: 'onset', voiceId: 'voice', sourceEventIds: ['event'], route: 'main', scoreTime: {}, ...patch });
const fixture = ({ begin = () => ({ status: 'accepted', stage: 'queued' }), maxPendingAdmissions = 8, historyLimit = 32, onReceipt = () => {}, latePolicy = null } = {}) => {
  let epoch = 'run', route = 3, connection = 5, enabled = true, endpoint = 'a';
  const receipts = [], backend = { begin, cancelGeneration() {} }, sink = { id: 'preview', route: 'main', backend, enabled: () => enabled, timeDomain: 'audio-sample-frames', getAdmissionIdentity: () => ({ sinkId: endpoint, connectionEpoch: connection, routeRevision: route }) };
  const dispatcher = createCausalIntentDispatcher({ sinks: [sink], toTargetFrame: () => 960, executionEpoch: () => epoch, maxPendingAdmissions, receiptCapacity: 32, historyLimit, latePolicy, onReceipt: receipt => { receipts.push(receipt); onReceipt(receipt); } });
  return { dispatcher, backend, receipts, dispatch: (values = [intent()], boundary = batch) => dispatcher.dispatch(values, boundary),
    retire(kind) { if (kind === 'epoch') epoch = 'next'; else if (kind === 'route') route++; else if (kind === 'connection') connection++; else if (kind === 'endpoint') endpoint = 'b'; else if (kind === 'disabled') enabled = false; else if (kind === 'generation') dispatcher.dispatch([], { ...batch, generation: 8 }); else if (kind === 'world') dispatcher.dispatch([], { ...batch, worldId: 'other' }); else if (kind === 'cancel') dispatcher.cancelGeneration(7, epoch); else if (kind === 'dispose') dispatcher.dispose(); dispatcher.cancelPendingAdmissions(); } };
};

describe('canonical physical sink admission ownership', () => {
  it('rejects mismatched worlds and malformed route identity before invoking the backend', () => {
    let calls = 0; const f = fixture({ begin: () => { calls++; return { status: 'accepted' }; } });
    expect(f.dispatch([intent({ worldId: 'foreign' })])[0].reason).to.equal('invalid-intent'); expect(calls).to.equal(0);
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'bad', route: 'main', backend: f.backend, getAdmissionIdentity: () => ({ connectionEpoch: {} }) }], toTargetFrame: () => 960 });
    expect(dispatcher.dispatch([intent()], batch)[0].reason).to.equal('sink-identity-unavailable'); expect(calls).to.equal(0);
    expect(() => dispatcher.dispatch([], { ...batch, generation: -1 })).to.throw('Invalid causal intent batch'); dispatcher.dispose(); f.dispatcher.dispose();
  });
  it('preserves supplied causal identity and distinct target/ack clocks through immutable monotone stages', () => {
    const f = fixture(), [first] = f.dispatch();
    expect(first.admission).to.include({ worldId: 'world', generation: 7, batchId: 'batch', intentId: 'intent', onsetId: 'onset', voiceId: 'voice', eventId: 'event', sinkId: 'preview', connectionEpoch: 5, routeRevision: 3, targetTime: 960, timeDomain: 'audio-sample-frames', ackState: 'scheduled' });
    const second = f.dispatcher.acknowledge(first, { expectedVersion: 1, status: 'accepted', ackState: 'driver-submitted', acknowledgedTime: 25, acknowledgementTimeDomain: 'performance-ms' });
    expect(second.admission).to.include({ receiptVersion: 2, ackState: 'driver-submitted', acknowledgedTime: 25, acknowledgementTimeDomain: 'performance-ms', targetTime: 960 });
    expect(first.admission.receiptVersion).to.equal(1); expect(Object.isFrozen(second.admission)).to.equal(true); expect(Object.isFrozen(second)).to.equal(true);
    expect(f.dispatcher.acknowledge(first, { expectedVersion: 1, ackState: 'applied' })).to.equal(null);
    expect(f.dispatcher.acknowledge(second, { expectedVersion: 1, ackState: 'applied' })).to.equal(null);
    expect(f.dispatcher.acknowledge(second, { expectedVersion: 2, ackState: 'scheduled' })).to.equal(null);
    const applied = f.dispatcher.acknowledge(second, { expectedVersion: 2, ackState: 'applied', appliedFrame: 1000 });
    expect(applied.admission.appliedFrame).to.equal(1000); f.retire('connection');
    expect(f.dispatcher.acknowledge(applied, { expectedVersion: 3, ackState: 'receiver-observed' })).to.equal(null); f.dispatcher.dispose();
  });
  it('buffers synchronous driver acknowledgements until admission exists without inventing applied evidence', () => {
    const f = fixture({ begin: (value, frame, execution, context) => { context.acknowledge({ ackState: 'driver-submitted', acknowledgedTime: 1, acknowledgementTimeDomain: 'performance-ms' }); return { status: 'accepted', stage: 'queued' }; } });
    const [initial] = f.dispatch(); expect(initial.receiptVersion).to.equal(1);
    expect(f.receipts.map(row => [row.receiptVersion, row.ackState])).to.deep.equal([[1, 'scheduled'], [2, 'driver-submitted']]);
    expect(f.receipts[1]).not.to.have.property('appliedFrame'); f.dispatcher.dispose();
  });
  it('keeps deferred work outside accepted state and publishes only matching completion', async () => {
    const j = job(), f = fixture({ begin: () => ({ status: 'deferred', completion: j.completion, cancel: () => true }) });
    const [initial] = f.dispatch(); expect(initial.status).to.equal('deferred'); expect(f.dispatcher.diagnostics().admissions.pending).to.have.length(1);
    j.resolve({ status: 'accepted', stage: 'scheduled', sinkId: 'preview', connectionEpoch: 5, routeRevision: 3 }); await turn();
    expect(f.receipts.map(row => [row.status, row.receiptVersion])).to.deep.equal([['deferred', 1], ['accepted', 2]]);
    expect(f.receipts[1].previousAdmissionStatus).to.equal('deferred'); expect(initial.status).to.equal('deferred'); expect(f.dispatcher.diagnostics().admissions.pending).to.have.length(0); f.dispatcher.dispose();
  });
  it('cancels route, connection, execution, world, generation, disabled, explicit and disposed owners before late completion', async () => {
    for (const kind of ['route', 'connection', 'endpoint', 'epoch', 'world', 'generation', 'disabled', 'cancel', 'dispose']) {
      const j = job(), cancellations = [], f = fixture({ begin: () => ({ status: 'deferred', completion: j.completion, cancel: reason => { cancellations.push(reason); return true; } }) });
      f.dispatch(); f.retire(kind); j.resolve({ status: 'accepted' }); await turn();
      expect(cancellations, kind).to.have.length(1); expect(f.receipts.map(row => row.status), kind).to.deep.equal(['deferred', 'rejected']); expect(f.dispatcher.diagnostics().admissions.pending, kind).to.have.length(0); f.dispatcher.dispose();
    }
  });
  it('rejects stale completion identity and deadline without reviving the authoring intent', async () => {
    for (const mode of ['reply', 'deadline']) {
      let late = false; const j = job(), cancellations = [], f = fixture({ begin: () => ({ status: 'deferred', completion: j.completion, cancel: reason => { cancellations.push(reason); return true; } }), latePolicy: () => late ? { status: 'rejected', reason: 'late-attack' } : { status: 'accepted', targetFrame: 960 } });
      const source = intent(), text = JSON.stringify(source); f.dispatch([source]); late = mode === 'deadline';
      j.resolve({ status: 'accepted', ...(mode === 'reply' ? { connectionEpoch: 999 } : {}) }); await turn();
      expect(cancellations).to.have.length(1); expect(f.receipts.at(-1).status).to.equal('rejected'); expect(JSON.stringify(source)).to.equal(text); f.dispatcher.dispose();
    }
  });
  it('reserves capacity before callbacks, including reentrant dispatch, and retains uncertain cancellation', async () => {
    const j = job(); let calls = 0, inner, f;
    f = fixture({ maxPendingAdmissions: 1, begin: () => { calls++; inner = f.dispatch([intent({ intentId: 'nested' })]); return { status: 'deferred', completion: j.completion, cancel: () => false }; } });
    f.dispatch(); expect(calls).to.equal(1); expect(inner[0].reason).to.equal('admission-capacity'); f.retire('route'); await turn();
    expect(f.dispatcher.diagnostics().admissions.pending[0]).to.include({ cancelled: true, cancellationUnconfirmed: true }); f.dispatch(); expect(calls).to.equal(1);
    j.resolve({ status: 'accepted' }); await turn(); expect(f.dispatcher.diagnostics().admissions.pending).to.have.length(1); f.dispatcher.dispose();
  });
  it('bounds malformed deferrals, cancellation throws and completion rejection without orphan capacity', async () => {
    for (const kind of ['missing-cancel', 'cancel-throws', 'completion-reject']) {
      const j = job(), f = fixture({ maxPendingAdmissions: 1, begin: () => ({ status: 'deferred', completion: j.completion, ...(kind === 'missing-cancel' ? {} : { cancel: () => { if (kind === 'cancel-throws') throw Error('unknown'); return true; } }) }) });
      f.dispatch(); if (kind === 'completion-reject') j.reject(Error('driver failed')); else f.retire('route'); await turn();
      expect(f.receipts.at(-1).status).to.equal('rejected'); expect(f.dispatcher.diagnostics().admissions.pending).to.have.length(kind === 'completion-reject' ? 0 : 1); f.dispatcher.dispose();
    }
  });
  it('keeps semantic observations separate from scheduled/applied output and keeps bounded chronological history', () => {
    const f = fixture({ historyLimit: 2, begin: () => ({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'unrepresented' }), onReceipt: () => { throw Error('observer'); } });
    const [first] = f.dispatch(); expect(first).to.include({ status: 'degraded', stage: 'semantic-observation', ackState: 'none' });
    expect(f.dispatcher.acknowledge(first, { expectedVersion: 1, ackState: 'applied', appliedFrame: 960 })).to.equal(null);
    f.dispatch([intent({ intentId: 'second' }), intent({ intentId: 'third' })]);
    expect(f.dispatcher.diagnostics().receipts.map(row => row.intentId)).to.deep.equal(['second', 'third']); expect(f.dispatcher.diagnostics().admissions.reserved).to.equal(0); f.dispatcher.dispose();
  });
  it('rejects wrong initial route identity, thrown/absent sinks and invalid outcomes without spending accepted state', () => {
    for (const begin of [() => ({ status: 'accepted', connectionEpoch: 99 }), () => { throw Error('sink'); }, undefined, () => true]) {
      const f = fixture({ begin }); if (!begin) f.backend.begin = undefined;
      expect(f.dispatch()[0].status).to.equal('rejected'); expect(f.dispatcher.diagnostics().admissions.reserved).to.equal(0); f.dispatcher.dispose();
    }
  });
});
