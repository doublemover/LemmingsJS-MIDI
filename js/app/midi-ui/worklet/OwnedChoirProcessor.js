import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { validateOwnedSourceBank, CHOIR_HARMONICS as CHOIR_EXCITER_HARMONICS } from '../OwnedSourceBank.js';
import { CHOIR_LAYOUT, choirSourceBytes, CHOIR_SOURCE_HEAP_ESTIMATE } from '../OwnedSourceLayout.js';

export const CHOIR_WIDTH = CHOIR_LAYOUT.width, CHOIR_VOICES = CHOIR_LAYOUT.voices, CHOIR_MIN_HZ = 50, CHOIR_MAX_HZ = 2000, CHOIR_BEND_CENTS = 200;
export { CHOIR_SOURCE_HEAP_ESTIMATE, choirSourceBytes };
const STATE_WIDTH = CHOIR_LAYOUT.state, BAND_WIDTH = CHOIR_LAYOUT.bandState, TABLE_LENGTH = CHOIR_LAYOUT.tableLength, TWO_PI = 2 * Math.PI;
const landmarks = Object.freeze([350, 900, 2200, 700, 1200, 2600, 300, 2200, 3000]);
const bandwidths = Object.freeze([70, 110, 160]);
const valid = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;

export class OwnedChoirSource {
  constructor(rate, voices = CHOIR_VOICES, sourceBank = null) {
    choirSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.maxUpdateMask = 511;
    this.bank = validateOwnedSourceBank(sourceBank, 'choir-v1');
    this.state = new Float64Array(voices * STATE_WIDTH); this.bands = new Float64Array(voices * 3 * BAND_WIDTH); this.table = this.bank.planes[0];
  }
  begin(slot, frequency, command) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.voices || !valid(frequency, CHOIR_MIN_HZ, CHOIR_MAX_HZ) ||
        !Number.isInteger(command[18]) || !valid(command[18], 0, 0xffffffff) || !valid(command[19], 0, 1) || !valid(command[20], 0, 1) ||
        !valid(command[21], 0.5, 2) || !valid(command[22], 0, 12) || !valid(command[23], 0, 12) || ![0, 1].includes(command[24]) || !valid(command[25], 0.5, 2)) return 0;
    const at = slot * STATE_WIDTH, seed = command[18] || 0x6d2b79f5, pitchRange = 2 ** (CHOIR_BEND_CENTS * 2 / 1200);
    for (let field = 0; field < STATE_WIDTH; field++) this.state[at + field] = 0;
    this.state[at] = (seed & 65535) / 65536; this.state[at + 1] = this.state[at]; this.state[at + 2] = seed; this.state[at + 3] = this.state[at];
    this.state[at + 4] = frequency / pitchRange; this.state[at + 5] = frequency * pitchRange;
    this.state[at + 29] = seed / 4294967296 * 2 - 1; this.state[at + 31] = -1;
    for (let parameter = 0; parameter < 7; parameter++) { const value = parameter === 2 || parameter === 6 ? Math.log(command[19 + parameter]) : command[19 + parameter];
      this.state[at + 8 + parameter] = value; this.state[at + 16 + parameter] = value; }
    for (let field = slot * 3 * BAND_WIDTH; field < (slot + 1) * 3 * BAND_WIDTH; field++) this.bands[field] = 0;
    this.tune(slot); return 1;
  }
  validFrequency(slot, frequency) { const at = slot * STATE_WIDTH; return valid(frequency, this.state[at + 4], this.state[at + 5]); }
  validUpdate(_slot, mask, command) {
    return (!(mask & 8) || valid(command[19], 0, 1)) && (!(mask & 16) || valid(command[20], 0, 1)) && (!(mask & 32) || valid(command[21], 0.5, 2)) &&
      (!(mask & 64) || valid(command[22], 0, 12)) && (!(mask & 128) || valid(command[23], 0, 12)) && (!(mask & 256) || valid(command[25], 0.5, 2));
  }
  applyUpdate(slot, mask, command) {
    if (!(mask & 504)) return;
    const at = slot * STATE_WIDTH;
    for (let parameter = 0; parameter < 7; parameter++) {
      const bit = parameter === 6 ? 256 : 8 << parameter;
      if (parameter === 5 || !(mask & bit)) continue;
      this.state[at + 16 + parameter] = parameter === 2 || parameter === 6 ? Math.log(command[19 + parameter]) : command[19 + parameter];
    }
    this.state[at + 24] = Math.max(Math.ceil(this.rate * 0.008), Math.round(command[14]));
  }
  tune(slot) {
    const at = slot * STATE_WIDTH, vowel = this.state[at + 13] ? Math.round(this.state[at + 8] * 2) / 2 : this.state[at + 8],
      left = Math.min(1, Math.floor(vowel * 2)), fraction = vowel * 2 - left, size = Math.exp(this.state[at + 10]), widthScale = Math.exp(this.state[at + 14]);
    for (let band = 0; band < 3; band++) {
      const first = landmarks[left * 3 + band], second = landmarks[(left + 1) * 3 + band],
        center = Math.min(this.rate * 0.4, Math.max(60, Math.exp(Math.log(first) + Math.log(second / first) * fraction) / size)),
        width = Math.min(1500, Math.max(30, bandwidths[band] * widthScale / size));
      const g = Math.tan(Math.PI * center / this.rate), damping = width / center, denominator = 1 / (1 + g * (g + damping)), offset = (slot * 3 + band) * BAND_WIDTH;
      this.bands[offset] = denominator; this.bands[offset + 1] = g * denominator; this.bands[offset + 2] = g * g * denominator; this.bands[offset + 3] = damping;
      this.bands[offset + 6] = center; this.bands[offset + 7] = width;
    }
    this.state[at + 26] = vowel; this.state[at + 27] = this.state[at + 10]; this.state[at + 28] = this.state[at + 14];
  }
  tableAt(phase, level) { const position = phase * TABLE_LENGTH, first = Math.floor(position), index = level * (TABLE_LENGTH + 1) + first, fraction = position - first;
    return this.table[index] + (this.table[index + 1] - this.table[index]) * fraction; }
  excitationAt(phase, level, blend) {
    if (!level) return this.tableAt(phase, 0);
    return this.tableAt(phase, level - 1) * (1 - blend) + this.tableAt(phase, level) * blend;
  }
  sample(slot, frequency) {
    const at = slot * STATE_WIDTH;
    if (!this.validFrequency(slot, frequency)) return NaN;
    if (this.state[at + 24] > 0) { const remaining = this.state[at + 24];
      for (let parameter = 0; parameter < 7; parameter++) this.state[at + 8 + parameter] += (this.state[at + 16 + parameter] - this.state[at + 8 + parameter]) / remaining;
      this.state[at + 24]--; }
    if (this.state[at + 25]-- <= 0) { const vowel = this.state[at + 13] ? Math.round(this.state[at + 8] * 2) / 2 : this.state[at + 8];
      if (vowel !== this.state[at + 26] || this.state[at + 10] !== this.state[at + 27] || this.state[at + 14] !== this.state[at + 28]) this.tune(slot); this.state[at + 25] = 7; }
    const chorus = this.state[at + 11], vibrato = this.state[at + 12];
    if (chorus !== this.state[at + 31]) { this.state[at + 30] = 2 ** (chorus * this.state[at + 29] / 1200); this.state[at + 31] = chorus; }
    if (vibrato !== this.state[at + 34]) { this.state[at + 35] = 2 ** (vibrato / 1200); this.state[at + 34] = vibrato; }
    const harmonicLimit = this.rate * 0.4 / (frequency * Math.max(1, this.state[at + 30]) * Math.max(1, this.state[at + 35]));
    let level = 0; while (level + 1 < CHOIR_EXCITER_HARMONICS.length && CHOIR_EXCITER_HARMONICS[level + 1] <= harmonicLimit) level++;
    const blend = Math.max(0, Math.min(1, (harmonicLimit / CHOIR_EXCITER_HARMONICS[level] - 1) * 4));
    this.state[at + 36] = level; this.state[at + 37] = blend;
    const vibPhase = this.state[at + 3], ratio = vibrato ? 2 ** (Math.sin(vibPhase * TWO_PI) * vibrato / 1200) : 1;
    this.state[at + 3] = vibPhase + 5.1 / this.rate; if (this.state[at + 3] >= 1) this.state[at + 3]--;
    const phase = this.state[at], otherPhase = this.state[at + 1], chorusMix = Math.min(1, chorus / 4) * 0.5,
      voiced = this.excitationAt(phase, level, blend) * (1 - chorusMix) + (chorusMix ? this.excitationAt(otherPhase, level, blend) * chorusMix : 0);
    this.state[at] = phase + frequency * ratio / this.rate; if (this.state[at] >= 1) this.state[at]--;
    this.state[at + 1] = otherPhase + frequency * ratio * this.state[at + 30] / this.rate; if (this.state[at + 1] >= 1) this.state[at + 1]--;
    let noise = this.state[at + 2]; noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5; this.state[at + 2] = noise >>> 0;
    const breath = this.state[at + 9], input = voiced * (1 - breath) + ((noise >>> 0) / 4294967296 * 2 - 1) * breath; let output = 0;
    for (let band = 0; band < 3; band++) {
      const offset = (slot * 3 + band) * BAND_WIDTH, first = this.bands[offset + 4], second = this.bands[offset + 5], difference = input - second;
      const bandpass = this.bands[offset] * first + this.bands[offset + 1] * difference,
        lowpass = second + this.bands[offset + 1] * first + this.bands[offset + 2] * difference;
      this.bands[offset + 4] = 2 * bandpass - first; this.bands[offset + 5] = 2 * lowpass - second;
      output += bandpass * this.bands[offset + 3] * (1 - band * 0.2);
    }
    return output / 2.4 * 0.85 + voiced * (1 - breath) * 0.15;
  }
}

export class OwnedChoirKernel extends OwnedSineKernel {
  constructor(rate, voices = CHOIR_VOICES, sourceBank = null) { super(rate, voices, { width: CHOIR_WIDTH, source: new OwnedChoirSource(rate, voices, sourceBank) }); }
}
export class OwnedChoirProcessor extends OwnedSineProcessor {
  createKernel(rate, voices, options) { return new OwnedChoirKernel(rate, Math.min(voices, CHOIR_VOICES), options?.sourceBank); }
  runtimeIdentity() { return { engineId: 'worklet-choir', engineVersion: 1, runtimeABI: 'owned-choir-f64-command-v1', buildId: 'owned-choir-v6-owned-retirement', sourceBankHash: this.kernel.source.bank.hash }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-choir-v1', OwnedChoirProcessor);
