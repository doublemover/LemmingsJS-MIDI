import { validTextureBodyCommand } from '../../../midi/content/TextureBodyProfile.js';
import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { SpatialTextureKernel } from './SpatialTextureKernel.js';
import { TEXTURE_EXCITER_LIMITS as LIMITS, TEXTURE_EXCITER_REVISION } from '../../../midi/content/TextureExciter.js';
import { TEXTURE_LAYOUT, textureSourceBytes } from '../OwnedSourceLayout.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export class OwnedTextureSource {
  constructor(rate, voices = TEXTURE_LAYOUT.voices) {
    textureSourceBytes(rate, voices); this.rate = rate; this.voices = voices; this.stereo = true; this.maxUpdateMask = 71;
    this.state = new Float64Array(voices * LIMITS.state); this.modes = new Float64Array(voices * LIMITS.modes * LIMITS.modeWidth); this.observation = new Float64Array(voices * LIMITS.modes); this.pulses = new Float64Array(voices * LIMITS.pulses * LIMITS.pulseWidth); this.admission = new Float64Array([-1, 0]);
    this.children = Array.from({ length: voices }, (_, slot) => new SpatialTextureKernel(rate, { state: this.state.subarray(slot * LIMITS.state, (slot + 1) * LIMITS.state), modes: this.modes.subarray(slot * LIMITS.modes * LIMITS.modeWidth, (slot + 1) * LIMITS.modes * LIMITS.modeWidth),
      observation: this.observation.subarray(slot * LIMITS.modes, (slot + 1) * LIMITS.modes), pulses: this.pulses.subarray(slot * LIMITS.pulses * LIMITS.pulseWidth, (slot + 1) * LIMITS.pulses * LIMITS.pulseWidth), admission: this.admission })); this.leftSample = this.rightSample = 0;
  }
  begin(slot, frequency, command, frame) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.voices || !finite(frequency, 20, 2000) || ![0, 1].includes(command[38]) || !validTextureBodyCommand(command, frequency, this.rate)) return 0;
    const from = command[38] ? command[36] * 128 : 0, to = command[38] ? command[37] * 128 : 0, first = command[38] ? command[34] : frame, end = command[38] ? command[35] : frame + 1;
    if (!this.children[slot].begin(command[19], command[18], command[20], command[21], command[22], command[23], from, to, first, end, frame)) return 0;
    if (!this.children[slot].configureExternalBody(command, frequency)) return 0;
    const s = this.children[slot].state; s[31] = frequency; s[36] = command[5]; s[37] = command[0]; s[38] = command[17]; return 1;
  }
  validFrequency(slot, frequency) { return frequency === this.state[slot * LIMITS.state + 31]; }
  validUpdate(slot, mask, command) {
    if (mask & ~71) return false; if (!(mask & 64)) return true;
    const s = this.children[slot].state, first = command[1], end = first + command[27];
    return !s[7] && this.children[slot].validSpan(command[25] * 128, command[26] * 128, first, end) && first >= s[12] && Math.abs(command[25] * 128 - s[10]) <= 1e-5;
  }
  applyUpdate(slot, mask, command) { if (mask & 64 && !this.children[slot].setSpan(command[25] * 128, command[26] * 128, command[1], command[1] + command[27])) throw new Error('Prepared texture travel changed before application.'); }
  release(slot, _frames, frame) { this.children[slot].end(frame); }
  retire(slot) { this.children[slot].clear(); }
  sample(slot, _frequency, frame) { const child = this.children[slot]; child.sample(frame); this.leftSample = child.leftSample; this.rightSample = child.rightSample; return (this.leftSample + this.rightSample) * 0.5; }
  diagnostics() { return { kind: 'owned-spatial-texture', revision: TEXTURE_EXCITER_REVISION, restoration: 'exactSnapshot;pcm-equivalence-qualification-pending', pulseSlotsPerVoice: LIMITS.pulses, maximumBirthsPer128Frames: LIMITS.birthsPer128Frames,
    birthBucket: this.admission[0], bucketBirths: this.admission[1], voices: this.children.map((child, slot) => child.state[0] ? ({ slot, seed: child.state[1], kind: child.state[2], signedPositionPixels: child.state[8], lastOutputFrame: child.state[13], requestedChildren: child.state[24], rejectedChildren: child.state[25], peak: child.state[23], inputEnergy: child.state[34], outputEnergy: child.state[35], externalBodyModes: child.state[42], bodyInputStopped: !!child.state[45], maximumBodyInputPeak: child.state[46], fixedBodyRootHz: child.state[47] }) : null).filter(Boolean) }; }
}
export class OwnedTextureKernel extends OwnedSineKernel {
  constructor(rate, voices = TEXTURE_LAYOUT.voices) { super(rate, voices, { width: TEXTURE_LAYOUT.width, source: new OwnedTextureSource(rate, voices) }); }
}
export class OwnedTextureProcessor extends OwnedSineProcessor {
  createKernel(rate, voices) { return new OwnedTextureKernel(rate, Math.min(voices, TEXTURE_LAYOUT.voices)); }
  runtimeIdentity() { return { engineId: 'worklet-texture', engineVersion: 1, runtimeABI: 'owned-texture-f64-command-v2', buildId: 'owned-texture-v3-state-cut', restoration: 'exactSnapshot' }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-texture-v1', OwnedTextureProcessor);
