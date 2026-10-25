import { expect } from 'chai';
import { createSympatheticMapRecipe, SYMPATHETIC_MAP_RECIPES } from '../../js/midi/content/SympatheticMapRecipes.js';
import { prepareSympatheticNetworkProfile } from '../../js/midi/content/SympatheticNetworkProfile.js';
import { SympatheticNetworkKernel } from '../../js/app/midi-ui/worklet/SympatheticNetworkKernel.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';

const parametersFor = (recipe, options = {}) => createSympatheticMapRecipe({ recipe, ...options }).graph.nodes.find(node => node.id === 'bodies').parameters;
const energy = kernel => { let total = 0; for (const value of kernel.state) total += value * value; return total; };
describe('owned sparse sympathetic body networks', () => {
  for (const recipe of SYMPATHETIC_MAP_RECIPES) for (const sampleRate of [44100, 48000, 96000]) it('contracts without input at maximum coupling and slowest damping: ' + recipe + '/' + sampleRate, () => {
    const kernel = new SympatheticNetworkKernel({ sampleRate, parameters: parametersFor(recipe, { couple01: 1, damp01: 0 }) }); kernel.sample(1, -1, 1, 0);
    const initial = energy(kernel); let prior = initial, maximumRatio = 0;
    for (let frame = 0; frame < 16000; frame++) { kernel.sample(0, 0, frame % 300 < 150 ? 1 : 0, frame % 1000 < 500 ? 0 : 1); const next = energy(kernel); if (prior > 1e-40) maximumRatio = Math.max(maximumRatio, next / prior); prior = next; }
    expect(initial).to.be.greaterThan(0); expect(prior).to.be.lessThan(initial); expect(maximumRatio).to.be.at.most(kernel.profile.maximumRadius ** 2 + 1e-12); expect(kernel.faults).to.equal(0);
  });
  it('obeys linear superposition and preserves opposite stereo polarity through sparse coupling', () => {
    const parameters = parametersFor('metal-constellation'), a = new SympatheticNetworkKernel({ parameters }), b = new SympatheticNetworkKernel({ parameters }), sum = new SympatheticNetworkKernel({ parameters }); let error = 0;
    for (let frame = 0; frame < 12000; frame++) { const x = frame === 0 ? 0.7 : 0, y = frame === 317 ? 0.3 : 0; a.sample(x, -x); b.sample(y, -y); sum.sample(x + y, -x - y); error = Math.max(error, Math.abs(sum.leftSample - a.leftSample - b.leftSample), Math.abs(sum.leftSample + sum.rightSample)); }
    expect(error).to.be.lessThan(1e-14); expect(sum.diagnostics().bodies.some(body => body.bodyId !== parameters.bodies[0].id && body.energy > 0)).to.equal(true);
  });
  it('retains exact ringing state and rejects same-size foreign topology before mutation', () => {
    const parameters = parametersFor('string-trellis'), a = new SympatheticNetworkKernel({ parameters }), b = new SympatheticNetworkKernel({ parameters });
    for (let frame = 0; frame < 757; frame++) a.sample(frame === 0 ? 1 : 0, 0, 0.2, 0.8);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); b.restoreFrom(bytes); let error = 0;
    for (let frame = 0; frame < 2000; frame++) { a.sample(0, 0, 1, 0); b.sample(0, 0, 1, 0); error = Math.max(error, Math.abs(a.leftSample - b.leftSample)); } expect(error).to.equal(0);
    const foreignParameters = JSON.parse(JSON.stringify(parameters)); foreignParameters.bodies[0].id = 'foreign-body'; foreignParameters.edges = foreignParameters.edges.map(edge => ({ ...edge, fromBody: edge.fromBody === parameters.bodies[0].id ? 'foreign-body' : edge.fromBody }));
    const foreign = new SympatheticNetworkKernel({ parameters: foreignParameters }), before = foreign.state.slice(); expect(() => foreign.restoreFrom(bytes)).to.throw(); expect(foreign.state).to.deep.equal(before);
    const other = new SympatheticNetworkKernel({ sampleRate: 96000, parameters }); expect(() => other.restoreFrom(bytes)).to.throw();
  });
  it('rejects excess degree, arbitrary edge gain and duplicate coupling before preparation', () => {
    const parameters = JSON.parse(JSON.stringify(parametersFor('metal-constellation'))); parameters.edges.push({ ...parameters.edges[0] }); expect(() => prepareSympatheticNetworkProfile(parameters)).to.throw();
    parameters.edges.pop(); parameters.edges[0].amount = 2; expect(() => prepareSympatheticNetworkProfile(parameters)).to.throw();
  });
  it('accounts for exact configuration transfer at the 8/32/64-body comparison sizes without promising a real-time tier', () => {
    for (const count of [8, 32, 64]) {
      const parameters = { bodies: Array.from({ length: count }, (_, index) => ({ id: 'body-' + index, excitation01: index === 0 ? 1 : 0, pickup01: 1, modes: [{ frequencyHz: 100 + index, decaySeconds: 1, gain01: 1 }] })),
        edges: Array.from({ length: count - 1 }, (_, index) => ({ fromBody: 'body-' + index, fromMode: 0, toBody: 'body-' + (index + 1), toMode: 0, amount: 0.05 })), couple01: 1, damp01: 0 };
      const kernel = new SympatheticNetworkKernel({ parameters }); expect(kernel.profile.bodyCount).to.equal(count); expect(kernel.profile.cost.modeUpdatesPerStereoFrame).to.equal(count * 2);
      const bytes = new Uint8Array(kernel.snapshotBytes); kernel.snapshotInto(bytes); expect(kernel.profile.configurationBytes).to.be.greaterThan(0); expect(kernel.profile.qualification).to.include('awaiting');
    }
  });
  it('uses the actual shared graph bus and clears only the faulty network branch', async () => {
    const model = createSympatheticMapRecipe({ sourceBusId: 'lane:tools' }), graph = await createOwnedEffectGraphKernel({ definition: model.graph }), source = new Float32Array([0.3, -0.3]), present = new Uint8Array([1]);
    graph.sample(0, 0, source, present); source.fill(0); for (let frame = 0; frame < 1000; frame++) graph.sample(0, 0, source, present);
    expect(graph.diagnostics().sympatheticStates[0].bodies.some(body => body.energy > 0)).to.equal(true); graph.update('bodies', { couple01: 0, damp01: 1 }); expect(() => graph.update('bodies', { damp01: 2 })).to.throw();
    const a = new SympatheticNetworkKernel({ parameters: parametersFor('string-trellis') }), b = new SympatheticNetworkKernel({ parameters: parametersFor('string-trellis') }); a.state[0] = NaN; a.sample(0, 0); expect(a.faults).to.equal(1); expect(a.state.every(value => value === 0)).to.equal(true); expect(b.muted).to.equal(false);
    graph.panic(); graph.sample(1, 1, source, present); expect(graph.leftSample).to.equal(0);
  });
  it('prepares the explicit six-mode open Felt Bridge decays without a spatial damping claim', () => {
    const recipe = createSympatheticMapRecipe({ recipe: 'felt-bridge', damp01: 0 }), profile = prepareSympatheticNetworkProfile(recipe.graph.nodes.find(node => node.id === 'bodies').parameters);
    expect(profile.modes).to.have.length(6); expect(profile.lossMasks).to.have.length(2); expect(recipe.openModeT60Seconds).to.deep.equal([2, 1.6, 1.1, 0.8, 0.5, 0.3]);
    for (let i = 0; i < 6; i++) expect(-Math.log(1000) / (Math.log(profile.modes[i].longRadius) * 48000)).to.be.closeTo(recipe.openModeT60Seconds[i], 1e-9);
    expect(profile.preparation.kind).to.include('not-spatial'); expect(recipe.preparationMeaning).to.include('authored-mode-masks');
  });
  it('removes selected modal energy without exciting silence and never restores dissipated energy on mask release', () => {
    const parameters = JSON.parse(JSON.stringify(parametersFor('felt-bridge', { damp01: 0 }))); parameters.lossMasks[0].weights = [0, 1, 0, 1, 0, 1];
    const open = new SympatheticNetworkKernel({ parameters }), felt = new SympatheticNetworkKernel({ parameters }), silent = new SympatheticNetworkKernel({ parameters });
    open.sample(1, 1); felt.sample(1, 1); felt.setLossMask(0, 1); silent.setLossMask(0, 1); let prior = energy(felt);
    for (let frame = 0; frame < 2500; frame++) { open.sample(0, 0); felt.sample(0, 0); silent.sample(0, 0); expect(energy(felt)).to.be.at.most(prior + 1e-20); prior = energy(felt); }
    expect(energy(silent)).to.equal(0); expect(felt.state[0]).to.equal(open.state[0]); expect(felt.state[1]).to.equal(open.state[1]);
    expect(felt.state[2] ** 2 + felt.state[3] ** 2).to.be.lessThan((open.state[2] ** 2 + open.state[3] ** 2) * 0.05);
    felt.setLossMask(1, 0.7); felt.setLossMask(0, 0); expect(felt.lossMasks[4]).to.equal(0); expect(felt.lossMasks[5]).to.equal(Math.fround(0.7));
    for (let frame = 0; frame < 1000; frame++) { felt.sample(0, 0); expect(energy(felt)).to.be.at.most(prior + 1e-20); prior = energy(felt); }
  });
  it('restores in-flight mask slews and rejects another prepared mask before mutation', () => {
    const parameters = parametersFor('felt-bridge'), a = new SympatheticNetworkKernel({ parameters }), b = new SympatheticNetworkKernel({ parameters }); a.setLossMask(0, 0.8); a.setLossMask(1, 0.4);
    for (let frame = 0; frame < 117; frame++) a.sample(frame === 0 ? 1 : 0, 0);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); b.restoreFrom(bytes);
    for (let frame = 0; frame < 1000; frame++) { a.sample(0, 0); b.sample(0, 0); expect(a.leftSample).to.equal(b.leftSample); expect(a.lossMasks).to.deep.equal(b.lossMasks); }
    const changed = JSON.parse(JSON.stringify(parameters)); changed.lossMasks[0].weights[0] = 0.9; const foreign = new SympatheticNetworkKernel({ parameters: changed }); expect(() => foreign.restoreFrom(bytes)).to.throw(); expect(energy(foreign)).to.equal(0);
    a.panic(); a.snapshotInto(bytes); b.restoreFrom(bytes); expect(b.lossMasks.every(value => value === 0)).to.equal(true);
  });
  it('uses the same authored mask controls in the owned graph and rejects undeclared slots', async () => {
    const recipe = createSympatheticMapRecipe({ recipe: 'felt-bridge', damp01: 0 }), graph = await createOwnedEffectGraphKernel({ definition: recipe.graph });
    graph.update('bodies', { modeLoss0Amount01: 0.7 }); expect(graph.diagnostics().sympatheticStates[0].lossMasks[0].target01).to.equal(Math.fround(0.7));
    expect(() => graph.update('bodies', { modeLoss3Amount01: 1 })).to.throw('prepared'); expect(() => graph.update('bodies', { modeLoss0Amount01: -0.1 })).to.throw();
    graph.sample(0, 0); graph.assertHealthy(); expect(graph.plan.processingCost.sympatheticModeMaskComparisonsPerFrame).to.equal(12);
    const invalid = JSON.parse(JSON.stringify(parametersFor('felt-bridge'))); invalid.lossMasks[0].weights[0] = -1; expect(() => prepareSympatheticNetworkProfile(invalid)).to.throw();
  });
  it('moves signed pickup weights without adding energy or changing either stereo state trajectory', () => {
    const parameters = parametersFor('felt-bridge', { damp01: 0 }), moved = new SympatheticNetworkKernel({ parameters }), fixed = new SympatheticNetworkKernel({ parameters }), silent = new SympatheticNetworkKernel({ parameters });
    moved.sample(1, 1); fixed.sample(1, 1); moved.setPickupPosition('pickupLeftX01', 1); moved.setPickupPosition('pickupRightX01', 0); silent.setPickupPosition('pickupLeftX01', 1); let difference = 0;
    for (let frame = 0; frame < 5000; frame++) { moved.sample(0, 0); fixed.sample(0, 0); silent.sample(0, 0); difference += Math.abs(moved.leftSample - fixed.leftSample); }
    expect(difference).to.be.greaterThan(0); expect(moved.state).to.deep.equal(fixed.state); expect(energy(silent)).to.equal(0); expect(silent.leftSample).to.equal(0);
    const count = moved.profile.modeCount; for (let side = 0; side < 2; side++) { let norm = 0; for (let mode = 0; mode < count; mode++) norm += moved.pickupWeights[side * count + mode] ** 2; expect(norm).to.be.at.most(1); }
    expect(moved.profile.pickupGrid.units).to.include('not-a-solved'); expect(moved.profile.pickupPreparation.energyPolicy).to.include('read-existing');
  });
  it('restores independent in-flight pickup positions and rejects a different observation field before mutation', () => {
    const parameters = parametersFor('felt-bridge'), a = new SympatheticNetworkKernel({ parameters }), b = new SympatheticNetworkKernel({ parameters }); a.setPickupPosition('pickupLeftX01', 0.9); a.setPickupPosition('pickupRightY01', 0.1);
    for (let frame = 0; frame < 123; frame++) a.sample(frame === 0 ? 1 : 0, frame === 0 ? 0.5 : 0);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); b.restoreFrom(bytes);
    for (let frame = 0; frame < 1000; frame++) { a.sample(0, 0); b.sample(0, 0); expect(a.leftSample).to.equal(b.leftSample); expect(a.rightSample).to.equal(b.rightSample); expect(a.pickupPositions).to.deep.equal(b.pickupPositions); }
    const changed = JSON.parse(JSON.stringify(parameters)); changed.pickupGrid.weights[0] = 0.64; const other = new SympatheticNetworkKernel({ parameters: changed }); expect(() => other.restoreFrom(bytes)).to.throw(); expect(energy(other)).to.equal(0);
    a.panic(); a.snapshotInto(bytes); b.restoreFrom(bytes); expect(b.pickupPositions.every(value => value === 0)).to.equal(true);
  });
  it('declines unbounded or missing observation fields and routes the supported controls through the owned graph', async () => {
    const parameters = JSON.parse(JSON.stringify(parametersFor('felt-bridge'))); parameters.pickupGrid.weights[0] = 1; parameters.pickupGrid.weights[1] = 1; expect(() => prepareSympatheticNetworkProfile(parameters)).to.throw('L2');
    const plain = new SympatheticNetworkKernel({ parameters: parametersFor('string-trellis') }); expect(() => plain.setPickupPosition('pickupLeftX01', 0.2)).to.throw('observation');
    const recipe = createSympatheticMapRecipe({ recipe: 'felt-bridge' }), graph = await createOwnedEffectGraphKernel({ definition: recipe.graph }); graph.update('bodies', { pickupLeftX01: 0.2, pickupRightX01: 0.8 }); graph.sample(0, 0); graph.assertHealthy();
    const state = graph.diagnostics().sympatheticStates[0]; expect(state.pickups.targets[0]).to.equal(Math.fround(0.2)); expect(state.pickups.targets[2]).to.equal(Math.fround(0.8)); expect(graph.plan.processingCost.sympatheticPickupWeightProductsPerFrame).to.equal(48);
    expect(() => graph.update('bodies', { pickupLeftY01: -0.1 })).to.throw();
  });
});
