import { expect } from 'chai';
import { createInstrumentExecutionLifecycle } from '../../js/app/midi-ui/InstrumentExecutionLifecycle.js';

describe('opaque instrument execution ownership', () => {
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
