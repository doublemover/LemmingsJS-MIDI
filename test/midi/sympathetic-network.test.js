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
});
