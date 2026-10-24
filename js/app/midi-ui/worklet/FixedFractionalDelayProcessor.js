import { OfflineEffectCompletion } from './OfflineEffectCompletion.js';
import { createOwnedEffectState } from './OwnedEffectState.js';
import { ALIGNMENT_KERNEL_REVISION } from '../../../midi/content/EffectRuntimeRevisions.js';

export const fixedFractionalDelayIdentity = (sampleRate, delayFrames) => JSON.stringify({ revision: ALIGNMENT_KERNEL_REVISION, sampleRate, delayFrames, interpolation: 'linear-two-tap-write-before-read' });
export class FixedFractionalDelayKernel {
  constructor({ sampleRate, delayFrames } = {}) {
    if (![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(delayFrames) || delayFrames < 0 || delayFrames > sampleRate) throw new TypeError('Invalid fixed fractional alignment profile.');
    this.sampleRate = sampleRate; this.delayFrames = delayFrames; this.stride = Math.ceil(delayFrames) + 2; this.buffer = new Float32Array(this.stride * 2);
    this.write = 0; this.frame = 0; this.faults = 0; this.muted = false; this.leftSample = this.rightSample = 0; this.stateIdentity = fixedFractionalDelayIdentity(sampleRate, delayFrames);
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.stateIdentity, arrays: [this.buffer],
      scalars: [...['write', 'frame', 'faults', 'leftSample', 'rightSample'].map(name => ({ name, type: 'number' })), { name: 'muted', type: 'boolean' }],
      validate: ({ named, planes }) => {
        for (const name of ['write', 'frame', 'faults']) if (!Number.isSafeInteger(named(name)) || named(name) < 0 || name === 'write' && named(name) >= this.stride) throw new TypeError('Invalid alignment frontier.');
        for (const name of ['leftSample', 'rightSample']) if (Math.abs(named(name)) > 32) throw new TypeError('Excessive alignment output state.');
        for (let i = 0; i < this.buffer.length; i++) if (Math.abs(planes[0].read(i)) > 32) throw new TypeError('Excessive alignment ring state.');
      } });
  }
  panic() { this.buffer.fill(0); this.leftSample = this.rightSample = 0; this.muted = true; }
  sample(left, right) {
    this.leftSample = this.rightSample = 0;
    if (this.muted) { this.frame++; return; }
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32) { this.faults++; this.panic(); this.frame++; return; }
    this.buffer[this.write] = left; this.buffer[this.stride + this.write] = right;
    let cursor = this.write - this.delayFrames; if (cursor < 0) cursor += this.stride;
    const first = Math.floor(cursor), fraction = cursor - first, second = first + 1 === this.stride ? 0 : first + 1;
    this.leftSample = this.buffer[first] + (this.buffer[second] - this.buffer[first]) * fraction;
    this.rightSample = this.buffer[this.stride + first] + (this.buffer[this.stride + second] - this.buffer[this.stride + first]) * fraction;
    if (++this.write === this.stride) this.write = 0; this.frame++;
  }
  stateByteLength() { return this.stateTransfer.byteLength; }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
}
const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
export class FixedFractionalDelayProcessor extends ProcessorBase {
  constructor(options) {
    super(); this.kernel = new FixedFractionalDelayKernel({ ...options?.processorOptions, sampleRate: globalThis.sampleRate }); this.disposed = false; this.reportedFaults = 0;
    this.faultMessage = { type: 'effect-fault', revision: ALIGNMENT_KERNEL_REVISION, frame: 0, faults: 0 };
    this.port.onmessage = event => { if (event.data?.type === 'dispose') { this.kernel.panic(); this.disposed = true; this.port.postMessage({ type: 'disposed', frame: this.kernel.frame }); }
    else if (!this.disposed && event.data?.type === 'panic') this.kernel.panic(); };
    this.offlineCompletion = new OfflineEffectCompletion({ endFrame: options?.processorOptions?.offlineEndFrame ?? null,
      sampleRate: globalThis.sampleRate, revision: ALIGNMENT_KERNEL_REVISION, stateBytes: this.kernel.buffer.byteLength, configurationKey: this.kernel.stateIdentity, port: this.port });
    this.port.postMessage({ type: 'ready', revision: ALIGNMENT_KERNEL_REVISION, sampleRate: globalThis.sampleRate, stateBytes: this.kernel.buffer.byteLength, configurationKey: this.kernel.stateIdentity });
  }
  process(inputs, outputs) {
    const output = outputs[0]; if (!output?.[0]) return true;
    if (this.disposed) { for (const plane of output) plane.fill(0); return false; }
    const left = inputs[0]?.[0], right = inputs[0]?.[1] || left;
    for (let i = 0; i < output[0].length; i++) { this.kernel.sample(left?.[i] ?? 0, right?.[i] ?? 0); output[0][i] = this.kernel.leftSample; if (output[1]) output[1][i] = this.kernel.rightSample; }
    if (this.kernel.faults !== this.reportedFaults) { this.reportedFaults = this.kernel.faults; this.faultMessage.frame = globalThis.currentFrame + output[0].length; this.faultMessage.faults = this.kernel.faults; this.port.postMessage(this.faultMessage); }
    this.offlineCompletion.observe(globalThis.currentFrame, output[0].length, this.kernel.faults, this.kernel.muted);
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-fixed-fractional-delay-v1', FixedFractionalDelayProcessor);
