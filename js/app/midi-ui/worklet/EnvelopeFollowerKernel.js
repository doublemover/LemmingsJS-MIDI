import { prepareEnvelopeDetectorProfile, envelopeDetectorIdentity } from '../../../midi/content/EnvelopeDetectorProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

export class EnvelopeFollowerKernel {
  constructor({ sampleRate = 48000, parameters = {} } = {}) {
    this.profile = prepareEnvelopeDetectorProfile(parameters, sampleRate); this.parameters = this.profile.parameters;
    this.state = new Float64Array(this.parameters.windowFrames); this.identity = envelopeDetectorIdentity(this.profile);
    this.frame = 0; this.write = 0; this.nonzeroCount = 0; this.powerSum = 0; this.compensation = 0;
    this.envelope = 0; this.output = 0; this.faults = 0; this.muted = false; this.sourceAvailable = false;
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.identity, arrays: [this.state],
      scalars: [...['frame', 'write', 'nonzeroCount', 'powerSum', 'compensation', 'envelope', 'output', 'faults'].map(name => ({ name, type: 'number' })),
        ...['muted', 'sourceAvailable'].map(name => ({ name, type: 'boolean' }))], validate: data => {
        for (const key of ['frame', 'write', 'nonzeroCount', 'faults']) if (!Number.isSafeInteger(data.named(key)) || data.named(key) < 0) throw new Error('Invalid detector state frontier.');
        if (data.named('write') >= this.state.length || data.named('nonzeroCount') > this.state.length || data.named('powerSum') < 0 || data.named('powerSum') > this.state.length * 1024 ||
            data.named('envelope') < 0 || data.named('envelope') > 1 || data.named('output') < 0 || data.named('output') > 1) throw new Error('Detector state exceeds its admitted power/envelope domain.');
        let nonzero = 0, total = 0; for (let i = 0; i < this.state.length; i++) { const value = data.planes[0].read(i); if (value < 0 || value > 1024) throw new Error('Invalid detector window energy.'); if (value > 0) nonzero++; total += value; }
        if (Math.abs(total - data.named('powerSum')) > Math.max(1, total) * 1e-9 || Math.abs(data.named('compensation')) > Math.max(1, total) * Number.EPSILON * 16) throw new Error('Detector power accumulator differs from its window.');
        if (nonzero !== data.named('nonzeroCount')) throw new Error('Detector window occupancy differs from its restored frontier.');
      } });
  }
  clear() { this.state.fill(0); this.write = this.nonzeroCount = 0; this.powerSum = this.compensation = this.envelope = this.output = 0; }
  panic() { this.clear(); this.muted = true; }
  sample(left, right = left, sourceAvailable = true) {
    if (typeof sourceAvailable !== 'boolean') { this.faults++; this.panic(); this.frame++; return; }
    this.sourceAvailable = sourceAvailable;
    if (this.muted) { this.output = 0; this.frame++; return; }
    if (!sourceAvailable) left = right = 0;
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32) { this.faults++; this.panic(); this.frame++; return; }
    const p = this.parameters;
    const power = p.inputLayout === 'audioMono' ? left * left : p.stereoLink === 'maximum' ? Math.max(left * left, right * right) : (left * left + right * right) * 0.5;
    let amplitude;
    if (p.kind === 'rms') {
      const old = this.state[this.write]; if (old > 0) this.nonzeroCount--; if (power > 0) this.nonzeroCount++;
      this.state[this.write] = power; if (++this.write === this.state.length) this.write = 0;
      const delta = power - old - this.compensation, sum = this.powerSum + delta; this.compensation = (sum - this.powerSum) - delta; this.powerSum = sum;
      if (!this.nonzeroCount) this.powerSum = this.compensation = 0;
      if (this.powerSum < 0 && this.powerSum >= -1e-9) this.powerSum = this.compensation = 0;
      if (!Number.isFinite(this.powerSum) || this.powerSum < 0 || this.powerSum > this.state.length * 1024 + 1e-9) { this.faults++; this.panic(); this.frame++; return; }
      amplitude = Math.sqrt(this.powerSum / this.state.length);
    } else amplitude = Math.sqrt(power);
    const target = Math.min(1, amplitude / p.referenceAmplitude), coefficient = target > this.envelope ? this.profile.attackCoefficient : this.profile.releaseCoefficient;
    this.envelope = target + coefficient * (this.envelope - target);
    if (target === 0 && this.envelope < 1e-9) this.envelope = 0;
    this.output = this.envelope; this.frame++;
  }
  stateByteLength() { return this.stateTransfer.byteLength; }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
}
