import { PairedModalBodyKernel } from './PairedModalBodyKernel.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';
const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class PairedModalBodyProcessor extends ProcessorBase {
  static get parameterDescriptors() { return [{ name: 'morph', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' }]; }
  createKernel(sampleRate, parameters) { return new PairedModalBodyKernel({ sampleRate, parameters }); }
  constructor(options) {
    super(); const p = options?.processorOptions || {}; this.kernel = this.createKernel(globalThis.sampleRate, p.parameters); const revision = this.kernel.profile.revision;
    this.disposed = false; this.reportedFaults = 0; this.inspectedAt = -Infinity; this.faultMessage = { type: 'effect-fault', revision, frame: 0, faults: 0 };
    this.port.onmessage = event => {
      if (event.data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
      else if (!this.disposed && event.data?.type === 'panic') this.kernel.panic();
      else if (!this.disposed && event.data?.type === 'inspect' && this.kernel.frame - this.inspectedAt >= globalThis.sampleRate / 4) { this.inspectedAt = this.kernel.frame; this.port.postMessage({ type: 'effect-health', ...this.kernel.diagnostics() }); }
    };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: p.offlineEndFrame ?? null, sampleRate: globalThis.sampleRate, revision, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity, port: this.port });
    this.port.postMessage({ type: 'ready', revision, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity });
  }
  process(inputs, outputs, parameters) {
    const left = outputs[0]?.[0], right = outputs[0]?.[1]; if (!left || !right) return true;
    if (this.disposed) { left.fill(0); right.fill(0); return false; }
    const a = inputs[0]?.[0], b = inputs[0]?.[1] || a, morph = parameters.morph;
    for (let index = 0; index < left.length; index++) { this.kernel.sample(a?.[index] ?? 0, b?.[index] ?? 0, morph?.[morph.length === 1 ? 0 : index] ?? NaN); left[index] = this.kernel.leftSample; right[index] = this.kernel.rightSample; }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + left.length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, left.length, this.kernel.faults, this.kernel.muted); return true;
  }
}
export class ResonatorBlendBodyProcessor extends PairedModalBodyProcessor { createKernel(sampleRate, parameters) { return new PairedModalBodyKernel({ sampleRate, parameters, strategy: 'blend' }); } }
if (typeof globalThis.registerProcessor === 'function') { globalThis.registerProcessor('lemmings-paired-modal-body-v1', PairedModalBodyProcessor); globalThis.registerProcessor('lemmings-resonator-blend-body-v1', ResonatorBlendBodyProcessor); }
