import { prepareAllpassNotchProfile, allpassLatticeCoefficient, allpassNotchIdentity, ALLPASS_NOTCH_REVISION } from '../../../midi/content/AllpassNotchProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';

export class AllpassNotchKernel {
  constructor({ sampleRate = 48000, parameters = {} } = {}) {
    this.profile = prepareAllpassNotchProfile(parameters, sampleRate); this.parameters = this.profile.parameters; this.identity = allpassNotchIdentity(this.profile);
    this.state = new Float64Array(18); this.coefficients = new Float64Array(8); this.frequencyHz = this.targetFrequencyHz = this.parameters.baseFrequencyHz;
    this.feedback = this.parameters.feedback; this.wet = this.parameters.wet01; this.frame = this.faults = 0; this.muted = false; this.leftSample = this.rightSample = 0;
    this.smoothing = 1 - Math.exp(-1 / (0.008 * sampleRate)); this.setCoefficients();
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.identity, arrays: [this.state, this.coefficients],
      scalars: [...['frequencyHz', 'targetFrequencyHz', 'feedback', 'wet', 'frame', 'faults', 'leftSample', 'rightSample'].map(name => ({ name, type: 'number' })), { name: 'muted', type: 'boolean' }], validate: data => {
        for (const name of ['frequencyHz', 'targetFrequencyHz']) if (data.named(name) < 160 || data.named(name) > 1600) throw new Error('Invalid allpass frequency state.');
        if (Math.abs(data.named('feedback')) > this.parameters.feedbackMaximum || data.named('wet') < 0 || data.named('wet') > 1) throw new Error('Invalid allpass mix state.');
        for (const name of ['frame', 'faults']) if (!Number.isSafeInteger(data.named(name)) || data.named(name) < 0) throw new Error('Invalid allpass frontier.');
        for (const name of ['leftSample', 'rightSample']) if (Math.abs(data.named(name)) > 64) throw new Error('Invalid allpass output state.');
        for (let i = 0; i < 18; i++) if (Math.abs(data.planes[0].read(i)) > 1024) throw new Error('Allpass history exceeds its containment bound.');
        for (let index = 0; index < 4; index++) {
          const expected = allpassLatticeCoefficient(data.named('frequencyHz') * this.parameters.ratio ** index, sampleRate);
          for (let field = 0; field < 2; field++) if (Math.abs(data.planes[1].read(index * 2 + field) - expected[field]) > Number.EPSILON * 16) throw new Error('Allpass reflection state differs from its declared physical frequency.');
        }
      } });
  }
  setCoefficients() {
    let frequency = this.frequencyHz;
    for (let index = 0; index < 4; index++) {
      const tangent = Math.tan(Math.PI * frequency / this.profile.sampleRate), k = (tangent - 1) / (tangent + 1);
      this.coefficients[index * 2] = k; this.coefficients[index * 2 + 1] = Math.sqrt(Math.max(0, 1 - k * k)); frequency *= this.parameters.ratio;
    }
  }
  panic() { this.state.fill(0); this.leftSample = this.rightSample = 0; this.muted = true; }
  sample(left, right, frequencyHz = this.parameters.baseFrequencyHz, feedback = this.parameters.feedback, wet = this.parameters.wet01) {
    this.frame++; this.leftSample = this.rightSample = 0; if (this.muted) return;
    if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(frequencyHz) || !Number.isFinite(feedback) || !Number.isFinite(wet) || Math.abs(left) > 32 || Math.abs(right) > 32 || frequencyHz < 160 || frequencyHz > 1600 ||
        Math.abs(feedback) > this.parameters.feedbackMaximum || wet < 0 || wet > 1) { this.faults++; this.panic(); return; }
    this.targetFrequencyHz = frequencyHz;
    if (this.frequencyHz !== frequencyHz) { this.frequencyHz += Math.max(-this.parameters.maximumSlewHzPerSample, Math.min(this.parameters.maximumSlewHzPerSample, frequencyHz - this.frequencyHz)); this.setCoefficients(); }
    this.feedback += (feedback - this.feedback) * this.smoothing; this.wet += (wet - this.wet) * this.smoothing;
    for (let channel = 0; channel < 2; channel++) {
      const input = channel ? right : left; let value = input + this.feedback * this.state[16 + channel];
      for (let stage = 0; stage < 8; stage++) {
        const at = channel * 8 + stage, coefficient = Math.floor(stage / 2) * 2, k = this.coefficients[coefficient], g = this.coefficients[coefficient + 1], previous = this.state[at];
        const output = k * value + g * previous, next = g * value - k * previous;
        if (!Number.isFinite(next) || !Number.isFinite(output) || Math.abs(next) > 1024 || Math.abs(output) > 1024) { this.faults++; this.panic(); return; }
        this.state[at] = Math.abs(next) < 1e-24 ? 0 : next; value = output;
      }
      this.state[16 + channel] = value; const output = input * (1 - this.wet) + value * this.wet;
      if (!Number.isFinite(output) || Math.abs(output) > 64) { this.faults++; this.panic(); return; }
      if (channel) this.rightSample = output; else this.leftSample = output;
    }
  }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
  get snapshotBytes() { return this.stateTransfer.byteLength; }
}

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class AllpassNotchProcessor extends ProcessorBase {
  static get parameterDescriptors() { return [{ name: 'frequencyHz', defaultValue: 640, minValue: 160, maxValue: 1600, automationRate: 'a-rate' },
    { name: 'feedback', defaultValue: 0.1, minValue: -0.25, maxValue: 0.25, automationRate: 'a-rate' }, { name: 'wet', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' }]; }
  constructor(options) {
    super(); this.kernel = new AllpassNotchKernel({ sampleRate: globalThis.sampleRate, parameters: options?.processorOptions?.parameters }); this.disposed = false; this.reportedFaults = 0;
    this.faultMessage = { type: 'effect-fault', revision: ALLPASS_NOTCH_REVISION, frame: 0, faults: 0 };
    this.port.onmessage = event => { if (event.data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
    else if (!this.disposed && event.data?.type === 'panic') this.kernel.panic(); };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: options?.processorOptions?.offlineEndFrame ?? null, sampleRate: globalThis.sampleRate,
      revision: ALLPASS_NOTCH_REVISION, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity, port: this.port });
    this.port.postMessage({ type: 'ready', revision: ALLPASS_NOTCH_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity });
  }
  process(inputs, outputs, parameters) {
    const left = outputs[0]?.[0], right = outputs[0]?.[1]; if (!left || !right) return true;
    if (this.disposed) { left.fill(0); right.fill(0); return false; }
    const inputLeft = inputs[0]?.[0], inputRight = inputs[0]?.[1] || inputLeft;
    for (let frame = 0; frame < left.length; frame++) {
      this.kernel.sample(inputLeft?.[frame] ?? 0, inputRight?.[frame] ?? 0,
        parameters.frequencyHz[parameters.frequencyHz.length === 1 ? 0 : frame], parameters.feedback[parameters.feedback.length === 1 ? 0 : frame], parameters.wet[parameters.wet.length === 1 ? 0 : frame]);
      left[frame] = this.kernel.leftSample; right[frame] = this.kernel.rightSample;
    }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + left.length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, left.length, this.kernel.faults, this.kernel.muted); return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-allpass-notch-v1', AllpassNotchProcessor);
