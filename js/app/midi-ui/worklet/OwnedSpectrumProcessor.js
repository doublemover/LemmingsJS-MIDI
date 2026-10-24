import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { SPECTRUM_TABLES, SPECTRUM_LEVELS, SPECTRUM_SINE, SPECTRUM_FRAME_GAINS } from './SpectrumSourceTables.js';

export const SPECTRUM_WIDTH = 73, SPECTRUM_VOICES = 8, SPECTRUM_MIN_HZ = 20, SPECTRUM_MAX_HZ = 2000, SPECTRUM_BEND_CENTS = 200;
export const SPECTRUM_SOURCE_HEAP_ESTIMATE = (SPECTRUM_TABLES.length + SPECTRUM_SINE.length + SPECTRUM_FRAME_GAINS.length) * 16 + 16384;
const STATE = 24, PARTIAL = 6, LENGTH = 2048, STRIDE = LENGTH + 1, LN1000 = Math.log(1000);
const valid = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function spectrumSourceBytes(rate, voices = SPECTRUM_VOICES) {
  if (!valid(rate, 8000, 384000) || !Number.isInteger(voices) || voices < 1 || voices > SPECTRUM_VOICES) throw new RangeError('Invalid spectrum source profile.');
  return (SPECTRUM_TABLES.length + SPECTRUM_SINE.length + SPECTRUM_FRAME_GAINS.length) * 4 + voices * (STATE + 16 * PARTIAL) * 8;
}
export class OwnedSpectrumSource {
  constructor(rate, voices = SPECTRUM_VOICES) {
    spectrumSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.maxUpdateMask = 63;
    this.state = new Float64Array(voices * STATE); this.partials = new Float64Array(voices * 16 * PARTIAL);
    this.tables = new Float32Array(SPECTRUM_TABLES); this.sine = new Float32Array(SPECTRUM_SINE); this.frames = new Float32Array(SPECTRUM_FRAME_GAINS);
  }
  begin(slot, frequency, command) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.voices || !valid(frequency, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ) || !Number.isInteger(command[18]) || !valid(command[18], 0, 0xffffffff) ||
        ![0, 1].includes(command[19]) || !Number.isInteger(command[20]) || !valid(command[20], 1, 16) || !valid(command[21], 0, 1) || !valid(command[22], 0, 1) || !valid(command[23], 0, 1) || !valid(command[24], 0, 4)) return 0;
    if (!command[19] && command[20] !== 16) return 0;
    for (let index = 0; index < 16; index++) {
      if (!valid(command[25 + index], 0.125, 32) || !valid(command[41 + index], 0, 1) || !valid(command[57 + index], 0.01, 1)) return 0;
      if (!command[19] && (command[25 + index] !== index + 1 || command[41 + index] !== 1 / (index + 1) || command[57 + index] !== 1)) return 0;
    }
    const at = slot * STATE, phase = command[18] / 4294967296;
    for (let field = 0; field < STATE; field++) this.state[at + field] = 0;
    this.state[at] = phase; this.state[at + 1] = command[19]; this.state[at + 2] = command[20]; this.state[at + 3] = frequency;
    this.state[at + 4] = frequency * 2 ** (-SPECTRUM_BEND_CENTS * 2 / 1200); this.state[at + 5] = frequency * 2 ** (SPECTRUM_BEND_CENTS * 2 / 1200);
    for (let parameter = 0; parameter < 3; parameter++) { this.state[at + 8 + parameter] = command[21 + parameter]; this.state[at + 12 + parameter] = command[21 + parameter]; }
    let totalGain = 0;
    for (let index = 0; index < 16; index++) {
      const offset = (slot * 16 + index) * PARTIAL, ratio = command[25 + index], t60 = command[24] * command[57 + index];
      this.partials[offset] = ratio; this.partials[offset + 1] = command[41 + index]; this.partials[offset + 2] = t60 > 0 ? Math.exp(-LN1000 / (t60 * this.rate)) : 1;
      this.partials[offset + 3] = 1; this.partials[offset + 4] = phase * ratio % 1; this.partials[offset + 5] = 1;
      if (index < command[20]) totalGain += command[41 + index];
    }
    this.state[at + 6] = 0.8 / Math.max(1, totalGain * 2); this.state[at + 18] = 1;
    this.state[at + 19] = command[24] > 0 ? Math.exp(-LN1000 / (command[24] * this.rate)) : 1; this.tune(slot, frequency); return 1;
  }
  validFrequency(slot, frequency) { const at = slot * STATE; return valid(frequency, this.state[at + 4], this.state[at + 5]); }
  validUpdate(_slot, mask, command) { return (!(mask & 8) || valid(command[21], 0, 1)) && (!(mask & 16) || valid(command[22], 0, 1)) && (!(mask & 32) || valid(command[23], 0, 1)); }
  applyUpdate(slot, mask, command) {
    if (!(mask & 56)) return; const at = slot * STATE;
    for (let parameter = 0; parameter < 3; parameter++) if (mask & 8 << parameter) this.state[at + 12 + parameter] = command[21 + parameter];
    this.state[at + 16] = Math.max(Math.ceil(this.rate * 0.008), Math.round(command[14]));
  }
  lookup(table, offset, phase) { const position = phase * LENGTH, index = Math.floor(position), fraction = position - index;
    return table[offset + index] + (table[offset + index + 1] - table[offset + index]) * fraction; }
  frameAt(frame, level, phase) { return this.lookup(this.tables, (frame * SPECTRUM_LEVELS.length + level) * STRIDE, phase); }
  tune(slot, frequency) {
    const at = slot * STATE, cutoff = Math.min(this.rate * 0.4, frequency * (2 + this.state[at + 10] * 30));
    this.state[at + 21] = 1 - Math.exp(-2 * Math.PI * cutoff / this.rate);
    for (let index = 0; index < this.state[at + 2]; index++) this.partials[(slot * 16 + index) * PARTIAL + 5] = (0.05 + 0.95 * this.state[at + 10]) ** (index / 4);
    this.state[at + 3] = frequency;
  }
  sample(slot, frequency) {
    const at = slot * STATE; if (!this.validFrequency(slot, frequency)) return NaN;
    if (this.state[at + 16] > 0) { const remaining = this.state[at + 16];
      for (let parameter = 0; parameter < 3; parameter++) this.state[at + 8 + parameter] += (this.state[at + 12 + parameter] - this.state[at + 8 + parameter]) / remaining; this.state[at + 16]--; }
    if (this.state[at + 23]-- <= 0 || this.state[at + 3] !== frequency) { this.tune(slot, frequency); this.state[at + 23] = 7; }
    const phase = this.state[at], next = phase + frequency / this.rate; this.state[at] = next - Math.floor(next); let output = 0, active = 0;
    if (!this.state[at + 1]) {
      const limit = this.rate * 0.4 / frequency; let level = 0;
      while (level + 1 < SPECTRUM_LEVELS.length && SPECTRUM_LEVELS[level + 1] <= limit) level++;
      const blend = Math.max(0, Math.min(1, (limit / SPECTRUM_LEVELS[level] - 1) * 4)), position = this.state[at + 8] * 15, first = Math.min(14, Math.floor(position)), fraction = position - first;
      const left = this.frameAt(first, level, phase), right = this.frameAt(first + 1, level, phase);
      output = left + (right - left) * fraction;
      if (level) { const lowLeft = this.frameAt(first, level - 1, phase), lowRight = this.frameAt(first + 1, level - 1, phase), low = lowLeft + (lowRight - lowLeft) * fraction; output = low + (output - low) * blend; }
      const body = this.state[at + 9] * 0.6;
      output = (output * (1 - body) + this.lookup(this.sine, 0, phase) * 0.8 * body) * this.state[at + 18]; this.state[at + 18] *= this.state[at + 19]; active = SPECTRUM_LEVELS[level];
    } else {
      const position = this.state[at + 8] * 15, first = Math.min(14, Math.floor(position)), fraction = position - first;
      for (let index = 0; index < this.state[at + 2]; index++) {
        const offset = (slot * 16 + index) * PARTIAL, ratio = this.partials[offset], partialFrequency = frequency * ratio, partialPhase = this.partials[offset + 4], following = partialPhase + partialFrequency / this.rate;
        this.partials[offset + 4] = following - Math.floor(following);
        const taper = Math.max(0, Math.min(1, (this.rate * 0.4 - partialFrequency) / (this.rate * 0.04)));
        const frameGain = this.frames[first * 16 + index] + (this.frames[(first + 1) * 16 + index] - this.frames[first * 16 + index]) * fraction;
        const gain = this.partials[offset + 1] * this.partials[offset + 3] * this.partials[offset + 5] * (1 + this.state[at + 9] / (index + 1)) * (0.35 + 0.65 * frameGain);
        if (taper > 0 && gain > 0) { output += this.lookup(this.sine, 0, partialPhase) * gain * taper; active++; }
        this.partials[offset + 3] *= this.partials[offset + 2];
      }
      output *= this.state[at + 6];
    }
    this.state[at + 20] = active; this.state[at + 17] += (output - this.state[at + 17]) * this.state[at + 21]; return this.state[at + 17];
  }
}
export class OwnedSpectrumKernel extends OwnedSineKernel {
  constructor(rate, voices = SPECTRUM_VOICES) { super(rate, voices, { width: SPECTRUM_WIDTH, source: new OwnedSpectrumSource(rate, voices) }); }
}
export class OwnedSpectrumProcessor extends OwnedSineProcessor {
  createKernel(rate, voices) { return new OwnedSpectrumKernel(rate, Math.min(voices, SPECTRUM_VOICES)); }
  runtimeIdentity() { return { engineId: 'worklet-spectrum', engineVersion: 1, runtimeABI: 'owned-spectrum-f64-command-v1', buildId: 'owned-spectrum-v1' }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-spectrum-v1', OwnedSpectrumProcessor);
