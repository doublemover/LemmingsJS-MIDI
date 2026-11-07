import { validateOwnedSourceBank, getOwnedSourceBankIdentity } from '../OwnedSourceBank.js';
import { SAMPLE_READ_BANK_ID, SAMPLE_READ_TAPS as TAPS, SAMPLE_READ_PHASES as PHASES, SAMPLE_READ_RATE_STEPS as STEPS, SAMPLE_READ_PROFILE } from '../../../midi/content/SampleReadProfile.js';

const modes = Object.freeze({ clamp: 0, zero: 1, wrap: 2, reflect: 3 });
export class OwnedSampleReader {
  constructor(bank) {
    const source = validateOwnedSourceBank(bank, SAMPLE_READ_BANK_ID), identity = getOwnedSourceBankIdentity(SAMPLE_READ_BANK_ID);
    if (!Number.isFinite(identity.maximumL1) || identity.maximumL1 < 1 || identity.maximumL1 > 8) throw new TypeError('Sample read gain bound is unbound.');
    this.bank = source; this.coefficients = source.planes[0]; this.maximumL1 = identity.maximumL1; this.profile = SAMPLE_READ_PROFILE; this.leftSample = this.rightSample = 0;
  }
  read(left, right, position, derivative, first, end, mode = 'clamp') {
    if (!(left instanceof Float32Array) || !(left.buffer instanceof ArrayBuffer) || right !== null && (!(right instanceof Float32Array) || !(right.buffer instanceof ArrayBuffer) || right.length !== left.length) || !Number.isInteger(first) || !Number.isInteger(end) || first < 0 || end > left.length || end - first < 2 || !Number.isFinite(position) || position < first || position >= end || !Number.isFinite(derivative) || Math.abs(derivative) > 4 || typeof mode !== 'string' || !Object.hasOwn(modes, mode)) { this.leftSample = this.rightSample = NaN; return false; }
    const floor = Math.floor(position), phase = (position - floor) * PHASES, phaseIndex = Math.min(PHASES - 1, Math.floor(phase)), phaseBlend = phase - phaseIndex;
    const rate = Math.log2(Math.max(1, Math.abs(derivative))) * STEPS, level = Math.floor(rate) + 1, rateBlend = rate - Math.floor(rate), stride = (PHASES + 1) * TAPS;
    const a = level * stride + phaseIndex * TAPS, b = a + TAPS, c = a + stride, d = c + TAPS, taps = this.coefficients, boundary = modes[mode], length = end - first;
    let l = 0, r = 0;
    for (let tap = 0; tap < TAPS; tap++) {
      let index = floor - (TAPS / 2 - 1) + tap;
      if (index < first || index >= end) {
        if (boundary === 1) continue;
        if (boundary === 2) { index -= first; index -= Math.floor(index / length) * length; index += first; }
        else if (boundary === 3) { const span = length - 1, period = span * 2; index -= first; index -= Math.floor(index / period) * period; if (index > span) index = period - index; index += first; }
        else index = Math.max(first, Math.min(end - 1, index));
      }
      const near = taps[a + tap] + (taps[b + tap] - taps[a + tap]) * phaseBlend, far = taps[c + tap] + (taps[d + tap] - taps[c + tap]) * phaseBlend, weight = near + (far - near) * rateBlend;
      l += left[index] * weight; if (right) r += right[index] * weight;
    }
    this.leftSample = l; this.rightSample = right ? r : l; return Number.isFinite(l) && Number.isFinite(this.rightSample);
  }
}
