import { prepareNonlinearChainProfile, nonlinearChainIdentity, NONLINEAR_KERNEL_REVISION, NONLINEAR_STATE_ABI } from '../../../midi/content/NonlinearChainProfile.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
export function nonlinearTransfer(shape, input) {
  if (shape === 'cubic') { const x = clamp(input, -1, 1); return x - x * x * x / 3; }
  const u = ((input + 1) % 4 + 4) % 4; return 1 - Math.abs(u - 2);
}
function primitive(shape, x) {
  if (shape === 'cubic') { const a = Math.abs(x); return a <= 1 ? x * x / 2 - x * x * x * x / 12 : 5 / 12 + (a - 1) * 2 / 3; }
  const u = ((x + 1) % 4 + 4) % 4; return (u < 2 ? u * u / 2 - u : 3 * u - u * u / 2 - 4) + 0.5;
}
export function nonlinearADAA1(shape, x, previous) {
  if (x === previous) return nonlinearTransfer(shape, x);
  if (shape === 'cubic') {
    if (Math.abs(x) <= 1 && Math.abs(previous) <= 1) return (x + previous) * (0.5 - (x * x + previous * previous) / 12);
    if (x >= 1 && previous >= 1) return 2 / 3;
    if (x <= -1 && previous <= -1) return -2 / 3;
  } else if (Math.floor((x + 1) / 2) === Math.floor((previous + 1) / 2)) return nonlinearTransfer(shape, (x + previous) / 2);
  const difference = x - previous;
  if (Math.abs(difference) <= 1e-7 * Math.max(1, Math.abs(x), Math.abs(previous))) return nonlinearTransfer(shape, (x + previous) / 2);
  return (primitive(shape, x) - primitive(shape, previous)) / difference;
}
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let value = i; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); crcTable[i] = value >>> 0; }
const checksum = bytes => { let value = 0xffffffff; for (let i = 0; i < bytes.length; i++) value = value >>> 8 ^ crcTable[(value ^ (i >= 4092 && i < 4096 ? 0 : bytes[i])) & 255]; return (value ^ 0xffffffff) >>> 0; };

export class NonlinearChainKernel {
  constructor({ sampleRate, parameters } = {}) {
    this.profile = prepareNonlinearChainProfile(parameters, sampleRate); const p = this.profile;
    this.factor = p.parameters.oversample; this.stages = p.parameters.stages;
    this.gains = Object.freeze(this.stages.map(stage => 10 ** (stage.driveDb / 20)));
    this.baselines = Object.freeze(this.stages.map(stage => nonlinearTransfer(stage.shape, stage.bias)));
    this.state = new Float64Array(p.stateBytes / 8); let offset = 0;
    const take = count => { const array = this.state.subarray(offset, offset + count); offset += count; return array; };
    this.input = take(p.inputHistoryFrames * 2); this.down = take(p.filterFrames * 2); this.previous = take(this.stages.length * 2); this.filters = take(8); this.values = take(4);
    this.inputCoefficient = p.parameters.inputHighpassHz ? Math.exp(-2 * Math.PI * p.parameters.inputHighpassHz / sampleRate) : 0;
    this.dcCoefficient = p.parameters.outputDcBlockHz ? Math.exp(-2 * Math.PI * p.parameters.outputDcBlockHz / sampleRate) : 0;
    this.smoothing = 1 - Math.exp(-1 / (0.008 * sampleRate)); this.frame = 0; this.faults = 0; this.muted = false;
    this.identity = nonlinearChainIdentity(p);
    if (this.identity.length > 2048) throw new TypeError('Nonlinear state identity exceeds its header.');
    this.clear();
  }
  clear() {
    this.state.fill(0); this.inputCursor = this.downCursor = 0; this.leftSample = this.rightSample = 0;
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < this.stages.length; i++) this.previous[channel * this.stages.length + i] = this.stages[i].bias;
    this.values[0] = this.values[2] = 10 ** (this.profile.parameters.driveDb / 20); this.values[1] = this.profile.parameters.outputTrim01; this.values[3] = this.profile.parameters.driveDb;
  }
  panic() { this.clear(); this.muted = true; }
  fault() { this.faults++; this.panic(); }
  shape(input, channel) {
    let value = input; const base = channel * this.stages.length;
    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i], driven = clamp(value * this.gains[i] + stage.bias, -8, 8);
      value = (this.profile.parameters.antialiasMode === 'adaa1' ? nonlinearADAA1(stage.shape, driven, this.previous[base + i]) : nonlinearTransfer(stage.shape, driven)) - this.baselines[i];
      this.previous[base + i] = driven;
    }
    return value;
  }
  sample(left, right, driveDb = this.profile.parameters.driveDb, outputTrim01 = this.profile.parameters.outputTrim01) {
    this.leftSample = this.rightSample = 0;
    if (this.muted) { this.frame++; return; }
    if (!finite(left, -32, 32) || !finite(right, -32, 32) || !finite(driveDb, 0, 24) || !finite(outputTrim01, 0, 1)) { this.fault(); this.frame++; return; }
    if (driveDb !== this.values[3]) { this.values[3] = driveDb; this.values[2] = 10 ** (driveDb / 20); }
    this.values[0] += (this.values[2] - this.values[0]) * this.smoothing; this.values[1] += (outputTrim01 - this.values[1]) * this.smoothing;
    const p = this.profile, coefficients = p.filter?.coefficients, history = p.inputHistoryFrames, taps = p.filterFrames;
    for (let channel = 0; channel < 2; channel++) {
      let value = channel ? right : left; const filterAt = channel * 4;
      if (this.inputCoefficient) { const filtered = value - this.filters[filterAt] + this.inputCoefficient * this.filters[filterAt + 1]; this.filters[filterAt] = value; this.filters[filterAt + 1] = Math.abs(filtered) < 1e-20 ? 0 : filtered; value = filtered; }
      value *= this.values[0];
      if (coefficients) {
        this.input[channel * history + this.inputCursor] = value;
        let result = 0;
        for (let phase = 0; phase < this.factor; phase++) {
          let up = 0, cursor = this.inputCursor;
          for (let tap = phase; tap < taps; tap += this.factor) { up += coefficients[tap] * this.input[channel * history + cursor]; if (--cursor < 0) cursor = history - 1; }
          const shaped = this.shape(up * this.factor, channel); let downCursor = this.downCursor + phase; if (downCursor >= taps) downCursor -= taps;
          this.down[channel * taps + downCursor] = shaped;
          if (phase === 0) { let read = downCursor; for (let tap = 0; tap < taps; tap++) { result += coefficients[tap] * this.down[channel * taps + read]; if (--read < 0) read = taps - 1; } }
        }
        value = result;
      } else value = this.shape(value, channel);
      if (this.dcCoefficient) { const filtered = value - this.filters[filterAt + 2] + this.dcCoefficient * this.filters[filterAt + 3]; this.filters[filterAt + 2] = value; this.filters[filterAt + 3] = Math.abs(filtered) < 1e-20 ? 0 : filtered; value = filtered; }
      value *= this.values[1];
      if (!finite(value, -64, 64) || !finite(this.filters[filterAt + 1], -64, 64) || !finite(this.filters[filterAt + 3], -64, 64)) { this.fault(); this.frame++; return; }
      if (channel) this.rightSample = value; else this.leftSample = value;
    }
    if (history && ++this.inputCursor === history) this.inputCursor = 0;
    if (taps) { this.downCursor += this.factor; if (this.downCursor >= taps) this.downCursor -= taps; }
    this.frame++;
  }
  get stateByteLength() { return 4096 + this.state.byteLength; }
  stateView(bytes) {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset || bytes.buffer.byteLength !== this.stateByteLength || bytes.byteLength !== this.stateByteLength || bytes.buffer === this.state.buffer) throw new TypeError('Nonlinear state requires an exclusive exact-size transfer.');
    return new DataView(bytes.buffer);
  }
  snapshotInto(bytes) {
    const view = this.stateView(bytes); bytes.fill(0); view.setUint32(0, 0x4e4c5331, true); view.setUint32(4, 1, true); view.setUint32(8, this.profile.sampleRate, true); view.setUint32(12, this.identity.length, true);
    view.setFloat64(16, this.frame, true); view.setUint32(24, this.inputCursor, true); view.setUint32(28, this.downCursor, true); view.setFloat64(32, this.faults, true); view.setUint32(40, this.muted ? 1 : 0, true);
    view.setFloat64(48, this.leftSample, true); view.setFloat64(56, this.rightSample, true);
    for (let i = 0; i < this.identity.length; i++) view.setUint8(64 + i, this.identity.charCodeAt(i));
    for (let i = 0; i < this.state.length; i++) view.setFloat64(4096 + i * 8, this.state[i], true);
    view.setUint32(4092, checksum(bytes), true); return this.stateByteLength;
  }
  restoreFrom(bytes) {
    const view = this.stateView(bytes), p = this.profile, frame = view.getFloat64(16, true), faults = view.getFloat64(32, true), inputCursor = view.getUint32(24, true), downCursor = view.getUint32(28, true);
    if (view.getUint32(0, true) !== 0x4e4c5331 || view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== p.sampleRate || view.getUint32(12, true) !== this.identity.length ||
        checksum(bytes) !== view.getUint32(4092, true) || !Number.isSafeInteger(frame) || frame < 0 || !Number.isSafeInteger(faults) || faults < 0 || view.getUint32(40, true) > 1 ||
        inputCursor >= Math.max(1, p.inputHistoryFrames) || downCursor >= Math.max(1, p.filterFrames) || !finite(view.getFloat64(48, true), -64, 64) || !finite(view.getFloat64(56, true), -64, 64)) throw new TypeError('Incompatible or corrupt nonlinear state.');
    for (let i = 0; i < this.identity.length; i++) if (view.getUint8(64 + i) !== this.identity.charCodeAt(i)) throw new TypeError('Nonlinear state has a different immutable chain/filter identity.');
    // Driven input history can exceed the external domain; it remains finite and bounded.
    for (let i = 0; i < this.state.length; i++) if (!finite(view.getFloat64(4096 + i * 8, true), -2048, 2048)) throw new TypeError('Nonlinear history contains nonfinite or excessive state.');
    const previousAt = this.input.length + this.down.length, filtersAt = previousAt + this.previous.length;
    for (let i = 0; i < this.down.length; i++) if (!finite(view.getFloat64(4096 + (this.input.length + i) * 8, true), -1.25, 1.25)) throw new TypeError('Invalid nonlinear decimator history.');
    for (let i = 0; i < this.previous.length; i++) if (!finite(view.getFloat64(4096 + (previousAt + i) * 8, true), -8, 8)) throw new TypeError('Invalid nonlinear stage domain.');
    for (let i = 0; i < this.filters.length; i++) if (!finite(view.getFloat64(4096 + (filtersAt + i) * 8, true), -64, 64)) throw new TypeError('Invalid nonlinear filter history.');
    const valuesAt = this.state.length - 4, gain = view.getFloat64(4096 + valuesAt * 8, true), trim = view.getFloat64(4096 + (valuesAt + 1) * 8, true), target = view.getFloat64(4096 + (valuesAt + 2) * 8, true), requested = view.getFloat64(4096 + (valuesAt + 3) * 8, true);
    if (!finite(gain, 1, 10 ** 1.2) || !finite(trim, 0, 1) || !finite(target, 1, 10 ** 1.2) || !finite(requested, 0, 24) || target !== 10 ** (requested / 20)) throw new TypeError('Invalid nonlinear control frontier.');
    for (let i = 0; i < this.state.length; i++) this.state[i] = view.getFloat64(4096 + i * 8, true);
    this.frame = frame; this.faults = faults; this.inputCursor = inputCursor; this.downCursor = downCursor; this.muted = Boolean(view.getUint32(40, true)); this.leftSample = view.getFloat64(48, true); this.rightSample = view.getFloat64(56, true);
    return Object.freeze({ status: 'restored', revision: NONLINEAR_KERNEL_REVISION, stateAbi: NONLINEAR_STATE_ABI, frame });
  }
  diagnostics() {
    return { revision: NONLINEAR_KERNEL_REVISION, stateAbi: NONLINEAR_STATE_ABI, frame: this.frame, faults: this.faults, muted: this.muted, stateBytes: this.state.byteLength,
      sampleRate: this.profile.sampleRate, internalSampleRate: this.profile.internalSampleRate, oversample: this.factor, antialiasMode: this.profile.parameters.antialiasMode,
      filterRevision: this.profile.filter?.designRevision || null, filterHash: this.profile.filter?.coefficientHash || null, coefficients: this.profile.filter?.coefficients || null,
      processingLatencyFrames: this.profile.processingLatencyFrames, delayConvention: this.profile.delayConvention, phasePolicy: this.profile.phasePolicy, precision: this.profile.precision,
      transferFunctions: this.stages.map(stage => ({ ...stage, transfer: stage.shape === 'cubic' ? 'clamp(x,-1,1)-clamp(x,-1,1)^3/3' : '1-abs(modulo(x+1,4)-2)', biasCompensation: 'subtract-transfer-at-bias' })),
      qualification: this.profile.qualification };
  }
}
