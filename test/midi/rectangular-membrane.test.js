import { expect } from 'chai';
import { prepareRectangularMembraneProfile } from '../../js/midi/content/RectangularMembraneProfile.js';
import { createRectangularMembraneRecipe } from '../../js/midi/content/RectangularMembraneRecipe.js';
import { RectangularMembraneKernel } from '../../js/app/midi-ui/worklet/RectangularMembraneKernel.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';

const parameters = options => createRectangularMembraneRecipe(options).graph.nodes.find(node => node.kind === 'rectangular-membrane').parameters;
const kernelFor = (options, sampleRate = 48000) => new RectangularMembraneKernel({ parameters: parameters(options), sampleRate });
const interpolation = (size, x01, y01, fn) => {
  const x = 1 + x01 * (size - 1), y = 1 + y01 * (size - 1), i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j;
  return (1 - a) * (1 - b) * fn(i, j) + a * (1 - b) * fn(i + 1, j) + (1 - a) * b * fn(i, j + 1) + a * b * fn(i + 1, j + 1);
};
describe('owned rectangular membrane', () => {
  for (const gridSize of [8, 16]) for (const sampleRate of [44100, 48000, 96000]) it('matches an independent sine-mode reference: ' + gridSize + '/' + sampleRate, () => {
    const kernel = kernelFor({ gridSize, strikeX01: 0.23, strikeY01: 0.61 }, sampleRate), p = kernel.profile, options = p.parameters, modes = [];
    for (let y = 1; y <= gridSize; y++) for (let x = 1; x <= gridSize; x++) {
      const shape = (i, j) => 2 / (gridSize + 1) * Math.sin(Math.PI * x * i / (gridSize + 1)) * Math.sin(Math.PI * y * j / (gridSize + 1));
      const mu = 4 - 2 * Math.cos(Math.PI * x / (gridSize + 1)) - 2 * Math.cos(Math.PI * y / (gridSize + 1));
      modes.push({ a: 0, b: 0, coefficient: (2 - p.lambdaSquared * mu) / (1 + p.longLoss), previous: (1 - p.longLoss) / (1 + p.longLoss),
        excitation: interpolation(gridSize, options.strikeX01, options.strikeY01, shape) * 0.02 / (1 + p.longLoss),
        pickup: interpolation(gridSize, options.pickupLeftX01, options.pickupLeftY01, shape) * p.outputScale });
    }
    let error = 0;
    for (let frame = 0; frame < 1500; frame++) {
      kernel.sample(frame === 0 ? 1 : 0, frame === 0 ? 1 : 0); let reference = 0;
      for (const mode of modes) { const next = mode.coefficient * mode.b - mode.previous * mode.a + (frame === 0 ? mode.excitation : 0); mode.a = mode.b; mode.b = next; reference += next * mode.pickup; }
      error = Math.max(error, Math.abs(kernel.leftSample - reference));
    }
    expect(error).to.be.lessThan(1e-10); expect(kernel.faults).to.equal(0); expect(p.lambdaSquared).to.be.at.most(0.49);
  });
  it('dissipates discrete energy with changing positive loss and preserves fixed zero boundaries', () => {
    const kernel = kernelFor({ gridSize: 16 }); kernel.sample(1, 1); const initial = kernel.energy; let prior = initial, largestGrowth = 0;
    for (let frame = 0; frame < 8000; frame++) {
      kernel.sample(0, 0, 0.5, 0.5, 0.2, 0.3, 0.7, 0.6, frame % 1000 < 500 ? 0 : 1); largestGrowth = Math.max(largestGrowth, kernel.energy - prior); prior = kernel.energy;
    }
    expect(initial).to.be.greaterThan(0); expect(kernel.energy).to.be.lessThan(initial); expect(largestGrowth).to.be.lessThan(1e-11); expect(kernel.faults).to.equal(0);
    const stride = kernel.profile.stride;
    for (const plane of kernel.planes) for (let i = 0; i < plane.length; i++) if (i % stride === 0 || i % stride === stride - 1 || i < stride || i >= plane.length - stride) expect(plane[i]).to.equal(0);
  });
  it('has mirrored spatial symmetry and linear superposition below its declared energy cap', () => {
    const a = kernelFor({ strikeX01: 0.18, strikeY01: 0.41, pickupLeftX01: 0.3, pickupLeftY01: 0.7 }), mirror = kernelFor({ strikeX01: 0.82, strikeY01: 0.41, pickupLeftX01: 0.7, pickupLeftY01: 0.7 });
    const b = kernelFor({ strikeX01: 0.18, strikeY01: 0.41, pickupLeftX01: 0.3, pickupLeftY01: 0.7 }), sum = kernelFor({ strikeX01: 0.18, strikeY01: 0.41, pickupLeftX01: 0.3, pickupLeftY01: 0.7 }); let error = 0;
    for (let frame = 0; frame < 2500; frame++) {
      const x = frame === 0 ? 0.4 : 0, y = frame === 137 ? 0.3 : 0;
      a.sample(x, x); mirror.sample(x, x); b.sample(y, y); sum.sample(x + y, x + y);
      error = Math.max(error, Math.abs(a.leftSample - mirror.leftSample), Math.abs(sum.leftSample - a.leftSample - b.leftSample));
    }
    expect(error).to.be.lessThan(1e-11); expect(sum.overflows).to.equal(0);
  });
  it('moves observation without adding energy or changing the wave field', () => {
    const a = kernelFor(), b = kernelFor(); b.setControls({ pickupLeftX01: 0, pickupLeftY01: 1 }); let different = false;
    for (let frame = 0; frame < 2500; frame++) { a.sample(frame === 0 ? 1 : 0, frame === 0 ? 1 : 0); b.sample(frame === 0 ? 1 : 0, frame === 0 ? 1 : 0); different ||= Math.abs(a.leftSample - b.leftSample) > 1e-9; }
    expect(different).to.equal(true); expect(a.planes).to.deep.equal(b.planes); expect(a.energy).to.equal(b.energy);
  });
  it('caps excitation internally, accounts stereo cancellation, and quarantines only its own state', () => {
    const a = kernelFor(), silent = kernelFor(); let maximum = 0;
    for (let frame = 0; frame < 8000; frame++) { a.sample(32, 32); silent.sample(1, -1); maximum = Math.max(maximum, a.energy); }
    expect(maximum).to.be.at.most(1.0000001); expect(a.overflows).to.be.greaterThan(0); expect(a.faults).to.equal(0); expect(silent.energy).to.equal(0);
    a.planes[a.current][a.profile.stride + 1] = NaN; a.sample(0, 0); expect(a.faults).to.equal(1); expect(a.planes.every(plane => plane.every(value => value === 0))).to.equal(true); expect(silent.muted).to.equal(false);
  });
  it('restores every ringing plane/control and rejects other rates, tuning and geometry before mutation', () => {
    const a = kernelFor(), b = kernelFor(); a.setControls({ pickupLeftX01: 0.1, damp01: 0.9 });
    for (let i = 0; i < 157; i++) a.sample(i === 0 ? 1 : 0, i === 0 ? 1 : 0);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); b.restoreFrom(bytes);
    for (let i = 0; i < 1000; i++) { a.sample(0, 0); b.sample(0, 0); expect(a.leftSample).to.equal(b.leftSample); expect(a.energy).to.equal(b.energy); }
    for (const other of [kernelFor({ gridSize: 16 }), kernelFor({ fundamentalHz: 190 }), kernelFor({}, 96000)]) { expect(() => other.restoreFrom(bytes)).to.throw(); expect(other.energy).to.equal(0); }
    a.panic(); a.snapshotInto(bytes); b.restoreFrom(bytes); expect(b.muted).to.equal(true); expect(b.energy).to.equal(0);
  });
  it('rejects unqualified masks, geometry and nonfinite controls', () => {
    const p = parameters(); expect(() => prepareRectangularMembraneProfile({ ...p, mask: [1] })).to.throw(); expect(() => prepareRectangularMembraneProfile({ ...p, gridSize: 12 })).to.throw();
    expect(() => prepareRectangularMembraneProfile({ ...p, fundamentalHz: 10000 })).to.throw(); expect(() => prepareRectangularMembraneProfile({ ...p, decaySeconds: 0 })).to.throw();
    const kernel = kernelFor(); expect(() => kernel.setControls({ pickupLeftX01: NaN })).to.throw(); expect(() => kernel.setControls({ fundamentalHz: 200 })).to.throw();
  });
  it('prepares 8/16-grid and one/four-body cost fixtures without asserting a measured device tier', () => {
    for (const gridSize of [8, 16]) for (const bodyCount of [1, 4]) {
      const base = parameters({ gridSize }), nodes = [{ id: 'in', kind: 'bus-in', parameters: {} }, { id: 'out', kind: 'bus-out', parameters: {} }], edges = [];
      for (let i = 0; i < bodyCount; i++) { const id = 'skin-' + i; nodes.push({ id, kind: 'rectangular-membrane', parameters: base }); edges.push({ from: { nodeId: 'in', port: 'audio' }, to: { nodeId: id, port: 'audio' }, gain01: 1 }, { from: { nodeId: id, port: 'audio' }, to: { nodeId: 'out', port: 'audio' }, gain01: 0.25 }); }
      const plan = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: 'membrane-benchmark', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 8, nodes, edges });
      expect(plan.processingCost.membraneGridUpdatesPerFrame).to.equal(gridSize * gridSize * bodyCount); expect(plan.processingCost.membraneUpdateRate).to.equal(48000);
      expect(plan.nodes.filter(node => node.membrane).every(node => node.membrane.qualification.includes('awaiting'))).to.equal(true);
    }
  });
  it('uses actual shared owner audio and recorded controls in the normal graph path', async () => {
    const recipe = createRectangularMembraneRecipe({ sourceBusId: 'lane:tools' }), graph = await createOwnedEffectGraphKernel({ definition: recipe.graph }), input = new Float32Array([1, 1]);
    graph.sample(0, 0, input, new Uint8Array([1])); input.fill(0); graph.update('skin', { pickupLeftX01: 0.1, damp01: 0.2 });
    for (let i = 0; i < 1000; i++) graph.sample(0, 0, input, new Uint8Array([1]));
    expect(graph.diagnostics().membraneStates[0].energy).to.be.greaterThan(0); expect(graph.diagnostics().membraneStates[0].displacement).to.have.length(64);
    expect(() => graph.update('skin', { strikeX01: 2 })).to.throw(); graph.panic(); graph.sample(1, 1); expect(graph.leftSample).to.equal(0);
  });
});
