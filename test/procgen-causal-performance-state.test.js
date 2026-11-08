import { expect } from 'chai';
import { captureCausalPerformanceState, createCausalPerformanceState, diffCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

describe('captured causal lane performance inputs', () => {
  const lanes = () => [{ id: 'first', instrumentControls: { macros: { breath: 0.2 } }, instrumentRef: { definition: { schemaVersion: 2, causalBindings: [{ mode: 'continuous', sourceKind: 'MotionCommitted' }] } } },
    { id: 'second', instrumentControls: { macros: {}, variationSeed: 42 } }];
  it('addresses numeric physical lanes and stable IDs, copies author values and retains only changed lanes', () => {
    const source = lanes(), before = captureCausalPerformanceState(source), provider = createCausalPerformanceState(before);
    source[0].instrumentControls.macros.breath = 0.8;
    expect(provider.getControls(0)).to.equal(provider.getControls('first')); expect(provider.getControls(0).macros.breath).to.equal(0.2);
    expect(provider.getPhysicalControlKinds('first')).to.deep.equal(['MotionCommitted']);
    const after = captureCausalPerformanceState(source), change = diffCausalPerformanceState(before, after); expect(change.upserts).to.have.length(1); expect(change.removed).to.have.length(0);
    provider.apply(change); expect(provider.snapshot()).to.deep.equal(after); expect(diffCausalPerformanceState(after, provider.snapshot())).to.equal(null);
    const reordered = captureCausalPerformanceState([source[1], source[0]]); provider.apply(diffCausalPerformanceState(after, reordered)); expect(provider.getControls(1).macros.breath).to.equal(0.8);
  });
  it('retains future patch data without interpreting its opaque causal binding structure', () => {
    const source = lanes(); source[0].instrumentRef.definition = { schemaVersion: 99, causalBindings: { opaque: true } };
    const before = JSON.stringify(source), captured = captureCausalPerformanceState(source);
    expect(captured.lanes[0].physicalSourceKinds).to.deep.equal([]); expect(captured.lanes[0].controls.macros.breath).to.equal(0.2);
    expect(JSON.stringify(source)).to.equal(before);
  });
  it('rejects malformed topology atomically and refuses checkpoint restoration under different performer inputs', () => {
    const initial = captureCausalPerformanceState(lanes()), provider = createCausalPerformanceState(initial);
    const retained = provider.snapshot();
    expect(() => provider.apply({ version: 1, removed: ['first'], upserts: [] })).to.throw('Invalid causal'); expect(provider.snapshot()).to.equal(retained);
    expect(provider.snapshot()).to.deep.equal(initial);
    const graph = { version: 1, revision: 1, instruments: [] }, engine = createCausalMusicEngine({ getGraph: () => graph, getPerformanceState: provider.snapshot });
    const checkpoint = engine.snapshot(), changed = lanes(); changed[0].instrumentControls.macros.breath = 1;
    provider.apply(diffCausalPerformanceState(initial, captureCausalPerformanceState(changed)));
    expect(() => engine.restore(checkpoint)).to.throw('differ');
  });
});
