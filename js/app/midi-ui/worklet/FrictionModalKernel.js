import { FRICTION_MODEL_LIMITS as L, FRICTION_PRESSURE_DOMAINS, FRICTION_GLASS_RATIOS, FRICTION_GLASS_T60, FRICTION_BODY_HZ, FRICTION_MODEL_REVISION } from '../../../midi/content/FrictionModel.js';

export const FRICTION_STATE = Object.freeze({ active: 0, kind: 1, seed: 2, drag: 3, pressure: 4, edge: 5, body: 6, ended: 7, position: 8, from: 9, to: 10, first: 11, end: 12, lastFrame: 13, onset: 14, pressureRamp: 15, force: 16, energy: 17, inputWork: 18, frictionLoss: 19, linearLoss: 20, peak: 21, maximumBalanceDefect: 22, rootResidual: 23, modeCount: 24, rootHz: 25, hpLeftInput: 26, hpLeftOutput: 27, hpRightInput: 28, hpRightOutput: 29, iterations: 30, releaseFrame: 31, signProjections: 32, controlPressure: 33, faults: 34, speed: 35, bowVelocity: 36, forceCap: 37, admittance: 38, slopeProduct: 39, left: 40, right: 41, contactVelocity: 42, relativeVelocity: 43, pressureStep: 44, highpass: 45 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const spatial = (seed, cell) => { let value = (seed ^ Math.imul(cell | 0, 0x9e3779b1)) >>> 0; value = Math.imul(value ^ value >>> 16, 0x7feb352d); value = Math.imul(value ^ value >>> 15, 0x846ca68b); return ((value ^ value >>> 16) >>> 0) / 4294967296; };
const friction = (relative, cap) => cap * Math.tanh(relative / L.frictionSmoothingVelocity) * (L.staticToDynamicRatio + (1 - L.staticToDynamicRatio) * Math.exp(-Math.abs(relative) / L.stribeckVelocity));

export class FrictionModalKernel {
  constructor(sampleRate, { state = new Float64Array(L.state), modes = new Float64Array(L.modes * L.modeWidth) } = {}) {
    if (![44100, 48000, 96000].includes(sampleRate) || !(state instanceof Float64Array) || state.length !== L.state || !(modes instanceof Float64Array) || modes.length !== L.modes * L.modeWidth || !(state.buffer instanceof ArrayBuffer) || !(modes.buffer instanceof ArrayBuffer) || state.buffer === modes.buffer && state.byteOffset < modes.byteOffset + modes.byteLength && modes.byteOffset < state.byteOffset + state.byteLength) throw new TypeError('Friction synthesis requires its fixed state and modal storage.');
    this.rate = sampleRate; this.h = 1 / sampleRate; this.state = state; this.modes = modes; this.leftSample = this.rightSample = 0;
  }
  validSpan(from, to, first, end) { return finite(from, -L.maximumCoordinatePixels, L.maximumCoordinatePixels) && finite(to, -L.maximumCoordinatePixels, L.maximumCoordinatePixels) && integer(first, 0) && integer(end, first + 1) && end - first <= this.rate * L.maximumSpanSeconds && Math.abs(to - from) * this.rate / (end - first) <= L.maximumPixelsPerSecond; }
  begin(kind, frequency, seed, drag, pressure, edge, body, from, to, first, end, onset = first) {
    const domain = FRICTION_PRESSURE_DOMAINS[kind];
    if (!integer(kind, 0, 2) || !finite(frequency, L.minimumHz, L.maximumHz) || !integer(seed, 0, 0xffffffff) || !finite(drag, 0, 1) || !domain || !finite(pressure, domain[0], domain[1]) || !finite(edge, 0.1, 0.45) || !finite(body, 0, 1) || !integer(onset, 0, first) || !this.validSpan(from, to, first, end)) return false;
    this.clear(); const s = this.state, m = this.modes, count = kind === 1 ? 6 : 12;
    s[0] = 1; s[1] = kind; s[2] = seed; s[3] = drag; s[4] = pressure; s[5] = edge; s[6] = body; s[8] = s[10] = from; s[12] = first; s[13] = onset - 1; s[14] = onset; s[24] = count; s[25] = frequency; s[33] = 1; s[44] = this.h / 0.035; s[45] = Math.exp(-2 * Math.PI * 20 / this.rate);
    let pointReference = 0, outputReference = 0;
    for (let mode = 0; mode < count; mode++) {
      const at = mode * L.modeWidth, bodyMode = kind !== 1 && mode >= 8, ordinal = mode + 1;
      const ratio = kind === 1 ? FRICTION_GLASS_RATIOS[mode] : ordinal * Math.sqrt((1 + (kind === 2 ? 0.0002 : 0) * ordinal * ordinal) / (1 + (kind === 2 ? 0.0002 : 0)));
      const hz = bodyMode ? FRICTION_BODY_HZ[mode - 8] : frequency * ratio, t60 = kind === 1 ? FRICTION_GLASS_T60[mode] : bodyMode ? 0.2 + 0.07 * (11 - mode) : 0.6 / (1 + mode * 0.18);
      if (!(hz > 0 && hz < this.rate * 0.4)) { this.clear(); return false; }
      const radius = Math.exp(-Math.log(1000) / (t60 * this.rate)), halfSin = Math.sin(Math.PI * hz / this.rate), denominator = (1 + radius) ** 2 - 4 * radius * halfSin * halfSin;
      m[at + 2] = 4 * this.rate * this.rate * ((1 - radius) ** 2 + 4 * radius * halfSin * halfSin) / denominator;
      m[at + 3] = 2 * this.rate * -Math.expm1(-2 * Math.log(1000) / (t60 * this.rate)) / denominator;
      m[at + 4] = 1 + this.h * m[at + 3] + this.h * this.h * m[at + 2] / 4;
      m[at + 5] = Math.sin(ordinal * Math.PI * edge) * (bodyMode ? 0.35 * body : 1); pointReference += m[at + 5] ** 2;
      const observation = kind === 1 ? 1 : bodyMode ? body : 1 - body;
      m[at + 6] = observation * Math.sin(ordinal * Math.PI * (kind === 1 ? 0.25 + body * 0.15 : 0.31)); m[at + 7] = observation * Math.sin(ordinal * Math.PI * (kind === 1 ? 0.75 - body * 0.15 : 0.69));
      outputReference += Math.max(Math.abs(m[at + 6]), Math.abs(m[at + 7]));
    }
    pointReference = Math.sqrt(pointReference); if (!(pointReference > 0)) { this.clear(); return false; }
    for (let mode = 0; mode < count; mode++) { const at = mode * L.modeWidth; m[at + 5] /= pointReference; m[at + 6] /= Math.max(1, outputReference); m[at + 7] /= Math.max(1, outputReference); m[at + 9] = this.h * 0.5 * m[at + 5] / m[at + 4]; s[38] += m[at + 5] * m[at + 9]; }
    s[39] = s[38] * L.forceScale * pressure * (kind === 2 ? 1.2 : 1) * (1 - L.staticToDynamicRatio) / L.stribeckVelocity;
    if (!(s[38] > 0 && s[39] < 0.5)) { this.clear(); return false; }
    return this.setSpan(from, to, first, end);
  }
  setSpan(from, to, first, end) { const s = this.state; if (!s[0] || s[7] || !this.validSpan(from, to, first, end) || s[46] && first !== s[13] + 1 || first < s[12] || Math.abs(from - s[10]) > 1e-5) return false; s[9] = from; s[10] = to; s[11] = first; s[12] = end; s[46]++; return true; }
  setPressure(value) { if (!finite(value, 0, 1) || !this.state[0]) return false; this.state[33] = value; return true; }
  end(frame) { const s = this.state; if (!integer(frame, 0) || !s[0] || frame < s[13] || frame > s[13] + 1) throw new TypeError('Friction release needs its actual contiguous output frontier.'); if (s[7]) return false; s[7] = 1; s[31] = frame; return true; }
  clear() { this.state.fill(0); this.modes.fill(0); this.leftSample = this.rightSample = 0; }
  quarantine() { const faults = this.state[34] + 1; this.clear(); this.state[34] = faults; }
  sample(frame) {
    this.leftSample = this.rightSample = 0; const s = this.state, m = this.modes, h = this.h;
    if (!s[0]) return;
    if (!integer(frame, 0) || frame !== s[13] + 1) throw new RangeError('Friction feedback needs contiguous owned output frames.'); s[13] = frame;
    const moving = !s[7] && frame >= s[11] && frame < s[12] && s[10] !== s[9], previous = s[8], position = moving ? s[9] + (s[10] - s[9]) * (frame - s[11] + 1) / (s[12] - s[11]) : previous, velocity = moving ? (position - previous) * this.rate : 0;
    s[8] = position; s[35] = Math.abs(velocity); s[36] = L.maximumVelocity * Math.tanh(velocity * s[3] / 64);
    const pressureTarget = moving ? s[33] : 0; s[15] += Math.max(-s[44], Math.min(s[44], pressureTarget - s[15]));
    let roughness = 1;
    if (s[1] === 2) { const coordinate = position / 4, cell = Math.floor(coordinate), fraction = coordinate - cell; roughness = 0.8 + 0.4 * (spatial(s[2], cell) * (1 - fraction) + spatial(s[2], cell + 1) * fraction); }
    const cap = L.forceScale * s[4] * s[15] * roughness; s[37] = cap; let freeContact = 0;
    for (let mode = 0; mode < s[24]; mode++) { const at = mode * L.modeWidth; m[at + 8] = (m[at + 1] - h * 0.5 * m[at + 2] * m[at]) / m[at + 4]; freeContact += m[at + 5] * m[at + 8]; }
    let force = 0;
    if (cap > 0) {
      let low = -cap, high = cap;
      for (let iteration = 0; iteration < L.iterations; iteration++) { const candidate = (low + high) * 0.5, relative = s[36] - freeContact - s[38] * candidate; if (candidate - friction(relative, cap) < 0) low = candidate; else high = candidate; }
      force = (low + high) * 0.5; const relative = s[36] - freeContact - s[38] * force;
      if (force * relative < 0) { force = 0; s[32]++; } s[30] += L.iterations;
    }
    const contact = freeContact + s[38] * force, relative = s[36] - contact, inputWork = h * force * s[36], frictionLoss = h * force * relative;
    let energy = 0, linearLoss = 0, left = 0, right = 0;
    for (let mode = 0; mode < s[24]; mode++) {
      const at = mode * L.modeWidth, midpointVelocity = m[at + 8] + m[at + 9] * force, q = m[at] + h * midpointVelocity, v = 2 * midpointVelocity - m[at + 1];
      m[at] = Math.abs(q) < 1e-24 ? 0 : q; m[at + 1] = Math.abs(v) < 1e-24 ? 0 : v;
      energy += 0.5 * (m[at + 1] ** 2 + m[at + 2] * m[at] ** 2); linearLoss += 2 * h * m[at + 3] * midpointVelocity * midpointVelocity;
      left += m[at + 6] * m[at + 1] * 0.05; right += m[at + 7] * m[at + 1] * 0.05;
    }
    const defect = energy - s[17] + linearLoss + frictionLoss - inputWork, tolerance = 128 * Number.EPSILON * (1 + energy + s[17] + Math.abs(inputWork));
    if (!Number.isFinite(energy) || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(defect) || energy > L.maximumEnergy || defect > tolerance || frictionLoss < -tolerance) { this.quarantine(); return; }
    s[16] = force; s[17] = energy; s[18] += inputWork; s[19] += frictionLoss; s[20] += linearLoss; s[22] = Math.max(s[22], Math.max(0, defect)); s[23] = Math.abs(force - friction(relative, cap)); s[42] = contact; s[43] = relative;
    const outputLeft = left - s[26] + s[45] * s[27], outputRight = right - s[28] + s[45] * s[29]; s[26] = left; s[28] = right; s[27] = Math.abs(outputLeft) < 1e-24 ? 0 : outputLeft; s[29] = Math.abs(outputRight) < 1e-24 ? 0 : outputRight;
    if (!Number.isFinite(outputLeft) || !Number.isFinite(outputRight) || Math.max(Math.abs(outputLeft), Math.abs(outputRight)) > 32) { this.quarantine(); return; }
    s[40] = this.leftSample = s[27]; s[41] = this.rightSample = s[29]; s[21] = Math.max(s[21], Math.abs(outputLeft), Math.abs(outputRight));
  }
  diagnostics() { const s = this.state; return { revision: FRICTION_MODEL_REVISION, active: !!s[0], kind: s[1], rootHz: s[25], modeCount: s[24], frame: s[13], positionPixels: s[8], speedPixelsPerSecond: s[35], force: s[16], normalizedBowVelocity: s[36], energy: s[17], inputWork: s[18], frictionLoss: s[19], linearLoss: s[20], maximumPositiveBalanceDefect: s[22], rootResidual: s[23], uniqueRootSlopeProduct: s[39], nonlinearIterations: s[30], signProjections: s[32], peak: s[21], faults: s[34], inputPolicy: 'actual-motion-only;zero-bow-velocity-at-rest', qualification: 'original-model;runtime-stability-tone-alias-cost-and-listening-pending' }; }
}
