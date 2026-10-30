import { OwnedSampleBody } from './OwnedSampleBody.js';
import { prepareSampleBodyProfile } from '../../../midi/content/SampleBodyProfile.js';
import { validTextureBodyCommand } from '../../../midi/content/TextureBodyProfile.js';

import { SEALED_BODY_STATE, SEALED_BODY_PARAMETERS, SEALED_BODY_PACKET } from '../../../midi/content/SealedBodyProfile.js';
export { SEALED_BODY_STATE, SEALED_BODY_PARAMETERS };
const makeProfile = rate => ({ sampleRate: rate, count: 0, modes: Array.from({ length: 8 }, () => ({ ratio: 1, t60Scale: 1, pickupA: 0, pickupB: 0 })), maximumL1: 1, excitationMode: 1, energyBudget: 1, supportFrames: 0, maximumTailFrames: rate * 4, dcPole: Math.exp(-2 * Math.PI * 20 / rate), outputGain: 0.4, denormalFloor: 1e-24, inputPeakBound: 1, accumulatorBound: 1, policy: 'intact-feedback-source-into-independent-private-linear-body;source-end-closes-body-input' });
export class OwnedSealedBody {
  constructor(rate, voices) {
    this.rate = rate; this.voices = voices; this.state = new Float64Array(voices * SEALED_BODY_STATE); this.parameters = new Float64Array(voices * SEALED_BODY_PARAMETERS);
    this.profiles = Array.from({ length: voices }, () => makeProfile(rate)); this.children = this.profiles.map(profile => new OwnedSampleBody(profile, this.state, SEALED_BODY_STATE, voices)); this.packets = Array.from({ length: voices }, () => new Float64Array(SEALED_BODY_PACKET)); this.left = this.right = 0;
  }
  load(slot) {
    const p = this.profiles[slot], at = slot * SEALED_BODY_PARAMETERS, count = this.parameters[at]; p.count = count; let l1 = 0;
    for (let index = 0; index < 8; index++) { const mode = p.modes[index], from = at + 6 + index * 4; mode.ratio = index < count ? this.parameters[from] : 1; mode.t60Scale = index < count ? this.parameters[from + 1] : 1; mode.pickupA = index < count ? this.parameters[from + 2] : 0; mode.pickupB = index < count ? this.parameters[from + 3] : 0; l1 += Math.max(Math.abs(mode.pickupA), Math.abs(mode.pickupB)); } p.maximumL1 = Math.max(1, l1);
  }
  begin(slot, frequency, command, frame) {
    this.clear(slot); if (!validTextureBodyCommand(command, frequency, this.rate)) return false; const count = command[40]; if (count && Math.round(command[13]) !== this.rate * 4) return false; if (!count) return true;
    const at = slot * SEALED_BODY_PARAMETERS; for (let field = 0; field < 6 + count * 4; field++) this.parameters[at + field] = command[40 + field]; this.load(slot);
    const packet = this.packets[slot]; packet[34] = command[41]; packet[35] = command[42]; packet[36] = command[43]; packet[37] = command[44]; packet[38] = command[45]; packet[39] = count; this.children[slot].begin(slot, frequency, packet, frame); return true;
  }
  sample(slot, frame, left, right) {
    const at = slot * SEALED_BODY_PARAMETERS; if (!this.parameters[at]) { this.left = left; this.right = right; return; }
    const child = this.children[slot], mix = this.parameters[at + 1]; child.sample(slot, frame, left / 32, right / 32, true);
    this.left = left * (1 - mix) + (child.left - left / 32 * (1 - mix)); this.right = right * (1 - mix) + (child.right - right / 32 * (1 - mix));
  }
  release(slot, frames, frame) { if (this.parameters[slot * SEALED_BODY_PARAMETERS]) this.children[slot].release(slot, frames, frame, false, frame + frames); }
  clear(slot) { this.children[slot].clear(slot); this.parameters.fill(0, slot * SEALED_BODY_PARAMETERS, (slot + 1) * SEALED_BODY_PARAMETERS); this.load(slot); }
  rehydrate() { for (let slot = 0; slot < this.voices; slot++) this.load(slot); }
  diagnostics(slot, frame) { return this.parameters[slot * SEALED_BODY_PARAMETERS] ? { ...this.children[slot].inspect(slot, frame), sourceInputReference: 'intact-parent-stereo-divided-by-32;dry-gain-restored-independently', feedback: 'none-to-parent-model' } : null; }
}
export function validateOwnedSealedBody({ source, arrays, active, voice }) {
  const readState = arrays[2].get, readParameters = arrays[3].get;
  for (let slot = 0; slot < source.voices; slot++) {
    const at = slot * SEALED_BODY_PARAMETERS, count = readParameters(at), base = slot * SEALED_BODY_STATE;
    if (!active(slot) || !count) { for (let index = 0; index < SEALED_BODY_PARAMETERS; index++) if (readParameters(at + index) !== 0) throw new Error('Inactive outer-body parameters are noncanonical.'); for (let index = 0; index < SEALED_BODY_STATE; index++) if (readState(base + index) !== 0) throw new Error('Inactive outer-body state is noncanonical.'); continue; }
    const command = new Float64Array(80); for (let field = 0; field < SEALED_BODY_PARAMETERS; field++) command[40 + field] = readParameters(at + field);
    if (!validTextureBodyCommand(command, voice(slot, 5), source.rate)) throw new Error('Outer-body calibration, positive modes or observation is invalid.');
    for (let index = 6 + count * 4; index < SEALED_BODY_PARAMETERS; index++) if (readParameters(at + index) !== 0) throw new Error('Unused outer-body parameters are noncanonical.');
    const parameters = { graftModeCount: count, graftExcitationMode: 1 }; for (let mode = 0; mode < count; mode++) for (const [field, name] of ['Ratio', 'T60Scale', 'PickupA', 'PickupB'].entries()) parameters['graftMode' + mode + name] = command[46 + mode * 4 + field];
    const profile = prepareSampleBodyProfile(parameters, source.rate), body = new OwnedSampleBody(profile, null, SEALED_BODY_STATE, source.voices);
    body.validate(slot, readState, { released: voice(slot, 20) !== 0, releaseFrame: voice(slot, 21) });
    if (readState(base + 49) !== voice(slot, 15) || readState(base + 62) !== voice(slot, 5) || readState(base + 54) !== command[41] || readState(base + 65) !== command[42] || readState(base + 66) !== command[43] || readState(base + 57) !== command[44] || readState(base + 64) !== command[45]) throw new Error('Outer-body onset, source pitch or controls differ from its parent and frozen parameters.');
    for (let index = 0; index < 48; index++) if (readState(base + index) !== 0) throw new Error('Outer-body prefix is noncanonical.');
  }
}
