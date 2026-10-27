const PCM_CAPTURE_PROTOCOL = 1, PCM_CAPTURE_CHANNELS = 2, PCM_CAPTURE_POOL = 2, PCM_CAPTURE_GAPS = 256;
const BUFFER_PRESSURE = 1, MISSING_INPUT = 2;

class OwnedPcmCaptureKernel {
  constructor({ sampleRate, maxFrames, targetStartFrame, chunkFrames = 4096 } = {}) {
    if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > sampleRate * 300 ||
        !Number.isSafeInteger(targetStartFrame) || targetStartFrame < 0 || targetStartFrame > Number.MAX_SAFE_INTEGER - maxFrames ||
        !Number.isSafeInteger(chunkFrames) || chunkFrames < 1024 || chunkFrames > 8192 || (chunkFrames & (chunkFrames - 1))) throw new TypeError('Invalid PCM capture bounds.');
    this.sampleRate = sampleRate; this.maxFrames = maxFrames; this.targetStartFrame = targetStartFrame; this.chunkFrames = chunkFrames;
    this.pool = Array.from({ length: PCM_CAPTURE_POOL }, () => new Float32Array(chunkFrames * PCM_CAPTURE_CHANNELS));
    this.states = new Uint8Array(PCM_CAPTURE_POOL); this.tokens = new Uint32Array(PCM_CAPTURE_POOL); this.gaps = new Float64Array(PCM_CAPTURE_GAPS * 3);
    this.current = -1; this.used = 0; this.chunkStartFrame = 0; this.sourceStartFrame = null; this.firstCapturedFrame = null; this.lastFrame = null;
    this.stopFrame = Infinity; this.stopReason = 'user-stop'; this.stopped = false; this.capturedFrames = 0; this.droppedFrames = 0;
    this.sequence = 0; this.gapCount = 0; this.overflowFirstFrame = null; this.overflowLastFrame = null; this.rejectedReturns = 0;
    this.zeroChannelFrames = 0; this.monoFrames = 0;
  }
  returnBuffer(index, token, buffer) {
    if (this.stopped || !Number.isSafeInteger(index) || index < 0 || index >= PCM_CAPTURE_POOL || this.states[index] !== 2 || token !== this.tokens[index] ||
        !(buffer instanceof ArrayBuffer) || buffer.byteLength !== this.chunkFrames * PCM_CAPTURE_CHANNELS * 4) { this.rejectedReturns++; return false; }
    this.pool[index] = new Float32Array(buffer); this.states[index] = 0; return true;
  }
  requestStop(frame, reason = 'user-stop') {
    if (this.stopped || !Number.isSafeInteger(frame) || frame < 0 || !['user-stop', 'panic', 'context-interrupted', 'owner-retired', 'provenance-unavailable'].includes(reason)) return false;
    if (frame < this.stopFrame) { this.stopFrame = frame; this.stopReason = reason; } return true;
  }
  gap(first, last, reason) {
    if (last <= first) return; this.droppedFrames += last - first;
    if (this.gapCount) { const at = (this.gapCount - 1) * 3;
      if (this.gaps[at + 1] === first && this.gaps[at + 2] === reason) { this.gaps[at + 1] = last; return; }
    }
    if (this.gapCount < PCM_CAPTURE_GAPS) { const at = this.gapCount++ * 3; this.gaps[at] = first; this.gaps[at + 1] = last; this.gaps[at + 2] = reason; }
    else { this.overflowFirstFrame ??= first; this.overflowLastFrame = last; }
  }
  flush(emit) {
    if (this.current < 0 || !this.used) return;
    const index = this.current, count = this.used; this.current = -1; this.used = 0;
    if (this.tokens[index] === 0xffffffff || this.sequence === Number.MAX_SAFE_INTEGER) { this.stopped = true; this.stopReason = 'capture-identity-exhausted'; return; }
    this.states[index] = 2;
    emit(index, ++this.tokens[index], ++this.sequence, this.sourceStartFrame, this.chunkStartFrame, count, this.pool[index].buffer);
  }
  process(channels, frames, firstFrame, emit) {
    if (this.stopped) return false;
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > 8192 || !Number.isSafeInteger(firstFrame) || firstFrame < 0 || firstFrame > Number.MAX_SAFE_INTEGER - frames ||
        this.lastFrame != null && firstFrame !== this.lastFrame) { this.stopped = true; this.stopReason = 'noncontiguous-render-clock'; this.flush(emit); return false; }
    const inputAvailable = Array.isArray(channels), layout = inputAvailable ? channels.length : 0;
    let validLayout = layout <= PCM_CAPTURE_CHANNELS;
    for (let channel = 0; channel < layout; channel++) if (!(channels[channel] instanceof Float32Array) || channels[channel].length !== frames) validLayout = false;
    if (!validLayout) {
      this.stopped = true; this.stopReason = 'unsupported-input-layout'; this.flush(emit); return false;
    }
    for (let offset = 0; offset < frames; offset++) {
      const frame = firstFrame + offset;
      if (frame < this.targetStartFrame) continue;
      this.sourceStartFrame ??= frame;
      if (frame >= this.stopFrame || frame - this.sourceStartFrame >= this.maxFrames) {
        this.lastFrame = frame; if (frame - this.sourceStartFrame >= this.maxFrames) this.stopReason = 'capacity-reached'; this.flush(emit); this.stopped = true; return false;
      }
      const left = layout ? channels[0][offset] : 0, right = layout === 2 ? channels[1][offset] : left;
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        this.lastFrame = frame; this.stopReason = 'nonfinite-input'; this.flush(emit); this.stopped = true; return false;
      }
      if (!inputAvailable) { this.flush(emit); if (this.stopped) { this.lastFrame = frame; return false; } this.gap(frame, frame + 1, MISSING_INPUT); continue; }
      if (this.current < 0) {
        const available = this.states[0] === 0 ? 0 : this.states[1] === 0 ? 1 : -1;
        if (available < 0) { this.gap(frame, frame + 1, BUFFER_PRESSURE); continue; }
        this.current = available; this.states[available] = 1; this.used = 0; this.chunkStartFrame = frame;
      }
      const buffer = this.pool[this.current], at = this.used * PCM_CAPTURE_CHANNELS; buffer[at] = left; buffer[at + 1] = right;
      this.firstCapturedFrame ??= frame; this.used++; this.capturedFrames++;
      if (!layout) this.zeroChannelFrames++; else if (layout === 1) this.monoFrames++;
      if (this.used === this.chunkFrames) { this.flush(emit); if (this.stopped) { this.lastFrame = frame + 1; return false; } }
    }
    this.lastFrame = firstFrame + frames; return !this.stopped;
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor || class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
class OwnedPcmCaptureProcessor extends ProcessorBase {
  constructor(options = {}) {
    super(); const settings = options.processorOptions;
    if (!settings || settings.protocol !== PCM_CAPTURE_PROTOCOL || typeof settings.epoch !== 'string' || !settings.epoch || settings.epoch.length > 160) throw new TypeError('Invalid PCM capture owner.');
    this.epoch = settings.epoch; this.terminalSent = false;
    this.kernel = new OwnedPcmCaptureKernel({ sampleRate: globalThis.sampleRate || 48000, maxFrames: settings.maxFrames,
      targetStartFrame: settings.targetStartFrame, chunkFrames: settings.chunkFrames });
    this.emit = (index, token, sequence, sourceStartFrame, firstFrame, frameCount, buffer) => this.port.postMessage({ type: 'pcm', protocol: PCM_CAPTURE_PROTOCOL,
      epoch: this.epoch, index, token, sequence, sourceStartFrame, firstFrame, frameCount, buffer }, [buffer]);
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.protocol !== PCM_CAPTURE_PROTOCOL || message.epoch !== this.epoch) return;
      if (message.type === 'return-buffer') this.kernel.returnBuffer(message.index, message.token, message.buffer);
      else if (message.type === 'stop') this.kernel.requestStop(message.frame, message.reason);
    };
    this.port.postMessage({ type: 'ready', protocol: PCM_CAPTURE_PROTOCOL, epoch: this.epoch, sampleRate: this.kernel.sampleRate,
      channels: PCM_CAPTURE_CHANNELS, chunkFrames: this.kernel.chunkFrames, pool: PCM_CAPTURE_POOL, targetStartFrame: settings.targetStartFrame });
  }
  process(inputs, outputs) {
    const output = outputs[0], frames = output?.[0]?.length;
    if (!frames) return false;
    for (let channel = 0; channel < output.length; channel++) output[channel].fill(0);
    let active;
    try { active = this.kernel.process(inputs[0], frames, globalThis.currentFrame || 0, this.emit); }
    catch { this.kernel.stopped = true; this.kernel.stopReason = 'capture-port-fault'; active = false; }
    if (!active && !this.terminalSent) {
      this.terminalSent = true;
      this.port.postMessage({ type: 'stopped', protocol: PCM_CAPTURE_PROTOCOL, epoch: this.epoch, sourceStartFrame: this.kernel.sourceStartFrame,
        firstCapturedFrame: this.kernel.firstCapturedFrame, lastFrame: this.kernel.lastFrame, capturedFrames: this.kernel.capturedFrames,
        droppedFrames: this.kernel.droppedFrames, lastSequence: this.kernel.sequence, reason: this.kernel.stopReason, gapCount: this.kernel.gapCount,
        zeroChannelFrames: this.kernel.zeroChannelFrames, monoFrames: this.kernel.monoFrames,
        gaps: this.kernel.gaps, overflowFirstFrame: this.kernel.overflowFirstFrame, overflowLastFrame: this.kernel.overflowLastFrame }, [this.kernel.gaps.buffer]);
    }
    return active;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-pcm-capture-v1', OwnedPcmCaptureProcessor);

export { OwnedPcmCaptureKernel, OwnedPcmCaptureProcessor, PCM_CAPTURE_PROTOCOL, PCM_CAPTURE_CHANNELS, PCM_CAPTURE_POOL, PCM_CAPTURE_GAPS, BUFFER_PRESSURE, MISSING_INPUT };
