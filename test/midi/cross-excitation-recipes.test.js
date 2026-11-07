import { expect } from 'chai';
import { CROSS_EXCITATION_RECIPES, createCrossExcitationRecipe } from '../../js/midi/content/CrossExcitationRecipes.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { RingModulatorKernel } from '../../js/app/midi-ui/worklet/RingModulatorKernel.js';

describe('cross-excitation content and actual ring DSP', function() {
  for (const rate of [44100, 48000, 96000]) {
    for (const recipe of CROSS_EXCITATION_RECIPES) it('prepares ' + recipe.name + ' at ' + rate + ' Hz with explicit independent inputs', () => {
      const model = createCrossExcitationRecipe({ recipe: recipe.id, donorLaneId: 'tools', carrierLaneId: 'voices' }), plan = prepareEffectGraphRevision(model.graph, { sampleRate: rate });
      expect(model.direction).to.equal('donor-to-carrier-only'); expect(model.lineagePolicy).to.include('no-additional-semantic-onsets');
      expect(plan.sidechainInputs).to.have.members(['donor', 'carrier']); expect(plan.nodes.find(node => node.id === 'dry').parameters.gain01).to.equal(1);
      if (recipe.id === 'tools-talk') expect(plan.nodes.find(node => node.kind === 'multiband-vocoder').vocoder.parameters).to.include({ bands: 12, lowHz: 120, highHz: 6000, attackSeconds: 0.004, releaseSeconds: 0.08, depth01: 0.7, baseline01: 0.1 });
      if (recipe.id === 'rust-bloom') expect(plan.latencyFrames).to.equal(16);
    });
    it('retains the physical carrier and known ring sidebands with independent stereo polarity at ' + rate + ' Hz', () => {
      const kernel = new RingModulatorKernel({ sampleRate: rate }), phase = frequency => 2 * Math.PI * frequency / rate;
      let lowReal = 0, lowImaginary = 0, highReal = 0, highImaginary = 0, carrierReal = 0, carrierImaginary = 0, maximumStereoError = 0;
      for (let frame = 0; frame < rate + 4096; frame++) {
        const donor = 0.2 * Math.cos(phase(200) * frame), carrier = 0.4 * Math.sin(phase(1000) * frame); kernel.sample(donor, -donor, carrier, carrier);
        maximumStereoError = Math.max(maximumStereoError, Math.abs(kernel.leftSample + kernel.rightSample));
        if (frame < 4096) continue;
        lowReal += kernel.leftSample * Math.cos(phase(800) * frame); lowImaginary += kernel.leftSample * Math.sin(phase(800) * frame);
        highReal += kernel.leftSample * Math.cos(phase(1200) * frame); highImaginary += kernel.leftSample * Math.sin(phase(1200) * frame);
        carrierReal += kernel.leftSample * Math.cos(phase(1000) * frame); carrierImaginary += kernel.leftSample * Math.sin(phase(1000) * frame);
      }
      expect(2 * Math.hypot(lowReal, lowImaginary) / rate).to.be.within(0.02, 0.06);
      expect(2 * Math.hypot(highReal, highImaginary) / rate).to.be.within(0.02, 0.06);
      expect(2 * Math.hypot(carrierReal, carrierImaginary) / rate).to.be.lessThan(0.001); expect(kernel.faults).to.equal(0); expect(maximumStereoError).to.equal(0);
    });
  }
  it('rejects a self donor, invalid route identity and unsafe controls before graph publication', () => {
    for (const input of [{ donorLaneId: 'same', carrierLaneId: 'same' }, { donorLaneId: '../lane', carrierLaneId: 'carrier' },
      { donorLaneId: 'donor', carrierLaneId: 'carrier', merge01: 1 }, { donorLaneId: 'donor', carrierLaneId: 'carrier', air01: NaN }]) expect(() => createCrossExcitationRecipe(input)).to.throw();
  });
  it('restores every ring filter, cursor and diagnostic frontier and refuses corrupt or foreign state before mutation', () => {
    const first = new RingModulatorKernel(), restored = new RingModulatorKernel();
    for (let frame = 0; frame < 343; frame++) first.sample(Math.sin(frame / 11) * 0.2, Math.cos(frame / 13) * 0.2, Math.sin(frame / 7) * 0.4, Math.cos(frame / 9) * 0.4);
    const bytes = new Uint8Array(first.snapshotBytes); first.snapshotInto(bytes); restored.restoreFrom(bytes);
    for (let frame = 343; frame < 1343; frame++) {
      const args = [Math.sin(frame / 11) * 0.2, Math.cos(frame / 13) * 0.2, Math.sin(frame / 7) * 0.4, Math.cos(frame / 9) * 0.4]; first.sample(...args); restored.sample(...args);
      expect(restored.leftSample).to.equal(first.leftSample); expect(restored.rightSample).to.equal(first.rightSample);
    }
    const before = new Uint8Array(restored.snapshotBytes); restored.snapshotInto(before); const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
    expect(() => restored.restoreFrom(corrupt)).to.throw(); const after = new Uint8Array(restored.snapshotBytes); restored.snapshotInto(after); expect(after).to.deep.equal(before);
    expect(() => new RingModulatorKernel({ parameters: { drive01: 0.5 } }).restoreFrom(bytes)).to.throw();
  });
  it('runs the ring inside the actual shared graph with an unchanged aligned dry path and no donor bleed', async () => {
    const model = createCrossExcitationRecipe({ recipe: 'rust-bloom', donorLaneId: 'donor', carrierLaneId: 'carrier' });
    const graph = await createOwnedEffectGraphKernel({ definition: model.graph }), inputs = new Float32Array(4), present = new Uint8Array([1, 1]);
    for (let frame = 0; frame < 128; frame++) {
      graph.sample(frame === 0 ? 1 : 0, frame === 0 ? -1 : 0, inputs, present);
      expect(graph.leftSample).to.equal(frame === 16 ? 1 : 0); expect(graph.rightSample).to.equal(frame === 16 ? -1 : 0);
    }
    graph.panic(); graph.sample(1, 1, inputs, present); expect(graph.leftSample).to.equal(0); expect(graph.rightSample).to.equal(0);
  });
  it('drains missing sources and quarantines nonfinite input without leaving an autonomous ring', () => {
    const kernel = new RingModulatorKernel();
    for (let frame = 0; frame < 64; frame++) kernel.sample(0.2, 0.2, 0.4, 0.4);
    for (let frame = 0; frame < 10000; frame++) kernel.sample(0, 0, 0, 0, false, false);
    expect(Math.abs(kernel.leftSample)).to.be.lessThan(1e-12); expect(kernel.donorAvailable).to.equal(false);
    kernel.sample(NaN, 0, 0, 0); expect(kernel.muted).to.equal(true); expect(kernel.faults).to.equal(1);
    kernel.sample(0.2, 0.2, 0.4, 0.4); expect(kernel.leftSample).to.equal(0);
  });
});
