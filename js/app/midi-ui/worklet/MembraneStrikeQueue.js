import { MEMBRANE_STRIKE_QUEUE_CAPACITY, MEMBRANE_STRIKE_VOICES, MEMBRANE_STRIKE_RECEIPTS, MEMBRANE_STRIKE_WIDTH as WIDTH, MEMBRANE_STRIKE_RECEIPT_WIDTH as RECEIPT_WIDTH } from '../../../midi/content/RectangularMembraneProfile.js';
const QUEUED = 0, READ = 1, WRITE = 2, COUNT = 3, LAST_FRAME = 4, APPLIED = 5, REJECTED = 6, ENDED = 7, LAST_REJECT = 8;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const normalized = value => Number.isFinite(value) && value >= 0 && value <= 1;
const earlier = (a, b, read) => read(a) < read(b) || read(a) === read(b) && read(a + 1) < read(b + 1);

export class MembraneStrikeQueue {
  constructor(profile) {
    this.profile = profile; this.queue = new Float64Array(MEMBRANE_STRIKE_QUEUE_CAPACITY * WIDTH); this.voices = new Float64Array(MEMBRANE_STRIKE_VOICES * WIDTH);
    this.receipts = new Float64Array(MEMBRANE_STRIKE_RECEIPTS * RECEIPT_WIDTH); this.frontier = new Float64Array(16); this.frontier[LAST_FRAME] = -1;
    this.pulses = profile.pulses.map(pulse => new Float64Array(pulse.coefficients));
  }
  get lastFrame() { return this.frontier[LAST_FRAME]; }
  get queued() { return this.frontier[QUEUED]; }
  get receiptCount() { return this.frontier[COUNT]; }
  swap(a, b) { for (let i = 0; i < WIDTH; i++) { const value = this.queue[a + i]; this.queue[a + i] = this.queue[b + i]; this.queue[b + i] = value; } }
  enqueue({ frame, token, x01, y01, amplitude01, pulseIndex }) {
    const f = this.frontier; let code = 0;
    if (!natural(frame) || !natural(token) || token === 0 || !normalized(x01) || !normalized(y01) || !normalized(amplitude01) || !Number.isInteger(pulseIndex) || pulseIndex < 0 || pulseIndex >= this.pulses.length || !Number.isSafeInteger(frame + (this.pulses[pulseIndex]?.length || 0))) code = 1;
    else if (frame <= f[LAST_FRAME]) code = 2;
    else if (f[QUEUED] >= MEMBRANE_STRIKE_QUEUE_CAPACITY) code = 3;
    else {
      for (let i = 0; i < f[QUEUED]; i++) if (this.queue[i * WIDTH + 1] === token) code = 4;
      for (let i = 0; i < MEMBRANE_STRIKE_VOICES; i++) if (this.voices[i * WIDTH] && this.voices[i * WIDTH + 1] === token) code = 4;
    }
    f[LAST_REJECT] = code; if (code) { f[REJECTED]++; return false; }
    let index = f[QUEUED]++, at = index * WIDTH; this.queue[at] = frame; this.queue[at + 1] = token; this.queue[at + 2] = x01; this.queue[at + 3] = y01; this.queue[at + 4] = amplitude01; this.queue[at + 5] = pulseIndex;
    while (index > 0) { const parent = index - 1 >>> 1, p = parent * WIDTH; if (!(this.queue[at] < this.queue[p] || this.queue[at] === this.queue[p] && token < this.queue[p + 1])) break; this.swap(at, p); index = parent; at = p; }
    return true;
  }
  pop() {
    const count = --this.frontier[QUEUED], last = count * WIDTH;
    for (let i = 0; i < WIDTH; i++) { this.queue[i] = count ? this.queue[last + i] : 0; this.queue[last + i] = 0; }
    let index = 0;
    while (index * 2 + 1 < count) {
      let next = index * 2 + 1; const right = next + 1, a = next * WIDTH, b = right * WIDTH;
      if (right < count && (this.queue[b] < this.queue[a] || this.queue[b] === this.queue[a] && this.queue[b + 1] < this.queue[a + 1])) next = right;
      const p = index * WIDTH, child = next * WIDTH;
      if (!(this.queue[child] < this.queue[p] || this.queue[child] === this.queue[p] && this.queue[child + 1] < this.queue[p + 1])) break; this.swap(child, p); index = next;
    }
  }
  receipt(kind, token, frame, code = 0) {
    const f = this.frontier; if (f[COUNT] >= MEMBRANE_STRIKE_RECEIPTS) return false;
    const at = f[WRITE] * RECEIPT_WIDTH; this.receipts[at] = kind; this.receipts[at + 1] = token; this.receipts[at + 2] = frame; this.receipts[at + 3] = code;
    f[WRITE] = (f[WRITE] + 1) % MEMBRANE_STRIKE_RECEIPTS; f[COUNT]++; return true;
  }
  scatter(forces, x01, y01, amplitude) {
    const size = this.profile.parameters.gridSize, x = x01 * (size - 1), y = y01 * (size - 1), ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy, i = iy * size + ix;
    forces[i] += amplitude * (1 - a) * (1 - b); if (a) forces[i + 1] += amplitude * a * (1 - b); if (b) forces[i + size] += amplitude * (1 - a) * b; if (a && b) forces[i + size + 1] += amplitude * a * b;
  }
  advance(frame, forces) {
    const f = this.frontier; if (!natural(frame) || !Number.isSafeInteger(frame + 1) || f[LAST_FRAME] !== -1 && frame !== f[LAST_FRAME] + 1) return false;
    f[LAST_FRAME] = frame;
    while (f[QUEUED] && this.queue[0] <= frame) {
      const target = this.queue[0], token = this.queue[1]; let slot = -1;
      for (let i = 0; i < MEMBRANE_STRIKE_VOICES; i++) if (!this.voices[i * WIDTH]) { slot = i * WIDTH; break; }
      if (target !== frame || slot < 0) { f[REJECTED]++; if (!this.receipt(2, token, frame, target !== frame ? 1 : 2)) return false; }
      else {
        this.voices[slot] = 1; for (let i = 1; i < 6; i++) this.voices[slot + i] = this.queue[i]; this.voices[slot + 6] = 0; this.voices[slot + 7] = frame;
        f[APPLIED]++; if (!this.receipt(1, token, frame)) return false;
      }
      this.pop();
    }
    for (let at = 0; at < this.voices.length; at += WIDTH) if (this.voices[at]) {
      const pulse = this.pulses[this.voices[at + 5]], cursor = this.voices[at + 6];
      this.scatter(forces, this.voices[at + 2], this.voices[at + 3], pulse[cursor] * this.voices[at + 4] * this.profile.parameters.excitationGain01 * 0.02);
      if (++this.voices[at + 6] === pulse.length) { f[ENDED]++; if (!this.receipt(3, this.voices[at + 1], frame + 1)) return false; this.voices.fill(0, at, at + WIDTH); }
    }
    return true;
  }
  panic(frame = Math.max(0, this.lastFrame + 1)) {
    let complete = true;
    for (let i = 0; i < this.queued; i++) complete = this.receipt(2, this.queue[i * WIDTH + 1], frame, 3) && complete;
    for (let at = 0; at < this.voices.length; at += WIDTH) if (this.voices[at]) complete = this.receipt(3, this.voices[at + 1], frame, 3) && complete;
    this.queue.fill(0); this.voices.fill(0); this.frontier[QUEUED] = 0; return complete;
  }
  discardReceipts() {
    const f = this.frontier;
    while (f[COUNT]) { const at = f[READ] * RECEIPT_WIDTH; this.receipts.fill(0, at, at + RECEIPT_WIDTH); f[READ] = (f[READ] + 1) % MEMBRANE_STRIKE_RECEIPTS; f[COUNT]--; }
  }
  drainReceipts() {
    const f = this.frontier, output = new Float64Array(f[COUNT] * RECEIPT_WIDTH);
    for (let i = 0; i < output.length; i += RECEIPT_WIDTH) { const at = f[READ] * RECEIPT_WIDTH; for (let j = 0; j < RECEIPT_WIDTH; j++) { output[i + j] = this.receipts[at + j]; this.receipts[at + j] = 0; } f[READ] = (f[READ] + 1) % MEMBRANE_STRIKE_RECEIPTS; f[COUNT]--; }
    return output;
  }
  validateTransfer(data, firstPlane, muted) {
    const queue = data.planes[firstPlane], voices = data.planes[firstPlane + 1], receipts = data.planes[firstPlane + 2], frontier = data.planes[firstPlane + 3], tokens = new Set();
    const read = index => frontier.read(index), queued = read(QUEUED), count = read(COUNT), last = read(LAST_FRAME);
    if (!natural(queued) || queued > MEMBRANE_STRIKE_QUEUE_CAPACITY || !natural(count) || count > MEMBRANE_STRIKE_RECEIPTS || !natural(read(READ)) || read(READ) >= MEMBRANE_STRIKE_RECEIPTS || !natural(read(WRITE)) || read(WRITE) !== (read(READ) + count) % MEMBRANE_STRIKE_RECEIPTS || !Number.isSafeInteger(last) || last < -1 || !Number.isSafeInteger(last + 1)) throw new Error('Invalid membrane strike queue frontier.');
    for (let i = APPLIED; i <= LAST_REJECT; i++) if (!natural(read(i))) throw new Error('Invalid membrane strike counters.');
    for (let i = LAST_REJECT + 1; i < 16; i++) if (read(i) !== 0) throw new Error('Unknown membrane strike frontier field.');
    const payload = (plane, at) => {
      const token = plane.read(at + 1), pulse = plane.read(at + 5);
      if (!natural(token) || token === 0 || tokens.has(token) || !normalized(plane.read(at + 2)) || !normalized(plane.read(at + 3)) || !normalized(plane.read(at + 4)) || !Number.isInteger(pulse) || pulse < 0 || pulse >= this.pulses.length) throw new Error('Invalid or aliased membrane strike payload.'); tokens.add(token); return pulse;
    };
    for (let i = 0; i < MEMBRANE_STRIKE_QUEUE_CAPACITY; i++) {
      const at = i * WIDTH;
      if (i < queued) { const pulse = payload(queue, at); if (!Number.isSafeInteger(queue.read(at) + this.pulses[pulse].length) || !natural(queue.read(at)) || queue.read(at) <= last || queue.read(at + 6) !== 0 || queue.read(at + 7) !== 0 || i > 0 && earlier(at, (i - 1 >>> 1) * WIDTH, queue.read)) throw new Error('Invalid membrane strike heap order or time.'); }
      else for (let j = 0; j < WIDTH; j++) if (queue.read(at + j) !== 0) throw new Error('Inactive strike queue retains payload.');
    }
    for (let at = 0; at < MEMBRANE_STRIKE_VOICES * WIDTH; at += WIDTH) {
      if (voices.read(at) === 1) { const pulse = payload(voices, at), cursor = voices.read(at + 6), start = voices.read(at + 7); if (!natural(cursor) || cursor >= this.pulses[pulse].length || !natural(start) || start + cursor !== last + 1) throw new Error('Invalid finite strike cursor.'); }
      else for (let j = 0; j < WIDTH; j++) if (voices.read(at + j) !== 0) throw new Error('Inactive finite strike retains state.');
    }
    for (let i = 0; i < MEMBRANE_STRIKE_RECEIPTS; i++) {
      const active = (i - read(READ) + MEMBRANE_STRIKE_RECEIPTS) % MEMBRANE_STRIKE_RECEIPTS < count, at = i * RECEIPT_WIDTH;
      if (active) { if (![1, 2, 3].includes(receipts.read(at)) || !natural(receipts.read(at + 1)) || receipts.read(at + 1) === 0 || !natural(receipts.read(at + 2)) || ![0, 1, 2, 3].includes(receipts.read(at + 3))) throw new Error('Invalid membrane strike receipt.'); }
      else for (let j = 0; j < RECEIPT_WIDTH; j++) if (receipts.read(at + j) !== 0) throw new Error('Inactive strike receipt retains payload.');
    }
    if (muted && tokens.size) throw new Error('Cleared membrane retains strike commands or exciters.');
  }
  diagnostics() { return { queued: this.queued, activeExciters: this.voices.filter((value, index) => index % WIDTH === 0 && value === 1).length, lastAudioFrame: this.lastFrame,
    applied: this.frontier[APPLIED], rejected: this.frontier[REJECTED], ended: this.frontier[ENDED], pendingReceipts: this.receiptCount }; }
}
