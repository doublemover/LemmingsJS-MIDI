import './PairedModalBodyProcessor.js';
import './RectangularMembraneProcessor.js';
import './SympatheticNetworkProcessor.js';
import './SpectralFreezeProcessor.js';
import './AllpassNotchProcessor.js';
import './SidechainProcessors.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';
import './NonlinearChainProcessor.js';
import './FixedFractionalDelayProcessor.js';
import { createOwnedEffectState } from './OwnedEffectState.js';
import { DELAY_KERNEL_REVISION } from '../../../midi/content/EffectRuntimeRevisions.js';
export { DELAY_KERNEL_REVISION } from '../../../midi/content/EffectRuntimeRevisions.js';

const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class BoundedDelayKernel {
  constructor({ sampleRate, maxDelayFrames, delayFrames, mode = 'glide', transitionFrames = 128, maximumSlew = 0.25, feedback = 0.3,
    feedbackMaximum = 0.7, feedbackLowpassHz = 6000, feedbackHighpassHz = 120, wet = 0.2, interpolation = 'linear', jumpPolicy = 'reject' } = {}) {
    if (!Number.isSafeInteger(sampleRate) || !finite(sampleRate, 8000, 192000) || !Number.isSafeInteger(maxDelayFrames) || !finite(maxDelayFrames, 2, sampleRate * 3) ||
        !['linear', 'lagrange3'].includes(interpolation) || !['reject', 'coalesce-latest'].includes(jumpPolicy) || interpolation === 'lagrange3' && feedbackMaximum > 0.35 || !finite(delayFrames, interpolation === 'lagrange3' ? 2 : 1, maxDelayFrames) || !['glide', 'jump'].includes(mode) || !Number.isSafeInteger(transitionFrames) ||
        !finite(transitionFrames, 2, sampleRate * 0.2) || !finite(maximumSlew, 0.00001, 0.25) || !finite(feedbackMaximum, 0, 0.7) || !finite(feedback, -feedbackMaximum, feedbackMaximum) || !finite(wet, 0, 1) ||
        !finite(feedbackLowpassHz, 200, sampleRate * 0.4) || !finite(feedbackHighpassHz, 20, Math.min(1000, feedbackLowpassHz))) throw new TypeError('Invalid bounded delay profile.');
    this.interpolation = interpolation; this.minimumDelayFrames = interpolation === 'lagrange3' ? 2 : 1; this.jumpPolicy = jumpPolicy; this.pendingDelay = 0; this.coalescedTransitions = 0;
    this.sampleRate = sampleRate; this.maxDelayFrames = maxDelayFrames; this.mode = mode; this.transitionFrames = transitionFrames; this.maximumSlew = maximumSlew;
    this.stride = maxDelayFrames + 4; this.buffer = new Float32Array(this.stride * 2); this.filter = new Float64Array(6);
    this.write = 0; this.frame = 0; this.delay = delayFrames; this.targetDelay = delayFrames; this.oldDelay = delayFrames; this.transition = 0;
    this.feedbackMaximum = feedbackMaximum; this.feedback = feedback; this.wet = wet; this.slew = 1 - Math.exp(-1 / (0.008 * sampleRate));
    this.feedbackLowpassHz = feedbackLowpassHz; this.lp = this.targetLowpass = 1 - Math.exp(-2 * Math.PI * feedbackLowpassHz / sampleRate); this.hp = Math.exp(-2 * Math.PI * feedbackHighpassHz / sampleRate);
    this.faults = 0; this.rejectedTransitions = 0; this.leftSample = 0; this.rightSample = 0; this.muted = false; this.inputEnabled = true;
    const configuration = { revision: DELAY_KERNEL_REVISION, sampleRate, maxDelayFrames, delayFrames, mode, transitionFrames, maximumSlew, feedback, feedbackMaximum, feedbackLowpassHz, feedbackHighpassHz, wet, interpolation, jumpPolicy };
    this.stateIdentity = JSON.stringify(configuration);
    const numberFields = ['write', 'frame', 'delay', 'targetDelay', 'oldDelay', 'transition', 'feedback', 'wet', 'lp', 'targetLowpass', 'feedbackLowpassHz', 'faults', 'rejectedTransitions', 'pendingDelay', 'coalescedTransitions', 'leftSample', 'rightSample'];
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.stateIdentity, arrays: [this.buffer, this.filter],
      scalars: [...numberFields.map(name => ({ name, type: 'number' })), ...['muted', 'inputEnabled'].map(name => ({ name, type: 'boolean' }))],
      validate: ({ named, planes }) => {
        const integer = (name, lo, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(named(name)) && finite(named(name), lo, hi);
        if (!integer('write', 0, this.stride - 1) || !integer('frame', 0) || !integer('transition', 0, this.transitionFrames) || !integer('faults', 0) || !integer('rejectedTransitions', 0) || !integer('coalescedTransitions', 0) || !(named('pendingDelay') === 0 || this.mode === 'jump' && named('transition') > 0 && this.jumpPolicy === 'coalesce-latest' && finite(named('pendingDelay'), this.minimumDelayFrames, this.maxDelayFrames)) ||
            !['delay', 'targetDelay', 'oldDelay'].every(name => finite(named(name), this.minimumDelayFrames, this.maxDelayFrames)) || !finite(named('feedback'), -this.feedbackMaximum, this.feedbackMaximum) || !finite(named('wet'), 0, 1) ||
            !finite(named('lp'), 0, 1) || !finite(named('targetLowpass'), 0, 1) || !finite(named('feedbackLowpassHz'), 200, this.sampleRate * 0.4) ||
            Math.abs(named('targetLowpass') - (1 - Math.exp(-2 * Math.PI * named('feedbackLowpassHz') / this.sampleRate))) > Number.EPSILON * 4 ||
            !finite(named('leftSample'), -64, 64) || !finite(named('rightSample'), -64, 64) || this.mode === 'glide' && named('transition') !== 0) throw new TypeError('Invalid delay state frontier.');
        for (const plane of planes) for (let i = 0; i < plane.array.length; i++) if (Math.abs(plane.read(i)) > 32) throw new TypeError('Delay history exceeds its containment domain.');
      } });
  }
  stateByteLength() { return this.stateTransfer.byteLength; }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
  setDelay(value) {
    if (!finite(value, this.minimumDelayFrames, this.maxDelayFrames)) return false;
    if (value === this.targetDelay) { if (this.jumpPolicy === 'coalesce-latest') this.pendingDelay = 0; return true; }
    if (this.mode === 'jump' && this.transition) { if (this.jumpPolicy === 'coalesce-latest') { this.pendingDelay = value; this.coalescedTransitions++; return true; } this.rejectedTransitions++; return false; }
    this.targetDelay = value;
    if (this.mode === 'jump') { this.oldDelay = this.delay; this.transition = this.transitionFrames; }
    return true;
  }
  setFeedbackLowpassHz(value) {
    if (!finite(value, 200, this.sampleRate * 0.4)) return false;
    if (value !== this.feedbackLowpassHz) { this.feedbackLowpassHz = value; this.targetLowpass = 1 - Math.exp(-2 * Math.PI * value / this.sampleRate); } return true;
  }
  read(channel, delay) {
    let cursor = this.write - delay; if (cursor < 0) cursor += this.stride;
    const first = Math.floor(cursor), fraction = cursor - first, base = channel * this.stride, second = first + 1 === this.stride ? 0 : first + 1;
    if (this.interpolation === 'lagrange3') {
      const before = first === 0 ? this.stride - 1 : first - 1, after = second + 1 === this.stride ? 0 : second + 1, f = fraction;
      return this.buffer[base + before] * (-f * (1 - f) * (2 - f) / 6) + this.buffer[base + first] * ((1 + f) * (1 - f) * (2 - f) / 2) +
        this.buffer[base + second] * ((1 + f) * f * (2 - f) / 2) - this.buffer[base + after] * ((1 + f) * f * (1 - f) / 6);
    }
    return this.buffer[base + first] + (this.buffer[base + second] - this.buffer[base + first]) * fraction;
  }
  clear() { this.buffer.fill(0); this.filter.fill(0); this.transition = 0; this.pendingDelay = 0; this.delay = this.targetDelay; this.oldDelay = this.delay; this.leftSample = this.rightSample = 0; }
  panic() { this.clear(); this.muted = true; this.inputEnabled = false; }
  sample(left, right, feedback = this.feedback, wet = this.wet) {
    if (!Number.isFinite(left) || !Number.isFinite(right) || !finite(feedback, -this.feedbackMaximum, this.feedbackMaximum) || !finite(wet, 0, 1)) { this.faults++; this.panic(); this.frame++; return; }
    this.feedback += (feedback - this.feedback) * this.slew; this.wet += (wet - this.wet) * this.slew; this.lp += (this.targetLowpass - this.lp) * this.slew;
    if (this.mode === 'glide') this.delay += clamp(this.targetDelay - this.delay, -this.maximumSlew, this.maximumSlew);
    const blend = this.transition ? (this.transitionFrames - this.transition + 1) / this.transitionFrames : 1;
    for (let channel = 0; channel < 2; channel++) {
      const input = this.inputEnabled ? channel ? right : left : 0;
      const delayed = this.transition ? this.read(channel, this.oldDelay) * (1 - blend) + this.read(channel, this.targetDelay) * blend : this.read(channel, this.delay);
      const at = channel * 3, low = this.filter[at] + (delayed - this.filter[at]) * this.lp;
      const high = low - this.filter[at + 1] + this.hp * this.filter[at + 2], stored = input + high * this.feedback;
      if (!Number.isFinite(stored) || !Number.isFinite(delayed) || Math.abs(stored) > 32 || Math.abs(high) > 32) { this.faults++; this.panic(); this.frame++; return; }
      this.filter[at] = Math.abs(low) < 1e-20 ? 0 : low; this.filter[at + 1] = low; this.filter[at + 2] = Math.abs(high) < 1e-20 ? 0 : high;
      this.buffer[channel * this.stride + this.write] = Math.abs(stored) < 1e-20 ? 0 : stored;
      const output = this.muted ? 0 : input * (1 - this.wet) + delayed * this.wet;
      if (channel) this.rightSample = output; else this.leftSample = output;
    }
    if (this.transition && --this.transition === 0) { this.delay = this.targetDelay; if (this.pendingDelay) { const next = this.pendingDelay; this.pendingDelay = 0; this.setDelay(next); } }
    if (++this.write === this.stride) this.write = 0; this.frame++;
  }
  diagnostics() { return { revision: DELAY_KERNEL_REVISION, frame: this.frame, delayFrames: this.delay, targetDelayFrames: this.targetDelay, mode: this.mode, interpolation: this.interpolation, interpolationOrder: this.interpolation === 'lagrange3' ? 3 : 1, minimumDelayFrames: this.minimumDelayFrames, jumpPolicy: this.jumpPolicy, pendingDelayFrames: this.pendingDelay, coalescedTransitions: this.coalescedTransitions,
    transitionRemainingFrames: this.transition, transitionGainLaw: 'linear-correlated-unity-sum', maximumDelaySlewFramesPerSample: this.maximumSlew,
    interpolationSupportFrames: this.interpolation === 'lagrange3' ? 4 : 2, interpolationMaximumL1: this.interpolation === 'lagrange3' ? 1.25 : 1, feedbackBound: this.feedbackMaximum, stateAmplitudeFaultBound: 32, stateBytes: this.buffer.byteLength + this.filter.byteLength,
    processingLatencyFrames: 0, intentionalDelayFrames: this.delay, faults: this.faults, rejectedTransitions: this.rejectedTransitions,
    feedbackLowpassHz: this.feedbackLowpassHz, feedbackToneSmoothing: '8ms-one-pole-in-coefficient-domain',
    muted: this.muted, inputEnabled: this.inputEnabled, quality: 'implementation-awaiting-alias-impulse-and-cost-qualification' }; }
}

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class BoundedDelayProcessor extends ProcessorBase {
  static get parameterDescriptors() { return [{ name: 'delayFrames', defaultValue: 9600, minValue: 1, maxValue: 576000, automationRate: 'a-rate' },
    { name: 'feedback', defaultValue: 0.3, minValue: -0.7, maxValue: 0.7, automationRate: 'a-rate' }, { name: 'wet', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
    { name: 'feedbackLowpassHz', defaultValue: 6000, minValue: 200, maxValue: 76800, automationRate: 'k-rate' }]; }
  constructor(options) {
    super(); this.kernel = new BoundedDelayKernel({ ...options?.processorOptions, sampleRate: globalThis.sampleRate });
    this.reportedFaults = 0; this.faultMessage = { type: 'delay-fault', revision: DELAY_KERNEL_REVISION, frame: 0, faults: 0 }; this.lastRequestedDelay = this.kernel.targetDelay; this.disposed = false; this.lastInspect = -Infinity; this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
      else if (this.disposed) return;
      else if (data?.type === 'panic') this.kernel.panic();
      else if (data?.type === 'bypass' && ['active', 'neutral', 'tail', 'mute'].includes(data.mode)) {
        this.kernel.inputEnabled = data.mode === 'active'; this.kernel.muted = data.mode === 'mute';
        if (data.mode === 'neutral') this.kernel.clear();
        // The host owns neutral dry routing and tail-only wet routing.
      } else if (data?.type === 'inspect' && this.kernel.frame - this.lastInspect >= globalThis.sampleRate / 4) {
        this.lastInspect = this.kernel.frame; this.port.postMessage({ type: 'delay-health', ...this.kernel.diagnostics() });
      }
    };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: options?.processorOptions?.offlineEndFrame ?? null,
      sampleRate: globalThis.sampleRate, revision: DELAY_KERNEL_REVISION, stateBytes: this.kernel.buffer.byteLength + this.kernel.filter.byteLength, configurationKey: null, port: this.port });
    this.port.postMessage({ type: 'ready', revision: DELAY_KERNEL_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.buffer.byteLength + this.kernel.filter.byteLength });
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0]; if (!output?.[0]) return true;
    if (this.disposed) { for (const channel of output) channel.fill(0); return false; }
    const input = inputs[0], left = input?.[0], right = input?.[1] || left, kernel = this.kernel;
    if (parameters.feedbackLowpassHz && !kernel.setFeedbackLowpassHz(parameters.feedbackLowpassHz[0])) { kernel.faults++; kernel.panic(); }
    for (let i = 0; i < output[0].length; i++) {
      const requestedDelay = parameters.delayFrames.length === 1 ? parameters.delayFrames[0] : parameters.delayFrames[i];
      if (requestedDelay !== this.lastRequestedDelay) { kernel.setDelay(requestedDelay); this.lastRequestedDelay = requestedDelay; }
      kernel.sample(left?.[i] ?? 0, right?.[i] ?? 0, parameters.feedback.length === 1 ? parameters.feedback[0] : parameters.feedback[i], parameters.wet.length === 1 ? parameters.wet[0] : parameters.wet[i]);
      output[0][i] = kernel.leftSample; if (output[1]) output[1][i] = kernel.rightSample;
    }
    if (kernel.faults !== this.reportedFaults) { this.reportedFaults = kernel.faults; this.faultMessage.frame = globalThis.currentFrame + output[0].length; this.faultMessage.faults = kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, output[0].length, this.kernel.faults, this.kernel.muted);
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-bounded-delay-v1', BoundedDelayProcessor);
