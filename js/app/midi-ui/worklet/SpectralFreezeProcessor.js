import { SpectralFreezeKernel } from './SpectralFreezeKernel.js';
import { SPECTRAL_FREEZE_REVISION } from '../../../midi/content/SpectralFreezeProfile.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class SpectralFreezeProcessor extends ProcessorBase {
  static get parameterDescriptors() { return [{ name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' }]; }
  constructor(options) {
    super(); const p = options?.processorOptions || {};
    this.kernel = new SpectralFreezeKernel({ sampleRate: globalThis.sampleRate, parameters: p.parameters, startFrame: globalThis.currentFrame || 0, sourceAvailable: p.sourceAvailable ?? true });
    this.captureFlights = new Float64Array(4);
    this.started = false; this.disposed = false; this.sourceEpoch = p.sourceEpoch ?? 0; this.reportedFaults = this.reportedCapture = 0; this.inspectedAt = -Infinity;
    this.faultMessage = { type: 'effect-fault', revision: SPECTRAL_FREEZE_REVISION, frame: 0, faults: 0 };
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
      else if (!this.disposed && message?.type === 'spectral-capture-consumed' && message.sourceEpoch === this.sourceEpoch && Number.isSafeInteger(message.serial) && message.serial > 0) { for (let index = 0; index < this.captureFlights.length; index++) if (this.captureFlights[index] === message.serial) { this.captureFlights[index] = 0; break; } }
      else if (!this.disposed && message?.type === 'panic') this.kernel.panic();
      else if (!this.disposed && message?.type === 'source-status' && message.sourceEpoch === this.sourceEpoch && typeof message.present === 'boolean') this.kernel.sourceAvailable = message.present;
      else if (!this.disposed && message?.type === 'inspect' && this.kernel.frame - this.inspectedAt >= globalThis.sampleRate / 4) { this.inspectedAt = this.kernel.frame; this.port.postMessage({ type: 'effect-health', ...this.kernel.diagnostics() }); }
    };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: p.offlineEndFrame ?? null, sampleRate: globalThis.sampleRate, revision: SPECTRAL_FREEZE_REVISION,
      stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity, port: this.port });
    this.port.postMessage({ type: 'ready', revision: SPECTRAL_FREEZE_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity });
  }
  process(inputs, outputs, parameters) {
    const left = outputs[0]?.[0], right = outputs[0]?.[1]; if (!left || !right) return true;
    if (this.disposed) { left.fill(0); right.fill(0); return false; }
    if (!this.started) { this.kernel.frame = globalThis.currentFrame; this.started = true; }
    const a = inputs[0]?.[0], b = inputs[0]?.[1] || a, hold = parameters.hold;
    for (let index = 0; index < left.length; index++) { this.kernel.sample(a?.[index] ?? 0, b?.[index] ?? 0, hold[hold.length === 1 ? 0 : index]); left[index] = this.kernel.leftSample; right[index] = this.kernel.rightSample; }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + left.length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    if (!this.kernel.muted && this.kernel.captureSerial !== this.reportedCapture) {
      this.reportedCapture = this.kernel.captureSerial; const slot = this.captureFlights.indexOf(0);
      if (slot < 0) { this.kernel.faults++; this.kernel.panic(); left.fill(0); right.fill(0); this.faultMessage.frame = this.kernel.frame; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); this.reportedFaults = this.kernel.faults; }
      else { this.captureFlights[slot] = this.kernel.captureSerial; this.port.postMessage({ type: 'spectral-capture', sourceEpoch: this.sourceEpoch, capture: this.kernel.captureReceipt() }); }
    }
    this.offlineCompletion.observe(globalThis.currentFrame, left.length, this.kernel.faults, this.kernel.muted); return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-spectral-freeze-v1', SpectralFreezeProcessor);
