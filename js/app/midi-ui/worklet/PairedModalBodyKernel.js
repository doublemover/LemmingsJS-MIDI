import { prepareResonatorBlendBodyProfile, resonatorBlendBodyIdentity } from '../../../midi/content/ResonatorBlendProfile.js';
import { ResonatorBlendKernel } from './ResonatorBlendKernel.js';
import { preparePairedModalBodyProfile, pairedModalBodyIdentity } from '../../../midi/content/PairedModalBodyProfile.js';
import { ResonatorMorphKernel, admitResonatorMorphKernelProfile } from './ResonatorMorphKernel.js';

export class PairedModalBodyKernel {
  constructor({ sampleRate = 48000, parameters, strategy = 'paired' } = {}) {
    if (!['paired', 'blend'].includes(strategy)) throw new TypeError('Choose the explicit paired or prepared-blend body strategy.');
    this.profile = strategy === 'blend' ? prepareResonatorBlendBodyProfile(parameters, sampleRate) : preparePairedModalBodyProfile(parameters, sampleRate); this.identity = strategy === 'blend' ? resonatorBlendBodyIdentity(this.profile) : pairedModalBodyIdentity(this.profile);
    this.body = strategy === 'blend' ? new ResonatorBlendKernel(this.profile.body) : new ResonatorMorphKernel(admitResonatorMorphKernelProfile(this.profile.body, this.profile.parameters.profileIdentity));
    this.body.setMorph(this.profile.parameters.morph01); this.frame = this.faults = this.leftSample = this.rightSample = 0; this.muted = false;
  }
  panic() { this.body.panic(); this.leftSample = this.rightSample = 0; this.muted = true; }
  sample(left, right, morph01 = this.profile.parameters.morph01) {
    this.leftSample = this.rightSample = 0;
    if (this.muted) { this.frame++; return; }
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32 || !Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) { this.faults++; this.panic(); this.frame++; return; }
    this.body.sample((left * 0.5 + right * 0.5) / 32 * this.profile.parameters.inputGain01, this.frame++, Math.fround(morph01));
    if (this.body.state[7]) { this.faults++; this.panic(); return; }
    this.leftSample = this.body.leftSample * 0.25; this.rightSample = this.body.rightSample * 0.25;
  }
  diagnostics() { return { ...this.body.diagnostics(), frame: this.frame, faults: this.faults, muted: this.muted, input: 'same-owner-stereo-average;fixed-absolute-32-input-reference', output: 'fixed-quarter-readout;absolute-eight-fault-bound', semanticSource: 'unchanged-upstream-owner-sum', restoration: 'graph-deterministic-preroll;private-body-cut-is-not-a-live-host-cut' }; }
}
