import { expect } from 'chai';
import { createInstrumentExecutionLifecycle } from '../../js/app/midi-ui/InstrumentExecutionLifecycle.js';

describe('opaque instrument execution ownership', () => {
  it('scopes actual command receipts to the opaque execution and fences them before retiring observers', () => {
    const context = {}, received = []; let receive, privateEpoch, releases = 0;
    const raw = { observeCommandOutcomes(listener) { receive = listener; return () => { releases++; }; },
      begin(_intent, _frame, epoch) { privateEpoch = epoch; return { status: 'accepted', sequence: 3 }; },
      cancelGenerationWithReceipt: () => ({ status: 'accepted' }), renderDiagnostics: () => ({}), dispose() {} };
    const api = createInstrumentExecutionLifecycle(raw, { getContext: () => context, getGeneration: () => 0, isSettled: () => true, forget() {} }).api;
    const execution = api.registerExecution({ executionEpoch: 'public-commands', generation: 7 }).execution;
    expect(() => api.observeCommandOutcomes(() => {}, { execution: { ...execution } })).to.throw('owned execution');
    api.observeCommandOutcomes(value => received.push(value), { execution }); api.begin({ generation: 7 }, 100, execution);
    receive({ executionEpoch: 'unrelated', stage: 'render-kernel-applied', sequence: 3, appliedFrame: 100 }); expect(received).to.have.length(0);
    receive({ executionEpoch: privateEpoch, stage: 'render-kernel-applied', sequence: 3, appliedFrame: 101 });
    expect(received[0]).to.include({ executionEpoch: 'public-commands', stage: 'render-kernel-applied', sequence: 3, appliedFrame: 101 });
    api.retireExecution(execution); expect(releases).to.equal(1); receive({ executionEpoch: privateEpoch }); expect(received).to.have.length(1); api.dispose();
  });
  it('keeps failed command-observer retirement charged without retrying its callback', () => {
    let releases = 0; const context = {};
    const api = createInstrumentExecutionLifecycle({ observeCommandOutcomes: () => () => { releases++; throw null; },
      cancelGenerationWithReceipt: () => ({ status: 'accepted' }), renderDiagnostics: () => ({}), dispose() {} },
    { getContext: () => context, getGeneration: () => 0, isSettled: () => true, forget() {}, capacity: 1 }).api;
    const execution = api.registerExecution({ executionEpoch: 'commands', generation: 1 }).execution;
    const stop = api.observeCommandOutcomes(() => {}, { execution }); expect(stop).to.throw('retirement failed'); api.retireExecution(execution);
    expect(releases).to.equal(1); expect(api.registerExecution({ executionEpoch: 'next', generation: 1 }).reason).to.equal('execution-identity-capacity'); api.dispose();
  });
  it('translates display identities only through an active owned handle and retires observers with that handle', () => {
    const context = {}, requests = [], received = []; let receive, releases = 0;
    const raw = { observeDisplaySamples(listener, options) { receive = listener; requests.push(options); return () => { releases++; }; },
      cancelGenerationWithReceipt: () => ({ status: 'accepted' }), renderDiagnostics: () => ({}), dispose() {} };
    const api = createInstrumentExecutionLifecycle(raw, { getContext: () => context, getGeneration: () => 0, isSettled: () => true, forget() {} }).api;
    const execution = api.registerExecution({ executionEpoch: 'public-performance', generation: 7 }).execution;
    const options = { execution, identity: { executionEpoch: 'public-performance', generation: 7 } };
    expect(() => api.observeDisplaySamples(() => {}, { ...options, execution: { ...execution } })).to.throw('owned execution');
    api.observeDisplaySamples(sample => received.push(sample), options);
    expect(requests[0].identity.executionEpoch).not.to.equal('public-performance');
    receive({ executionEpoch: requests[0].identity.executionEpoch, generation: 7, actorId: 4 });
    expect(received[0]).to.include({ executionEpoch: 'public-performance', generation: 7, actorId: 4 });
    api.retireExecution(execution); expect(releases).to.equal(1);
    receive({ executionEpoch: requests[0].identity.executionEpoch, generation: 7 }); expect(received).to.have.length(1);
    expect(() => api.observeDisplaySamples(() => {}, options)).to.throw('owned execution'); api.dispose();
  });
  it('keeps failed display retirement consuming execution capacity without retrying its native release', () => {
    let releases = 0; const context = {};
    const api = createInstrumentExecutionLifecycle({ observeDisplaySamples: () => () => { releases++; throw new Error('unknown display close'); },
      cancelGenerationWithReceipt: () => ({ status: 'accepted' }), renderDiagnostics: () => ({}), dispose() {} },
    { getContext: () => context, getGeneration: () => 0, isSettled: () => true, forget() {}, capacity: 1 }).api;
    const execution = api.registerExecution({ executionEpoch: 'performance', generation: 1 }).execution;
    const stop = api.observeDisplaySamples(() => {}, { execution, identity: { executionEpoch: 'performance', generation: 1 } });
    expect(stop).to.throw('unknown display close'); api.retireExecution(execution);
    expect(releases).to.equal(1); expect(api.registerExecution({ executionEpoch: 'next', generation: 1 }).reason).to.equal('execution-identity-capacity'); api.dispose();
  });
  it('keeps delayed producers fenced across same-label renewal and context replacement', () => {
    let context = {}, generation = 0;
    const pending = new Set(), cancellations = [], forgotten = [];
    const backend = { begin: (_intent, _frame, epoch) => { pending.add(epoch); return { status: 'accepted' }; },
      update: () => ({ status: 'accepted' }), end: () => ({ status: 'accepted' }),
      renewExecutionLease: () => ({ status: 'accepted' }),
      cancelGenerationWithReceipt: (_generation, epoch) => { cancellations.push(epoch); return { count: 1 }; },
      renderDiagnostics: () => ({}), dispose() {} };
    const api = createInstrumentExecutionLifecycle(backend, { getContext: () => context, getGeneration: () => generation,
      isSettled: epoch => !pending.has(epoch), forget: epoch => forgotten.push(epoch), capacity: 2 }).api;
    const a = api.registerExecution({ executionEpoch: 'same', generation: 1 }).execution;
    api.begin({ generation: 1 }, 1, a); expect(api.retireExecution(a).state).to.equal('retiring');
    const b = api.registerExecution({ executionEpoch: 'same', generation: 1 }).execution;
    api.begin({ generation: 1 }, 1, b);
    expect(api.registerExecution({ executionEpoch: 'third', generation: 1 }).reason).to.equal('execution-identity-capacity');
    expect(api.begin({ generation: 1 }, 1, a).reason).to.equal('execution-retired');
    expect(api.begin({ generation: 1 }, 1, { ...b }).reason).to.equal('invalid-execution-handle');
    expect(api.begin({ generation: 2 }, 1, b).reason).to.equal('execution-generation-mismatch');
    expect(api.begin({ generation: 1 }, 1, cancellations[0]).reason).to.equal('execution-handle-required');
    pending.delete(cancellations[0]); expect(api.renderDiagnostics().executions.retired).to.equal(1);
    context = {}; generation++;
    expect(api.update('v', {}, 1, b).reason).to.equal('execution-retired');
    pending.clear(); expect(api.renderDiagnostics().executions.retired).to.equal(2);
    expect(new Set(forgotten).size).to.equal(2); api.dispose();
  });
});
