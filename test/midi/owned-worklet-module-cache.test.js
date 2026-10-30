import { expect } from 'chai';
import { loadOwnedWorkletModule, inspectOwnedWorkletModule } from '../../js/app/midi-ui/OwnedWorkletModuleCache.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';

const source = { id: 'worklet-choir', runtime: { workletUrl: 'https://example.invalid/owned-test-source.js' }, heapEstimate: 4096 };
const context = action => {
  const listeners = new Set(); return { state: 'running', audioWorklet: { addModule: action }, addEventListener: (_kind, listener) => listeners.add(listener),
    removeEventListener: (_kind, listener) => listeners.delete(listener), close() { this.state = 'closed'; for (const listener of listeners) listener(); }, listeners };
};
describe('owned worklet module heap lifetime', () => {
  it('loads a shared module once and retires its estimate at actual context closure', async () => {
    let loads = 0; const ctx = context(async () => { loads++; }), resources = createAudioResourceLeases();
    await Promise.all([loadOwnedWorkletModule(ctx, source, resources), loadOwnedWorkletModule(ctx, source, resources)]);
    expect(loads).to.equal(1); expect(resources.diagnostics()).to.include({ reservations: 1, estimatedBytes: 4096 });
    expect(inspectOwnedWorkletModule(ctx, source.runtime.workletUrl).state).to.equal('ready'); const disposed = resources.dispose(); expect(disposed.outcome).not.to.equal('complete');
    ctx.close(); await disposed.completion; expect(disposed.outcome).to.equal('complete'); expect(resources.diagnostics().reservations).to.equal(0); expect(ctx.listeners.size).to.equal(0);
  });
  it('keeps failed or still-loading module estimates until closure and does not duplicate failed loads', async () => {
    let loads = 0; const resources = createAudioResourceLeases(), ctx = context(async () => { loads++; throw new Error('module failed'); });
    for (let attempt = 0; attempt < 2; attempt++) { let failure; try { await loadOwnedWorkletModule(ctx, source, resources); } catch (error) { failure = error; } expect(failure.message).to.equal('module failed'); }
    expect(loads).to.equal(1); expect(resources.diagnostics().estimatedBytes).to.equal(4096); ctx.close(); expect(resources.diagnostics().reservations).to.equal(0);
    let finish; const pendingContext = context(() => new Promise(resolve => { finish = resolve; })), waiting = loadOwnedWorkletModule(pendingContext, source, resources);
    expect(resources.diagnostics().estimatedBytes).to.equal(4096); pendingContext.close(); expect(resources.diagnostics().reservations).to.equal(0); finish(); await waiting;
    expect(inspectOwnedWorkletModule(pendingContext, source.runtime.workletUrl).state).to.equal('closed');
  });
});
