import { expect } from 'chai';
import { AllpassNotchKernel } from '../../js/app/midi-ui/worklet/AllpassNotchProcessor.js';
import { createTravelColorationRecipe } from '../../js/midi/content/TravelColorationRecipes.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';

describe('normalized moving allpass notch realization', () => {
  for (const rate of [44100, 48000, 96000]) {
    it('preserves scattering energy while frequencies move rapidly at ' + rate + ' Hz', () => {
      const kernel = new AllpassNotchKernel({ sampleRate: rate, parameters: { feedback: 0 } }); let inputEnergy = 0, outputEnergy = 0;
      for (let frame = 0; frame < 20000; frame++) {
        const input = frame < 10000 ? Math.sin(frame * 0.17) * 0.1 : 0, frequency = frame % 64 < 32 ? 160 : 1600;
        kernel.sample(input, -input, frequency, 0, 1); inputEnergy += input * input * 2; outputEnergy += kernel.leftSample ** 2 + kernel.rightSample ** 2;
      }
      let stored = 0; for (let index = 0; index < 16; index++) stored += kernel.state[index] ** 2;
      expect(Math.abs(inputEnergy - outputEnergy - stored)).to.be.lessThan(1e-8); expect(kernel.faults).to.equal(0);
    });
    it('retains unit static magnitude and names frequency-dependent phase at ' + rate + ' Hz', () => {
      const kernel = new AllpassNotchKernel({ sampleRate: rate, parameters: { feedback: 0 } }); let real = 0, imaginary = 0;
      for (let frame = 0; frame < rate + 4096; frame++) {
        const phase = 2 * Math.PI * 440 * frame / rate; kernel.sample(Math.sin(phase) * 0.2, 0, 640, 0, 1);
        if (frame >= 4096) { real += kernel.leftSample * Math.cos(phase); imaginary += kernel.leftSample * Math.sin(phase); }
      }
      expect(2 * Math.hypot(real, imaginary) / rate).to.be.closeTo(0.2, 1e-6);
      expect(kernel.profile.phasePolicy).to.include('frequency-dependent'); expect(kernel.profile.gainBoundDomain).to.include('L2');
    });
  }
  it('restores the actual moving reflection coefficients, feedback delay and control frontier', () => {
    const first = new AllpassNotchKernel(), second = new AllpassNotchKernel();
    for (let frame = 0; frame < 217; frame++) first.sample(Math.sin(frame / 13) * 0.2, 0, 1200);
    const bytes = new Uint8Array(first.snapshotBytes); first.snapshotInto(bytes); second.restoreFrom(bytes);
    for (let frame = 217; frame < 1217; frame++) {
      const input = Math.sin(frame / 13) * 0.2; first.sample(input, -input, 160); second.sample(input, -input, 160);
      expect(second.leftSample).to.equal(first.leftSample); expect(second.rightSample).to.equal(first.rightSample);
    }
    const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1; expect(() => second.restoreFrom(corrupt)).to.throw();
    expect(() => new AllpassNotchKernel({ sampleRate: 96000 }).restoreFrom(bytes)).to.throw();
  });
  it('renders Hollow Steps through the shared graph and controls the actual frequency input', async () => {
    const model = createTravelColorationRecipe({ recipe: 'hollow-steps' }), plan = prepareEffectGraphRevision(model.graph), graph = await createOwnedEffectGraphKernel({ definition: model.graph });
    expect(model.control).to.include({ nodeId: 'motion-notches', parameter: 'baseFrequencyHz' });
    expect(plan.processingCost.allpassLatticeSectionsPerFrame).to.equal(16); expect(plan.nodes.find(node => node.allpass).allpass.stageCount).to.equal(8);
    graph.update('motion-notches', { baseFrequencyHz: 1600 });
    for (let frame = 0; frame < 1000; frame++) { graph.sample(Math.sin(frame / 17) * 0.2, 0); expect(Number.isFinite(graph.leftSample)).to.equal(true); }
    expect(() => graph.update('motion-notches', { baseFrequencyHz: 0 })).to.throw(); graph.panic(); graph.sample(0.2, 0.2); expect(graph.leftSample).to.equal(0);
  });
  it('keeps both through-zero branches causal around the declared delayed reference', () => {
    for (const sampleRate of [44100, 48000, 96000]) {
      const model = createTravelColorationRecipe({ recipe: 'through-zero', depth01: 1 }), plan = prepareEffectGraphRevision(model.graph, { sampleRate });
      expect(model.creativeReferenceDelaySeconds).to.be.closeTo(0.0042, 1e-12);
      expect(model.relativeDelaySeconds[0]).to.be.lessThan(0); expect(model.relativeDelaySeconds[1]).to.be.greaterThan(0);
      expect(plan.nodes.find(node => node.id === 'reference-delay').parameters.delaySeconds).to.equal(model.creativeReferenceDelaySeconds);
      expect(plan.edges.filter(edge => edge.to.nodeId === 'dry').map(edge => edge.from.nodeId)).to.deep.equal(['reference-delay']);
      expect(plan.edges.every(edge => edge.alignmentFrames === 0)).to.equal(true); expect(model.control.minimum * sampleRate).to.be.greaterThan(2);
    }
  });
  it('clears its own histories and fails closed on excessive or nonfinite modulation', () => {
    const kernel = new AllpassNotchKernel(); kernel.sample(0.1, 0.1); kernel.sample(0.1, 0.1, NaN);
    expect(kernel.faults).to.equal(1); expect(kernel.muted).to.equal(true); expect(kernel.state.every(value => value === 0)).to.equal(true);
    kernel.sample(0.1, 0.1); expect(kernel.leftSample).to.equal(0);
  });
});
