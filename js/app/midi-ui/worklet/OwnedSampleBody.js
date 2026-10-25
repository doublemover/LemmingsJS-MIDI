import { SAMPLE_BODY_STATE_OFFSET as BASE, SAMPLE_BODY_CONTROL_SCALARS as CONTROLS, SAMPLE_BODY_MODE_STRIDE as STRIDE } from '../../../midi/content/SampleBodyProfile.js';

const F = Object.freeze({ active: 0, start: 1, deadline: 2, released: 3, forceFrame: 4, forceFrames: 5, mix: 6, energy: 7, overflow: 8, excite: 9,
  oldL: 10, oldR: 11, dcL: 12, dcR: 13, frequency: 14, t60: 15, pickup: 16, baseT60: 17, damping: 18, releaseFrame: 19 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;

// Finite excitation uses its stereo energy budget. Motion excitation uses
// ||DC||_1 <= 2 and (1-r)/(2 sqrt(2) peak) to bound stereo modal state by one.
export class OwnedSampleBody {
  constructor(profile, state, width, voices) { this.profile = profile; this.state = state; this.width = width; this.voices = voices; this.left = this.right = 0; }
  accepts(frequency, packet) {
    const p = this.profile;
    return !!p && packet[39] === p.count && finite(packet[34], 0, 1) && finite(packet[35], 0.02, 2.5) && finite(packet[36], 0, 1) && finite(packet[37], 0, 1) && finite(packet[38], 0, 1) && p.modes.every(mode => frequency * mode.ratio < p.sampleRate * 0.4);
  }
  begin(slot, frequency, packet, frame) {
    const p = this.profile, s = this.state, at = slot * this.width + BASE;
    s.fill(0, at, at + CONTROLS + 8 * STRIDE); s[at + F.active] = 1; s[at + F.start] = frame; s[at + F.deadline] = p.excitationMode ? Number.MAX_SAFE_INTEGER : frame + p.supportFrames + p.maximumTailFrames;
    s[at + F.mix] = packet[34]; s[at + F.excite] = packet[37]; s[at + F.frequency] = frequency; s[at + F.t60] = packet[35] * (1 - 0.9 * packet[36]); s[at + F.pickup] = packet[38]; s[at + F.baseT60] = packet[35]; s[at + F.damping] = packet[36];
    for (let index = 0; index < p.count; index++) {
      const mode = p.modes[index], row = at + CONTROLS + index * STRIDE, angle = 2 * Math.PI * frequency * mode.ratio / p.sampleRate,
        radius = Math.exp(-Math.log(1000) / (s[at + F.t60] * mode.t60Scale * p.sampleRate));
      s[row + 4] = radius * Math.cos(angle); s[row + 5] = radius * Math.sin(angle); s[row + 7] = p.excitationMode ? (1 - radius) / (2 * Math.SQRT2 * p.inputPeakBound) : Math.sqrt(Math.max(0, 1 - radius * radius) / p.energyBudget);
      s[row + 6] = (mode.pickupA + (mode.pickupB - mode.pickupA) * packet[38]) / p.maximumL1;
    }
  }
  release(slot, frames, frame, forced, parentDeadline) {
    const at = slot * this.width + BASE, s = this.state, p = this.profile; if (!s[at + F.frequency]) return;
    s[at + F.released] = 1; s[at + F.releaseFrame] = frame; s[at + F.deadline] = Math.min(s[at + F.deadline], parentDeadline, frame + p.maximumTailFrames);
    if (forced) { s[at + F.forceFrame] = frame; s[at + F.forceFrames] = frames; s[at + F.deadline] = Math.min(s[at + F.deadline], frame + frames); }
  }
  sample(slot, frame, left, right, observedMotion = false) {
    const p = this.profile, s = this.state, at = slot * this.width + BASE;
    if (!s[at + F.active]) { this.left = left * (1 - s[at + F.mix]); this.right = right * (1 - s[at + F.mix]); return false; }
    const mix = s[at + F.mix]; let inputL = 0, inputR = 0;
    const allowed = p.excitationMode ? observedMotion && !s[at + F.released] : frame - s[at + F.start] < p.supportFrames;
    if (allowed && !s[at + F.overflow] && !s[at + F.forceFrames]) {
      const peak = Math.max(Math.abs(left), Math.abs(right));
      if (p.excitationMode && (!Number.isFinite(peak) || peak > p.inputPeakBound)) s[at + F.overflow] = 1;
      else {
        s[at + F.dcL] = left - s[at + F.oldL] + p.dcPole * s[at + F.dcL]; s[at + F.dcR] = right - s[at + F.oldR] + p.dcPole * s[at + F.dcR]; s[at + F.oldL] = left; s[at + F.oldR] = right;
        const edge = Math.min(p.supportFrames, Math.ceil(p.sampleRate * 0.005)), supportFade = p.excitationMode ? 1 : Math.max(0, Math.min(1, (p.supportFrames - (frame - s[at + F.start]) - 1) / edge));
        inputL = s[at + F.dcL] * s[at + F.excite] * supportFade; inputR = s[at + F.dcR] * s[at + F.excite] * supportFade;
        if (p.excitationMode) s[at + F.energy] = Math.max(s[at + F.energy], peak);
        else {
          const energy = inputL * inputL + inputR * inputR, remaining = Math.max(0, p.energyBudget - s[at + F.energy]);
          if (!Number.isFinite(energy)) { inputL = inputR = 0; s[at + F.overflow] = 1; }
          else if (energy > remaining) { const gain = Math.sqrt(remaining / energy); inputL *= gain; inputR *= gain; s[at + F.overflow] = 1; }
          s[at + F.energy] = Math.min(p.energyBudget, s[at + F.energy] + inputL * inputL + inputR * inputR);
        }
      }
    } else if (p.excitationMode) s[at + F.oldL] = s[at + F.oldR] = s[at + F.dcL] = s[at + F.dcR] = 0;
    let outputL = 0, outputR = 0;
    for (let index = 0; index < p.count; index++) {
      const row = at + CONTROLS + index * STRIDE, a = s[row + 4], b = s[row + 5], injection = s[row + 7],
        l = a * s[row] - b * s[row + 1] + injection * inputL, r = a * s[row + 2] - b * s[row + 3] + injection * inputR;
      const il = b * s[row] + a * s[row + 1], ir = b * s[row + 2] + a * s[row + 3];
      s[row] = Math.abs(l) < p.denormalFloor ? 0 : l; s[row + 1] = Math.abs(il) < p.denormalFloor ? 0 : il; s[row + 2] = Math.abs(r) < p.denormalFloor ? 0 : r; s[row + 3] = Math.abs(ir) < p.denormalFloor ? 0 : ir;
      outputL += s[row] * s[row + 6]; outputR += s[row + 2] * s[row + 6];
    }
    const fade = Math.max(0, Math.min(1, (s[at + F.deadline] - frame - 1) / Math.ceil(p.sampleRate * 0.005), s[at + F.forceFrames] ? 1 - (frame - s[at + F.forceFrame]) / s[at + F.forceFrames] : 1));
    this.left = left * (1 - mix) + outputL * mix * p.outputGain * fade; this.right = right * (1 - mix) + outputR * mix * p.outputGain * fade;
    if (frame + 1 >= s[at + F.deadline]) { s[at + F.active] = 0; s.fill(0, at + CONTROLS, at + CONTROLS + 8 * STRIDE); return false; } return true;
  }
  clear(slot) { const at = slot * this.width + BASE; this.state.fill(0, at, at + CONTROLS + 8 * STRIDE); }
  inspect(slot, frame) { const at = slot * this.width + BASE, s = this.state; return { active: !!s[at + F.active], modes: this.profile.count, excitationMode: this.profile.excitationMode,
    injectedEnergy: this.profile.excitationMode ? null : s[at + F.energy], energyBudget: this.profile.excitationMode ? null : this.profile.energyBudget, maximumObservedInputPeak: this.profile.excitationMode ? s[at + F.energy] : null,
    calibrationExceeded: !!s[at + F.overflow], remainingTailFrames: s[at + F.deadline] === Number.MAX_SAFE_INTEGER ? null : Math.max(0, s[at + F.deadline] - frame), policy: this.profile.policy }; }
  validate(slot, read, parent = null) {
    const p = this.profile, at = slot * this.width + BASE, get = field => read(at + field);
    for (let field = 0; field < this.width - BASE; field++) if (!Number.isFinite(get(field))) throw new Error('Nonfinite graft body state.');
    if (!get(F.frequency)) { for (let field = 0; field < this.width - BASE; field++) if (get(field)) throw new Error('Inactive graft state is noncanonical.'); return; }
    for (let field = CONTROLS + 8 * STRIDE; field < this.width - BASE; field++) if (get(field)) throw new Error('Reserved graft state is noncanonical.');
    if (!integer(get(F.releaseFrame), 0) || !get(F.released) && get(F.releaseFrame) !== 0 || get(F.released) && (get(F.releaseFrame) < get(F.start) || get(F.deadline) > get(F.releaseFrame) + p.maximumTailFrames) ||
        !p.excitationMode && get(F.deadline) > get(F.start) + p.supportFrames + p.maximumTailFrames || p.excitationMode && !get(F.released) && get(F.deadline) !== Number.MAX_SAFE_INTEGER ||
        parent && (get(F.released) !== Number(parent.released) || get(F.released) && get(F.releaseFrame) !== parent.releaseFrame) || !finite(get(F.pickup), 0, 1) || !finite(get(F.baseT60), 0.02, 2.5) || !finite(get(F.damping), 0, 1) || Math.abs(get(F.t60) - get(F.baseT60) * (1 - 0.9 * get(F.damping))) > 1e-12) throw new Error('Invalid prepared graft onset controls or release frontier.');
    if (![F.active, F.released, F.overflow].every(field => [0, 1].includes(get(field))) || !integer(get(F.start), 0) || !integer(get(F.deadline), get(F.start)) ||
        !integer(get(F.forceFrame), 0) || !integer(get(F.forceFrames), 0, p.sampleRate * 4) || !finite(get(F.mix), 0, 1) || !finite(get(F.excite), 0, 1) ||
        !finite(get(F.energy), 0, p.accumulatorBound) || ![F.oldL, F.oldR, F.dcL, F.dcR].every(field => finite(get(field), -4, 4))) throw new Error('Invalid graft calibration or lifetime state.');
    if (!finite(get(F.frequency), 0.1, p.sampleRate * 0.4) || !finite(get(F.t60), 0.002 - 1e-15, 2.5)) throw new Error('Invalid active graft register or amplitude T60.');
    let observedL1 = 0;
    for (let index = 0; index < 8; index++) {
      const row = CONTROLS + index * STRIDE;
      if (!get(F.active) || index >= p.count) { for (let field = 0; field < STRIDE; field++) if (get(row + field)) throw new Error('Unused graft modal state is noncanonical.'); continue; }
      const a = get(row + 4), b = get(row + 5), angle = 2 * Math.PI * get(F.frequency) * p.modes[index].ratio / p.sampleRate, radius = Math.exp(-Math.log(1000) / (get(F.t60) * p.modes[index].t60Scale * p.sampleRate));
      const injection = p.excitationMode ? (1 - radius) / (2 * Math.SQRT2 * p.inputPeakBound) : Math.sqrt(Math.max(0, 1 - radius * radius) / p.energyBudget);
      if (Math.abs(a - radius * Math.cos(angle)) > 1e-12 || Math.abs(b - radius * Math.sin(angle)) > 1e-12 || Math.abs(get(row + 7) - injection) > 1e-12 || Math.abs(get(row + 6) - (p.modes[index].pickupA + (p.modes[index].pickupB - p.modes[index].pickupA) * get(F.pickup)) / p.maximumL1) > 1e-12 || !finite(get(row + 6), -1, 1) || Math.hypot(get(row), get(row + 1), get(row + 2), get(row + 3)) > 1.000001) throw new Error('Graft modal state exceeds its contraction/energy profile.');
      observedL1 += Math.abs(get(row + 6));
    }
    if (observedL1 > 1.000001) throw new Error('Graft observation exceeds its signed L1 bound.');
  }
}
