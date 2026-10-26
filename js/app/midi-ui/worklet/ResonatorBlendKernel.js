import { resonatorBlendEndpointData } from '../../../midi/content/ResonatorBlendProfile.js';
import { ResonatorMorphKernel, admitResonatorMorphKernelProfile } from './ResonatorMorphKernel.js';

export class ResonatorBlendKernel {
  constructor(profile) {
    const data = resonatorBlendEndpointData(profile); this.profile = profile; this.a = new ResonatorMorphKernel(admitResonatorMorphKernelProfile(data[0], profile.bodyA.identity)); this.b = new ResonatorMorphKernel(admitResonatorMorphKernelProfile(data[1], profile.bodyB.identity)); this.state = new Float64Array(16); this.state[0] = -1; this.state[1] = -1; this.leftSample = this.rightSample = 0; this.weightA = 1; this.weightB = 0;
  }
  setMorph(morph01) {
    if (!Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) throw new TypeError('The blend readout exceeds its normalized domain.');
    if (morph01 !== this.state[1]) { this.weightB = morph01 === 0 ? 0 : morph01 === 1 ? 1 : Math.sin(Math.PI * morph01 * 0.5) ** 2; this.weightA = 1 - this.weightB; this.state[1] = morph01; }
  }
  sample(input, frame, morph01 = this.state[1] < 0 ? 0 : this.state[1]) {
    if (!Number.isFinite(input) || Math.abs(input) > 1 || !Number.isSafeInteger(frame) || frame !== this.state[0] + 1 || !Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) throw new TypeError('Blend input, contiguous output frontier or normalized readout is invalid.');
    this.setMorph(morph01);
    this.a.sample(input, frame, 0); this.b.sample(input, frame, 0); const s = this.state, a = this.a.state, b = this.b.state; s[0] = frame; s[2] = a[2] + b[2]; s[3] = a[3] + b[3]; s[4] = a[4] + b[4]; s[5] = Math.max(a[5], b[5]); s[7] = a[7] + b[7];
    this.leftSample = this.weightA * this.a.leftSample + this.weightB * this.b.leftSample; this.rightSample = this.weightA * this.a.rightSample + this.weightB * this.b.rightSample; s[6] = Math.max(s[6], Math.abs(this.leftSample), Math.abs(this.rightSample));
  }
  panic() { this.a.panic(); this.b.panic(); const frame = this.state[0], u = this.state[1]; this.state.fill(0); this.state[0] = frame; this.state[1] = u; this.state[7] = this.a.state[7] + this.b.state[7]; this.leftSample = this.rightSample = 0; }
  diagnostics() { const s = this.state; return { revision: this.profile.revision, profileHash: this.profile.identity, mapHash: this.profile.mapHash, frame: s[0], morph01: Math.max(0, s[1]), modes: this.profile.slots.length, bodyCount: 2, energy: s[2], inputWork: s[3], positiveLoss: s[4], maximumBalanceDefect: s[5], peak: s[6], faults: s[7], semanticOnsetsAdded: 0, strategy: 'blend;two-independent-endpoint-states;not-an-intermediate-physical-object', endpointA: this.a.diagnostics(), endpointB: this.b.diagnostics(), restoration: 'deterministic-preroll;private-endpoint-cuts-do-not-establish-a-composite-live-cut', qualification: this.profile.qualification }; }
}
