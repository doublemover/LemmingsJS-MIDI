export const OFFLINE_EFFECT_COMPLETION_REVISION = 'owned-effect-offline-completion-v1';

// Control metadata is allocated at construction and once at the terminal block.
// Live processors take the disabled branch; sample loops allocate no receipts.
export class OfflineEffectCompletion {
  constructor({ endFrame = null, sampleRate, revision, stateBytes, configurationKey = null, port }) {
    if (endFrame !== null && (!Number.isSafeInteger(endFrame) || endFrame < 1 || endFrame > sampleRate * 150)) throw new RangeError('Invalid offline effect completion boundary.');
    this.endFrame = endFrame; this.sampleRate = sampleRate; this.revision = revision; this.stateBytes = stateBytes;
    this.configurationKey = configurationKey; this.port = port; this.firstFrame = null; this.through = 0; this.contiguous = true; this.sent = false; this.faults = 0; this.faulted = false;
  }
  observe(frame, frames, faults, faulted) {
    if (this.endFrame === null || this.sent) return;
    if (this.firstFrame === null) this.firstFrame = frame;
    if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(frames) || frames < 1 || frames > 2048 || frame !== this.through) this.contiguous = false;
    this.through = frame + frames; this.faults = Math.max(this.faults, faults); this.faulted ||= faulted;
    if (this.through < this.endFrame) return;
    this.sent = true;
    this.port.postMessage({ type: 'offline-complete', protocol: OFFLINE_EFFECT_COMPLETION_REVISION,
      revision: this.revision, sampleRate: this.sampleRate, stateBytes: this.stateBytes, configurationKey: this.configurationKey,
      endFrame: this.endFrame, firstFrame: this.firstFrame, processedThroughFrame: this.through, quantumFrames: frames,
      contiguous: this.contiguous, faults: this.faults, faulted: this.faulted });
  }
}

export function validateOfflineEffectCompletion(value, expected) {
  const allowed = ['type', 'protocol', 'revision', 'sampleRate', 'stateBytes', 'configurationKey', 'endFrame', 'firstFrame', 'processedThroughFrame', 'quantumFrames', 'contiguous', 'faults', 'faulted'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !allowed.includes(key)) ||
      value.type !== 'offline-complete' || value.protocol !== OFFLINE_EFFECT_COMPLETION_REVISION || value.revision !== expected.revision || value.sampleRate !== expected.sampleRate ||
      value.stateBytes !== expected.stateBytes || value.configurationKey !== expected.configurationKey || value.endFrame !== expected.endFrame || value.firstFrame !== 0 ||
      value.contiguous !== true || value.faults !== 0 || value.faulted !== false || !Number.isSafeInteger(value.quantumFrames) || value.quantumFrames < 1 || value.quantumFrames > 2048 ||
      !Number.isSafeInteger(value.processedThroughFrame) || value.processedThroughFrame < value.endFrame || value.processedThroughFrame >= value.endFrame + value.quantumFrames)
    throw Object.assign(new Error('Offline effect completion differs from its admitted continuous frame range or contains a processor fault.'), { code: 'offline-effect-receipt-invalid' });
  return Object.freeze({ ...value });
}
