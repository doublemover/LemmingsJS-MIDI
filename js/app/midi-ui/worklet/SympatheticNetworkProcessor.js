import { SympatheticNetworkKernel } from './SympatheticNetworkKernel.js';
import { SYMPATHETIC_NETWORK_REVISION, NETWORK_LOSS_CONTROLS, NETWORK_PICKUP_CONTROLS } from '../../../midi/content/SympatheticNetworkProfile.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';
const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class SympatheticNetworkProcessor extends ProcessorBase {
  static get parameterDescriptors() { return [{ name: 'couple', defaultValue: 0.65, minValue: 0, maxValue: 1, automationRate: 'a-rate' }, { name: 'damp', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'a-rate' }, ...NETWORK_LOSS_CONTROLS.map(name => ({ name, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' })), ...NETWORK_PICKUP_CONTROLS.map(name => ({ name, defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' }))]; }
  constructor(options) {
    super(); const p = options?.processorOptions || {}; this.kernel = new SympatheticNetworkKernel({ sampleRate: globalThis.sampleRate, parameters: p.parameters });
    this.disposed = false; this.reportedFaults = 0; this.inspectedAt = -Infinity; this.faultMessage = { type: 'effect-fault', revision: SYMPATHETIC_NETWORK_REVISION, frame: 0, faults: 0 };
    this.port.onmessage = event => { if (event.data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
    else if (!this.disposed && event.data?.type === 'panic') this.kernel.panic();
    else if (!this.disposed && event.data?.type === 'inspect' && this.kernel.frame - this.inspectedAt >= globalThis.sampleRate / 4) { this.inspectedAt = this.kernel.frame; this.port.postMessage({ type: 'effect-health', ...this.kernel.diagnostics() }); } };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: p.offlineEndFrame ?? null, sampleRate: globalThis.sampleRate, revision: SYMPATHETIC_NETWORK_REVISION,
      stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity, port: this.port });
    this.port.postMessage({ type: 'ready', revision: SYMPATHETIC_NETWORK_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.profile.stateBytes, configurationKey: this.kernel.identity });
  }
  process(inputs, outputs, parameters) {
    const left = outputs[0]?.[0], right = outputs[0]?.[1]; if (!left || !right) return true;
    if (this.disposed) { left.fill(0); right.fill(0); return false; }
    const a = inputs[0]?.[0], b = inputs[0]?.[1] || a;
    for (let index = 0; index < left.length; index++) {
      if (!this.kernel.muted) for (let mask = 0; mask < this.kernel.profile.lossMasks.length; mask++) { const values = parameters[NETWORK_LOSS_CONTROLS[mask]], amount = values[values.length === 1 ? 0 : index]; if (!Number.isFinite(amount) || amount < 0 || amount > 1) { this.kernel.faults++; this.kernel.panic(); break; } this.kernel.setLossMask(mask, amount); }
      if (!this.kernel.muted && this.kernel.profile.pickupGrid) for (let pickup = 0; pickup < NETWORK_PICKUP_CONTROLS.length; pickup++) { const name = NETWORK_PICKUP_CONTROLS[pickup], values = parameters[name], amount = values?.[values.length === 1 ? 0 : index]; if (!Number.isFinite(amount) || amount < 0 || amount > 1) { this.kernel.faults++; this.kernel.panic(); break; } this.kernel.setPickupPosition(name, amount); }
      this.kernel.sample(a?.[index] ?? 0, b?.[index] ?? 0, parameters.couple[parameters.couple.length === 1 ? 0 : index], parameters.damp[parameters.damp.length === 1 ? 0 : index]); left[index] = this.kernel.leftSample; right[index] = this.kernel.rightSample;
    }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + left.length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, left.length, this.kernel.faults, this.kernel.muted); return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-sympathetic-network-v1', SympatheticNetworkProcessor);
