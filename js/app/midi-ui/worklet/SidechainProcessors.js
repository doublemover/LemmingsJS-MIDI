import { EnvelopeFollowerKernel } from './EnvelopeFollowerKernel.js';
import { EnvelopeMappingKernel } from './EnvelopeMappingKernel.js';
import { ENVELOPE_DETECTOR_REVISION } from '../../../midi/content/EnvelopeDetectorProfile.js';
import { ENVELOPE_MAPPING_REVISION } from '../../../midi/content/EnvelopeMappingProfile.js';
import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
class SidechainProcessorBase extends ProcessorBase {
  initialize(options, mapping) {
    this.mapping = mapping; this.revision = mapping ? ENVELOPE_MAPPING_REVISION : ENVELOPE_DETECTOR_REVISION;
    this.kernel = mapping ? new EnvelopeMappingKernel({ sampleRate: globalThis.sampleRate, parameters: options?.processorOptions?.parameters }) : new EnvelopeFollowerKernel({ sampleRate: globalThis.sampleRate, parameters: options?.processorOptions?.parameters });
    this.disposed = false; this.sourceOverride = null; this.sourceEpoch = options?.processorOptions?.sourceEpoch ?? 0;
    this.lastInspect = -Infinity; this.reportedFaults = 0; this.faultMessage = { type: 'effect-fault', revision: this.revision, frame: 0, faults: 0 };
    const stateBytes = this.kernel.state.byteLength + (this.kernel.lookup?.byteLength || 0);
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: options?.processorOptions?.offlineEndFrame ?? null,
      sampleRate: globalThis.sampleRate, revision: this.revision, stateBytes, configurationKey: this.kernel.identity, port: this.port });
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
      else if (this.disposed) return;
      else if (data?.type === 'panic') this.kernel.panic();
      else if (data?.type === 'source-status' && !this.mapping && data.sourceEpoch === this.sourceEpoch && typeof data.present === 'boolean') this.sourceOverride = data.present;
      else if (data?.type === 'inspect' && this.kernel.frame - this.lastInspect >= globalThis.sampleRate / 4) {
        this.lastInspect = this.kernel.frame; this.port.postMessage({ type: 'effect-health', revision: this.revision, frame: this.kernel.frame,
          output: this.kernel.output, sourceAvailable: this.mapping ? null : this.kernel.sourceAvailable, faults: this.kernel.faults, muted: this.kernel.muted });
      }
    };
    this.port.postMessage({ type: 'ready', revision: this.revision, sampleRate: globalThis.sampleRate, stateBytes, configurationKey: this.kernel.identity });
  }
  process(inputs, outputs) {
    const output = outputs[0]?.[0]; if (!output) return true;
    if (this.disposed) { output.fill(0); return false; }
    const left = inputs[0]?.[0], right = inputs[0]?.[1] || left, available = this.sourceOverride ?? Boolean(left);
    for (let i = 0; i < output.length; i++) {
      if (this.mapping) this.kernel.sample(left?.[i] ?? 0); else this.kernel.sample(left?.[i] ?? 0, right?.[i] ?? 0, available);
      output[i] = this.kernel.output;
    }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + output.length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, output.length, this.kernel.faults, this.kernel.muted); return true;
  }
}
export class EnvelopeFollowerProcessor extends SidechainProcessorBase { constructor(options) { super(); this.initialize(options, false); } }
export class EnvelopeMappingProcessor extends SidechainProcessorBase { constructor(options) { super(); this.initialize(options, true); } }
if (typeof globalThis.registerProcessor === 'function') {
  globalThis.registerProcessor('lemmings-envelope-follower-v1', EnvelopeFollowerProcessor);
  globalThis.registerProcessor('lemmings-envelope-gain-map-v1', EnvelopeMappingProcessor);
}
