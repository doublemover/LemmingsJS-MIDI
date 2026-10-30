import { WIND_MODEL_LIMITS as L, WIND_MODEL_REVISION, WIND_PRESSURE_DOMAINS, WIND_PITCH_DOMAINS, windForceCurve, windRandomStep } from '../../../midi/content/WindModel.js';

const BREATH_REFERENCE = 10 ** (-26 / 20);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
export const WIND_STATE = Object.freeze({ active: 0, kind: 1, seed: 2, air: 3, bite: 4, lengthRatio: 5, leak: 6, bell: 7, ended: 8, lastFrame: 9, onset: 10, releaseFrame: 11, controlPressure: 12, pressureRamp: 13, force: 14, energy: 15, inputWork: 16, linearLoss: 17, peak: 18, maximumBalanceDefect: 19, rootResidual: 20, intendedHz: 21, baseHz: 22, highRegister: 23, registerTransitions: 24, registerArmed: 25, modeCount: 26, admittance: 27, slopeProduct: 28, noiseLast: 29, noiseHP: 30, noiseLP: 31, noiseHPCoefficient: 32, noiseLPCoefficient: 33, highpass: 34, pressureStep: 35, randomState: 36, left: 37, right: 38, hpLeftInput: 39, hpLeftOutput: 40, hpRightInput: 41, hpRightOutput: 42, iterations: 43, faults: 44, contactVelocity: 45, portNoise: 46, forceCap: 47, token: 48, epoch: 49, generation: 50, forceScale: 51, velocityScale: 52, releaseStep: 53 });

export class WindModalKernel {
  constructor(sampleRate, { state = new Float64Array(L.state), modes = new Float64Array(L.modes * L.modeWidth) } = {}) {
    if (![44100, 48000, 96000].includes(sampleRate) || !(state instanceof Float64Array) || state.length !== L.state || !(modes instanceof Float64Array) || modes.length !== L.modes * L.modeWidth || !(state.buffer instanceof ArrayBuffer) || !(modes.buffer instanceof ArrayBuffer) || state.buffer === modes.buffer && state.byteOffset < modes.byteOffset + modes.byteLength && modes.byteOffset < state.byteOffset + state.byteLength) throw new TypeError('Wind synthesis requires its bounded independent state and modal storage.');
    this.rate = sampleRate; this.h = 1 / sampleRate; this.state = state; this.modes = modes; this.leftSample = this.rightSample = 0;
  }
  begin(kind, frequency, seed, air, bite, lengthRatio, leak, bell, frame) {
    const pressure = WIND_PRESSURE_DOMAINS[kind], pitch = WIND_PITCH_DOMAINS[kind], root = frequency / lengthRatio;
    if (!integer(kind, 0, 2) || !pressure || !pitch || !finite(root, pitch[0], pitch[1]) || !integer(seed, 0, 0xffffffff) || !finite(air, pressure[0], pressure[1]) || !finite(bite, 0.35, 0.65) || !finite(lengthRatio, 0.75, 1.25) || !finite(leak, 0, 1) || !finite(bell, 0.2, 0.5) || !integer(frame, 0)) return false;
    this.clear(); const s = this.state, m = this.modes; s[0] = 1; s[1] = kind; s[2] = seed; s[3] = air; s[4] = bite; s[5] = lengthRatio; s[6] = leak; s[7] = bell; s[9] = frame - 1; s[10] = frame; s[12] = 1; s[21] = frequency; s[22] = root; s[26] = L.modes; s[32] = Math.exp(-2 * Math.PI * 900 / this.rate); s[33] = -Math.expm1(-2 * Math.PI * 6000 / this.rate); s[34] = Math.exp(-2 * Math.PI * 20 / this.rate); s[35] = air / ((kind === 1 ? 0.08 : 0.03) * this.rate); s[36] = seed || 0x6d2b79f5; s[51] = L.forceScale; s[52] = L.minimumVelocityScale + (0.65 - bite) * 0.1; s[53] = air / ((kind === 1 ? 0.3 : 0.12) * this.rate);
    let point = 0, output = 0;
    for (let mode = 0; mode < L.modes; mode++) {
      const at = mode * L.modeWidth, ordinal = mode + 1, ratio = kind === 1 ? ordinal : 2 * mode + 1;
      const force = mode ? (kind === 1 ? 0.32 : 0.2) * Math.sin(Math.PI * ordinal * bite) / ordinal : 1;
      m[at + 5] = force; point += force * force; m[at + 6] = Math.sin(ordinal * Math.PI * (0.2 + bell * 0.3)) / ordinal; m[at + 7] = Math.sin(ordinal * Math.PI * (0.8 - bell * 0.3)) / ordinal; output += Math.max(Math.abs(m[at + 6]), Math.abs(m[at + 7]));
      for (let register = 0; register <= Number(kind === 2); register++) {
        const hz = root * ratio * (register ? 2 : 1), t60 = (0.65 - bell * 0.6) / (1 + mode * (kind === 1 ? 0.3 : 0.45));
        if (!(hz > 0 && hz < this.rate * 0.4)) { this.clear(); return false; }
        const radius = Math.exp(-Math.log(1000) / (t60 * this.rate)), sine = Math.sin(Math.PI * hz / this.rate), denominator = (1 + radius) ** 2 - 4 * radius * sine * sine, base = at + (register ? 10 : 2);
        m[base] = 4 * this.rate * this.rate * ((1 - radius) ** 2 + 4 * radius * sine * sine) / denominator;
        m[base + 1] = 2 * this.rate * -Math.expm1(-2 * Math.log(1000) / (t60 * this.rate)) / denominator; m[base + 2] = 1 + this.h * m[base + 1] + this.h * this.h * m[base] / 4;
      }
    }
    point = Math.sqrt(point);
    for (let mode = 0; mode < L.modes; mode++) { const at = mode * L.modeWidth; m[at + 5] /= point; m[at + 6] /= Math.max(1, output); m[at + 7] /= Math.max(1, output); m[at + 9] = this.h * 0.5 * m[at + 5] / m[at + 4]; s[27] += m[at + 5] * m[at + 9]; if (kind === 2) { m[at + 13] = m[at + 5]; m[at + 14] = m[at + 6]; m[at + 15] = m[at + 7]; m[at + 16] = this.h * 0.5 * m[at + 5] / m[at + 12]; } }
    s[28] = s[27] * L.forceScale * air / s[52]; if (!(s[27] > 0 && s[28] < 0.25)) { this.clear(); return false; } return true;
  }
  setPressure(value) { if (!this.state[0] || this.state[8] || !finite(value, 0, 1)) return false; this.state[12] = value; return true; }
  raiseRegister() {
    const s = this.state, m = this.modes; if (s[1] !== 2 || s[23] || s[24] || !s[25]) return false;
    s[27] = 0;
    for (let mode = 0; mode < L.modes; mode++) { const at = mode * L.modeWidth; m[at] *= Math.sqrt(m[at + 2] / m[at + 10]); for (let field = 0; field < 6; field++) m[at + 2 + field] = m[at + 10 + field]; m[at + 9] = m[at + 16]; s[27] += m[at + 5] * m[at + 9]; }
    s[23] = s[24] = 1; s[28] = s[27] * L.forceScale * s[3] / s[52]; return true;
  }
  end(frame) { const s = this.state; if (!s[0] || !integer(frame, 0) || frame < s[9] || frame > s[9] + 1) throw new TypeError('Wind release needs its actual contiguous output frontier.'); if (s[8]) return false; s[8] = 1; s[11] = frame; return true; }
  clear() { this.state.fill(0); this.modes.fill(0); this.leftSample = this.rightSample = 0; }
  quarantine() { const faults = this.state[44] + 1; this.clear(); this.state[44] = faults; }
  sample(frame) {
    this.leftSample = this.rightSample = 0; const s = this.state, m = this.modes, h = this.h; if (!s[0]) return;
    if (!integer(frame, 0) || frame !== s[9] + 1) throw new RangeError('Wind feedback needs contiguous owned output frames.'); s[9] = frame;
    const target = s[8] ? 0 : s[3] * s[12], step = s[8] ? s[53] : s[35]; s[13] += Math.max(-step, Math.min(step, target - s[13]));
    if (s[1] === 2 && !s[8]) { if (s[13] <= L.registerLow) s[25] = 1; if (s[13] >= L.registerHigh) this.raiseRegister(); }
    s[36] = windRandomStep(s[36]); const random = s[36] / 2147483648 - 1, noise = s[13] > 0 ? random * (s[6] * BREATH_REFERENCE + (frame - s[10] < 32 ? 1e-5 : 0)) : 0;
    const high = noise - s[29] + s[32] * s[30]; s[29] = noise; s[30] = high; s[31] += s[33] * (high - s[31]); s[46] = s[31];
    let freeContact = 0; for (let mode = 0; mode < L.modes; mode++) { const at = mode * L.modeWidth; m[at + 8] = (m[at + 1] - h * 0.5 * m[at + 2] * m[at]) / m[at + 4]; freeContact += m[at + 5] * m[at + 8]; }
    const cap = L.forceScale * s[13]; s[47] = cap; let force = 0;
    if (cap > 0) { let low = -cap, high = cap; for (let iteration = 0; iteration < L.iterations; iteration++) { const candidate = (low + high) * 0.5; if (candidate - windForceCurve(freeContact + s[27] * candidate, s[46], cap, s[52]) < 0) low = candidate; else high = candidate; } force = freeContact + s[46] === 0 ? 0 : (low + high) * 0.5; s[43] += L.iterations; }
    const contact = freeContact + s[27] * force, work = h * force * contact; let energy = 0, loss = 0, left = 0, right = 0;
    for (let mode = 0; mode < L.modes; mode++) { const at = mode * L.modeWidth, midpoint = m[at + 8] + m[at + 9] * force, q = m[at] + h * midpoint, v = 2 * midpoint - m[at + 1]; m[at] = Math.abs(q) < 1e-24 ? 0 : q; m[at + 1] = Math.abs(v) < 1e-24 ? 0 : v; energy += 0.5 * (m[at + 1] ** 2 + m[at + 2] * m[at] ** 2); loss += 2 * h * m[at + 3] * midpoint * midpoint; left += m[at + 6] * m[at + 1] * 0.05; right += m[at + 7] * m[at + 1] * 0.05; }
    const defect = energy - s[15] + loss - work, tolerance = 128 * Number.EPSILON * (1 + energy + s[15] + Math.abs(work));
    if (!Number.isFinite(energy) || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(defect) || energy > L.maximumEnergy || Math.abs(defect) > tolerance) { this.quarantine(); return; }
    s[14] = force; s[15] = energy; s[16] += work; s[17] += loss; s[19] = Math.max(s[19], Math.abs(defect)); s[20] = Math.abs(force - windForceCurve(contact, s[46], cap, s[52])); s[45] = contact;
    const outputLeft = left - s[39] + s[34] * s[40], outputRight = right - s[41] + s[34] * s[42]; s[39] = left; s[41] = right; s[40] = Math.abs(outputLeft) < 1e-24 ? 0 : outputLeft; s[42] = Math.abs(outputRight) < 1e-24 ? 0 : outputRight;
    if (!Number.isFinite(outputLeft) || !Number.isFinite(outputRight) || Math.max(Math.abs(outputLeft), Math.abs(outputRight)) > 32) { this.quarantine(); return; }
    s[37] = this.leftSample = s[40]; s[38] = this.rightSample = s[42]; s[18] = Math.max(s[18], Math.abs(outputLeft), Math.abs(outputRight));
  }
  diagnostics() { const s = this.state; return { revision: WIND_MODEL_REVISION, active: !!s[0], kind: s[1], intendedHz: s[21], acousticBaseHz: s[22], register: s[23], registerTransitions: s[24], modeCount: s[26], frame: s[9], pressure: s[13], energy: s[15], inputWork: s[16], linearLoss: s[17], maximumBalanceDefect: s[19], rootResidual: s[20], uniqueRootSlopeProduct: s[28], nonlinearIterations: s[43], peak: s[18], faults: s[44], qualification: 'original-experimental-modal-wind;stability-tone-alias-cost-and-listening-pending' }; }
}
