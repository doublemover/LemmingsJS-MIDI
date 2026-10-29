import { expect } from 'chai';
import { createSinkAdmissionRegistry } from '../../js/app/procgen/workstation/SinkAdmissionRegistry.js';
import { createProcgenPatternEngine } from '../../js/app/procgen/workstation/ProcgenPatternEngine.js';
import { createProcgenWorkstationProject, createProcgenLane } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject, reduceMidiProject } from '../../js/midi/project/MidiProject.js';

const turn = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
const pending = () => { let resolve, reject; const completion = new Promise((yes, no) => { resolve = yes; reject = no; }); return { completion, resolve, reject }; };
const identity = { worldId: 'world', generation: 2, batchId: 'batch', intentId: 'intent', onsetId: 'onset', voiceId: 'voice', eventId: 'event', sinkId: 'local', connectionEpoch: 3, routeRevision: 4, targetTime: 10, timeDomain: 'performance-ms' };
const fixture = options => {
  const lane = createProcgenLane(0, { mode: 'pattern', patternPurpose: 'Explicit accompaniment admission fixture.' });
  lane.patterns = lane.patterns.map(pattern => ({ ...pattern, steps: pattern.steps.map(step => ({ ...step, enabled: false })) }));
  let project = createProcgenWorkstationProject(createMidiProject(), { lanes: [{ ...lane, id: 'lane-1', mode: 'pattern' }] }), route = 'route:1';
  project = reduceMidiProject(project, { type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { enabled: true, note: 60, duration: 4 } });
  const engine = createProcgenPatternEngine({ getProject: () => project, getSinkKey: () => route, getAdmissionIdentity: () => identity, ...options });
  const beat = value => engine.onBeat({ beat: value, timestamp: value * 500, bpm: 120 });
  return { engine, beat, setRoute(value) { route = value; }, edit(action) { project = reduceMidiProject(project, action); engine.cancelPendingAdmissions(); }, get project() { return project; } };
};

describe('immutable sink admission transitions', () => {
  it('retains full identity, immutable stages and independent acknowledgement clock domains', () => {
    const registry = createSinkAdmissionRegistry(), first = registry.open(identity, { status: 'deferred' });
    expect(first).to.include(identity); expect(Object.isFrozen(first)).to.equal(true);
    const scheduled = registry.advance(first, { expectedVersion: 1, status: 'accepted' });
    const applied = registry.advance(scheduled, { expectedVersion: 2, ackState: 'applied', appliedFrame: 128, acknowledgedTime: 1.5, acknowledgementTimeDomain: 'audio-context-seconds' });
    expect(first).to.include({ status: 'deferred', ackState: 'none', receiptVersion: 1 });
    expect(applied).to.include({ status: 'accepted', ackState: 'applied', receiptVersion: 3, targetTime: 10, timeDomain: 'performance-ms', appliedFrame: 128 });
    expect(registry.advance(scheduled, { expectedVersion: 2, ackState: 'receiver-observed' })).to.equal(null);
    expect(registry.advance(applied, { expectedVersion: 3, ackState: 'driver-submitted' })).to.equal(null);
    expect(registry.advance(applied, { expectedVersion: 3, routeRevision: 5, ackState: 'receiver-observed' })).to.equal(null);
    expect(registry.advance(applied, { expectedVersion: 3, connectionEpoch: 99, ackState: 'receiver-observed' })).to.equal(null);
    expect(registry.advance(applied, { expectedVersion: 3, status: 'rejected' })).to.equal(null);
    expect(registry.advance(applied, { expectedVersion: 3, acknowledgedTime: 123 })).to.equal(null);
    expect(registry.snapshot().history.map(row => row.sequence)).to.deep.equal([1, 2, 3]);
  });
  it('bounds retained history without evicting unresolved admissions', () => {
    const registry = createSinkAdmissionRegistry({ capacity: 2, historyLimit: 2 });
    const a = registry.open(identity, { status: 'deferred' }), b = registry.open({ ...identity, sinkId: 'midi' }, { status: 'deferred' });
    expect(registry.open(identity, { status: 'accepted' })).to.equal(null);
    registry.advance(a, { expectedVersion: 1, status: 'rejected', reason: 'cancelled' });
    expect(registry.open(identity, { status: 'accepted' })).not.to.equal(null);
    expect(registry.snapshot().latest).to.have.length(2); expect(registry.snapshot().latest).to.include(b);
    expect(registry.snapshot().history.map(row => row.sequence)).to.deep.equal([3, 4]);
    expect(registry.restoreCounters({ serial: Number.MAX_SAFE_INTEGER, sequence: Number.MAX_SAFE_INTEGER })).to.equal(false);
  });
});

describe('pattern admission ownership', () => {
  it('records separate local-only and hardware-only acceptance without resurrecting the refused sink', () => {
    for (const selected of ['local', 'midi']) {
      const attempts = [];
      const f = fixture({ emit(spec, meta) {
        const targets = meta.targetSinkId ? [meta.targetSinkId] : ['local', 'midi']; attempts.push(targets);
        return { schema: 'lemmings-sink-admissions/v1', outcomes: targets.map(sinkId => ({ status: sinkId === selected ? 'accepted' : 'rejected', sinkId })) };
      } });
      f.beat(0); expect(f.engine.snapshot().active.map(row => row.receipt.sinkId)).to.deep.equal([selected]);
      expect(f.engine.getAdmissions().latest.map(row => row.status)).to.deep.equal(['local', 'midi'].map(sinkId => sinkId === selected ? 'accepted' : 'rejected'));
      f.engine.resume({ beat: 0.1, timestamp: 50, bpm: 120 }); expect(attempts.at(-1)).to.deep.equal([selected]);
      expect(f.engine.snapshot().active.map(row => row.receipt.sinkId)).to.deep.equal([selected]);
    }
  });
  it('promotes a deferred note only after matching acceptance and never checkpoints it as active', async () => {
    const job = pending(), f = fixture({ emit: () => ({ status: 'deferred', sinkId: 'local', connectionEpoch: 3, routeRevision: 4, completion: job.completion, cancel: () => true }) });
    f.beat(0); expect(f.engine.snapshot().active).to.have.length(0); expect(f.engine.snapshot().pendingAdmissions).to.have.length(1);
    const restored = fixture({ emit: () => { throw Error('Deferred state must not resume.'); } }); restored.engine.restore(f.engine.snapshot()); restored.engine.resume();
    expect(restored.engine.snapshot().active).to.have.length(0); expect(restored.engine.snapshot().pendingAdmissions).to.have.length(0);
    expect(() => restored.engine.restore({ ...f.engine.snapshot(), admissionCursor: { serial: Number.MAX_SAFE_INTEGER, sequence: Number.MAX_SAFE_INTEGER, eventSerial: Number.MAX_SAFE_INTEGER } })).to.throw('admission cursor');
    job.resolve({ status: 'accepted', sinkId: 'local', connectionEpoch: 3, routeRevision: 4 }); await turn();
    expect(f.engine.snapshot().active).to.have.length(1); expect(f.engine.snapshot().pendingAdmissions).to.have.length(0);
    expect(f.engine.getAdmissions().history.map(row => [row.status, row.receiptVersion])).to.deep.equal([['deferred', 1], ['accepted', 2]]);
  });
  it('cancels deferred acceptance on route change, mute, reset, flush and late identity replies', async () => {
    for (const kind of ['route', 'mute', 'reset', 'flush', 'reply']) {
      const job = pending(), cancelled = [], f = fixture({ emit: () => ({ status: 'deferred', sinkId: 'local', completion: job.completion, cancel: reason => { cancelled.push(reason); return true; } }) });
      f.beat(0);
      if (kind === 'route') { f.setRoute('route:2'); f.engine.cancelPendingAdmissions(); }
      if (kind === 'mute') f.edit({ type: 'procgen/lane', laneId: 'lane-1', patch: { mute: true } });
      if (kind === 'reset') f.engine.reset();
      if (kind === 'flush') f.engine.flush();
      job.resolve({ status: 'accepted', ...(kind === 'reply' ? { routeRevision: 999 } : {}) }); await turn();
      expect(cancelled, kind).to.have.length(1); expect(f.engine.snapshot().active, kind).to.have.length(0);
      expect(f.engine.snapshot().pendingAdmissions, kind).to.have.length(0);
      expect(f.engine.getAdmissions().history.at(-1).status, kind).to.equal('rejected');
    }
  });
  it('retains a bounded uncertain cancellation and stops further work until ownership is resolved', async () => {
    const job = pending(); let attempts = 0;
    const f = fixture({ maxPendingAdmissions: 1, maxSinkOutcomes: 1, emit() { attempts++; return { status: 'deferred', sinkId: 'local', completion: job.completion, cancel() { throw Error('uncertain'); } }; } });
    f.beat(0); f.engine.flush(); await turn();
    expect(f.engine.snapshot().pendingAdmissions[0]).to.include({ cancelling: true, cancellationUnconfirmed: true });
    f.engine.reset(); f.beat(0); expect(attempts).to.equal(1);
    job.resolve({ status: 'accepted' }); await turn(); expect(f.engine.snapshot().active).to.have.length(0);
  });
  it('rejects expired and throwing completions, absent sinks and invalid deferred ownership', async () => {
    for (const kind of ['expired', 'throwing']) {
      const job = pending(); let cancels = 0;
      const f = fixture({ emit: () => ({ status: 'deferred', sinkId: 'local', completion: job.completion, cancel: () => { cancels++; return true; } }) });
      f.beat(0); if (kind === 'expired') { f.beat(4.5); job.resolve({ status: 'accepted' }); } else job.reject(Error('backpressure failed'));
      await turn(); expect(cancels).to.be.greaterThan(0); expect(f.engine.snapshot().active).to.have.length(0);
    }
    for (const emit of [undefined, () => 1, () => { throw Error('sink'); }, () => ({ status: 'deferred', sinkId: 'local', completion: Promise.resolve({ status: 'accepted' }) })]) {
      const f = fixture({ emit }); f.beat(0); expect(f.engine.snapshot().active).to.have.length(0); expect(f.engine.snapshot().pendingAdmissions).to.have.length(0);
    }
  });
  it('does not revive a note when the sender synchronously resets the engine', () => {
    let engine; const f = fixture({ emit: () => { engine.reset(); return { status: 'accepted', sinkId: 'local' }; } }); engine = f.engine;
    f.beat(0); expect(engine.snapshot().active).to.have.length(0);
    const stale = fixture({ emit: () => ({ status: 'accepted', sinkId: 'local', connectionEpoch: 999, routeRevision: 4 }) });
    stale.beat(0); expect(stale.engine.snapshot().active).to.have.length(0);
    expect(stale.engine.getAdmissions().history.at(-1)).to.include({ status: 'rejected', reason: 'stale-sink-identity', connectionEpoch: 3 });
  });
  it('keeps a newer immutable acknowledgement and refuses stale versions', () => {
    let receipt; const f = fixture({ emit: () => ({ status: 'accepted', sinkId: 'local' }), onAdmission: row => { receipt = row; } });
    f.beat(0); const scheduled = receipt;
    const applied = f.engine.acknowledgeAdmission(scheduled, { expectedVersion: 1, ackState: 'applied', appliedFrame: 128 });
    expect(f.engine.acknowledgeAdmission(scheduled, { expectedVersion: 1, ackState: 'receiver-observed' })).to.equal(null);
    expect(f.engine.snapshot().active[0].receipt).to.deep.equal(applied); expect(scheduled.ackState).to.equal('scheduled');
  });
  it('deduplicates CC by sink and retries only the refused sink with the latest value', () => {
    const sent = []; let available = false;
    const f = fixture({ emitCC(spec, meta) {
      const targets = meta.targetSinkIds || ['local', 'midi']; sent.push({ value: spec.value, targets });
      return { schema: 'lemmings-sink-admissions/v1', outcomes: targets.map(sinkId => ({ sinkId, status: sinkId === 'local' || available ? 'accepted' : 'rejected' })) };
    } });
    f.edit({ type: 'procgen/lane', laneId: 'lane-1', patch: { ccAutomation: [{ id: 'cc', controller: 74, length: 4, mode: 'step', points: [{ beat: 0, value: 64 }, { beat: 1, value: 80 }] }] } });
    f.beat(0); f.beat(0.1); expect(sent[1]).to.deep.equal({ value: 64, targets: ['midi'] });
    f.beat(1); available = true; f.beat(1.1); f.beat(1.2);
    expect(sent).to.deep.equal([{ value: 64, targets: ['local', 'midi'] }, { value: 64, targets: ['midi'] }, { value: 80, targets: ['local', 'midi'] }, { value: 80, targets: ['midi'] }]);
  });
  it('coalesces deferred CC values, cancels the old value and ignores its late reply', async () => {
    const jobs = [], values = [], cancelled = [];
    const f = fixture({ emitCC(spec) { const job = pending(); jobs.push(job); values.push(spec.value); return { status: 'deferred', sinkId: 'midi', completion: job.completion, cancel: reason => { cancelled.push(reason); return true; } }; } });
    f.edit({ type: 'procgen/lane', laneId: 'lane-1', patch: { ccAutomation: [{ id: 'cc', controller: 74, length: 4, mode: 'step', points: [{ beat: 0, value: 64 }, { beat: 1, value: 80 }] }] } });
    f.beat(0); f.beat(0.1); expect(values).to.deep.equal([64]); f.beat(1); expect(values).to.deep.equal([64, 80]);
    jobs[1].resolve({ status: 'accepted' }); jobs[0].resolve({ status: 'accepted' }); await turn(); f.beat(1.1);
    expect(cancelled).to.deep.equal(['controller-value-superseded']); expect(values).to.deep.equal([64, 80]);
    expect(f.engine.snapshot().lanes['lane-1'].cc['cc:null:1:74']).to.equal(80);
  });
});
