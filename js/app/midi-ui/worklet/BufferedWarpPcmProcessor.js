/* global AudioWorkletProcessor, registerProcessor, currentFrame, sampleRate */
const validWarpIdentity = value => value && typeof value.voiceId === 'string' && value.voiceId.length > 0 && value.voiceId.length <= 256 && typeof value.onsetId === 'string' && value.onsetId.length > 0 && value.onsetId.length <= 256 && Number.isSafeInteger(value.generation) && value.generation >= 0 && (Number.isSafeInteger(value.epoch) && value.epoch >= 0 || typeof value.epoch === 'string' && value.epoch.length > 0 && value.epoch.length <= 128) && Number.isSafeInteger(value.sequence) && value.sequence >= 0;
class BufferedWarpPcmProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' }, { name: 'pan', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'a-rate' }]; }
  constructor(options = {}) {
    super(); this.liveInput = options.processorOptions?.liveInput === true; this.inputStartFrame = null; this.inputEndFrame = null; this.capturedThroughFrame = null; this.inputSerial = 0;
    this.inputSlots = this.liveInput ? Array.from({ length: 8 }, (_, slot) => { const left = new Float32Array(128), right = new Float32Array(128); return { available: true, sequence: 0, buffers: [left.buffer, right.buffer], packet: { protocol: 'lemmings-live-warp-worker/v1', type: 'live-input', slot, ownerId: '', ownerEpoch: 0, sequence: 0, inputFrame: 0, frames: 128, realInputFrames: 128, terminal: false, left, right } }; }) : null; this.capacity = 16; this.left = Array.from({ length: 16 }, () => new Float32Array(128)); this.right = Array.from({ length: 16 }, () => new Float32Array(128));
    this.starts = new Float64Array(16); this.lengths = new Uint16Array(16); this.head = 0; this.size = 0; this.source = null; this.identity = null;
    this.gate = null; this.gateRenderedStart = null; this.gateRenderedEnd = null; this.gateRenderedRelease = null;
    this.firstFrame = null; this.receivedThrough = null; this.renderedThrough = null; this.endFrame = null; this.failure = null; this.retired = false; this.sourceStopped = false;
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'attach-source') {
        if (this.retired || this.source || !message.port || typeof message.ownerId !== 'string' || !Number.isSafeInteger(message.ownerEpoch)) { this.port.postMessage({ type: 'failed', reason: 'source-already-owned-or-invalid' }); return; }
        this.identity = { ownerId: message.ownerId, ownerEpoch: message.ownerEpoch }; if (this.inputSlots) for (const slot of this.inputSlots) { slot.packet.ownerId = message.ownerId; slot.packet.ownerEpoch = message.ownerEpoch; } this.source = message.port;
        this.source.onmessage = incoming => this.receive(incoming.data); this.source.start(); this.port.postMessage({ type: 'source-attached', sampleRate, currentFrame });
      } else if (message?.type === 'input-start' || message?.type === 'input-inspect') {
        if (this.retired || message.ownerId !== this.identity?.ownerId || message.ownerEpoch !== this.identity?.ownerEpoch) return;
        let receipt;
        if (message.type === 'input-inspect') receipt = { status: 'accepted', observedFrame: currentFrame, capturedThroughFrame: this.capturedThroughFrame, inputEndFrame: this.inputEndFrame, failure: this.failure, renderedThroughOutputFrame: this.renderedThrough, sourceEndOutputFrame: this.endFrame };
        else if (!this.liveInput || this.inputStartFrame !== null || !Number.isSafeInteger(message.inputFrame) || message.inputFrame < currentFrame || !Number.isSafeInteger(message.endInputFrame) || message.endInputFrame <= message.inputFrame || message.endInputFrame > message.inputFrame + sampleRate * 30) receipt = { status: 'rejected', reason: 'input-clock-or-lifetime-invalid', observedFrame: currentFrame };
        else { this.inputStartFrame = message.inputFrame; this.inputEndFrame = message.endInputFrame; receipt = { status: 'accepted', observedFrame: currentFrame, firstInputFrame: this.inputStartFrame, endInputFrame: this.inputEndFrame, evidence: 'capture-window-admitted;no-future-input-captured' }; }
        this.port.postMessage({ type: 'live-response', requestId: message.requestId, ...receipt });
      } else if (['gate-start', 'gate-end', 'gate-inspect', 'reset-source'].includes(message?.type)) {
        if (this.retired || message.ownerId !== this.identity?.ownerId || message.ownerEpoch !== this.identity?.ownerEpoch) return;
        const receipt = this.controlGate(message); this.port.postMessage({ type: 'gate-response', requestId: message.requestId, ...receipt });
      } else if (message?.type === 'retire') {
        this.retired = true; this.size = 0; this.source?.close(); this.source = null;
        this.port.postMessage({ type: 'retired', outcome: 'complete', renderedThroughOutputFrame: this.renderedThrough, queuedPcmRetained: false });
      }
    };
  }
  controlGate(message) {
    const report = extra => ({ status: 'accepted', observedFrame: currentFrame, appliedFrame: null, renderedStartOutputFrame: this.gateRenderedStart, renderedEndOutputFrame: this.gateRenderedEnd, renderedReleaseStartOutputFrame: this.gateRenderedRelease, gateFinished: this.gateRenderedEnd !== null, sourceEndOutputFrame: this.endFrame, sourceFinished: this.endFrame !== null && currentFrame >= this.endFrame, evidence: 'processor-command-admission;rendered-frontier-observed-separately', ...extra });
    if (message.type === 'reset-source') {
      if (this.failure || !(this.gateRenderedEnd !== null || this.endFrame !== null && currentFrame >= this.endFrame)) return { status: 'rejected', reason: this.failure || 'source-output-not-settled', appliedFrame: null };
      this.size = 0; this.head = 0; this.firstFrame = this.receivedThrough = this.renderedThrough = this.endFrame = null; this.gate = null; this.gateRenderedStart = this.gateRenderedEnd = this.gateRenderedRelease = null; this.sourceStopped = false; return report({ priorSourceOutputSettled: true });
    }
    if (message.type === 'gate-inspect') return report({ sourceIdentity: this.gate?.identity || null, requestedEndOutputFrame: this.gate?.endFrame ?? null, releaseFrames: this.gate?.releaseFrames ?? null });
    const value = message.sourceIdentity;
    if (!validWarpIdentity(value) || this.failure) return { status: 'rejected', reason: this.failure || 'invalid-source-identity', appliedFrame: null };
    if (message.type === 'gate-start') {
      if (this.gate || this.firstFrame !== null || !Number.isSafeInteger(message.outputFrame) || message.outputFrame < currentFrame || !Number.isSafeInteger(message.attackFrames) || message.attackFrames < 0 || message.attackFrames > sampleRate * 2 || !Number.isSafeInteger(message.maximumEndOutputFrame) || message.maximumEndOutputFrame <= message.outputFrame || message.maximumEndOutputFrame > message.outputFrame + sampleRate * 30)
        return { status: 'rejected', reason: 'gate-clock-capacity-or-deadline', appliedFrame: null };
      this.gate = { identity: value, sequence: value.sequence, startFrame: message.outputFrame, attackFrames: message.attackFrames, endFrame: message.maximumEndOutputFrame, releaseFrames: 128, explicitEnd: false };
      return report({ targetOutputFrame: message.outputFrame, maximumEndOutputFrame: message.maximumEndOutputFrame });
    }
    const gate = this.gate;
    if (!gate || ['voiceId', 'onsetId', 'generation', 'epoch'].some(key => value[key] !== gate.identity[key]) || value.sequence <= gate.sequence || !Number.isSafeInteger(message.outputFrame) || message.outputFrame < 0 || !Number.isSafeInteger(message.releaseFrames) || message.releaseFrames < 1 || message.releaseFrames > sampleRate * 4 || !['reject', 'release-next-quantum'].includes(message.latePolicy)) return { status: 'rejected', reason: 'stale-or-invalid-output-release', appliedFrame: null };
    if (message.outputFrame < currentFrame && message.latePolicy !== 'release-next-quantum') return { status: 'rejected', reason: 'late-output-release', observedFrame: currentFrame, appliedFrame: null };
    const frame = Math.max(message.outputFrame, currentFrame); gate.sequence = value.sequence;
    if (this.gateRenderedEnd !== null || gate.explicitEnd && frame >= gate.endFrame) return report({ reason: 'already-releasing', targetOutputFrame: gate.endFrame, requestedTargetOutputFrame: message.outputFrame, releaseFrames: gate.releaseFrames });
    gate.endFrame = Math.min(frame, gate.endFrame); gate.releaseFrames = message.releaseFrames; gate.explicitEnd = true;
    return report({ targetOutputFrame: gate.endFrame, requestedTargetOutputFrame: message.outputFrame, lateByFrames: Math.max(0, currentFrame - message.outputFrame), releaseFrames: gate.releaseFrames, canceledBeforeOnset: gate.endFrame <= gate.startFrame });
  }
  receive(message) {
    if (!message || message.ownerId !== this.identity?.ownerId || message.ownerEpoch !== this.identity.ownerEpoch) return;
    if (message.type === 'input-return') {
      const slot = this.inputSlots?.[message.slot];
      if (!slot || slot.available || slot.sequence !== message.sequence || !(message.leftBuffer instanceof ArrayBuffer) || !(message.rightBuffer instanceof ArrayBuffer) || message.leftBuffer.byteLength !== 512 || message.rightBuffer.byteLength !== 512 || message.leftBuffer === message.rightBuffer) { this.failure = 'live-input-lease-mismatch'; return; }
      slot.buffers[0] = message.leftBuffer; slot.buffers[1] = message.rightBuffer; slot.packet.left = new Float32Array(message.leftBuffer); slot.packet.right = new Float32Array(message.rightBuffer); slot.available = true; return;
    }
    if (message.type === 'clock') {
      this.source.postMessage({ ownerId: this.identity.ownerId, ownerEpoch: this.identity.ownerEpoch, type: 'clock', requestId: message.requestId,
        currentFrame, sampleRate, freeChunks: this.capacity - this.size, failure: this.failure, gateFinishedOutputFrame: this.gateRenderedEnd, renderedThroughOutputFrame: this.renderedThrough, evidence: 'processor-frame-observation;device-output-separate' }); return;
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
        this.gate && ['voiceId', 'onsetId', 'generation', 'epoch'].some(key => chunk[key] !== this.gate.identity[key]) ||
        l.length !== 128 || r.length !== 128 || l.buffer === r.buffer || this.receivedThrough !== null && chunk.outputFrame !== this.receivedThrough) {
      respond(false, this.failure || 'pcm-capacity-clock-or-frontier'); return;
    }
    for (let index = 0; index < chunk.frames; index++) if (!Number.isFinite(l[index]) || !Number.isFinite(r[index]) || Math.max(Math.abs(l[index]), Math.abs(r[index])) > 32) { this.failure = 'invalid-pcm'; respond(false, this.failure); return; }
    const slot = (this.head + this.size) % this.capacity; this.left[slot].set(l); this.right[slot].set(r); this.starts[slot] = chunk.outputFrame; this.lengths[slot] = chunk.frames;
    this.size++; this.firstFrame ??= chunk.outputFrame; this.receivedThrough = chunk.outputFrame + chunk.frames; if (chunk.terminal === true) this.endFrame = this.receivedThrough; respond(true);
  }
  captureInput(inputs, count) {
    if (!this.liveInput || !this.source || this.inputStartFrame === null || currentFrame + count <= this.inputStartFrame || currentFrame >= this.inputEndFrame) return;
    if (count !== 128 || this.inputStartFrame % 128 || this.inputEndFrame <= this.inputStartFrame) { this.failure = 'live-input-quantum-or-boundary'; return; }
    let slot = null; for (let index = 0; index < this.inputSlots.length; index++) if (this.inputSlots[index].available) { slot = this.inputSlots[index]; break; }
    if (!slot) { this.failure = 'live-input-pool-exhausted'; return; }
    const packet = slot.packet, channels = inputs[0], l = channels?.[0], r = channels?.[1] || l, real = Math.min(count, this.inputEndFrame - currentFrame);
    for (let index = 0; index < count; index++) { const left = index < real && l ? l[index] : 0, right = index < real && r ? r[index] : 0;
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.max(Math.abs(left), Math.abs(right)) > 16) { this.failure = 'live-input-magnitude'; return; } packet.left[index] = left; packet.right[index] = right; }
    packet.inputFrame = currentFrame; packet.realInputFrames = real; packet.terminal = currentFrame + count >= this.inputEndFrame; packet.sequence = ++this.inputSerial; slot.sequence = packet.sequence; slot.available = false; this.capturedThroughFrame = currentFrame + real;
    this.source.postMessage(packet, slot.buffers);
  }
  process(inputs, outputs, parameters) {
    const channels = outputs[0]; if (!channels?.length) return !this.retired;
    for (let channel = 0; channel < channels.length; channel++) channels[channel].fill(0);
    if (this.retired || this.sourceStopped || this.failure) return !this.retired;
    const count = channels[0].length; this.captureInput(inputs, count); if (this.failure) return true;
    for (let index = 0; index < count; index++) {
      const frame = currentFrame + index, gate = this.gate;
      if (gate && frame >= gate.endFrame) this.gateRenderedRelease ??= frame;
      if (gate && (frame >= gate.endFrame + gate.releaseFrames || gate.endFrame <= gate.startFrame && frame >= gate.endFrame)) { this.gateRenderedEnd ??= frame; this.size = 0; continue; }
      if (this.endFrame !== null && frame >= this.endFrame) { if (gate) this.gateRenderedEnd ??= frame; this.size = 0; continue; }
      if (!this.size) { if (this.firstFrame !== null && frame >= this.firstFrame) this.failure = 'pcm-underrun'; continue; }
      const slot = this.head, offset = frame - this.starts[slot];
      if (offset < 0) continue;
      if (offset >= this.lengths[slot]) { this.failure = 'pcm-frontier-gap'; continue; }
      const attack = gate ? gate.attackFrames ? Math.max(0, Math.min(1, (frame - gate.startFrame) / gate.attackFrames)) : frame >= gate.startFrame ? 1 : 0 : 1,
        release = gate ? Math.max(0, Math.min(1, (gate.endFrame + gate.releaseFrames - frame) / gate.releaseFrames)) : 1,
        gain = parameters.gain[parameters.gain.length === 1 ? 0 : index] * attack * release,
        pan = parameters.pan[parameters.pan.length === 1 ? 0 : index], angle = (pan <= 0 ? pan + 1 : pan) * Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle),
        l = this.left[slot][offset], r = this.right[slot][offset];
      channels[0][index] = gain * (pan <= 0 ? l + r * c : l * c); if (channels.length > 1) channels[1][index] = gain * (pan <= 0 ? r * s : r + l * s); this.renderedThrough = frame + 1;
      if (gate && frame >= gate.startFrame) this.gateRenderedStart ??= frame;
      if (offset + 1 === this.lengths[slot]) { this.head = (this.head + 1) % this.capacity; this.size--; }
    }
    return true;
  }
}
registerProcessor('lemmings-buffered-warp-pcm', BufferedWarpPcmProcessor);
