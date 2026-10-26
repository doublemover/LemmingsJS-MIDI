import { expect } from 'chai';
import { prepareSympatheticNetworkProfile, NETWORK_POINT_LOSS_OPERATOR } from '../../js/midi/content/SympatheticNetworkProfile.js';
import { SympatheticNetworkKernel } from '../../js/app/midi-ui/worklet/SympatheticNetworkKernel.js';

const copy = value => JSON.parse(JSON.stringify(value));
const point = (id = 'touch-a', weights = [0.6, -0.8]) => ({ id, operator: NETWORK_POINT_LOSS_OPERATOR, extraAmplitudeT60Seconds: 0.06, weights });
const parameters = (lossMasks = [point()]) => ({ bodies: [{ id: 'body', excitation01: 1, pickup01: 1, modes: [0, 1].map(() => ({ frequencyHz: 440, decaySeconds: 0.4, gain01: 1 })) }], edges: [], couple01: 0, damp01: 0, lossMasks });
const energy = values => values.reduce((sum, value) => sum + value * value, 0);

describe('signed site point-loss flow (DSP execution and qualification deferred)', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    it('implements the analytic rank-one velocity flow and preserves its displacement quadrature at ' + sampleRate, () => {
      const kernel = new SympatheticNetworkKernel({ parameters: parameters(), sampleRate }), original = [0.3, 0.2, -0.4, -0.1], amount = 0.75;
      kernel.state.set(original); kernel.lossMasks[0] = amount; const projection = 0.6 * original[0] - 0.8 * original[2], coefficient = -Math.expm1(-Math.log(1000) / (0.06 * sampleRate)); kernel.applyPointLoss(0, 2);
      expect(kernel.state[0]).to.be.closeTo(original[0] - amount * coefficient * 0.6 * projection, 1e-15); expect(kernel.state[2]).to.be.closeTo(original[2] + amount * coefficient * 0.8 * projection, 1e-15); expect(kernel.state[1]).to.equal(original[1]); expect(kernel.state[3]).to.equal(original[3]); expect(energy(kernel.state)).to.be.lessThan(energy(original));
      expect(kernel.profile.preparation.gainPolicy).to.include('no-per-site-renormalization'); expect(kernel.profile.cost.pointLossProductsPerFrame).to.equal(8);
    });
  }
  it('retains the signed cross-mode term, the exact null space and site gain instead of squaring or renormalizing each site', () => {
    const kernel = new SympatheticNetworkKernel({ parameters: parameters() }); kernel.lossMasks[0] = 1;
    kernel.state.set([1, 0, 0, 0]); kernel.applyPointLoss(0, 2); expect(kernel.state[2]).to.be.greaterThan(0);
    kernel.state.set([0.8, 0.2, 0.6, -0.1]); const original = kernel.state.slice(); kernel.applyPointLoss(0, 2); expect(kernel.state).to.deep.equal(original);
    const quieter = new SympatheticNetworkKernel({ parameters: parameters([point('weaker-site', [0.3, -0.4])]) }); quieter.lossMasks[0] = 1; quieter.state.set([1, 0, 0, 0]); quieter.applyPointLoss(0, 2); expect(quieter.state[0]).to.be.greaterThan(1 - kernel.profile.lossMasks[0].projectionDepth * 0.36); expect(quieter.profile.lossMasks[0].squaredNorm).to.equal(0.25);
  });
  it('composes multiple contacts contractively with diagonal loss and does not restore dissipated energy on release', () => {
    const kernel = new SympatheticNetworkKernel({ parameters: parameters([point(), point('touch-b', [-0.2, 0.5]), { id: 'legacy-diagonal', extraAmplitudeT60Seconds: 0.1, weights: [1, 0.25] }]) }); kernel.state.set([0.8, 0.2, -0.3, 0.1, -0.6, 0.4, 0.2, -0.1]); let prior = energy(kernel.state);
    kernel.setLossMask(0, 1); kernel.setLossMask(1, 0.7); kernel.setLossMask(2, 0.4);
    for (let frame = 0; frame < 5000; frame++) { if (frame === 1000) kernel.setLossMask(0, 0); if (frame === 2000) kernel.setLossMask(1, 0); kernel.sample(0, 0); const next = energy(kernel.state); expect(next).to.be.at.most(prior + 1e-14); prior = next; }
    expect(kernel.diagnostics().faults).to.equal(0); expect(kernel.lossMasks[1]).to.be.lessThan(1e-3); expect(prior).to.be.lessThan(1);
    const silent = new SympatheticNetworkKernel({ parameters: parameters([point(), point('touch-b', [-0.2, 0.5])]) }); silent.setLossMask(0, 1); silent.setLossMask(1, 1); for (let frame = 0; frame < 500; frame++) silent.sample(0, 0); expect(energy(silent.state)).to.equal(0); expect(silent.leftSample).to.equal(0);
  });
  it('applies point loss once after the existing mode/edge evolution without also treating its signed vector as diagonal pole depth', () => {
    const p = parameters(), reference = new SympatheticNetworkKernel({ parameters: p }), touched = new SympatheticNetworkKernel({ parameters: p }); reference.state.set([0.7, 0.3, -0.1, 0.5]); touched.state.set(reference.state); touched.lossMasks[0] = touched.lossMasks[4] = 1;
    reference.sample(0, 0); const expected = reference.state.slice(), vector = p.lossMasks[0].weights, scale = touched.profile.lossMasks[0].projectionDepth * (vector[0] * expected[0] + vector[1] * expected[2]); expected[0] -= scale * vector[0]; expected[2] -= scale * vector[1]; touched.sample(0, 0); expect(touched.state).to.deep.equal(expected);
  });
  it('restores active point contacts exactly and rejects a different operator/vector configuration', () => {
    const p = parameters([point(), point('touch-b', [-0.2, 0.5])]), a = new SympatheticNetworkKernel({ parameters: p }); a.setLossMask(0, 0.8); a.setLossMask(1, 0.4); for (let index = 0; index < 140; index++) a.sample(index < 12 ? 0.5 : 0, 0);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); const b = new SympatheticNetworkKernel({ parameters: p }); b.restoreFrom(bytes);
    for (let index = 0; index < 300; index++) { a.sample(0, 0); b.sample(0, 0); expect(b.state).to.deep.equal(a.state); expect(b.leftSample).to.equal(a.leftSample); }
    const wrong = copy(p); wrong.lossMasks[0].weights[1] *= -1; expect(() => new SympatheticNetworkKernel({ parameters: wrong }).restoreFrom(bytes)).to.throw();
  });
  it('refuses nonpositive/oversized/mismatched site operators while retaining the legacy diagonal contract', () => {
    for (const changed of [{ weights: [0, 0] }, { weights: [1, 1] }, { weights: [0.5] }, { weights: [NaN, 0.5] }, { extraAmplitudeT60Seconds: 0 }, { operator: 'unqualified-negative-damper' }]) expect(() => prepareSympatheticNetworkProfile(parameters([{ ...point(), ...changed }]))).to.throw();
    expect(() => prepareSympatheticNetworkProfile(parameters([{ id: 'legacy', extraAmplitudeT60Seconds: 0.1, weights: [-0.2, 0.5] }]))).to.throw('nonnegative'); const legacy = prepareSympatheticNetworkProfile(parameters([{ id: 'legacy', extraAmplitudeT60Seconds: 0.1, weights: [0.2, 0.5] }])); expect(legacy.lossMasks[0]).not.to.have.property('operator'); expect(legacy.preparation.overlap).to.equal('maximum-additional-pole-depth-per-mode');
  });
});
