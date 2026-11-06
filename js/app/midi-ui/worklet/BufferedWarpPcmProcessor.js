/* global AudioWorkletProcessor, registerProcessor, currentFrame, sampleRate */
class BufferedWarpPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.capacity = 16; this.left = Array.from({ length: 16 }, () => new Float32Array(128)); this.right = Array.from({ length: 16 }, () => new Float32Array(128));
    this.starts = new Float64Array(16); this.lengths = new Uint16Array(16); this.head = 0; this.size = 0; this.source = null; this.identity = null;
    this.firstFrame = null; this.receivedThrough = null; this.renderedThrough = null; this.endFrame = null; this.failure = null; this.retired = false; this.sourceStopped = false;
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'attach-source') {
        if (this.retired || this.source || !message.port || typeof message.ownerId !== 'string' || !Number.isSafeInteger(message.ownerEpoch)) { this.port.postMessage({ type: 'failed', reason: 'source-already-owned-or-invalid' }); return; }
        this.identity = { ownerId: message.ownerId, ownerEpoch: message.ownerEpoch }; this.source = message.port;
        this.source.onmessage = incoming => this.receive(incoming.data); this.source.start(); this.port.postMessage({ type: 'source-attached', sampleRate, currentFrame });
      } else if (message?.type === 'retire') {
        this.retired = true; this.size = 0; this.source?.close(); this.source = null;
        this.port.postMessage({ type: 'retired', outcome: 'complete', renderedThroughOutputFrame: this.renderedThrough, queuedPcmRetained: false });
      }
    };
  }
  receive(message) {
    if (!message || message.ownerId !== this.identity?.ownerId || message.ownerEpoch !== this.identity.ownerEpoch) return;
    if (message.type === 'clock') {
      this.source.postMessage({ ownerId: this.identity.ownerId, ownerEpoch: this.identity.ownerEpoch, type: 'clock', requestId: message.requestId,
        currentFrame, sampleRate, freeChunks: this.capacity - this.size, failure: this.failure, renderedThroughOutputFrame: this.renderedThrough, evidence: 'processor-frame-observation;device-output-separate' }); return;
    }
    if (message.type === 'stop') { this.sourceStopped = true; this.size = 0; this.source.postMessage({ ...this.identity, type: 'source-retired', outcome: 'complete' }); return; }
    if (message.type === 'end') { if (message.outputFrame === this.receivedThrough) this.endFrame = message.outputFrame; return; }
    if (message.type !== 'pcm') return;
    const chunk = message.chunk, l = chunk?.left, r = chunk?.right, buffers = l instanceof Float32Array && r instanceof Float32Array ? [l.buffer, r.buffer] : [],
      identity = this.identity, respond = (accepted, reason = null) => this.source.postMessage({ ...identity, type: 'pcm-ack', sequence: message.sequence, accepted, reason,
        returnedBuffers: buffers, appliedFrame: null, evidence: 'bounded-processor-input-queue;applied-frontier-observed-separately' }, buffers);
    if (this.retired || this.sourceStopped || this.failure || this.size === this.capacity || chunk?.schema !== 'lemmings-buffered-warp-pcm-chunk/v1' || chunk.sampleRate !== sampleRate ||
        !Number.isSafeInteger(chunk.outputFrame) || chunk.outputFrame < currentFrame || chunk.outputFrame > currentFrame + sampleRate * 2 ||
        !Number.isSafeInteger(chunk.frames) || chunk.frames < 1 || chunk.frames > 128 || !(l instanceof Float32Array) || !(r instanceof Float32Array) ||
        l.length !== 128 || r.length !== 128 || l.buffer === r.buffer || this.receivedThrough !== null && chunk.outputFrame !== this.receivedThrough) {
      respond(false, this.failure || 'pcm-capacity-clock-or-frontier'); return;
    }
    for (let index = 0; index < chunk.frames; index++) if (!Number.isFinite(l[index]) || !Number.isFinite(r[index]) || Math.max(Math.abs(l[index]), Math.abs(r[index])) > 32) { this.failure = 'invalid-pcm'; respond(false, this.failure); return; }
    const slot = (this.head + this.size) % this.capacity; this.left[slot].set(l); this.right[slot].set(r); this.starts[slot] = chunk.outputFrame; this.lengths[slot] = chunk.frames;
    this.size++; this.firstFrame ??= chunk.outputFrame; this.receivedThrough = chunk.outputFrame + chunk.frames; if (chunk.terminal === true) this.endFrame = this.receivedThrough; respond(true);
  }
  process(_inputs, outputs) {
    const channels = outputs[0]; if (!channels?.length) return !this.retired;
    for (let channel = 0; channel < channels.length; channel++) channels[channel].fill(0);
    if (this.retired || this.sourceStopped || this.failure) return !this.retired;
    const count = channels[0].length;
    for (let index = 0; index < count; index++) {
      const frame = currentFrame + index;
      if (this.endFrame !== null && frame >= this.endFrame) continue;
      if (!this.size) { if (this.firstFrame !== null && frame >= this.firstFrame) this.failure = 'pcm-underrun'; continue; }
      const slot = this.head, offset = frame - this.starts[slot];
      if (offset < 0) continue;
      if (offset >= this.lengths[slot]) { this.failure = 'pcm-frontier-gap'; continue; }
      channels[0][index] = this.left[slot][offset]; if (channels.length > 1) channels[1][index] = this.right[slot][offset]; this.renderedThrough = frame + 1;
      if (offset + 1 === this.lengths[slot]) { this.head = (this.head + 1) % this.capacity; this.size--; }
    }
    return true;
  }
}
registerProcessor('lemmings-buffered-warp-pcm', BufferedWarpPcmProcessor);
