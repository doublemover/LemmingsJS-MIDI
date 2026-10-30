import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { PLUCK_LAYOUT, pluckSourceBytes } from '../OwnedSourceLayout.js';

export const PLUCK_WIDTH = PLUCK_LAYOUT.width, PLUCK_VOICES = PLUCK_LAYOUT.voices, PLUCK_MIN_HZ = 50, PLUCK_MAX_HZ = 2000, PLUCK_BEND_CENTS = 200;
const LN1000 = Math.log(1000), PITCH_RANGE = 2 ** (PLUCK_BEND_CENTS / 1200), STATE_WIDTH = PLUCK_LAYOUT.state;
export { pluckSourceBytes };

export class OwnedPluckSource {
  constructor(rate, voices = PLUCK_VOICES) {
    pluckSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.stride = Math.ceil(rate / PLUCK_LAYOUT.delayFloorHz) + PLUCK_LAYOUT.delayMargin;
    this.buffer = new Float32Array(this.stride * voices); this.scratch = new Float64Array(this.stride); this.state = new Float64Array(voices * STATE_WIDTH);
    this.initializationWrites = 0; this.initializationDenials = 0; this.maxInitializationWrites = 65536; this.initializationBucket = -1; this.maxUpdateMask = 15;
  }
  validFrequency(slot, frequency) { const at = slot * STATE_WIDTH;
    return Number.isFinite(frequency) && frequency >= this.state[at + 4] && frequency <= this.state[at + 5]; }
  begin(slot, frequency, command, frame) {
    const seed = command[18], position = command[19], t60 = command[20], brightness = command[21], bodyMix = command[22], bodyT60 = command[23];
    if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isInteger(slot) || slot < 0 || slot >= this.voices || !Number.isFinite(frequency) || frequency < PLUCK_MIN_HZ || frequency > PLUCK_MAX_HZ ||
        !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(position) || position < 0.05 || position > 0.45 ||
        !Number.isFinite(t60) || t60 < 0.02 || t60 > 4 || !Number.isFinite(brightness) || brightness < 0 || brightness > 1 ||
        !Number.isFinite(bodyMix) || bodyMix < 0 || bodyMix > 0.3 || !Number.isFinite(bodyT60) || bodyT60 < 0.02 || bodyT60 > 2) return 0;
    const length = Math.ceil(this.rate / (frequency / (PITCH_RANGE * PITCH_RANGE))) + 3, required = length * 3;
    if (length > this.stride) return 0;
    const bucket = Math.floor(frame / 128);
    if (bucket !== this.initializationBucket) { this.initializationBucket = bucket; this.initializationWrites = 0; }
    if (required > this.maxInitializationWrites - this.initializationWrites) { this.initializationDenials++; return -1; }
    this.initializationWrites += required;
    let random = seed || 0x6d2b79f5, previous = 0;
    const smoothing = 0.05 + brightness * 0.95;
    for (let index = 0; index < length; index++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      const noise = (random >>> 0) / 4294967296 * 2 - 1;
      previous += (noise - previous) * smoothing; this.scratch[index] = previous;
    }
    const pickOffset = Math.max(1, Math.round(this.rate / frequency * position)), base = slot * this.stride;
    let squares = 0, peak = 0;
    for (let index = 0; index < length; index++) { const value = (this.scratch[index] - this.scratch[(index + pickOffset) % length]) * 0.5;
      this.buffer[base + index] = value; squares += value * value; peak = Math.max(peak, Math.abs(value)); }
    const normalization = squares > 1e-16 && peak > 0 ? Math.min(4, 0.18 / Math.sqrt(squares / length), 0.9 / peak) : 1;
    for (let index = 0; index < length; index++) this.buffer[base + index] *= normalization;
    const at = slot * STATE_WIDTH;
    this.state[at] = length; this.state[at + 1] = 0; this.state[at + 2] = 0; this.state[at + 3] = t60;
    this.state[at + 4] = frequency / (PITCH_RANGE * PITCH_RANGE); this.state[at + 5] = frequency * PITCH_RANGE * PITCH_RANGE;
    this.state[at + 6] = seed; this.state[at + 7] = 0; this.state[at + 8] = -1; this.state[at + 9] = 0;
    this.state[at + 10] = 0; this.state[at + 11] = 0; this.state[at + 12] = bodyMix;
    this.state[at + 13] = Math.exp(-LN1000 / (bodyT60 * this.rate)); this.state[at + 14] = 1;
    this.state[at + 15] = Math.max(0, Math.min(2, Math.floor(this.rate * 0.4 / (frequency * PITCH_RANGE * 1.6))));
    for (let field = 16; field < STATE_WIDTH; field++) this.state[at + field] = 0;
    this.state[at + 21] = t60; this.state[at + 25] = this.state[at + 13];
    return 1;
  }
  validUpdate(_slot, mask, command) {
    return !(mask & 8) || Number.isFinite(command[20]) && command[20] >= 0.02 && command[20] <= 4 &&
      Number.isFinite(command[23]) && command[23] >= 0.02 && command[23] <= 2;
  }
  applyUpdate(slot, mask, command) {
    if (!(mask & 8)) return;
    const at = slot * STATE_WIDTH; this.state[at + 21] = command[20]; this.state[at + 22] = Math.max(1, Math.round(command[14]));
    this.state[at + 25] = Math.exp(-LN1000 / (command[23] * this.rate));
  }
  tune(at, frequency) {
    const omega = 2 * Math.PI * frequency / this.rate, wantedGain = Math.exp(-LN1000 / (this.state[at + 3] * frequency));
    const halfSine = Math.sin(omega * 0.5), ratio = (1 - wantedGain) / (halfSine * halfSine);
    const mix = ratio >= 1 ? 1 : 1 - Math.sqrt(Math.max(0, 1 - ratio)), h1 = mix * 0.5, h0 = 1 - h1, cosine = Math.cos(omega);
    const filterGain = Math.sqrt(h0 * h0 + h1 * h1 + 2 * h0 * h1 * cosine);
    const filterPhaseDelay = Math.atan2(h1 * Math.sin(omega), h0 + h1 * cosine) / omega, delay = this.rate / frequency - filterPhaseDelay;
    // Keep fractional delay near one sample so the allpass pole stays bounded.
    const integer = Math.floor(delay - 0.5), fraction = delay - integer, phaseRatio = Math.tan(omega * fraction * 0.5) / Math.tan(omega * 0.5);
    this.state[at + 7] = integer; this.state[at + 8] = frequency; this.state[at + 9] = Math.min(1, wantedGain / filterGain);
    this.state[at + 16] = (1 - phaseRatio) / (1 + phaseRatio); this.state[at + 19] = mix;
  }
  sample(slot, frequency) {
    const at = slot * STATE_WIDTH, length = this.state[at], write = this.state[at + 1], base = slot * this.stride;
    if (!this.validFrequency(slot, frequency)) return NaN;
    if (this.state[at + 22] > 0) { const remaining = this.state[at + 22];
      this.state[at + 3] += (this.state[at + 21] - this.state[at + 3]) / remaining;
      this.state[at + 13] += (this.state[at + 25] - this.state[at + 13]) / remaining; this.state[at + 22]--; this.state[at + 8] = -1; }
    if (frequency !== this.state[at + 8]) this.tune(at, frequency);
    let read = write - this.state[at + 7]; if (read < 0) read += length;
    const input = this.buffer[base + read], coefficient = this.state[at + 16];
    const delayed = coefficient * input + this.state[at + 17] - coefficient * this.state[at + 18];
    this.state[at + 17] = input; this.state[at + 18] = delayed;
    const h1 = this.state[at + 19] * 0.5, filtered = delayed * (1 - h1) + this.state[at + 2] * h1; this.state[at + 2] = delayed;
    this.buffer[base + write] = filtered * this.state[at + 9]; this.state[at + 1] = write + 1 === length ? 0 : write + 1;
    const bodyMix = this.state[at + 12];
    if (!bodyMix) return filtered;
    const phase1 = this.state[at + 10], phase2 = this.state[at + 11];
    this.state[at + 10] = (phase1 + 2 * Math.PI * frequency * 1.6 / this.rate) % (2 * Math.PI);
    this.state[at + 11] = (phase2 + 2 * Math.PI * frequency * 2.17 / this.rate) % (2 * Math.PI);
    const firstBody = frequency * PITCH_RANGE * 1.6 < this.rate * 0.4 ? Math.sin(phase1) : 0;
    const secondBody = frequency * PITCH_RANGE * 2.17 < this.rate * 0.4 ? Math.sin(phase2) : 0;
    const body = (firstBody + secondBody) * 0.5 * this.state[at + 14]; this.state[at + 14] *= this.state[at + 13];
    return filtered * (1 - bodyMix) + body * bodyMix;
  }
}

export class OwnedPluckKernel extends OwnedSineKernel {
  constructor(rate, voices = PLUCK_VOICES) { super(rate, voices, { width: PLUCK_WIDTH, source: new OwnedPluckSource(rate, voices) }); }
}

export class OwnedPluckProcessor extends OwnedSineProcessor {
  createKernel(rate, voices) { return new OwnedPluckKernel(rate, Math.min(voices, PLUCK_VOICES)); }
  runtimeIdentity() { return { engineId: 'worklet-pluck', engineVersion: 1, runtimeABI: 'owned-pluck-f64-command-v1', buildId: 'owned-pluck-v6-owned-retirement' }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-pluck-v1', OwnedPluckProcessor);
