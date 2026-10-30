import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { validateOwnedSourceBank } from '../OwnedSourceBank.js';
import { GRANULAR_LAYOUT, granularSourceBytes, GRANULAR_SOURCE_HEAP_ESTIMATE } from '../OwnedSourceLayout.js';

export const GRANULAR_WIDTH = GRANULAR_LAYOUT.width, GRANULAR_VOICES = GRANULAR_LAYOUT.voices, GRAINS_PER_VOICE = GRANULAR_LAYOUT.grains, GRANULAR_BIRTHS_PER_BUCKET = GRANULAR_LAYOUT.birthsPerBucket;
export { GRANULAR_SOURCE_HEAP_ESTIMATE, granularSourceBytes };
const CLOUD = GRANULAR_LAYOUT.cloudState, GRAIN = GRANULAR_LAYOUT.grainState, FIELDS = Object.freeze([19, 20, 21, 23, 28, 32]), BITS = Object.freeze([8, 16, 32, 64, 256, 512]);
const valid = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high) => Number.isSafeInteger(value) && valid(value, low, high);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export class OwnedGranularSource {
  constructor(rate, pcm, voices = GRANULAR_VOICES, sourceBank = null) {
    granularSourceBytes(rate, voices); const descriptor = pcm?.descriptor;
    this.bank = validateOwnedSourceBank(sourceBank, 'grain-window-v1');
    if (descriptor?.schema !== 'lemmings-owned-pcm-bank/v1' || descriptor.format !== 'float32-planar-le' || !/^[a-f0-9]{64}$/.test(descriptor.bankHash) ||
        !/^[a-f0-9]{64}$/.test(descriptor.pcmHash) || !/^[a-f0-9]{64}$/.test(descriptor.assetHash) || !integer(descriptor.sampleRate, 8000, 192000) ||
        !integer(descriptor.channels, 1, 2) || !integer(descriptor.frames, 2, 4194304) || descriptor.bytes !== descriptor.frames * descriptor.channels * 4 || descriptor.bytes > 16 * 1048576 ||
        !integer(descriptor.sourceFrames, 2, 8000000) || !integer(descriptor.sourceSampleRate, 8000, 192000) || !valid(descriptor.peak, 0, 16) ||
        !Array.isArray(pcm.planes) || pcm.planes.length !== descriptor.channels || pcm.planes.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.length !== descriptor.frames)) throw new TypeError('Granular source needs a prepared PCM bank.');
    this.rate = rate; this.voices = voices; this.descriptor = Object.freeze({ ...descriptor }); this.pcm = Object.freeze([...pcm.planes]); this.stereo = descriptor.channels === 2;
    this.state = new Float64Array(voices * CLOUD); this.grains = new Float64Array(voices * GRAINS_PER_VOICE * GRAIN); this.window = this.bank.planes[0];
    this.maxUpdateMask = 1023; this.leftSample = 0; this.rightSample = 0; this.birthBucket = -1; this.bucketBirths = 0;
    this.sourceGain = 0.9 / Math.max(1, descriptor.peak) / 4;
  }
  begin(slot, frequency, command, frame) {
    if (!integer(slot, 0, this.voices - 1) || !integer(frame, 0, Number.MAX_SAFE_INTEGER) || !valid(frequency, 20, 2000) || !integer(command[18], 0, 0xffffffff) ||
        !this.validUpdate(slot, 1023, command) || !valid(command[22], 0.25, 4) || !integer(command[24], 0, this.descriptor.sourceFrames - 2) ||
        !integer(command[25], command[24] + 2, this.descriptor.sourceFrames) || ![0, 1].includes(command[27]) || command[29] !== 0 || ![0, 1].includes(command[30]) || !valid(command[31], 20, 20000) ||
        !valid(frequency / command[31] * command[22], 0.25, 4)) return 0;
    const start = Math.floor(command[24] * this.descriptor.sampleRate / this.descriptor.sourceSampleRate), end = Math.min(this.descriptor.frames, Math.ceil(command[25] * this.descriptor.sampleRate / this.descriptor.sourceSampleRate));
    if (end - start < 2) return 0;
    this.retire(slot); const at = slot * CLOUD;
    for (let field = 0; field < CLOUD; field++) this.state[at + field] = 0;
    this.state[at] = command[18] || 0x6d2b79f5;
    for (let parameter = 0; parameter < FIELDS.length; parameter++) {
      const value = parameter === 2 ? Math.max(2, Math.round(command[FIELDS[parameter]] * this.rate / 1000)) : command[FIELDS[parameter]];
      this.state[at + 2 + parameter] = value; this.state[at + 8 + parameter] = value;
    }
    this.state[at + 15] = command[26]; this.state[at + 16] = command[19]; this.state[at + 17] = command[27]; this.state[at + 18] = command[30]; this.state[at + 19] = command[31];
    this.state[at + 20] = 1; this.state[at + 21] = 1; this.state[at + 22] = start; this.state[at + 23] = end; this.state[at + 24] = command[22];
    this.state[at + 25] = frequency * 2 ** (-400 / 1200); this.state[at + 26] = frequency * 2 ** (400 / 1200);
    this.state[at + 37] = 1; this.state[at + 38] = frame - 1; this.state[at + 40] = command[0]; this.state[at + 41] = command[17]; this.state[at + 42] = command[5];
    this.tune(at); return 1;
  }
  validFrequency(slot, frequency) {
    const at = slot * CLOUD, ratio = frequency / this.state[at + 19] * this.state[at + 24];
    return valid(frequency, this.state[at + 25], this.state[at + 26]) && valid(ratio, 0.25, 4);
  }
  validUpdate(_slot, mask, command) {
    return (!(mask & 8) || valid(command[19], 0, 1)) && (!(mask & 16) || valid(command[20], 0, 48)) && (!(mask & 32) || valid(command[21], 20, 140)) &&
      (!(mask & 64) || valid(command[23], 0, 1)) && (!(mask & 128) || [0, 1].includes(command[26])) && (!(mask & 256) || valid(command[28], 0, 1)) && (!(mask & 512) || valid(command[32], 0, 1));
  }
  applyUpdate(slot, mask, command) {
    if (!(mask & 1016)) return; const at = slot * CLOUD;
    if (mask & 128) { if (command[26] && !this.state[at + 15]) this.state[at + 16] = this.state[at + 2]; this.state[at + 15] = command[26]; }
    for (let parameter = 0; parameter < FIELDS.length; parameter++) if (mask & BITS[parameter]) this.state[at + 8 + parameter] =
      parameter === 2 ? Math.max(2, Math.round(command[FIELDS[parameter]] * this.rate / 1000)) : command[FIELDS[parameter]];
    this.state[at + 14] = Math.max(Math.ceil(this.rate * 0.008), Math.round(command[14]));
  }
  release(slot) { this.state[slot * CLOUD + 21] = 0; }
  retire(slot) {
    const at = slot * CLOUD; this.state[at + 21] = 0; this.state[at + 27] = 0; this.state[at + 37] = 0;
    for (let grain = slot * GRAINS_PER_VOICE; grain < (slot + 1) * GRAINS_PER_VOICE; grain++) this.grains[grain * GRAIN] = 0;
  }
  random(at) { let value = this.state[at]; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; this.state[at] = value >>> 0; return (value >>> 0) / 4294967296; }
  spawn(slot, frequency, frame) {
    const at = slot * CLOUD, positionRandom = this.random(at), stereoRandom = this.random(at); this.state[at + 1]++; this.state[at + 28]++;
    const bucket = Math.floor(frame / 128); if (bucket !== this.birthBucket) { this.birthBucket = bucket; this.bucketBirths = 0; }
    let offset = -1;
    if (this.bucketBirths < GRANULAR_BIRTHS_PER_BUCKET) for (let index = 0; index < GRAINS_PER_VOICE; index++) {
      const candidate = (slot * GRAINS_PER_VOICE + index) * GRAIN; if (!this.grains[candidate]) { offset = candidate; break; }
    }
    if (offset < 0) { this.state[at + 30]++; return; }
    const start = this.state[at + 22], end = this.state[at + 23], span = end - start - 1, spread = this.state[at + 5],
      position = clamp((this.state[at + 15] ? this.state[at + 16] : this.state[at + 2]) + (positionRandom * 2 - 1) * spread * 0.5, 0, 1),
      duration = Math.round(this.state[at + 4]), increment = frequency / this.state[at + 19] * this.state[at + 24] * this.descriptor.sampleRate / this.rate * (this.state[at + 18] ? -1 : 1),
      cursor = start + position * span - increment * (duration - 1) * 0.5;
    this.grains[offset] = duration; this.grains[offset + 1] = duration; this.grains[offset + 2] = cursor; this.grains[offset + 3] = increment;
    this.grains[offset + 4] = this.sourceGain; this.grains[offset + 6] = cursor + (stereoRandom * 2 - 1) * spread * span * 0.025;
    this.grains[offset + 7] = this.state[at + 1]; this.grains[offset + 8] = this.state[at + 42]; this.grains[offset + 9] = frame;
    this.state[at + 27]++; this.state[at + 29]++; this.bucketBirths++;
  }
  read(channel, cursor, start, end) {
    if (cursor < start || cursor >= end - 1) return 0;
    const index = Math.floor(cursor), fraction = cursor - index, samples = this.pcm[channel], edgeFrames = Math.min(16, (end - start - 1) * 0.5),
      edge = Math.min(1, (cursor - start) / edgeFrames, (end - 1 - cursor) / edgeFrames);
    return (samples[index] + (samples[index + 1] - samples[index]) * fraction) * edge;
  }
  tune(at) { const cutoff = Math.min(this.rate * 0.4, 200 * 80 ** this.state[at + 7]); this.state[at + 34] = 1 - Math.exp(-2 * Math.PI * cutoff / this.rate); this.state[at + 39] = this.state[at + 7]; }
  sample(slot, frequency, frame) {
    const at = slot * CLOUD; if (!this.validFrequency(slot, frequency) || !integer(frame, 0, Number.MAX_SAFE_INTEGER) || frame <= this.state[at + 38]) return NaN;
    this.state[at + 38] = frame;
    if (this.state[at + 14] > 0) { const remaining = this.state[at + 14];
      for (let parameter = 0; parameter < FIELDS.length; parameter++) if (parameter || !this.state[at + 15]) this.state[at + 2 + parameter] += (this.state[at + 8 + parameter] - this.state[at + 2 + parameter]) / remaining;
      this.state[at + 14]--;
    }
    if (this.state[at + 35]-- <= 0) { if (this.state[at + 39] !== this.state[at + 7]) this.tune(at); this.state[at + 35] = 7; }
    const density = this.state[at + 21] ? this.state[at + 3] * (this.state[at + 17] ? this.state[at + 6] : 1) : 0;
    this.state[at + 31] = density;
    if (density > 0) { if (this.state[at + 20] >= 1) { this.spawn(slot, frequency, frame); this.state[at + 20] -= 1; } this.state[at + 20] += density / this.rate; }
    let left = 0, right = 0; const start = this.state[at + 22], end = this.state[at + 23];
    if (this.state[at + 27] > 0) for (let grain = 0; grain < GRAINS_PER_VOICE; grain++) {
      const offset = (slot * GRAINS_PER_VOICE + grain) * GRAIN, remaining = this.grains[offset]; if (!remaining) continue;
      const duration = this.grains[offset + 1], position = (duration - remaining) / (duration - 1) * 2048, index = Math.min(2047, Math.floor(position)), fraction = position - index,
        window = (this.window[index] + (this.window[index + 1] - this.window[index]) * fraction) * this.grains[offset + 4], cursor = this.grains[offset + 2], other = this.grains[offset + 6];
      left += this.read(0, cursor, start, end) * window; right += this.read(this.stereo ? 1 : 0, this.stereo ? other : cursor, start, end) * window;
      this.grains[offset + 2] += this.grains[offset + 3]; this.grains[offset + 6] += this.grains[offset + 3]; this.grains[offset]--;
      if (!this.grains[offset]) this.state[at + 27]--;
    }
    this.state[at + 32] += (left - this.state[at + 32]) * this.state[at + 34]; this.state[at + 33] += (right - this.state[at + 33]) * this.state[at + 34];
    if (Math.abs(this.state[at + 32]) < 1e-14) this.state[at + 32] = 0; if (Math.abs(this.state[at + 33]) < 1e-14) this.state[at + 33] = 0;
    this.leftSample = this.state[at + 32]; this.rightSample = this.state[at + 33]; return this.stereo ? (this.leftSample + this.rightSample) * 0.5 : this.leftSample;
  }
  inspect() {
    const clouds = []; let activeGrains = 0;
    for (let slot = 0; slot < this.voices; slot++) {
      const at = slot * CLOUD; activeGrains += this.state[at + 27]; if (!this.state[at + 37]) continue;
      clouds.push({ slot, token: this.state[at + 42], epoch: this.state[at + 40], generation: this.state[at + 41], frame: this.state[at + 38],
        activeGrains: this.state[at + 27], requestedGrains: this.state[at + 28], admittedGrains: this.state[at + 29], rejectedGrains: this.state[at + 30],
        effectiveDensityHz: this.state[at + 31], sourcePosition01: this.state[at + 15] ? this.state[at + 16] : this.state[at + 2], freezeMode: this.state[at + 15] ? 'source-position-hold' : 'none' });
    }
    return { kind: 'owned-granular-source', bankHash: this.descriptor.bankHash, pcmHash: this.descriptor.pcmHash, activeGrains, grainLimit: this.voices * GRAINS_PER_VOICE, sourceGain: this.sourceGain,
      resampling: 'linear-unqualified', seedAlgorithm: 'xorshift32-zero-to-6d2b79f5-v1', window: 'hann-2048-v1', clouds };
  }
}
export class OwnedGranularKernel extends OwnedSineKernel {
  constructor(rate, pcm, voices = GRANULAR_VOICES, sourceBank = null) { super(rate, voices, { width: GRANULAR_WIDTH, source: new OwnedGranularSource(rate, pcm, voices, sourceBank) }); }
}
export class OwnedGranularProcessor extends OwnedSineProcessor {
  createKernel(rate, voices, options) { return new OwnedGranularKernel(rate, options?.pcm, Math.min(voices, GRANULAR_VOICES), options?.sourceBank); }
  runtimeIdentity() { return { engineId: 'worklet-granular', engineVersion: 1, runtimeABI: 'owned-granular-f64-command-v1', buildId: 'owned-granular-v6-owned-retirement', sourceBankHash: this.kernel.source.bank.hash, pcmBankHash: this.kernel.source.descriptor.bankHash }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-granular-v1', OwnedGranularProcessor);
