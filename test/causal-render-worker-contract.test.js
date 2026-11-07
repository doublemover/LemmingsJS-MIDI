import { expect } from 'chai';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
const options = { maxBytes: 1048576, estimatedPeakBytes: 16 * 1048576, yieldControl: async () => {} };
const rejectedCode = async request => { try { await request; } catch (error) { return error.code; } throw new Error('Expected a refused source-preview request'); };
const input = () => ({ revoice: {}, definition: {}, engineRequirement: {}, sampleRate: 48000, startSeconds: 0, endSeconds: 1,
  requestedEndSeconds: 1, timeTransformMode: 'captured-live', capturedSpatial: false, capturedMaterials: false, tail: { mode: 'exact-crop' }, stemLaneIds: [], restorationMode: 'forward-preroll' });
describe('causal render semantic request boundary (#1288)', () => {
  for (const kind of ['render-causal-sine-take', 'render-causal-source-pcm']) it('admits the current host fields before enforcing the immutable source identity for ' + kind, async () => {
    expect(await rejectedCode(runBackgroundJobKernel(kind, input(), options))).to.equal('engine-identity-unbound');
    expect(await rejectedCode(runBackgroundJobKernel(kind, { ...input(), timbreTuningReadout: { mode: 'paired' } }, options))).to.equal('engine-identity-unbound');
    expect(await rejectedCode(runBackgroundJobKernel(kind, { ...input(), unexpectedField: true }, options))).to.equal('invalid-contract');
    expect(await rejectedCode(runBackgroundJobKernel(kind, input(), { ...options, estimatedPeakBytes: 4096 }))).to.equal('invalid-contract');
  });
});
