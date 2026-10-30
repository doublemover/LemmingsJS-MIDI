import { prepareVocoderBankProfile, vocoderBankIdentity } from '../../../midi/content/VocoderBankProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

export class VocoderBankKernel {
  constructor({ sampleRate = 48000, parameters = {} } = {}) {
    this.profile = prepareVocoderBankProfile(parameters, sampleRate); this.parameters = this.profile.parameters; this.identity = vocoderBankIdentity(this.profile);
    this.state = new Float64Array(this.parameters.bands * 9); this.coefficients = new Float64Array(this.parameters.bands * 4);
    for (let i = 0; i < this.parameters.bands; i++) this.coefficients.set(this.profile.bands[i].coefficients, i * 4);
    this.frame = 0; this.faults = 0; this.muted = false; this.leftSample = this.rightSample = this.donorPeak = this.carrierPeak = this.envelopePeak = 0;
    this.donorAvailable = this.carrierAvailable = false;
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.identity, arrays: [this.state],
      scalars: [...['frame', 'faults', 'leftSample', 'rightSample', 'donorPeak', 'carrierPeak', 'envelopePeak'].map(name => ({ name, type: 'number' })),
        ...['muted', 'donorAvailable', 'carrierAvailable'].map(name => ({ name, type: 'boolean' }))], validate: data => {
        if (!Number.isSafeInteger(data.named('frame')) || data.named('frame') < 0 || !Number.isSafeInteger(data.named('faults')) || data.named('faults') < 0 ||
            Math.abs(data.named('leftSample')) > this.profile.maximumOutputAmplitude || Math.abs(data.named('rightSample')) > this.profile.maximumOutputAmplitude ||
            data.named('donorPeak') < 0 || data.named('donorPeak') > 32 || data.named('carrierPeak') < 0 || data.named('carrierPeak') > 32 || data.named('envelopePeak') < 0 || data.named('envelopePeak') > 1) throw new Error('Invalid vocoder state frontier.');
        for (let i = 0; i < this.parameters.bands; i++) for (let c = 0; c < 9; c++) {
          const value = data.planes[0].read(i * 9 + c); if (c === 8 ? value < 0 || value > 1 : Math.abs(value) > this.profile.bands[i].stateBound) throw new Error('Restored vocoder state exceeds its filter/envelope bounds.');
        }
      } });
  }
  panic() { this.muted = true; this.state.fill(0); this.leftSample = this.rightSample = this.donorPeak = this.carrierPeak = this.envelopePeak = 0; }
  filter(at, coefficientAt, value, bound) {
    if (this.muted) return 0;
    const output = this.coefficients[coefficientAt] * value + this.state[at];
    const first = -this.coefficients[coefficientAt + 2] * output + this.state[at + 1], second = this.coefficients[coefficientAt + 1] * value - this.coefficients[coefficientAt + 3] * output;
    if (!Number.isFinite(output) || !Number.isFinite(first) || !Number.isFinite(second) || Math.abs(first) > bound || Math.abs(second) > bound) { this.faults++; this.panic(); return 0; }
    this.state[at] = Math.abs(first) < 1e-24 ? 0 : first; this.state[at + 1] = Math.abs(second) < 1e-24 ? 0 : second; return output;
  }
  sample(donorLeft, donorRight, carrierLeft, carrierRight, donorAvailable = true, carrierAvailable = true) {
    if (this.muted) { this.leftSample = this.rightSample = 0; this.frame++; return; }
    if (typeof donorAvailable !== 'boolean' || typeof carrierAvailable !== 'boolean') { this.faults++; this.panic(); this.frame++; return; }
    this.donorAvailable = donorAvailable; this.carrierAvailable = carrierAvailable;
    if (!donorAvailable) donorLeft = donorRight = 0; if (!carrierAvailable) carrierLeft = carrierRight = 0;
    if (!Number.isFinite(donorLeft) || !Number.isFinite(donorRight) || !Number.isFinite(carrierLeft) || !Number.isFinite(carrierRight) ||
        Math.max(Math.abs(donorLeft), Math.abs(donorRight), Math.abs(carrierLeft), Math.abs(carrierRight)) > 32) { this.faults++; this.panic(); this.frame++; return; }
    this.donorPeak = Math.max(Math.abs(donorLeft), Math.abs(donorRight)); this.carrierPeak = Math.max(Math.abs(carrierLeft), Math.abs(carrierRight)); this.envelopePeak = 0;
    const p = this.parameters; let sumLeft = 0, sumRight = 0;
    for (let i = 0; i < p.bands; i++) {
      const at = i * 9, coefficientAt = i * 4, bound = this.profile.bands[i].stateBound;
      const dl = this.filter(at, coefficientAt, donorLeft, bound), dr = p.donorLayout === 'audioMono' ? dl : this.filter(at + 2, coefficientAt, donorRight, bound);
      const cl = this.filter(at + 4, coefficientAt, carrierLeft, bound), cr = this.filter(at + 6, coefficientAt, carrierRight, bound);
      if (this.muted) break;
      const amplitude = p.donorLayout === 'audioMono' || p.stereoLink === 'maximum' ? Math.max(Math.abs(dl), Math.abs(dr)) : Math.sqrt((dl * dl + dr * dr) * 0.5);
      const target = Math.min(1, amplitude / p.referenceAmplitude), coefficient = target > this.state[at + 8] ? this.profile.attackCoefficient : this.profile.releaseCoefficient;
      let envelope = target + coefficient * (this.state[at + 8] - target); if (target < 1e-12 && envelope < 1e-9) envelope = 0;
      this.state[at + 8] = envelope; this.envelopePeak = Math.max(this.envelopePeak, envelope);
      const gain = (p.baseline01 + p.depth01 * envelope) * p.bandGains[i]; sumLeft += cl * gain; sumRight += cr * gain;
    }
    if (this.muted) this.leftSample = this.rightSample = 0;
    else {
      this.leftSample = carrierLeft * p.dry01 + sumLeft * this.profile.sumScale * p.wetTrim01; this.rightSample = carrierRight * p.dry01 + sumRight * this.profile.sumScale * p.wetTrim01;
      if (!Number.isFinite(this.leftSample) || !Number.isFinite(this.rightSample) || Math.max(Math.abs(this.leftSample), Math.abs(this.rightSample)) > this.profile.maximumOutputAmplitude + 1e-9) { this.faults++; this.panic(); }
    }
    this.frame++;
  }
  stateByteLength() { return this.stateTransfer.byteLength; }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
}
