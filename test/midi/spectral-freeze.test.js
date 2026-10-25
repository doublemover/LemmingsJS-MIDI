import { expect } from 'chai';
import { OwnedRadix2FFT } from '../../js/app/midi-ui/worklet/OwnedRadix2FFT.js';
import { SpectralFreezeKernel } from '../../js/app/midi-ui/worklet/SpectralFreezeKernel.js';
import { createGlassHoldRecipe } from '../../js/midi/content/SpectralFreezeRecipes.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';

const signal = frame => frame < 0 ? 0 : frame === 0 ? 0.3 : (Math.sin(frame * 0.097) + Math.sin(frame * 0.013)) * 0.1;
describe('owned spectral freeze and overlap-add', () => {
  for (const n of [512, 1024, 2048]) {
    it('roundtrips independent complex planes with the prepared ' + n + '-point transform', () => {
      const fft = new OwnedRadix2FFT(n), real = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 11)), imaginary = Float64Array.from({ length: n }, (_, i) => Math.cos(i / 19));
      const expectedReal = real.slice(), expectedImaginary = imaginary.slice(); fft.transform(real, imaginary); fft.transform(real, imaginary, true); let error = 0;
      for (let i = 0; i < n; i++) error = Math.max(error, Math.abs(real[i] - expectedReal[i]), Math.abs(imaginary[i] - expectedImaginary[i]));
      expect(error).to.be.lessThan(1e-11);
    });
    for (const sampleRate of [44100, 48000, 96000]) it('reconstructs the initial impulse and irregular stereo signal with exactly N delay at ' + n + '/' + sampleRate, () => {
      const kernel = new SpectralFreezeKernel({ sampleRate, parameters: { fftSize: n } }); let error = 0;
      for (let frame = 0; frame < n * 6; frame++) { kernel.sample(signal(frame), -signal(frame)); error = Math.max(error, Math.abs(kernel.leftSample - signal(frame - n)), Math.abs(kernel.rightSample + signal(frame - n))); }
      expect(error).to.be.lessThan(1e-11); expect(kernel.faults).to.equal(0); expect(kernel.profile.processingLatencyFrames).to.equal(n);
    });
  }
  it('acknowledges the actual global hop and applies an attenuate-only capture peak bound', () => {
    const kernel = new SpectralFreezeKernel({ startFrame: 37, parameters: { fftSize: 512, blur01: 0.5, pitchRatio: 1.5 } });
    for (let frame = 0; frame < 2300; frame++) kernel.sample(signal(frame), -signal(frame), frame >= 533 ? 1 : 0);
    expect(kernel.captureSerial).to.equal(1); expect(kernel.captureEndFrame % 128).to.equal(0); expect(kernel.captureEndFrame).to.be.at.least(37 + 534);
    expect(kernel.captureStartFrame).to.equal(kernel.captureEndFrame - 512); expect(kernel.capturedSilence).to.equal(false);
    for (let channel = 0; channel < 2; channel++) { let peak = 0; for (let bin = 0; bin < kernel.profile.bins; bin++) peak += kernel.magnitude[channel * kernel.profile.bins + bin] * (bin === 0 || bin === kernel.profile.bins - 1 ? 1 : 2) / 512;
      expect(peak).to.be.at.most(kernel.capturePeaks[channel] / 2 + 1e-12); expect(kernel.captureScales[channel]).to.be.within(0, 1); }
    expect(kernel.diagnostics().portableMaterial).to.equal(false);
  });
  it('distinguishes an unavailable source from valid captured silence and cancels early thaw', () => {
    const kernel = new SpectralFreezeKernel({ sourceAvailable: false, parameters: { fftSize: 512 } });
    for (let frame = 0; frame < 1024; frame++) kernel.sample(0, 0, 1, false);
    expect(kernel.captureSerial).to.equal(0); expect(kernel.diagnostics().state).to.equal('source-unavailable');
    for (let frame = 0; frame < 1024; frame++) kernel.sample(0, 0, 1, true); expect(kernel.captureSerial).to.equal(0);
    kernel.sample(0, 0, 0); kernel.sample(0, 0, 1); kernel.sample(0, 0, 0);
    for (let frame = 0; frame < 512; frame++) kernel.sample(0, 0, 0); expect(kernel.captureSerial).to.equal(0);
    for (let frame = 0; frame < 1024; frame++) kernel.sample(0, 0, 1);
    expect(kernel.captureSerial).to.equal(1); expect(kernel.capturedSilence).to.equal(true); expect(kernel.captureEnergy).to.equal(0);
  });
  it('continues identical phase, overlap, normalization and control history after an exact state cut', () => {
    const parameters = { fftSize: 512, maximumHoldSeconds: 0.1, thawSeconds: 0.02 }, a = new SpectralFreezeKernel({ parameters }), b = new SpectralFreezeKernel({ parameters });
    for (let frame = 0; frame < 2037; frame++) a.sample(signal(frame), -signal(frame), frame > 600 ? 1 : 0);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); b.restoreFrom(bytes); let error = 0;
    for (let frame = 2037; frame < 13000; frame++) { a.sample(0, 0, 1); b.sample(0, 0, 1); error = Math.max(error, Math.abs(a.leftSample - b.leftSample), Math.abs(a.rightSample - b.rightSample)); }
    expect(error).to.equal(0); expect(a.holding).to.equal(false); expect(a.mix).to.equal(0); expect(a.leftSample).to.equal(0);
    const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1; expect(() => b.restoreFrom(corrupt)).to.throw();
    expect(() => new SpectralFreezeKernel({ sampleRate: 96000, parameters }).restoreFrom(bytes)).to.throw();
  });
  it('keeps dry attacks immediate and captures the actual selected lane in the complete graph', async () => {
    const model = createGlassHoldRecipe({ sourceBusId: 'lane:tools', fftSize: 512 }), plan = prepareEffectGraphRevision(model.graph), graph = await createOwnedEffectGraphKernel({ definition: model.graph });
    expect(plan.alignment).to.equal('disabled-preserve-immediate-dry'); expect(plan.edges.every(edge => edge.alignmentFrames === 0)).to.equal(true); expect(plan.latencyFrames).to.equal(512);
    const samples = new Float32Array(2), presence = new Uint8Array([1]); graph.sample(0.2, -0.2, samples, presence); expect(graph.leftSample).to.be.closeTo(0.17, 1e-7);
    graph.update('freeze', { hold01: 1 }); for (let frame = 0; frame < 1200; frame++) { samples[0] = signal(frame); samples[1] = -samples[0]; graph.sample(0, 0, samples, presence); }
    expect(graph.diagnostics().spectralStates[0].captureSerial).to.equal(1); expect(() => graph.update('freeze', { hold01: 0.5 })).to.throw();
    graph.panic(); graph.sample(0.2, 0.2, samples, presence); expect(graph.leftSample).to.equal(0);
  });
  it('contains invalid source data without modifying another owned spectral body', () => {
    const first = new SpectralFreezeKernel(), second = new SpectralFreezeKernel(); first.sample(NaN, 0);
    expect(first.faults).to.equal(1); expect(first.muted).to.equal(true); expect(second.muted).to.equal(false); expect(first.overlap.every(value => value === 0)).to.equal(true);
  });
});
