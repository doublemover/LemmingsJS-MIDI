// A first-party, sine-only reference kernel. All voice, command and receipt
// storage is fixed at construction. process() inspects the supplied block size.
const PROTOCOL = 1, WIDTH = 18, CAPACITY = 512, MAX_VOICES = 64, RECEIPT_WIDTH = 6;
const BEGIN = 1, UPDATE = 2, END = 3, CANCEL = 4, PANIC = 5, LEASE = 6;
const SCHEDULED = 1, APPLIED = 2, REJECTED = 3, ENDED = 4, CANCELLED = 5, FAULTED = 6;

class OwnedSineKernel {
  constructor(sampleRate, maxVoices = MAX_VOICES) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
        !Number.isSafeInteger(maxVoices) || maxVoices < 1 || maxVoices > MAX_VOICES) throw new Error('Invalid sine kernel limits.');
    this.sampleRate = sampleRate; this.maxVoices = maxVoices;
    this.queue = new Float64Array(CAPACITY * WIDTH); this.queueLength = 0;
    this.voice = new Float64Array(MAX_VOICES * 28); this.active = new Uint8Array(MAX_VOICES);
    this.receipts = new Float64Array(2048 * RECEIPT_WIDTH); this.receiptCount = 0;
    this.counters = new Uint32Array(8); this.panicPending = false;
    this.lastPacket = 0; this.lastFrame = 0; this.nonfinite = 0;
  }

  less(left, right) {
    const a = left * WIDTH, b = right * WIDTH;
    return this.queue[a + 1] < this.queue[b + 1] || this.queue[a + 1] === this.queue[b + 1] && this.queue[a + 2] < this.queue[b + 2];
  }
  swap(left, right) {
    for (let field = 0; field < WIDTH; field++) {
      const value = this.queue[left * WIDTH + field];
      this.queue[left * WIDTH + field] = this.queue[right * WIDTH + field]; this.queue[right * WIDTH + field] = value;
    }
  }
  siftDown(index) {
    while (index * 2 + 1 < this.queueLength) {
      let child = index * 2 + 1;
      if (child + 1 < this.queueLength && this.less(child + 1, child)) child++;
      if (!this.less(child, index)) break;
      this.swap(index, child); index = child;
    }
  }
  pop() {
    this.queueLength--;
    if (!this.queueLength) return;
    for (let field = 0; field < WIDTH; field++) this.queue[field] = this.queue[this.queueLength * WIDTH + field];
    this.siftDown(0);
  }

  receipt(code, sequence, slot, token, frame, reason = 0) {
    if (this.receiptCount >= 2048) { this.counters[7]++; return; }
    const index = this.receiptCount++ * RECEIPT_WIDTH, data = this.receipts;
    data[index] = code; data[index + 1] = sequence; data[index + 2] = slot;
    data[index + 3] = token; data[index + 4] = frame; data[index + 5] = reason;
  }

  accept(packet, count, packetSequence = this.lastPacket + 1) {
    if (!(packet instanceof Float64Array) || !Number.isInteger(count) || count < 0 || count > CAPACITY || packet.length !== count * WIDTH) {
      this.counters[0]++; return;
    }
    if (!Number.isSafeInteger(packetSequence) || packetSequence <= this.lastPacket) { this.counters[0]++; return; }
    this.lastPacket = packetSequence;
    for (let item = 0; item < count; item++) {
      const source = item * WIDTH, frame = packet[source + 1], sequence = packet[source + 2], opcode = packet[source + 3];
      let valid = Number.isSafeInteger(frame) && frame >= 0 && frame - this.lastFrame <= this.sampleRate * 10 &&
        Number.isSafeInteger(sequence) && sequence > 0 && Number.isInteger(opcode) && opcode >= BEGIN && opcode <= LEASE;
      for (let field = 0; valid && field < WIDTH; field++) if (!Number.isFinite(packet[source + field])) valid = false;
      if (!valid) { this.counters[0]++; this.receipt(REJECTED, sequence, packet[source + 4], packet[source + 5], this.lastFrame, 1); continue; }
      if (opcode === PANIC) { this.panicPending = true; this.receipt(SCHEDULED, sequence, -1, 0, frame); continue; }
      const isTerminal = opcode === END || opcode === CANCEL;
      if (this.queueLength >= (isTerminal ? CAPACITY : CAPACITY - MAX_VOICES)) {
        this.counters[1]++;
        if (isTerminal) this.panicPending = true;
        this.receipt(REJECTED, sequence, packet[source + 4], packet[source + 5], this.lastFrame, 2); continue;
      }
      let at = this.queueLength;
      for (let field = 0; field < WIDTH; field++) this.queue[at * WIDTH + field] = packet[source + field];
      this.queueLength++;
      while (at > 0) { const parent = Math.floor((at - 1) / 2); if (!this.less(at, parent)) break; this.swap(at, parent); at = parent; }
      this.receipt(SCHEDULED, sequence, packet[source + 4], packet[source + 5], frame);
    }
  }

  release(slot, frames, frame, reason) {
    if (!this.active[slot]) return;
    const at = slot * 28, voices = this.voice;
    voices[at + 18] = Math.max(1, frames); voices[at + 19] = voices[at + 4] / voices[at + 18];
    voices[at + 20] = reason; voices[at + 21] = frame;
  }

  apply(frame) {
    const queue = this.queue, epoch = queue[0], target = queue[1], sequence = queue[2], opcode = queue[3], slot = queue[4], token = queue[5];
    const at = slot * 28, voices = this.voice;
    if (opcode === CANCEL) {
      for (let voice = 0; voice < this.maxVoices; voice++) if (this.active[voice] && voices[voice * 28] === epoch && voices[voice * 28 + 1] === queue[17])
        this.release(voice, this.sampleRate * 0.005, frame, 3);
      // Keep the command being applied at index zero until the caller removes it.
      let kept = 1;
      for (let index = 1; index < this.queueLength; index++) {
        const from = index * WIDTH;
        if (queue[from] === epoch && queue[from + 17] === queue[17]) {
          this.receipt(CANCELLED, queue[from + 2], queue[from + 4], queue[from + 5], frame, queue[from + 3] === BEGIN ? 9 : 3); continue;
        }
        for (let field = 0; field < WIDTH; field++) queue[kept * WIDTH + field] = queue[from + field];
        kept++;
      }
      this.queueLength = kept;
      for (let index = Math.floor(kept / 2) - 1; index >= 0; index--) this.siftDown(index);
      this.receipt(APPLIED, sequence, -1, 0, frame, 3); return;
    }
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.maxVoices || !Number.isSafeInteger(token) || token < 1) {
      this.receipt(REJECTED, sequence, slot, token, frame, 1); return;
    }
    if (opcode === BEGIN) {
      if (target < frame) { this.counters[2]++; this.receipt(REJECTED, sequence, slot, token, frame, 4); return; }
      if (this.active[slot] || queue[6] <= 0 || queue[6] >= this.sampleRate / 2 || queue[7] < 0 || queue[7] > 1 ||
          queue[8] < 0 || queue[8] > 1 || queue[9] < -1 || queue[9] > 1 || queue[10] < 0 || queue[11] < 0 ||
          queue[12] < 0 || queue[12] > 1 || queue[13] < 1 || queue[16] <= frame) {
        this.receipt(REJECTED, sequence, slot, token, frame, 5); return;
      }
      for (let field = 0; field < 28; field++) voices[at + field] = 0;
      voices[at] = epoch; voices[at + 1] = queue[17]; voices[at + 2] = token;
      voices[at + 3] = 0; voices[at + 4] = queue[10] === 0 ? 1 : 0;
      voices[at + 5] = queue[6]; voices[at + 6] = queue[6]; voices[at + 7] = queue[7];
      voices[at + 8] = queue[8]; voices[at + 9] = queue[8]; voices[at + 10] = queue[9]; voices[at + 11] = queue[9];
      voices[at + 12] = Math.round(queue[10]); voices[at + 13] = Math.round(queue[11]); voices[at + 14] = queue[12];
      voices[at + 15] = frame; voices[at + 16] = queue[16]; voices[at + 17] = Math.max(1, Math.round(queue[13]));
      voices[at + 22] = sequence; this.active[slot] = 1;
    } else if (!this.active[slot] || voices[at] !== epoch || voices[at + 2] !== token) {
      this.counters[3]++; this.receipt(REJECTED, sequence, slot, token, frame, 6); return;
    } else if (opcode === UPDATE) {
      if (target < frame) { this.counters[2]++; this.receipt(REJECTED, sequence, slot, token, frame, 4); return; }
      const mask = queue[15];
      if (!Number.isInteger(mask) || mask < 0 || mask > 7 || queue[14] < 0 || queue[14] > this.sampleRate ||
          (mask & 1) && (queue[6] <= 0 || queue[6] >= this.sampleRate / 2) ||
          (mask & 2) && (queue[8] < 0 || queue[8] > 1) || (mask & 4) && (queue[9] < -1 || queue[9] > 1)) {
        this.receipt(REJECTED, sequence, slot, token, frame, 1); return;
      }
      if (mask & 1) { voices[at + 6] = queue[6]; voices[at + 23] = Math.max(1, Math.round(queue[14])); }
      if (mask & 2) { voices[at + 9] = queue[8]; voices[at + 24] = Math.max(1, Math.round(queue[14])); }
      if (mask & 4) { voices[at + 11] = queue[9]; voices[at + 25] = Math.max(1, Math.round(queue[14])); }
    } else if (opcode === END) this.release(slot, Math.max(1, queue[13]), frame, 1);
    else if (opcode === LEASE) voices[at + 16] = Math.max(voices[at + 16], queue[16]);
    this.receipt(APPLIED, sequence, slot, token, frame);
  }

  render(left, right, frameStart) {
    this.lastFrame = frameStart;
    if (this.panicPending) {
      this.panicPending = false;
      for (let index = 0; index < this.queueLength; index++) {
        const at = index * WIDTH;
        this.receipt(CANCELLED, this.queue[at + 2], this.queue[at + 4], this.queue[at + 5], frameStart, this.queue[at + 3] === BEGIN ? 9 : 2);
      }
      this.queueLength = 0; this.counters[4]++;
      for (let slot = 0; slot < this.maxVoices; slot++) this.release(slot, Math.max(1, Math.min(left.length, this.sampleRate * 0.005)), frameStart, 2);
      this.receipt(APPLIED, 0, -1, 0, frameStart, 2);
    }
    for (let offset = 0; offset < left.length; offset++) {
      const frame = frameStart + offset;
      while (this.queueLength && this.queue[1] <= frame) {
        this.apply(frame); this.pop();
      }
      let sumLeft = 0, sumRight = 0;
      for (let slot = 0; slot < this.maxVoices; slot++) {
        if (!this.active[slot]) continue;
        const at = slot * 28, voices = this.voice, age = frame - voices[at + 15];
        if (!voices[at + 18] && frame >= voices[at + 16] - voices[at + 17]) this.release(slot, voices[at + 17], frame, 7);
        if (voices[at + 18]) {
          voices[at + 4] = Math.max(0, voices[at + 4] - voices[at + 19]); voices[at + 18]--;
          if (voices[at + 18] === 0 || voices[at + 4] === 0) {
            this.active[slot] = 0; this.receipt(ENDED, voices[at + 22], slot, voices[at + 2], frame, voices[at + 20]); continue;
          }
        } else if (age < voices[at + 12]) voices[at + 4] = age / voices[at + 12];
        else if (age < voices[at + 12] + voices[at + 13]) voices[at + 4] = 1 - (1 - voices[at + 14]) * (age - voices[at + 12]) / voices[at + 13];
        else voices[at + 4] = voices[at + 14];
        if (voices[at + 23] > 0) { voices[at + 5] += (voices[at + 6] - voices[at + 5]) / voices[at + 23]; voices[at + 23]--; }
        if (voices[at + 24] > 0) { voices[at + 8] += (voices[at + 9] - voices[at + 8]) / voices[at + 24]; voices[at + 24]--; }
        if (voices[at + 25] > 0) { voices[at + 10] += (voices[at + 11] - voices[at + 10]) / voices[at + 25]; voices[at + 25]--; }
        const sample = Math.sin(voices[at + 3]) * voices[at + 4] * voices[at + 7] * voices[at + 8];
        voices[at + 3] += 2 * Math.PI * voices[at + 5] / this.sampleRate;
        if (voices[at + 3] > 2 * Math.PI) voices[at + 3] -= 2 * Math.PI;
        if (!Number.isFinite(sample) || !Number.isFinite(voices[at + 3])) {
          this.active[slot] = 0; this.nonfinite++; this.receipt(FAULTED, voices[at + 22], slot, voices[at + 2], frame, 8); continue;
        }
        const angle = (voices[at + 10] + 1) * Math.PI / 4;
        sumLeft += sample * Math.cos(angle); sumRight += sample * Math.sin(angle);
      }
      left[offset] = sumLeft; if (right) right[offset] = sumRight;
    }
    this.lastFrame = frameStart + left.length;
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
class OwnedSineProcessor extends ProcessorBase {
  constructor(options) {
    super(); this.kernel = new OwnedSineKernel(globalThis.sampleRate, options?.processorOptions?.maxVoices || MAX_VOICES);
    this.message = { type: 'receipts', protocol: PROTOCOL, count: 0, data: new Float64Array(64 * RECEIPT_WIDTH) };
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'commands' && data.protocol === PROTOCOL) this.kernel.accept(data.data, data.count, data.packetSequence);
      else if (data?.type === 'panic') this.kernel.panicPending = true;
      else if (data?.type === 'inspect') this.port.postMessage({ type: 'health', protocol: PROTOCOL,
        counters: Array.from(this.kernel.counters), nonfinite: this.kernel.nonfinite, queued: this.kernel.queueLength, frame: this.kernel.lastFrame });
      else this.port.postMessage({ type: 'protocol-error', protocol: PROTOCOL });
      this.flushReceipts();
    };
    this.port.postMessage({ type: 'ready', protocol: PROTOCOL, engineId: 'worklet-sine', engineVersion: 1,
      runtimeABI: 'owned-sine-f64-command-v1', buildId: 'owned-sine-v1',
      sampleRate: globalThis.sampleRate, maxVoices: this.kernel.maxVoices, capacity: CAPACITY, width: WIDTH });
  }
  flushReceipts() {
    if (!this.kernel.receiptCount) return;
    let copied = 0;
    while (copied < this.kernel.receiptCount) {
      this.message.count = Math.min(64, this.kernel.receiptCount - copied);
      for (let field = 0; field < this.message.count * RECEIPT_WIDTH; field++) this.message.data[field] = this.kernel.receipts[copied * RECEIPT_WIDTH + field];
      this.port.postMessage(this.message); copied += this.message.count;
    }
    this.kernel.receiptCount = 0;
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    this.kernel.render(output[0], output[1], globalThis.currentFrame); this.flushReceipts(); return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-sine-v1', OwnedSineProcessor);

export { OwnedSineKernel, PROTOCOL, WIDTH, CAPACITY, MAX_VOICES, RECEIPT_WIDTH,
  BEGIN, UPDATE, END, CANCEL, PANIC, LEASE, SCHEDULED, APPLIED, REJECTED, ENDED, CANCELLED, FAULTED };
