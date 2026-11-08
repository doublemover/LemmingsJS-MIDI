import { expect } from 'chai';
import { createBodyRoutedSympatheticMap } from '../../js/midi/content/SympatheticMapRecipes.js';
import { SympatheticNetworkKernel } from '../../js/app/midi-ui/worklet/SympatheticNetworkKernel.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { prepareEffectSourceBindings } from '../../js/app/midi-ui/EffectSourceBindings.js';

const model = () => createBodyRoutedSympatheticMap({ recipe: 'string-trellis', couple01: 0, damp01: 0.3, bodySourceBusIds: ['lane:left', 'lane:right', null, null] });
const parameters = () => model().graph.nodes.find(node => node.id === 'bodies').parameters;

describe('separate sympathetic body inputs (deferred grouped qualification)', () => {
  for (const sampleRate of [44100, 48000, 96000]) it('excites the selected body independently and retains exact ringing state at ' + sampleRate, () => {
    const a = new SympatheticNetworkKernel({ parameters: parameters(), sampleRate }), b = new SympatheticNetworkKernel({ parameters: parameters(), sampleRate }), inputs = new Float64Array(8); inputs[2] = 0.3; inputs[3] = -0.3; a.sample(0, 0, 0, 0.3, inputs); inputs.fill(0);
    for (let frame = 0; frame < 173; frame++) a.sample(0, 0, 0, 0.3, inputs);
    const health = a.diagnostics(); expect(health.bodies[1].energy).to.be.greaterThan(0); expect(health.bodies.filter((_, index) => index !== 1).every(body => body.energy === 0)).to.equal(true);
    const image = new Uint8Array(a.snapshotBytes); a.snapshotInto(image); b.restoreFrom(image);
    for (let frame = 0; frame < 1024; frame++) { inputs[0] = frame === 257 ? 0.2 : 0; a.sample(0, 0, 0.6, 0.2, inputs); b.sample(0, 0, 0.6, 0.2, inputs); expect([a.leftSample, a.rightSample]).to.deep.equal([b.leftSample, b.rightSample]); }
    expect(a.diagnostics().bodies[3].energy).to.be.greaterThan(0); expect(a.faults).to.equal(0);
  });
  it('routes actual separate lane samples through one shared owned graph, then clears on Panic', async () => {
    const map = model(), graph = await createOwnedEffectGraphKernel({ definition: map.graph }), bindings = prepareEffectSourceBindings(graph.plan, ['left', 'right']);
    expect(bindings.routes.map(route => route.laneId).sort()).to.deep.equal(['left', 'right']);
    const samples = new Float32Array(4), present = new Uint8Array([1, 1]), right = bindings.routes.findIndex(route => route.laneId === 'right'); samples[right * 2] = 0.25; samples[right * 2 + 1] = -0.25; graph.sample(0, 0, samples, present); samples.fill(0);
    for (let frame = 0; frame < 512; frame++) graph.sample(0, 0, samples, present);
    const network = graph.diagnostics().sympatheticStates[0]; expect(network.bodies[1].energy).to.be.greaterThan(0); expect(network.bodies[0].energy).to.equal(0); expect(network.audioInputs).to.equal(4);
    graph.panic(); graph.sample(0, 0, samples, present); expect([graph.leftSample, graph.rightSample]).to.deep.equal([0, 0]);
  });
  it('contains an oversized input vector rather than amplifying an invalid aggregate', () => {
    const kernel = new SympatheticNetworkKernel({ parameters: parameters() }), inputs = new Float64Array(8); inputs[0] = inputs[2] = 24; kernel.sample(0, 0, 0, 0, inputs);
    expect(kernel.muted).to.equal(true); expect(kernel.faults).to.equal(1); expect(kernel.state.every(value => value === 0)).to.equal(true);
  });
});
