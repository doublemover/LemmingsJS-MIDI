import { WIND_MODEL_LIMITS as L, WIND_MODEL_REVISION } from '../../../midi/content/WindModel.js';
import { WIND_LAYOUT, windSourceBytes } from '../OwnedSourceLayout.js';
import { WindModalKernel } from './WindModalKernel.js';
import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';

export class OwnedWindSource {
  constructor(rate, voices = WIND_LAYOUT.voices) {
    windSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.stereo = true; this.maxUpdateMask = 7;
    this.state = new Float64Array(voices * L.state); this.modes = new Float64Array(voices * L.modes * L.modeWidth);
    this.children = Array.from({ length: voices }, (_, slot) => new WindModalKernel(rate, { state: this.state.subarray(slot * L.state, (slot + 1) * L.state), modes: this.modes.subarray(slot * L.modes * L.modeWidth, (slot + 1) * L.modes * L.modeWidth) })); this.leftSample = this.rightSample = 0;
  }
  begin(slot, frequency, command, frame) {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.voices) return 0;
    const child = this.children[slot]; if (!child.begin(command[19], frequency, command[18], command[20], command[21], command[22], command[23], command[24], frame) || !child.setPressure(command[8])) return 0;
    const s = child.state; s[48] = command[5]; s[49] = command[0]; s[50] = command[17]; return 1;
  }
  validFrequency(slot, frequency) { return frequency === this.children[slot].state[21]; }
  validUpdate(slot, mask) { return !(mask & ~7 || mask & 2 && this.children[slot].state[8]); }
  applyUpdate(slot, mask, command) { if (mask & 2 && !this.children[slot].setPressure(command[8])) throw new Error('Prepared wind pressure changed before application.'); }
  release(slot, _frames, frame) { this.children[slot].end(frame); }
  retire(slot) { this.children[slot].clear(); }
  sample(slot, _frequency, frame) { const child = this.children[slot]; child.sample(frame); this.leftSample = child.leftSample; this.rightSample = child.rightSample; return child.state[44] ? NaN : (this.leftSample + this.rightSample) * 0.5; }
  diagnostics() { return { kind: 'owned-sealed-modal-wind', revision: WIND_MODEL_REVISION, restoration: 'exactSnapshot;kernel-cut;qualification-pending', maximumVoices: this.voices, voices: this.children.map((child, slot) => ({ slot, ...child.diagnostics() })).filter(value => value.active || value.faults) }; }
}
export class OwnedWindKernel extends OwnedSineKernel {
  constructor(rate, voices = WIND_LAYOUT.voices) { super(rate, voices, { width: WIND_LAYOUT.width, source: new OwnedWindSource(rate, voices) }); }
}
export class OwnedWindProcessor extends OwnedSineProcessor {
  createKernel(rate, voices) { return new OwnedWindKernel(rate, Math.min(voices, WIND_LAYOUT.voices)); }
  runtimeIdentity() { return { engineId: 'worklet-wind', engineVersion: 1, runtimeABI: 'owned-wind-f64-command-v1', buildId: 'owned-wind-v1-sealed-modal', restoration: 'exactSnapshot' }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-wind-v1', OwnedWindProcessor);
