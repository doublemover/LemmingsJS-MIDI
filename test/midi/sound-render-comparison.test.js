import { expect } from 'chai';
import { createSoundSpectrumPlan } from '../../js/midi/qualification/SoundSpectralTransform.js';
import { compareSoundRenders } from '../../js/midi/qualification/SoundRenderComparison.js';
import { renderSoundComparisonHtml } from '../../js/midi/qualification/SoundComparisonReport.js';
const signal = (frequency = 1000, seconds = 1, modulate = false) => ({ sampleRate: 48000, planes: [Float32Array.from({ length: Math.round(seconds * 48000) }, (_, frame) =>
  0.1 * (modulate ? 1 + 0.6 * Math.sin(2 * Math.PI * 4 * frame / 48000) : 1) * Math.sin(2 * Math.PI * frequency * frame / 48000))] });
const dft = values => Array.from({ length: values.length / 2 + 1 }, (_, bin) => {
  let real = 0, imaginary = 0;
  for (let frame = 0; frame < values.length; frame++) { const value = values[frame] * (0.5 - 0.5 * Math.cos(2 * Math.PI * frame / (values.length - 1))), angle = -2 * Math.PI * bin * frame / values.length;
    real += value * Math.cos(angle); imaginary += value * Math.sin(angle); }
  return real * real + imaginary * imaginary;
});
describe('bounded spectral and rhythmic A/B comparison', () => {
  it('matches an independent direct DFT and Parseval window energy while reusing the same destination', () => {
    const values = Float32Array.from({ length: 32 }, (_, i) => Math.sin(i * 0.7) + i / 100), plan = createSoundSpectrumPlan(32), destination = new Float64Array(plan.bins);
    expect(plan.writePower(values, 0, destination)).to.equal(destination); const expected = dft(values);
    for (let bin = 0; bin < expected.length; bin++) expect(destination[bin]).to.be.closeTo(expected[bin], 1e-10);
    let weighted = destination[0] + destination.at(-1), square = 0;
    for (let bin = 1; bin < destination.length - 1; bin++) weighted += 2 * destination[bin];
    for (let frame = 0; frame < values.length; frame++) square += (values[frame] * (0.5 - 0.5 * Math.cos(2 * Math.PI * frame / 31))) ** 2;
    expect(weighted / 32).to.be.closeTo(square, 1e-10); const first = Array.from(destination);
    plan.writePower(new Float32Array(32), 0, destination); expect(destination.every(value => value === 0)).to.equal(true);
    plan.writePower(values, 0, destination); expect(Array.from(destination)).to.deep.equal(first);
  });
  it('keeps strict nonfinite rejection separate from explicit legacy diagnostic zeroing', () => {
    const values = new Float32Array(16), destination = new Float64Array(9); values[15] = NaN;
    expect(() => createSoundSpectrumPlan(16).writePower(values, 0, destination)).to.throw('Nonfinite');
    createSoundSpectrumPlan(16, { nonfinitePolicy: 'zero-for-diagnostic' }).writePower(values, 0, destination); expect(destination.every(value => value === 0)).to.equal(true);
    for (const size of [0, 15, 33, 65536]) expect(() => createSoundSpectrumPlan(size)).to.throw();
    expect(() => createSoundSpectrumPlan(16, { windowFrames: 2 })).to.throw('no energy');
    expect(() => createSoundSpectrumPlan(16).writePower(new Float32Array(16), -1, destination)).to.throw();
    expect(() => createSoundSpectrumPlan(16).writePower(new Float32Array(16), 0, new Float64Array(8))).to.throw();
  });
  it('reports equal and anti-phase PCM truthfully without canceling stereo spectral energy', () => {
    const a = signal(), equal = compareSoundRenders(a, a); expect(equal.summary).to.include({ normalizedPcmRmsError: 0, waveformCorrelation: 1, meanAbsoluteActiveBandDifferenceDb: 0 });
    const opposite = { ...a, planes: a.planes.map(plane => Float32Array.from(plane, value => -value)) }, anti = compareSoundRenders(a, opposite);
    expect(anti.summary.waveformCorrelation).to.equal(-1); expect(anti.summary.meanAbsoluteActiveBandDifferenceDb).to.equal(0);
    const stereo = compareSoundRenders({ ...a, planes: [a.planes[0], opposite.planes[0]] }, { ...a, planes: [a.planes[0], opposite.planes[0]] });
    expect(stereo.measurements.a.rms).to.be.closeTo(equal.measurements.a.rms, 1e-12); expect(stereo.spectrogram.a).to.deep.equal(equal.spectrogram.a);
  });
  it('resolves a known four-Hz envelope change separately from the carrier frequency', () => {
    const result = compareSoundRenders(signal(1000, 4, true), signal(1000, 4));
    expect(result.modulation.a.largestBinHz).to.be.closeTo(4, 0.2); expect(result.modulation.a.index).to.be.greaterThan(0.4);
    expect(result.modulation.b.index).to.be.lessThan(1e-7); expect(result.modulation.b.largestBinHz).to.equal(null);
    expect(result.measurements.a.spectralCentroidHz).to.be.closeTo(1000, 40); expect(result.summary.perceptualVerdict).to.equal('not-inferred');
    const last = result.spectrogram.firstFrames.at(-1); expect(last + result.profile.fftSize).to.equal(result.profile.frames);
    expect(result.spectrogram.a).to.have.length(result.profile.columns * result.profile.frequencyBands);
  });
  it('rejects every nonfinite input boundary, misalignment and unmeasured gaps', () => {
    for (const value of [NaN, Infinity, -Infinity]) for (const side of [0, 1]) for (const frame of [0, 47999]) {
      const pair = [signal(), signal()]; pair[side].planes[0][frame] = value; expect(() => compareSoundRenders(...pair)).to.throw('Nonfinite PCM');
    }
    expect(() => compareSoundRenders(signal(), { ...signal(), sampleRate: 44100 })).to.throw();
    expect(() => compareSoundRenders(signal(), signal(1000, 0.5))).to.throw();
    expect(() => compareSoundRenders(signal(1000, 4), signal(1000, 4), { maximumColumns: 32 })).to.throw('gaps');
    expect(() => compareSoundRenders({ sampleRate: 48000, planes: [new Float32Array(0)] }, signal())).to.throw();
  });
  it('labels silence and short envelopes and safely embeds an independently viewable five-panel report', () => {
    const quiet = { sampleRate: 48000, planes: [new Float32Array(100)] }, result = compareSoundRenders(quiet, quiet);
    expect(result.display).to.include({ startSeconds: 0, fullDurationSeconds: 100 / 48000, silentRemainderIsRetained: true });
    expect(result.summary.normalizedPcmRmsError).to.equal(0); expect(result.summary.meanAbsoluteActiveBandDifferenceDb).to.equal(null); expect(result.modulation.a.state).to.equal('silent');
    expect(compareSoundRenders(signal(1000, 0.1), signal(1000, 0.1)).modulation.a.state).to.equal('insufficient-one-second-duration');
    result.inputs = { a: { sha256: '</script><img src=x>' } }; const html = renderSoundComparisonHtml(result);
    expect(html.match(/<canvas /g)).to.have.length(5); expect(html.match(/<script>/g)).to.have.length(1); expect(html).not.to.include('</script><img');
    expect(html).to.include('Hover a spectrogram'); expect(html).to.include('Shared A/B color scale');
  });
});
