import { OwnedSealedBody } from './OwnedSealedBody.js';
import { WIND_MODEL_LIMITS as L, WIND_MODEL_REVISION } from '../../../midi/content/WindModel.js';
import { WIND_LAYOUT, windSourceBytes } from '../OwnedSourceLayout.js';
import { WindModalKernel } from './WindModalKernel.js';
import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';

export class OwnedWindSource {
  constructor(rate, voices = WIND_LAYOUT.voices) {
    windSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.stereo = true; this.maxUpdateMask = 7;
    this.graft = new OwnedSealedBody(rate, voices); this.graftState = this.graft.state; this.graftParameters = this.graft.parameters; this.state = new Float64Array(voices * L.state); this.modes = new Float64Array(voices * L.modes * L.modeWidth);
    this.children = Array.from({ length: voices }, (_, slot) => new WindModalKernel(rate, { state: this.state.subarray(slot * L.state, (slot + 1) * L.state), modes: this.modes.subarray(slot * L.modes * L.modeWidth, (slot + 1) * L.modes * L.modeWidth) })); this.leftSample = this.rightSample = 0;
  }
  begin(slot, frequency, command, frame) {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.voices) return 0;
    const child = this.children[slot]; if (!child.begin(command[19], frequency, command[18], command[20], command[21], command[22], command[23], command[24], frame) || !child.setPressure(command[8])) { child.clear(); this.graft.clear(slot); return 0; }
    if (!this.graft.begin(slot, frequency, command, frame)) { child.clear(); return 0; }
    const s = child.state; s[48] = command[5]; s[49] = command[0]; s[50] = command[17]; return 1;
  }
  validFrequency(slot, frequency) { return frequency === this.children[slot].state[21]; }
  validUpdate(slot, mask) { return !(mask & ~7 || mask & 2 && this.children[slot].state[8]); }
  applyUpdate(slot, mask, command) { if (mask & 2 && !this.children[slot].setPressure(command[8])) throw new Error('Prepared wind pressure changed before application.'); }
  release(slot, _frames, frame) { this.children[slot].end(frame); this.graft.release(slot, _frames, frame); }
  retire(slot) { this.children[slot].clear(); this.graft.clear(slot); }
  rehydrateState() { this.graft.rehydrate(); }
  sample(slot, _frequency, frame) { const child = this.children[slot]; child.sample(frame); this.graft.sample(slot, frame, child.leftSample, child.rightSample); this.leftSample = this.graft.left; this.rightSample = this.graft.right; return child.state[44] ? NaN : (this.leftSample + this.rightSample) * 0.5; }
  diagnostics() { return { kind: 'owned-sealed-modal-wind', revision: WIND_MODEL_REVISION, restoration: 'exactSnapshot;kernel-cut;qualification-pending', maximumVoices: this.voices, voices: this.children.map((child, slot) => ({ slot, ...child.diagnostics(), externalBody: this.graft.diagnostics(slot, child.state[9]) })).filter(value => value.active || value.faults) }; }
}
export class OwnedWindKernel extends OwnedSineKernel {
  constructor(rate, voices = WIND_LAYOUT.voices) { super(rate, voices, { width: WIND_LAYOUT.width, source: new OwnedWindSource(rate, voices) }); }
}
export class OwnedWindProcessor extends OwnedSineProcessor {
  createKernel(rate, voices) { return new OwnedWindKernel(rate, Math.min(voices, WIND_LAYOUT.voices)); }
  runtimeIdentity() { return { engineId: 'worklet-wind', engineVersion: 1, runtimeABI: 'owned-wind-f64-command-v2', buildId: 'owned-wind-v2-sealed-outer-body', restoration: 'exactSnapshot' }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-wind-v1', OwnedWindProcessor);
