import { encodeUtf8 } from '../../../core/CanonicalData.js';
import { prepareSympatheticNetworkProfile, sympatheticNetworkIdentity } from '../../../midi/content/SympatheticNetworkProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

export class SympatheticNetworkKernel {
  constructor({ sampleRate = 48000, parameters } = {}) {
    this.profile = prepareSympatheticNetworkProfile(parameters, sampleRate); this.identity = sympatheticNetworkIdentity(this.profile);
    const count = this.profile.modeCount, edges = this.profile.edges.length; this.state = new Float64Array(count * 4); this.coefficients = new Float64Array(count * 6);
    this.edgeIndices = new Uint32Array(edges * 2); this.edgeCoefficients = new Float64Array(edges * 2);
    for (let index = 0; index < count; index++) { const m = this.profile.modes[index]; this.coefficients.set([m.cosine, m.sine, m.longRadius, m.shortRadius, m.excitation, m.pickup], index * 6); }
    for (let index = 0; index < edges; index++) { const edge = this.profile.edges[index]; this.edgeIndices.set([edge.from, edge.to], index * 2); this.edgeCoefficients.set([edge.cosineDelta, edge.sine], index * 2); }
    this.frame = this.faults = this.leftSample = this.rightSample = 0; this.muted = false; this.couple = this.profile.parameters.couple01; this.damp = this.profile.parameters.damp01;
    this.smoothing = 1 - Math.exp(-1 / (sampleRate * 0.008));
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.profile.revision + ':' + sampleRate, configurationBytes: encodeUtf8(this.identity), arrays: [this.state],
      scalars: [...['frame', 'faults', 'leftSample', 'rightSample', 'couple', 'damp'].map(name => ({ name, type: 'number' })), { name: 'muted', type: 'boolean' }], validate: data => {
        for (const name of ['frame', 'faults']) if (!Number.isSafeInteger(data.named(name)) || data.named(name) < 0) throw new Error('Invalid body frontier.');
        for (const name of ['couple', 'damp']) if (data.named(name) < 0 || data.named(name) > 1) throw new Error('Invalid body macro state.');
        for (const name of ['leftSample', 'rightSample']) if (Math.abs(data.named(name)) > 32.000001) throw new Error('Invalid body pickup state.');
        for (let channel = 0; channel < 2; channel++) { let energy = 0; for (let index = 0; index < count * 2; index++) energy += data.planes[0].read(channel * count * 2 + index) ** 2; if (energy > 1024.0001) throw new Error('Shared-body state exceeds its internal energy bound.'); }
      } });
  }
  panic() { this.state.fill(0); this.leftSample = this.rightSample = 0; this.muted = true; }
  sample(left, right, couple = this.profile.parameters.couple01, damp = this.profile.parameters.damp01) {
    this.frame++; this.leftSample = this.rightSample = 0; if (this.muted) return;
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32 || !Number.isFinite(couple) || !Number.isFinite(damp) || couple < 0 || couple > 1 || damp < 0 || damp > 1) { this.faults++; this.panic(); return; }
    this.couple += (couple - this.couple) * this.smoothing; this.damp += (damp - this.damp) * this.smoothing;
    const count = this.profile.modeCount;
    for (let channel = 0; channel < 2; channel++) {
      const base = channel * count * 2, input = channel ? right : left; let energy = 0, output = 0;
      for (let index = 0; index < count; index++) {
        const at = base + index * 2, c = index * 6, real = this.state[at], imaginary = this.state[at + 1], radius = this.coefficients[c + 2] + (this.coefficients[c + 3] - this.coefficients[c + 2]) * this.damp;
        const a = (real * this.coefficients[c] - imaginary * this.coefficients[c + 1]) * radius + input * this.coefficients[c + 4], b = (real * this.coefficients[c + 1] + imaginary * this.coefficients[c]) * radius;
        this.state[at] = Math.abs(a) < 1e-24 ? 0 : a; this.state[at + 1] = Math.abs(b) < 1e-24 ? 0 : b;
      }
      for (let index = 0; index < this.profile.edges.length; index++) {
        const from = base + this.edgeIndices[index * 2] * 2, to = base + this.edgeIndices[index * 2 + 1] * 2;
        const c = 1 + this.edgeCoefficients[index * 2] * this.couple, s = this.edgeCoefficients[index * 2 + 1] * this.couple;
        for (let component = 0; component < 2; component++) { const a = this.state[from + component], b = this.state[to + component]; this.state[from + component] = c * a - s * b; this.state[to + component] = s * a + c * b; }
      }
      for (let index = 0; index < count; index++) { const at = base + index * 2, a = this.state[at], b = this.state[at + 1]; energy += a * a + b * b; output += a * this.coefficients[index * 6 + 5]; }
      if (!Number.isFinite(energy) || energy > 1024.0001 || !Number.isFinite(output) || Math.abs(output) > 32.000001) { this.faults++; this.panic(); return; }
      if (channel) this.rightSample = output; else this.leftSample = output;
    }
  }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
  get snapshotBytes() { return this.stateTransfer.byteLength; }
  diagnostics() {
    const energy = new Float64Array(this.profile.bodyCount), count = this.profile.modeCount;
    for (let index = 0; index < count; index++) { const at = index * 2, right = count * 2 + at; energy[this.profile.modes[index].bodyIndex] += this.state[at] ** 2 + this.state[at + 1] ** 2 + this.state[right] ** 2 + this.state[right + 1] ** 2; }
    return { revision: this.profile.revision, frame: this.frame, faults: this.faults, muted: this.muted, couple: this.couple, damp: this.damp,
      bodies: this.profile.parameters.bodies.map((body, index) => ({ bodyId: body.id, energy: energy[index] })), energyDomain: 'modeled-audio-complex-state-not-physical-terrain-energy', cost: this.profile.cost };
  }
}
