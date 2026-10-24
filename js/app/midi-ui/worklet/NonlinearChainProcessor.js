import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';
import { NonlinearChainKernel } from './NonlinearChainKernel.js';
import { NONLINEAR_KERNEL_REVISION } from '../../../midi/content/NonlinearChainProfile.js';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class NonlinearChainProcessor extends ProcessorBase {
  static get parameterDescriptors() { return [{ name: 'driveDb', defaultValue: 0, minValue: 0, maxValue: 24, automationRate: 'a-rate' }, { name: 'outputTrim01', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' }]; }
  constructor(options) {
    super(); this.kernel = new NonlinearChainKernel({ parameters: options?.processorOptions?.parameters, sampleRate: globalThis.sampleRate });
    this.disposed = false; this.reportedFaults = 0; this.lastInspect = -Infinity;
    this.faultMessage = { type: 'effect-fault', revision: NONLINEAR_KERNEL_REVISION, frame: 0, faults: 0 };
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
      else if (this.disposed) return;
      else if (data?.type === 'panic') this.kernel.panic();
      else if (data?.type === 'inspect' && this.kernel.frame - this.lastInspect >= globalThis.sampleRate / 4) { this.lastInspect = this.kernel.frame; this.port.postMessage({ type: 'effect-health', ...this.kernel.diagnostics() }); }
    };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: options?.processorOptions?.offlineEndFrame ?? null,
      sampleRate: globalThis.sampleRate, revision: NONLINEAR_KERNEL_REVISION, stateBytes: this.kernel.state.byteLength, configurationKey: this.kernel.identity, port: this.port });
    this.port.postMessage({ type: 'ready', revision: NONLINEAR_KERNEL_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.state.byteLength, configurationKey: this.kernel.identity });
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0]; if (!output?.[0]) return true;
    if (this.disposed) { for (const plane of output) plane.fill(0); return false; }
    const left = inputs[0]?.[0], right = inputs[0]?.[1] || left, drive = parameters.driveDb, trim = parameters.outputTrim01;
    for (let i = 0; i < output[0].length; i++) {
      this.kernel.sample(left?.[i] ?? 0, right?.[i] ?? 0, drive.length === 1 ? drive[0] : drive[i], trim.length === 1 ? trim[0] : trim[i]);
      output[0][i] = this.kernel.leftSample; if (output[1]) output[1][i] = this.kernel.rightSample;
    }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + output[0].length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, output[0].length, this.kernel.faults, this.kernel.muted);
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-nonlinear-chain-v1', NonlinearChainProcessor);
