import { prepareRingModulatorProfile, ringModulatorIdentity } from '../../../midi/content/RingModulatorProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

export class RingModulatorKernel {
  constructor({ sampleRate = 48000, parameters = {} } = {}) {
    this.profile = prepareRingModulatorProfile(parameters, sampleRate); this.parameters = this.profile.parameters; this.identity = ringModulatorIdentity(this.profile);
    const p = this.profile; this.state = new Float64Array(p.stateBytes / 8);
    this.input = this.state.subarray(0, p.historyFrames * 4); this.down = this.state.subarray(p.historyFrames * 4, p.historyFrames * 4 + p.filterFrames * 2); this.highpass = this.state.subarray(-8);
    this.coefficient = Math.exp(-2 * Math.PI * this.parameters.highpassHz / sampleRate);
    this.inputCursor = this.downCursor = this.frame = this.faults = 0; this.muted = this.donorAvailable = this.carrierAvailable = false;
    this.leftSample = this.rightSample = this.donorPeak = this.carrierPeak = this.envelopePeak = 0;
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.identity, arrays: [this.state],
      scalars: [...['inputCursor', 'downCursor', 'frame', 'faults', 'leftSample', 'rightSample', 'donorPeak', 'carrierPeak', 'envelopePeak'].map(name => ({ name, type: 'number' })),
        ...['muted', 'donorAvailable', 'carrierAvailable'].map(name => ({ name, type: 'boolean' }))], validate: data => {
        for (const [name, maximum] of [['inputCursor', p.historyFrames - 1], ['downCursor', p.filterFrames - 1], ['frame', Number.MAX_SAFE_INTEGER], ['faults', Number.MAX_SAFE_INTEGER]])
          if (!Number.isSafeInteger(data.named(name)) || data.named(name) < 0 || data.named(name) > maximum) throw new Error('Invalid ring state frontier.');
        for (const name of ['leftSample', 'rightSample']) if (Math.abs(data.named(name)) > p.maximumOutputAmplitude) throw new Error('Invalid ring output state.');
        for (const [name, maximum] of [['donorPeak', 32], ['carrierPeak', 32], ['envelopePeak', 1]]) if (data.named(name) < 0 || data.named(name) > maximum) throw new Error('Invalid ring source observation.');
        for (let index = 0; index < this.state.length; index++) if (Math.abs(data.planes[0].read(index)) > p.stateBound) throw new Error('Ring filter state exceeds its declared bound.');
      } });
  }
  panic() { this.muted = true; this.state.fill(0); this.leftSample = this.rightSample = this.donorPeak = this.carrierPeak = this.envelopePeak = 0; }
  sample(dl, dr, cl, cr, donorAvailable = true, carrierAvailable = true) {
    this.leftSample = this.rightSample = this.envelopePeak = 0; this.frame++;
    this.donorAvailable = donorAvailable === true; this.carrierAvailable = carrierAvailable === true;
    if (this.muted) return;
    if (!Number.isFinite(dl) || !Number.isFinite(dr) || !Number.isFinite(cl) || !Number.isFinite(cr) || Math.max(Math.abs(dl), Math.abs(dr), Math.abs(cl), Math.abs(cr)) > 32) { this.faults++; this.panic(); return; }
    this.donorPeak = donorAvailable ? Math.max(Math.abs(dl), Math.abs(dr)) : 0; this.carrierPeak = carrierAvailable ? Math.max(Math.abs(cl), Math.abs(cr)) : 0;
    const p = this.profile, history = p.historyFrames, taps = p.filterFrames, coefficients = p.filter.coefficients;
    for (let channel = 0; channel < 2; channel++) {
      for (let source = 0; source < 2; source++) {
        const at = (source * 2 + channel) * 2, input = source ? carrierAvailable ? channel ? cr : cl : 0 : donorAvailable ? channel && this.parameters.donorLayout === 'audioStereo' ? dr : dl : 0;
        const filtered = input - this.highpass[at] + this.coefficient * this.highpass[at + 1]; this.highpass[at] = input; this.highpass[at + 1] = Math.abs(filtered) < 1e-24 ? 0 : filtered;
        this.input[(source * 2 + channel) * history + this.inputCursor] = filtered;
      }
      let result = 0;
      for (let phase = 0; phase < 2; phase++) {
        let donor = 0, carrier = 0, read = this.inputCursor;
        for (let tap = phase; tap < taps; tap += 2) {
          donor += coefficients[tap] * this.input[channel * history + read]; carrier += coefficients[tap] * this.input[(2 + channel) * history + read]; if (--read < 0) read = history - 1;
        }
        donor = Math.max(-1, Math.min(1, donor * 2 * this.parameters.drive01)); this.envelopePeak = Math.max(this.envelopePeak, Math.abs(donor));
        let write = this.downCursor + phase; if (write >= taps) write -= taps;
        this.down[channel * taps + write] = donor * carrier * 2;
        if (phase === 0) { let cursor = write; for (let tap = 0; tap < taps; tap++) { result += coefficients[tap] * this.down[channel * taps + cursor]; if (--cursor < 0) cursor = taps - 1; } }
      }
      result *= this.parameters.outputTrim01;
      if (!Number.isFinite(result) || Math.abs(result) > p.maximumOutputAmplitude) { this.faults++; this.panic(); return; }
      if (channel) this.rightSample = result; else this.leftSample = result;
    }
    if (++this.inputCursor === history) this.inputCursor = 0; this.downCursor += 2; if (this.downCursor >= taps) this.downCursor -= taps;
  }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
  get snapshotBytes() { return this.stateTransfer.byteLength; }
}
