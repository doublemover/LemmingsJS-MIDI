import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { OwnedSampleSource } from './OwnedSampleSource.js';
import { SAMPLE_LAYOUT } from '../OwnedSourceLayout.js';

export class OwnedSampleKernel extends OwnedSineKernel {
  constructor(rate, pcm, patch, voices = patch?.voicePolicy?.maxVoices ?? SAMPLE_LAYOUT.voices, sourceBank = null) {
    super(rate, voices, { width: SAMPLE_LAYOUT.width, source: new OwnedSampleSource(rate, pcm, patch, voices, sourceBank) });
  }
}
export class OwnedSampleProcessor extends OwnedSineProcessor {
  createKernel(rate, voices, options) { return new OwnedSampleKernel(rate, options?.pcm, options?.samplePatch, Math.min(voices, SAMPLE_LAYOUT.voices), options?.sourceBank); }
  runtimeIdentity() { return { engineId: 'worklet-sample', engineVersion: 1, runtimeABI: 'owned-sample-f64-command-v2', buildId: 'owned-sample-v7-bounded-voice-capacity',
    sourceBankHash: this.kernel.source.bank.hash, pcmBankHash: this.kernel.source.descriptor.bankHash, samplePlanIdentity: this.kernel.source.plan.identity }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-sample-v1', OwnedSampleProcessor);
