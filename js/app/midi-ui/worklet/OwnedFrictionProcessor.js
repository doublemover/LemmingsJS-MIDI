import { FRICTION_MODEL_LIMITS as L, FRICTION_MODEL_REVISION } from '../../../midi/content/FrictionModel.js';
import { FRICTION_LAYOUT, frictionSourceBytes } from '../OwnedSourceLayout.js';
import { FrictionModalKernel } from './FrictionModalKernel.js';
import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';

export class OwnedFrictionSource {
  constructor(rate, voices = FRICTION_LAYOUT.voices) {
    frictionSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.stereo = true; this.maxUpdateMask = 71;
    this.state = new Float64Array(voices * L.state); this.modes = new Float64Array(voices * L.modes * L.modeWidth);
    this.children = Array.from({ length: voices }, (_, slot) => new FrictionModalKernel(rate, { state: this.state.subarray(slot * L.state, (slot + 1) * L.state), modes: this.modes.subarray(slot * L.modes * L.modeWidth, (slot + 1) * L.modes * L.modeWidth) })); this.leftSample = this.rightSample = 0;
  }
  begin(slot, frequency, command, frame) {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.voices || command[38] !== 1) return 0;
    const child = this.children[slot];
    if (!child.begin(command[19], frequency, command[18], command[20], command[21], command[22], command[23], command[36] * 128, command[37] * 128, command[34], command[35], frame) || !child.setPressure(command[8])) return 0;
    const s = child.state; s[48] = command[5]; s[49] = command[0]; s[50] = command[17]; return 1;
  }
  validFrequency(slot, frequency) { return frequency === this.children[slot].state[25]; }
  validUpdate(slot, mask, command) {
    const child = this.children[slot], s = child.state;
    if (mask & ~71 || mask & 2 && s[7]) return false;
    if (!(mask & 64)) return true;
    return !s[7] && child.validSpan(command[25] * 128, command[26] * 128, command[1], command[1] + command[27]) && command[1] >= s[12] && Math.abs(command[25] * 128 - s[10]) <= 1e-5;
  }
  applyUpdate(slot, mask, command) {
    const child = this.children[slot];
    if (mask & 2 && !child.setPressure(command[8]) || mask & 64 && !child.setSpan(command[25] * 128, command[26] * 128, command[1], command[1] + command[27])) throw new Error('Prepared friction controls changed before application.');
  }
  release(slot, _frames, frame) { this.children[slot].end(frame); }
  retire(slot) { this.children[slot].clear(); }
  sample(slot, _frequency, frame) { const child = this.children[slot]; child.sample(frame); this.leftSample = child.leftSample; this.rightSample = child.rightSample; return child.state[34] ? NaN : (this.leftSample + this.rightSample) * 0.5; }
  diagnostics() { return { kind: 'owned-sealed-friction', revision: FRICTION_MODEL_REVISION, restoration: 'exactSnapshot;kernel-cut;qualification-pending', maximumVoices: this.voices, voices: this.children.map((child, slot) => ({ slot, ...child.diagnostics() })).filter(value => value.active || value.faults) }; }
}
export class OwnedFrictionKernel extends OwnedSineKernel {
  constructor(rate, voices = FRICTION_LAYOUT.voices) { super(rate, voices, { width: FRICTION_LAYOUT.width, source: new OwnedFrictionSource(rate, voices) }); }
}
export class OwnedFrictionProcessor extends OwnedSineProcessor {
  createKernel(rate, voices) { return new OwnedFrictionKernel(rate, Math.min(voices, FRICTION_LAYOUT.voices)); }
  runtimeIdentity() { return { engineId: 'worklet-friction', engineVersion: 1, runtimeABI: 'owned-friction-f64-command-v1', buildId: 'owned-friction-v1-sealed-modal', restoration: 'exactSnapshot' }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-friction-v1', OwnedFrictionProcessor);
