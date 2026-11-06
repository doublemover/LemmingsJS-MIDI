import { OWNED_STATE_BUNDLE_HEADER, writeOwnedStateBundle, readOwnedStateBundle } from './OwnedStateBundle.js';
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
  get snapshotBytes() { return OWNED_STATE_BUNDLE_HEADER + this.a.snapshotBytes + this.b.snapshotBytes; }
  snapshotInto(bytes) {
    const a = new Uint8Array(this.a.snapshotBytes), b = new Uint8Array(this.b.snapshotBytes);
    this.a.snapshotInto(a); this.b.snapshotInto(b);
    return writeOwnedStateBundle(bytes, { identity: { kind: 'resonator-blend', profile: this.profile.identity, rate: this.profile.sampleRate }, frontier: { state: Array.from(this.state), leftSample: this.leftSample, rightSample: this.rightSample, weightA: this.weightA, weightB: this.weightB }, components: [{ key: 'endpoint-a', bytes: a }, { key: 'endpoint-b', bytes: b }] });
  }
  restoreFrom(bytes) {
    const { frontier, components } = readOwnedStateBundle(bytes, { kind: 'resonator-blend', profile: this.profile.identity, rate: this.profile.sampleRate }, ['endpoint-a', 'endpoint-b']);
    if (!Array.isArray(frontier.state) || frontier.state.length !== 16 || frontier.state.some(value => !Number.isFinite(value)) || !Number.isSafeInteger(frontier.state[0]) || frontier.state[0] < -1 || frontier.state[1] < 0 || frontier.state[1] > 1 || ![frontier.leftSample, frontier.rightSample, frontier.weightA, frontier.weightB].every(Number.isFinite)) throw new Error('Invalid shared blend frontier.');
    const a = new ResonatorMorphKernel(this.a.profile), b = new ResonatorMorphKernel(this.b.profile); a.restoreFrom(components[0].bytes); b.restoreFrom(components[1].bytes);
    const u = frontier.state[1], weightB = u === 0 ? 0 : u === 1 ? 1 : Math.sin(Math.PI * u * 0.5) ** 2, weightA = 1 - weightB;
    if (a.state[0] !== frontier.state[0] || b.state[0] !== frontier.state[0] || frontier.weightA !== weightA || frontier.weightB !== weightB || frontier.leftSample !== weightA * a.leftSample + weightB * b.leftSample || frontier.rightSample !== weightA * a.rightSample + weightB * b.rightSample) throw new Error('Blend endpoint states do not share one output frontier.');
    this.a = a; this.b = b; this.state.set(frontier.state); this.leftSample = frontier.leftSample; this.rightSample = frontier.rightSample; this.weightA = weightA; this.weightB = weightB; return true;
  }
  diagnostics() { const s = this.state; return { revision: this.profile.revision, profileHash: this.profile.identity, mapHash: this.profile.mapHash, frame: s[0], morph01: Math.max(0, s[1]), modes: this.profile.slots.length, bodyCount: 2, energy: s[2], inputWork: s[3], positiveLoss: s[4], maximumBalanceDefect: s[5], peak: s[6], faults: s[7], semanticOnsetsAdded: 0, strategy: 'blend;two-independent-endpoint-states;not-an-intermediate-physical-object', endpointA: this.a.diagnostics(), endpointB: this.b.diagnostics(), restoration: 'deterministic-preroll;private-endpoint-cuts-do-not-establish-a-composite-live-cut', qualification: this.profile.qualification }; }
}
