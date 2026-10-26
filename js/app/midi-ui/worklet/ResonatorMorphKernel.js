import { prepareResonatorMorphMap } from '../../../midi/content/ResonatorMorph.js';
import { freezeData, hashData } from '../../../core/CanonicalData.js';

export const RESONATOR_MORPH_KERNEL_REVISION = 'paired-unit-complex-positive-loss-modal-body-v1';
const profiles = new WeakSet(), HEADER = 128, GLOBAL = 16, WIDTH = 7, MAX_MODES = 8, MAX_ENERGY = 1048576, FORCE_SCALE = 1280;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => { throw Object.assign(new Error('Paired modal body: ' + message), { code: 'invalid-paired-modal-body' }); };
const same = (a, b) => Math.abs(a - b) <= 1e-11 * Math.max(1, Math.abs(b));
const crc = bytes => { let value = 0xffffffff; for (let at = 0; at < bytes.length; at++) { value ^= at >= 28 && at < 32 ? 0 : bytes[at]; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
export async function prepareResonatorMorphKernelProfile(map, a, b, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate)) fail('Unsupported output rate.');
  const prepared = await prepareResonatorMorphMap(map, a, b);
  const resolvedMap = prepared.map;
  if (resolvedMap.transitionPolicy === 'prepared-dual-body-blend' || prepared.slots.length > MAX_MODES) fail('This paired renderer admits at most eight named slots; a dual-body blend needs its own overlap owner.');
  const slots = prepared.slots.map(slot => {
    const from = slot.a || slot.b, to = slot.b || slot.a;
    if (Math.max(from.frequencyHz, to.frequencyHz) >= sampleRate * 0.4) fail('An endpoint mode exceeds the output guard band.');
    return { id: slot.id, sourceAId: slot.a?.id ?? null, sourceBId: slot.b?.id ?? null, hasA: !!slot.a, hasB: !!slot.b, frequencyA: from.frequencyHz, frequencyB: to.frequencyHz, logFrequencyA: Math.log(from.frequencyHz), logFrequencyDelta: Math.log(to.frequencyHz) - Math.log(from.frequencyHz), t60A: from.t60Seconds, t60B: to.t60Seconds, logT60A: Math.log(from.t60Seconds), logT60Delta: Math.log(to.t60Seconds) - Math.log(from.t60Seconds), excitationA: slot.a?.excitation ?? 0, excitationB: slot.b?.excitation ?? 0, leftA: slot.a?.pickupLeft ?? 0, leftB: slot.b?.pickupLeft ?? 0, rightA: slot.a?.pickupRight ?? 0, rightB: slot.b?.pickupRight ?? 0 };
  });
  const body = { schema: 'lemmings-paired-modal-body-profile/v1', revision: RESONATOR_MORPH_KERNEL_REVISION, mapHash: resolvedMap.hash, endpointAHash: resolvedMap.endpointAHash, endpointBHash: resolvedMap.endpointBHash, transitionPolicy: resolvedMap.transitionPolicy, sampleRate, slots, forceScale: FORCE_SCALE, readoutScale: 0.05, maximumEnergy: MAX_ENERGY,
    statePolicy: 'retained-unit-complex-synthetic-coordinates;frequency-changes-rotate-without-reseeding-or-mechanical-energy-projection', unmatchedPolicy: 'prepared-private-mode-state;independent-excitation-and-observation-windows;no-semantic-onset', costPolicy: 'at-most-eight-modes;coefficient-cache-at-unchanged-morph;moving-control-cost-unmeasured', qualification: 'runtime-PCM-stability-alias-device-and-listening-pending' };
  const profile = freezeData({ ...body, identity: await hashData(body) }); profiles.add(profile); return profile;
}
export class ResonatorMorphKernel {
  constructor(profile) {
    if (!profiles.has(profile)) fail('Prepare the exact endpoint/map profile before creating body state.');
    this.profile = profile; this.rate = profile.sampleRate; this.state = new Float64Array(GLOBAL); this.modes = new Float64Array(profile.slots.length * WIDTH); this.state[0] = -1; this.state[1] = -1; this.highpass = Math.exp(-2 * Math.PI * 20 / this.rate); this.leftSample = this.rightSample = 0; this.setMorph(0);
  }
  setMorph(u) {
    if (!finite(u, 0, 1)) fail('Morph position exceeds its normalized domain.'); const s = this.state; if (s[1] === u) return; if (s[0] >= 0 && this.profile.transitionPolicy !== 'paired-synthetic-held') fail('A held change requires its explicitly reviewed paired-synthetic-held map policy.');
    const fadeIn = u === 0 ? 0 : u === 1 ? 1 : Math.sin(Math.PI * u * 0.5) ** 2, fadeOut = 1 - fadeIn;
    for (let index = 0; index < this.profile.slots.length; index++) {
      const slot = this.profile.slots[index], at = index * WIDTH, frequency = u === 0 ? slot.frequencyA : u === 1 ? slot.frequencyB : Math.exp(slot.logFrequencyA + u * slot.logFrequencyDelta), t60 = u === 0 ? slot.t60A : u === 1 ? slot.t60B : Math.exp(slot.logT60A + u * slot.logT60Delta), radius = Math.exp(-Math.log(1000) / (t60 * this.rate)), angle = 2 * Math.PI * frequency / this.rate;
      this.modes[at + 2] = radius * Math.cos(angle); this.modes[at + 3] = radius * Math.sin(angle); this.modes[at + 4] = fadeOut * slot.excitationA + fadeIn * slot.excitationB; this.modes[at + 5] = fadeOut * slot.leftA + fadeIn * slot.leftB; this.modes[at + 6] = fadeOut * slot.rightA + fadeIn * slot.rightB;
    }
    s[1] = u;
  }
  panic() { const frame = this.state[0], u = finite(this.state[1], 0, 1) ? this.state[1] : 0, faults = this.state[7]; this.state.fill(0); this.modes.fill(0); this.state[0] = this.state[1] = -1; this.state[7] = faults; this.setMorph(u); this.state[0] = frame; this.leftSample = this.rightSample = 0; }
  quarantine() { this.panic(); this.state[7]++; }
  sample(input, frame, u = this.state[1]) {
    const s = this.state, m = this.modes; this.leftSample = this.rightSample = 0;
    if (!finite(input, -1, 1) || !integer(frame, 0) || frame !== s[0] + 1 || !finite(u, 0, 1)) fail('Input, morph or actual contiguous output frontier is invalid.');
    this.setMorph(u); s[0] = frame; s[15] = u; if (s[7]) return;
    let energy = 0, loss = 0, work = 0, left = 0, right = 0;
    for (let at = 0; at < m.length; at += WIDTH) {
      const impulse = input * FORCE_SCALE / this.rate * m[at + 4], p = m[at] + impulse, q = m[at + 1], before = 0.5 * (p * p + q * q), nextP = m[at + 2] * p - m[at + 3] * q, nextQ = m[at + 3] * p + m[at + 2] * q;
      work += m[at] * impulse + impulse * impulse * 0.5; m[at] = Math.abs(nextP) < 1e-24 ? 0 : nextP; m[at + 1] = Math.abs(nextQ) < 1e-24 ? 0 : nextQ;
      const after = 0.5 * (m[at] * m[at] + m[at + 1] * m[at + 1]); energy += after; loss += before - after; left += m[at + 5] * m[at] * 0.05; right += m[at + 6] * m[at] * 0.05;
    }
    const defect = energy - s[2] + loss - work, tolerance = 128 * Number.EPSILON * (1 + energy + s[2] + Math.abs(work));
    if (!Number.isFinite(energy) || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(defect) || energy > MAX_ENERGY || loss < -tolerance || Math.abs(defect) > tolerance) { this.quarantine(); return; }
    s[2] = energy; s[3] += work; s[4] += Math.max(0, loss); s[5] = Math.max(s[5], Math.abs(defect)); s[14] = input;
    const a = left - s[8] + this.highpass * s[9], b = right - s[10] + this.highpass * s[11]; s[8] = left; s[10] = right; s[9] = Math.abs(a) < 1e-24 ? 0 : a; s[11] = Math.abs(b) < 1e-24 ? 0 : b;
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.max(Math.abs(a), Math.abs(b)) > 32) { this.quarantine(); return; }
    s[12] = this.leftSample = s[9]; s[13] = this.rightSample = s[11]; s[6] = Math.max(s[6], Math.abs(a), Math.abs(b));
  }
  get snapshotBytes() { return HEADER + (this.state.length + this.modes.length) * 8; }
  snapshotInto(bytes) {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength !== this.snapshotBytes || bytes.buffer === this.state.buffer || bytes.buffer === this.modes.buffer) fail('Snapshot storage must be exact and independently owned.'); bytes.fill(0); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < 8; index++) bytes[index] = 'PMORPH01'.charCodeAt(index);
    for (const [at, value] of [[8, 1], [12, this.rate], [16, this.profile.slots.length], [20, GLOBAL], [24, bytes.length]]) view.setUint32(at, value, true);
    for (let index = 0; index < 32; index++) bytes[32 + index] = parseInt(this.profile.identity.slice(index * 2, index * 2 + 2), 16);
    let at = HEADER; for (const array of [this.state, this.modes]) for (const value of array) { view.setFloat64(at, value, true); at += 8; } view.setUint32(28, crc(bytes), true); return bytes;
  }
  restoreFrom(bytes) {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength !== this.snapshotBytes || bytes.buffer === this.state.buffer || bytes.buffer === this.modes.buffer) fail('Incompatible snapshot storage.'); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if ([...bytes.subarray(0, 8)].some((value, index) => value !== 'PMORPH01'.charCodeAt(index)) || view.getUint32(8, true) !== 1 || view.getUint32(12, true) !== this.rate || view.getUint32(16, true) !== this.profile.slots.length || view.getUint32(20, true) !== GLOBAL || view.getUint32(24, true) !== bytes.length || view.getUint32(28, true) !== crc(bytes)) fail('Snapshot shape, rate or checksum changed.');
    for (let index = 0; index < 32; index++) if (bytes[32 + index] !== parseInt(this.profile.identity.slice(index * 2, index * 2 + 2), 16)) fail('Snapshot endpoint/map/renderer profile differs.'); for (let index = 64; index < HEADER; index++) if (bytes[index]) fail('Reserved snapshot header is noncanonical.');
    const state = new Float64Array(GLOBAL), modes = new Float64Array(this.modes.length); let at = HEADER; for (const array of [state, modes]) for (let index = 0; index < array.length; index++) { const value = view.getFloat64(at, true); if (!Number.isFinite(value)) fail('Snapshot contains nonfinite state.'); array[index] = value; at += 8; }
    if (!integer(state[0], -1) || !finite(state[1], 0, 1) || !finite(state[2], 0, MAX_ENERGY) || !finite(state[3], 0, Number.MAX_SAFE_INTEGER) || !finite(state[4], 0, Number.MAX_SAFE_INTEGER) || !finite(state[5], 0, 1e-5) || !finite(state[6], 0, 32) || !integer(state[7], 0) || !finite(state[14], -1, 1) || !finite(state[15], 0, 1)) fail('Snapshot frontier, work, loss or containment state exceeds its bound.');
    const expected = new ResonatorMorphKernel(this.profile); expected.setMorph(state[1]); const previousReadout = new ResonatorMorphKernel(this.profile); previousReadout.setMorph(state[15]); let energy = 0, left = 0, right = 0;
    for (let offset = 0; offset < modes.length; offset += WIDTH) { if (!finite(modes[offset], -2048, 2048) || !finite(modes[offset + 1], -2048, 2048)) fail('Modal state exceeds its energy domain.'); for (let field = 2; field < WIDTH; field++) if (!same(modes[offset + field], expected.modes[offset + field])) fail('Signed coupling, pole or morph coefficients differ.'); energy += 0.5 * (modes[offset] ** 2 + modes[offset + 1] ** 2); left += previousReadout.modes[offset + 5] * modes[offset] * 0.05; right += previousReadout.modes[offset + 6] * modes[offset] * 0.05; }
    if (!same(state[2], energy) || Math.abs(state[2] + state[4] - state[3]) > 1e-8 * (1 + state[3]) || !same(state[8], left) || !same(state[10], right) || state[12] !== state[9] || state[13] !== state[11] || !finite(state[9], -32, 32) || !finite(state[11], -32, 32) || state[7] && (energy !== 0 || state[12] || state[13])) fail('Snapshot energy, fixed readout or quarantine state disagrees.');
    if (this.profile.transitionPolicy !== 'paired-synthetic-held' && state[0] >= 0 && state[2] > 0 && state[15] !== state[1]) fail('An onset-only snapshot contains an invented held update.');
    if (state[0] === -1 && state.some((value, field) => ![0, 1].includes(field) && value !== 0)) fail('Pre-render state contains invented history.');
    this.state.set(state); this.modes.set(modes); this.leftSample = state[12]; this.rightSample = state[13]; return true;
  }
  diagnostics() { const s = this.state; return { revision: RESONATOR_MORPH_KERNEL_REVISION, profileHash: this.profile.identity, mapHash: this.profile.mapHash, frame: s[0], morph01: s[1], modes: this.profile.slots.length, energy: s[2], inputWork: s[3], positiveLoss: s[4], maximumBalanceDefect: s[5], peak: s[6], faults: s[7], semanticOnsetsAdded: 0, restoration: 'exact-private-kernel-cut;PCM-qualification-pending', qualification: this.profile.qualification }; }
}
