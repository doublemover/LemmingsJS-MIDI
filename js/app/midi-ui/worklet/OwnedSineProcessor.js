// Owned voice/command storage with a sine reference and fixed source adapters.
// Storage is fixed at construction; process() inspects the supplied block size.
import { ownedSourceStateBytes, writeOwnedSourceState, restoreOwnedSourceState } from './OwnedSourceState.js';
import { ownedKernelStateBytes, writeOwnedSineState, restoreOwnedSineState } from './OwnedSineState.js';
import { SINE_LAYOUT, LIVE_LANE_TAP_LIMIT, LIVE_LANE_TAP_PROTOCOL, LIVE_LANE_ID_LIMIT } from '../OwnedSourceLayout.js';
const PROTOCOL = 1, WIDTH = SINE_LAYOUT.width, CAPACITY = 512, MAX_VOICES = SINE_LAYOUT.voices, RECEIPT_WIDTH = 6;
const BEGIN = 1, UPDATE = 2, END = 3, CANCEL = 4, PANIC = 5, LEASE = 6, MIX = 7;
const SCHEDULED = 1, APPLIED = 2, REJECTED = 3, ENDED = 4, CANCELLED = 5, FAULTED = 6;
const DISPLAY_PROTOCOL = 1, DISPLAY_WIDTH = 20, DISPLAY_VOICES = 32, DISPLAY_STATE_WIDTH = 16;

class OwnedSineKernel {
  stateByteLength() { return this.source ? ownedSourceStateBytes(this) : ownedKernelStateBytes(this); }
  snapshotInto(destination, identity) { return this.source ? writeOwnedSourceState(this, destination, identity) : writeOwnedSineState(this, destination, identity); }
  restoreFrom(source, identity) { return this.source ? restoreOwnedSourceState(this, source, identity) : restoreOwnedSineState(this, source, identity); }
  constructor(sampleRate, maxVoices = MAX_VOICES, { source = null, width = WIDTH } = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
        !Number.isSafeInteger(maxVoices) || maxVoices < 1 || maxVoices > MAX_VOICES) throw new Error('Invalid sine kernel limits.');
    if (![18, 24, 26, 33, 40, 48, 56, 73, 80].includes(width) || width !== 18 && !source || source && (width === 18 || ['begin', 'sample', 'validFrequency', 'validUpdate', 'applyUpdate'].some(method => typeof source[method] !== 'function') || source.ownsEnvelope && typeof source.finished !== 'function')) throw new Error('Invalid owned source profile.');
    this.width = width; this.source = source;
    this.sampleRate = sampleRate; this.maxVoices = maxVoices;
    this.queue = new Float64Array(CAPACITY * this.width); this.queueLength = 0;
    this.mix = new Float64Array(MAX_VOICES * 6);
    this.pendingLanes = new Float64Array(MAX_VOICES * 2); this.laneRoutes = new Float64Array(MAX_VOICES * 5);
    this.voice = new Float64Array(MAX_VOICES * 28); this.active = new Uint8Array(MAX_VOICES);
    this.receipts = new Float64Array(2048 * RECEIPT_WIDTH); this.receiptCount = 0;
    this.counters = new Uint32Array(8); this.panicPending = false;
    this.stemSums = new Float64Array(32); this.preStemSums = new Float64Array(32);
    this.stemWeights = new Float64Array(16);
    this.lastPacket = 0; this.lastFrame = 0; this.nonfinite = 0;
    this.displayTokens = new Uint32Array(MAX_VOICES); this.displayState = new Float64Array(MAX_VOICES * DISPLAY_STATE_WIDTH);
    this.displayData = new Float64Array(DISPLAY_VOICES * DISPLAY_WIDTH); this.displayCount = 0;
    this.displayEnabled = false; this.displayReady = false; this.displayInterval = 0; this.displayNext = 0;
    this.displayRevision = 0; this.displaySequence = 0; this.displayDropped = 0;
  }

  setLaneIdentity(slot, token, laneToken) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.maxVoices || !Number.isSafeInteger(token) || token < 1 || token > 0xffffffff ||
        !Number.isSafeInteger(laneToken) || laneToken < 0 || laneToken > LIVE_LANE_ID_LIMIT || token < this.pendingLanes[slot * 2]) return false;
    if (token === this.pendingLanes[slot * 2] && this.pendingLanes[slot * 2 + 1] !== laneToken) return false;
    this.pendingLanes[slot * 2] = token; this.pendingLanes[slot * 2 + 1] = laneToken; return true;
  }

  configureDisplay(tokens, interval, revision) {
    if (!(tokens instanceof Uint32Array) || tokens.length !== MAX_VOICES || !Number.isSafeInteger(interval) ||
        interval < Math.ceil(this.sampleRate / 30) || interval > Math.ceil(this.sampleRate / 4) ||
        !Number.isSafeInteger(revision) || revision <= this.displayRevision) return false;
    let count = 0; for (let slot = 0; slot < MAX_VOICES; slot++) if (tokens[slot]) count++;
    if (count > DISPLAY_VOICES) return false;
    for (let slot = 0; slot < MAX_VOICES; slot++) if (this.displayState[slot * DISPLAY_STATE_WIDTH + 5]) { this.displayDropped++; break; }
    this.displayTokens.set(tokens); this.displayState.fill(0); this.displayEnabled = count > 0;
    this.displayInterval = interval; this.displayNext = this.lastFrame + interval; this.displayRevision = revision;
    if (this.displayReady) this.displayDropped++; this.displayReady = false; return true;
  }

  measureDisplay(slot, sample, frame, phase, flags = 0, absolutePeak = Math.abs(sample)) {
    const voice = slot * 28, token = this.voice[voice + 2];
    if (!this.displayEnabled || this.displayTokens[slot] !== token) return;
    const at = slot * DISPLAY_STATE_WIDTH, state = this.displayState;
    if (state[at] !== token || flags & 6) {
      for (let field = 0; field < DISPLAY_STATE_WIDTH; field++) state[at + field] = 0;
      state[at] = token; state[at + 3] = frame;
    }
    state[at + 1] = this.voice[voice]; state[at + 2] = this.voice[voice + 1];
    state[at + 4] = frame + 1; state[at + 5]++; state[at + 6] += sample * sample;
    state[at + 7] = Math.max(state[at + 7], absolutePeak); state[at + 8] = phase;
    state[at + 9] = this.voice[voice + 5]; state[at + 10] = this.voice[voice + 8]; state[at + 11] = this.voice[voice + 10];
    state[at + 12] = flags & 6 ? 0 : this.voice[voice + 4]; state[at + 13] = flags;
    state[at + 14] = this.voice[voice + 26]; state[at + 15] = this.voice[voice + 27];
  }

  finishDisplay(frame) {
    if (!this.displayEnabled || frame < this.displayNext) return;
    if (this.displayReady) this.displayDropped++;
    this.displayCount = 0; this.displaySequence++; this.displayNext = frame + this.displayInterval;
    for (let slot = 0; slot < MAX_VOICES; slot++) {
      const from = slot * DISPLAY_STATE_WIDTH, state = this.displayState;
      if (!state[from + 5] || this.displayTokens[slot] !== state[from]) continue;
      const at = this.displayCount++ * DISPLAY_WIDTH, data = this.displayData;
      data[at] = slot; data[at + 1] = state[from]; data[at + 2] = state[from + 1]; data[at + 3] = state[from + 2];
      data[at + 4] = state[from + 3]; data[at + 5] = state[from + 4]; data[at + 6] = state[from + 5]; data[at + 7] = state[from + 14];
      data[at + 8] = Math.sqrt(state[from + 6] / state[from + 5]); data[at + 9] = state[from + 7];
      for (let field = 0; field < 6; field++) data[at + 10 + field] = state[from + 8 + field];
      data[at + 16] = state[from + 4] - 1; data[at + 17] = this.displaySequence;
      data[at + 18] = this.displayRevision; data[at + 19] = state[from + 15];
      state[from + 3] = frame; state[from + 5] = 0; state[from + 6] = 0; state[from + 7] = 0;
    }
    this.displayReady = this.displayCount > 0;
  }

  less(left, right) {
    const a = left * this.width, b = right * this.width;
    return this.queue[a + 1] < this.queue[b + 1] || this.queue[a + 1] === this.queue[b + 1] && this.queue[a + 2] < this.queue[b + 2];
  }
  swap(left, right) {
    for (let field = 0; field < this.width; field++) {
      const value = this.queue[left * this.width + field];
      this.queue[left * this.width + field] = this.queue[right * this.width + field]; this.queue[right * this.width + field] = value;
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
    if (this.queueLength) {
      for (let field = 0; field < this.width; field++) this.queue[field] = this.queue[this.queueLength * this.width + field];
      this.siftDown(0);
    }
    this.queue.fill(0, this.queueLength * this.width, (this.queueLength + 1) * this.width);
  }

  receipt(code, sequence, slot, token, frame, reason = 0) {
    if (this.receiptCount >= 2048) { this.counters[7]++; return; }
    const index = this.receiptCount++ * RECEIPT_WIDTH, data = this.receipts;
    data[index] = code; data[index + 1] = sequence; data[index + 2] = slot;
    data[index + 3] = token; data[index + 4] = frame; data[index + 5] = reason;
  }

  accept(packet, count, packetSequence = this.lastPacket + 1) {
    if (!(packet instanceof Float64Array) || !Number.isInteger(count) || count < 0 || count > CAPACITY || packet.length !== count * this.width) {
      this.counters[0]++; return;
    }
    if (!Number.isSafeInteger(packetSequence) || packetSequence <= this.lastPacket) { this.counters[0]++; return; }
    this.lastPacket = packetSequence;
    for (let item = 0; item < count; item++) {
      const source = item * this.width, frame = packet[source + 1], sequence = packet[source + 2], opcode = packet[source + 3];
      let valid = Number.isSafeInteger(frame) && frame >= 0 && frame - this.lastFrame <= this.sampleRate * 10 &&
        Number.isSafeInteger(sequence) && sequence > 0 && Number.isInteger(opcode) && opcode >= BEGIN && opcode <= MIX;
      for (let field = 0; valid && field < this.width; field++) if (!Number.isFinite(packet[source + field])) valid = false;
      if (!valid) { this.counters[0]++; this.receipt(REJECTED, sequence, packet[source + 4], packet[source + 5], this.lastFrame, 1); continue; }
      if (opcode === PANIC) { this.panicPending = true; this.receipt(SCHEDULED, sequence, -1, 0, frame); continue; }
      const isTerminal = opcode === END || opcode === CANCEL;
      if (this.queueLength >= (isTerminal ? CAPACITY : CAPACITY - MAX_VOICES)) {
        this.counters[1]++;
        if (isTerminal) this.panicPending = true;
        this.receipt(REJECTED, sequence, packet[source + 4], packet[source + 5], this.lastFrame, 2); continue;
      }
      let at = this.queueLength;
      for (let field = 0; field < this.width; field++) this.queue[at * this.width + field] = packet[source + field];
      this.queueLength++;
      while (at > 0) { const parent = Math.floor((at - 1) / 2); if (!this.less(at, parent)) break; this.swap(at, parent); at = parent; }
      this.receipt(SCHEDULED, sequence, packet[source + 4], packet[source + 5], frame);
    }
  }

  release(slot, frames, frame, reason, packet = null) {
    if (!this.active[slot]) return;
    frames = Math.max(1, Math.round(frames));
    const at = slot * 28, voices = this.voice;
    voices[at + 18] = Math.max(1, frames); voices[at + 19] = voices[at + 4] / voices[at + 18];
    voices[at + 20] = reason; voices[at + 21] = frame;
    voices[at + 26] = frame;
    this.source?.release?.(slot, frames, frame, reason, packet, voices[at + 16]);
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
        const from = index * this.width;
        if (queue[from] === epoch && queue[from + 17] === queue[17]) {
          this.receipt(CANCELLED, queue[from + 2], queue[from + 4], queue[from + 5], frame, queue[from + 3] === BEGIN ? 9 : 3); continue;
        }
        for (let field = 0; field < this.width; field++) queue[kept * this.width + field] = queue[from + field];
        kept++;
      }
      this.queue.fill(0, kept * this.width, this.queueLength * this.width);
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
          queue[12] < 0 || queue[12] > 1 || queue[13] < 1 || queue[14] < 0 || queue[14] > 3 || queue[15] < -1 || queue[15] > 1 || queue[16] <= frame) {
        this.receipt(REJECTED, sequence, slot, token, frame, 5); return;
      }
      if (this.source) { const admission = this.source.begin(slot, queue[6], queue, frame);
        if (admission !== 1) { this.receipt(REJECTED, sequence, slot, token, frame, admission === -1 ? 10 : 5); return; } }
      for (let field = 0; field < 28; field++) voices[at + field] = 0;
      voices[at] = epoch; voices[at + 1] = queue[17]; voices[at + 2] = token;
      voices[at + 3] = 0; voices[at + 4] = queue[10] === 0 ? 1 : 0;
      voices[at + 5] = queue[6]; voices[at + 6] = queue[6]; voices[at + 7] = queue[7];
      voices[at + 8] = queue[8]; voices[at + 9] = queue[8]; voices[at + 10] = queue[9]; voices[at + 11] = queue[9];
      voices[at + 12] = Math.round(queue[10]); voices[at + 13] = Math.round(queue[11]); voices[at + 14] = queue[12];
      voices[at + 15] = frame; voices[at + 16] = queue[16]; voices[at + 17] = Math.max(1, Math.round(queue[13]));
      const mix = slot * 6; this.mix.fill(0, mix, mix + 6); this.mix[mix] = this.mix[mix + 1] = queue[14] === 0 ? 1 : queue[14] - 1; this.mix[mix + 3] = this.mix[mix + 4] = queue[15];
      const route = slot * 5, lane = this.pendingLanes[slot * 2] === token ? this.pendingLanes[slot * 2 + 1] : 0;
      this.laneRoutes.fill(0, route, route + 5); this.laneRoutes[route] = this.laneRoutes[route + 1] = lane;
      voices[at + 22] = sequence; this.active[slot] = 1;
    } else if (!this.active[slot] || voices[at] !== epoch || voices[at + 2] !== token) {
      this.counters[3]++; this.receipt(REJECTED, sequence, slot, token, frame, 6); return;
    } else if (opcode === UPDATE) {
      if (target < frame) { this.counters[2]++; this.receipt(REJECTED, sequence, slot, token, frame, 4); return; }
      const mask = queue[15];
      if (!Number.isInteger(mask) || mask < 0 || mask > (this.source?.maxUpdateMask ?? 7) || queue[14] < 0 || queue[14] > this.sampleRate * 60 ||
          (mask & 1) && (queue[6] <= 0 || queue[6] >= this.sampleRate / 2 || this.source && !this.source.validFrequency(slot, queue[6])) ||
          (mask & 2) && (queue[8] < 0 || queue[8] > 1) || (mask & 4) && (queue[9] < -1 || queue[9] > 1) || this.source && !this.source.validUpdate(slot, mask, queue)) {
        this.receipt(REJECTED, sequence, slot, token, frame, 1); return;
      }
      if (mask & 1) { voices[at + 6] = queue[6]; voices[at + 23] = Math.max(1, Math.round(queue[14])); }
      if (mask & 2) { voices[at + 9] = queue[8]; voices[at + 24] = Math.max(1, Math.round(queue[14])); }
      if (mask & 4) { voices[at + 11] = queue[9]; voices[at + 25] = Math.max(1, Math.round(queue[14])); }
      this.source?.applyUpdate(slot, mask, queue);
    } else if (opcode === MIX) {
      const route = slot * 5;
      if (queue[7] < 0 || queue[7] > 2 || queue[9] < -1 || queue[9] > 1 || queue[14] < 0 || queue[14] > this.sampleRate ||
          !Number.isSafeInteger(queue[6]) || queue[6] < 0 || queue[6] > LIVE_LANE_ID_LIMIT || queue[6] && (target < frame || this.laneRoutes[route + 2] > 0 && queue[6] !== this.laneRoutes[route + 1])) { this.receipt(REJECTED, sequence, slot, token, frame, 1); return; }
      if (queue[6] && queue[6] !== this.laneRoutes[route + 1]) {
        this.laneRoutes[route] = this.laneRoutes[route + 1]; this.laneRoutes[route + 1] = queue[6];
        this.laneRoutes[route + 2] = this.laneRoutes[route + 3] = Math.max(1, Math.round(queue[14])); this.laneRoutes[route + 4] = frame;
      }
      const mix = slot * 6; this.mix[mix + 1] = queue[7]; this.mix[mix + 4] = queue[9]; this.mix[mix + 2] = this.mix[mix + 5] = Math.max(1, Math.round(queue[14]));
    } else if (opcode === END) {
      if (this.source?.validRelease && !this.source.validRelease(queue, frame)) { this.receipt(REJECTED, sequence, slot, token, frame, 1); return; }
      this.release(slot, this.source?.ownsEnvelope ? Math.min(Math.max(1, queue[13]), Math.max(1, voices[at + 16] - frame)) : Math.max(1, queue[13]), frame, this.source?.ownsEnvelope ? frame >= voices[at + 16] ? 7 : queue[20] === 1 ? 13 : 1 : 1, queue);
      if (this.source?.cancelQueuedOnForcedEnd && queue[20] === 1) {
        let kept = 1;
        for (let index = 1; index < this.queueLength; index++) {
          const from = index * this.width;
          if (queue[from] === epoch && queue[from + 4] === slot && queue[from + 5] === token && queue[from + 3] !== BEGIN) {
            this.receipt(CANCELLED, queue[from + 2], slot, token, frame, 13); continue;
          }
          for (let field = 0; field < this.width; field++) queue[kept * this.width + field] = queue[from + field]; kept++;
        }
        this.queue.fill(0, kept * this.width, this.queueLength * this.width); this.queueLength = kept;
        for (let index = Math.floor(kept / 2) - 1; index >= 0; index--) this.siftDown(index);
      }
    }
    else if (opcode === LEASE) {
      // The render boundary, not producer time, owns the irreversible release cutoff.
      if (voices[at + 18] > 0 || frame >= voices[at + 16] - voices[at + 17]) {
        this.receipt(REJECTED, sequence, slot, token, frame, 11); return;
      }
      if (queue[16] <= voices[at + 16]) { this.receipt(REJECTED, sequence, slot, token, frame, 12); return; }
      voices[at + 16] = queue[16];
    }
    voices[at + 26] = frame; voices[at + 27] = sequence;
    this.receipt(APPLIED, sequence, slot, token, frame);
  }

  render(left, right, frameStart, stems = null) {
    const maskedStems = stems?.routeMode === 'mask', sourceEnvelope = this.source?.ownsEnvelope === true;
    if (stems) {
      if (stems.routeMode != null && !maskedStems || !(maskedStems ? stems.routes instanceof Uint16Array : stems.routes instanceof Int8Array) || stems.routes.length < this.maxVoices || stems.routes.length > MAX_VOICES ||
          !Array.isArray(stems.channels) || !stems.channels.length || stems.channels.length > 16 ||
          stems.tokens && (!(stems.tokens instanceof Uint32Array) || stems.tokens.length !== stems.routes.length) ||
          stems.laneTokens && (!(stems.laneTokens instanceof Uint32Array) || stems.laneTokens.length !== stems.channels.length || stems.laneTokens.some(value => value > LIVE_LANE_ID_LIMIT)) ||
          stems.preChannels && (!Array.isArray(stems.preChannels) || stems.preChannels.length !== stems.channels.length)) throw new TypeError('Invalid bounded sine stem taps.');
      for (let index = 0; index < stems.routes.length; index++) if (maskedStems ? stems.routes[index] >= 2 ** stems.channels.length : stems.routes[index] < -1 || stems.routes[index] >= stems.channels.length) throw new TypeError('Invalid stem route.');
      for (let stage = 0; stage < (stems.preChannels ? 2 : 1); stage++) {
        const channels = stage ? stems.preChannels : stems.channels;
        for (let index = 0; index < channels.length; index++) if (!Array.isArray(channels[index]) || channels[index].length !== 2 ||
            !(channels[index][0] instanceof Float32Array) || !(channels[index][1] instanceof Float32Array) ||
            channels[index][0].length !== left.length || channels[index][1].length !== left.length) throw new TypeError('Invalid stem channel storage.');
      }
    }
    this.lastFrame = frameStart;
    if (this.panicPending) {
      this.panicPending = false;
      for (let index = 0; index < this.queueLength; index++) {
        const at = index * this.width;
        this.receipt(CANCELLED, this.queue[at + 2], this.queue[at + 4], this.queue[at + 5], frameStart, this.queue[at + 3] === BEGIN ? 9 : 2);
      }
      this.queue.fill(0); this.queueLength = 0; this.counters[4]++;
      for (let slot = 0; slot < this.maxVoices; slot++) this.release(slot, Math.max(1, Math.min(left.length, this.sampleRate * 0.005)), frameStart, 2);
      this.receipt(APPLIED, 0, -1, 0, frameStart, 2);
    }
    for (let offset = 0; offset < left.length; offset++) {
      const frame = frameStart + offset;
      if (sourceEnvelope) for (let slot = 0; slot < this.maxVoices; slot++) if (this.active[slot] && this.source.finished(slot)) {
        const at = slot * 28;
        if (this.displayEnabled) this.measureDisplay(slot, 0, frame, 0, 2);
        this.active[slot] = 0; this.source.retire(slot); this.receipt(ENDED, this.voice[at + 22], slot, this.voice[at + 2], frame, this.voice[at + 20]);
      }
      while (this.queueLength && this.queue[1] <= frame) {
        this.apply(frame); this.pop();
      }
      let sumLeft = 0, sumRight = 0;
      if (stems) { this.stemSums.fill(0); if (stems.preChannels) this.preStemSums.fill(0); }
      for (let slot = 0; slot < this.maxVoices; slot++) {
        if (!this.active[slot]) continue;
        const at = slot * 28, voices = this.voice, age = frame - voices[at + 15];
        if (!voices[at + 18] && frame >= voices[at + 16] - voices[at + 17]) this.release(slot, voices[at + 17], frame, 7);
        if (voices[at + 18]) {
          voices[at + 4] = Math.max(0, voices[at + 4] - voices[at + 19]); voices[at + 18]--;
          if (!sourceEnvelope && (voices[at + 18] === 0 || voices[at + 4] === 0)) {
            if (this.displayEnabled) this.measureDisplay(slot, 0, frame, 0, 2);
            this.active[slot] = 0; this.source?.retire?.(slot); this.receipt(ENDED, voices[at + 22], slot, voices[at + 2], frame, voices[at + 20]); continue;
          }
          if (sourceEnvelope && voices[at + 18] === 0) { voices[at + 18] = 1; voices[at + 19] = 0; }
        } else if (age < voices[at + 12]) voices[at + 4] = age / voices[at + 12];
        else if (age < voices[at + 12] + voices[at + 13]) voices[at + 4] = 1 - (1 - voices[at + 14]) * (age - voices[at + 12]) / voices[at + 13];
        else voices[at + 4] = voices[at + 14];
        if (voices[at + 23] > 0) { voices[at + 5] += (voices[at + 6] - voices[at + 5]) / voices[at + 23]; voices[at + 23]--; }
        if (voices[at + 24] > 0) { voices[at + 8] += (voices[at + 9] - voices[at + 8]) / voices[at + 24]; voices[at + 24]--; }
        if (voices[at + 25] > 0) { voices[at + 10] += (voices[at + 11] - voices[at + 10]) / voices[at + 25]; voices[at + 25]--; }
        const mix = slot * 6;
        for (let offset = 0; offset <= 3; offset += 3) if (this.mix[mix + offset + 2] > 0) { this.mix[mix + offset] += (this.mix[mix + offset + 1] - this.mix[mix + offset]) / this.mix[mix + offset + 2]; this.mix[mix + offset + 2]--; }
        const envelope = sourceEnvelope ? 1 : voices[at + 4], phase = voices[at + 3], sourceSample = this.source ? this.source.sample(slot, voices[at + 5], frame) : Math.sin(phase),
          sample = sourceSample * envelope * voices[at + 7] * voices[at + 8], stereo = this.source?.stereo === true;
        let voiceLeft, voiceRight;
        if (stereo) {
          const leftSample = this.source.leftSample * envelope * voices[at + 7] * voices[at + 8], rightSample = this.source.rightSample * envelope * voices[at + 7] * voices[at + 8];
          voiceLeft = leftSample * (voices[at + 10] > 0 ? Math.cos(voices[at + 10] * Math.PI / 2) : 1);
          voiceRight = rightSample * (voices[at + 10] < 0 ? Math.cos(voices[at + 10] * Math.PI / 2) : 1);
          if (this.displayEnabled) this.measureDisplay(slot, Math.sqrt((leftSample * leftSample + rightSample * rightSample) * 0.5), frame, phase, voices[at + 18] ? 1 : 0,
            Math.max(Math.abs(leftSample), Math.abs(rightSample)));
        } else {
          const angle = (voices[at + 10] + 1) * Math.PI / 4;
          if (this.displayEnabled) this.measureDisplay(slot, sample, frame, phase, voices[at + 18] ? 1 : 0);
          voiceLeft = sample * Math.cos(angle); voiceRight = sample * Math.sin(angle);
        }
        voices[at + 3] += 2 * Math.PI * voices[at + 5] / this.sampleRate;
        if (voices[at + 3] > 2 * Math.PI) voices[at + 3] -= 2 * Math.PI;
        if (!Number.isFinite(sample) || !Number.isFinite(voiceLeft) || !Number.isFinite(voiceRight) || !Number.isFinite(voices[at + 3])) {
          if (this.displayEnabled) this.measureDisplay(slot, 0, frame, 0, 4);
          this.active[slot] = 0; this.source?.retire?.(slot); this.nonfinite++; this.receipt(FAULTED, voices[at + 22], slot, voices[at + 2], frame, 8); continue;
        }
        const routed = stems && (!stems.tokens || stems.tokens[slot] === voices[at + 2]), stemRoute = routed && !maskedStems ? stems.routes[slot] : -1, stemMask = routed && maskedStems ? stems.routes[slot] : 0;
        const route = slot * 5, fromWeight = this.laneRoutes[route + 3] ? this.laneRoutes[route + 2] / this.laneRoutes[route + 3] : 0;
        if (stems) for (let index = 0; index < stems.channels.length; index++) {
          const lane = stems.laneTokens?.[index] || 0, weight = !routed ? 0 : lane ?
            (lane === this.laneRoutes[route] ? fromWeight : 0) + (lane === this.laneRoutes[route + 1] ? 1 - fromWeight : 0) : stemRoute === index || stemMask & 1 << index ? 1 : 0;
          this.stemWeights[index] = weight;
          if (stems.preChannels && weight) { this.preStemSums[index * 2] += voiceLeft * weight; this.preStemSums[index * 2 + 1] += voiceRight * weight; }
        }
        if (this.laneRoutes[route + 2] > 0) this.laneRoutes[route + 2]--;
        voiceLeft *= this.mix[mix] * (this.mix[mix + 3] > 0 ? Math.cos(this.mix[mix + 3] * Math.PI / 2) : 1);
        voiceRight *= this.mix[mix] * (this.mix[mix + 3] < 0 ? Math.cos(this.mix[mix + 3] * Math.PI / 2) : 1);
        sumLeft += voiceLeft; sumRight += voiceRight;
        if (stems) for (let index = 0; index < stems.channels.length; index++) if (this.stemWeights[index]) { this.stemSums[index * 2] += voiceLeft * this.stemWeights[index]; this.stemSums[index * 2 + 1] += voiceRight * this.stemWeights[index]; }
      }
      left[offset] = !right && this.source?.stereo === true ? (sumLeft + sumRight) * 0.5 : sumLeft; if (right) right[offset] = sumRight;
      if (stems) for (let stem = 0; stem < stems.channels.length; stem++) { stems.channels[stem][0][offset] = this.stemSums[stem * 2]; stems.channels[stem][1][offset] = this.stemSums[stem * 2 + 1]; }
      if (stems?.preChannels) for (let stem = 0; stem < stems.preChannels.length; stem++) { stems.preChannels[stem][0][offset] = this.preStemSums[stem * 2]; stems.preChannels[stem][1][offset] = this.preStemSums[stem * 2 + 1]; }
      if (this.displayEnabled && frame + 1 >= this.displayNext) this.finishDisplay(frame + 1);
    }
    this.lastFrame = frameStart + left.length;
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor || class {};
class OwnedSineProcessor extends ProcessorBase {
  constructor(options) {
    super(); this.kernel = this.createKernel(globalThis.sampleRate, options?.processorOptions?.maxVoices || MAX_VOICES, options?.processorOptions);
    this.retired = false;
    this.laneRouteCount = 0; this.laneTapEnabled = new Uint8Array(LIVE_LANE_TAP_LIMIT); this.routeBarriers = new Float64Array(LIVE_LANE_TAP_LIMIT); this.routeBarrierCount = 0;
    this.laneTaps = options?.processorOptions?.laneTapProtocol === LIVE_LANE_TAP_PROTOCOL ? { routeMode: 'mask', routes: new Uint16Array(MAX_VOICES), tokens: new Uint32Array(MAX_VOICES), laneTokens: new Uint32Array(LIVE_LANE_TAP_LIMIT),
      channels: Array.from({ length: LIVE_LANE_TAP_LIMIT }, () => [null, null]), preChannels: Array.from({ length: LIVE_LANE_TAP_LIMIT }, () => [null, null]) } : null;
    this.message = { type: 'receipts', protocol: PROTOCOL, count: 0, data: new Float64Array(64 * RECEIPT_WIDTH) };
    this.displayMessage = { type: 'display-samples', protocol: PROTOCOL, displayProtocol: DISPLAY_PROTOCOL, revision: 0,
      sequence: 0, droppedWindows: 0, count: 0, data: new Float64Array(DISPLAY_VOICES * DISPLAY_WIDTH) };
    this.displayAwaiting = 0;
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'retire-processor' && data.protocol === PROTOCOL && data.retirementProtocol === 1 && Number.isSafeInteger(data.retirementId) && data.retirementId > 0) {
        const frame = this.kernel.lastFrame; this.retired = true; this.kernel = null; this.laneTaps = null; this.port.onmessage = null;
        this.port.postMessage({ type: 'processor-retired', protocol: PROTOCOL, retirementProtocol: 1, retirementId: data.retirementId, stage: 'processor-state-released', frame, renderingContinues: false }); return;
      }
      if (data?.type === 'commands' && data.protocol === PROTOCOL) this.kernel.accept(data.data, data.count, data.packetSequence);
      else if (data?.type === 'panic') {
        this.kernel.panicPending = true; this.kernel.receipt(SCHEDULED, 0, -1, 0, this.kernel.lastFrame, 2);
      }
      else if (data?.type === 'lane-route' && this.laneTaps && data.protocol === LIVE_LANE_TAP_PROTOCOL && Number.isSafeInteger(data.slot) && data.slot >= 0 && data.slot < this.kernel.maxVoices &&
          Number.isSafeInteger(data.token) && data.token > 0 && data.token <= 0xffffffff && Number.isSafeInteger(data.route) && data.route >= 0 && data.route < 2 ** LIVE_LANE_TAP_LIMIT &&
          this.kernel.setLaneIdentity(data.slot, data.token, data.laneToken)) {
        this.laneTaps.routes[data.slot] = data.route; this.laneTaps.tokens[data.slot] = data.token;
      }
      else if (data?.type === 'lane-tap' && this.laneTaps && data.protocol === LIVE_LANE_TAP_PROTOCOL && Number.isInteger(data.index) && data.index >= 0 && data.index < LIVE_LANE_TAP_LIMIT &&
          typeof data.enabled === 'boolean' && Number.isInteger(data.laneToken) && data.laneToken >= 0 && data.laneToken <= LIVE_LANE_ID_LIMIT) {
        this.laneRouteCount += Number(data.enabled) - this.laneTapEnabled[data.index]; this.laneTapEnabled[data.index] = Number(data.enabled);
        this.laneTaps.laneTokens[data.index] = data.enabled ? data.laneToken : 0;
      }
      else if (data?.type === 'lane-route-barrier' && this.laneTaps && data.protocol === LIVE_LANE_TAP_PROTOCOL && Number.isSafeInteger(data.barrierId) && data.barrierId > 0 && Number.isInteger(data.index) && data.index >= 0 && data.index < LIVE_LANE_TAP_LIMIT) { if (!this.routeBarriers[data.index]) this.routeBarrierCount++; this.routeBarriers[data.index] = data.barrierId; }
      else if (data?.type === 'display-config' && data.displayProtocol === DISPLAY_PROTOCOL) this.kernel.configureDisplay(data.tokens, data.intervalFrames, data.revision);
      else if (data?.type === 'display-ack' && data.sequence === this.displayAwaiting) { this.displayAwaiting = 0; this.flushDisplay(); }
      else if (data?.type === 'inspect') this.port.postMessage({ type: 'health', protocol: PROTOCOL, ...(Number.isSafeInteger(data.requestId) && data.requestId > 0 ? { requestId: data.requestId } : {}),
        counters: Array.from(this.kernel.counters), nonfinite: this.kernel.nonfinite, queued: this.kernel.queueLength, frame: this.kernel.lastFrame,
        ...(typeof this.kernel.source?.inspect === 'function' ? { source: this.kernel.source.inspect() } : {}) });
      else this.port.postMessage({ type: 'protocol-error', protocol: PROTOCOL });
      this.flushReceipts();
    };
    this.port.postMessage({ type: 'ready', protocol: PROTOCOL, retirementProtocol: 1, ...this.runtimeIdentity(),
      laneTapProtocol: this.laneTaps ? LIVE_LANE_TAP_PROTOCOL : null, maxLaneTaps: this.laneTaps ? LIVE_LANE_TAP_LIMIT : 0,
      displayProtocol: DISPLAY_PROTOCOL, displayWidth: DISPLAY_WIDTH, displayVoices: DISPLAY_VOICES,
      sampleRate: globalThis.sampleRate, maxVoices: this.kernel.maxVoices, capacity: CAPACITY, width: this.kernel.width });
  }
  createKernel(rate, voices) { return new OwnedSineKernel(rate, voices); }
  runtimeIdentity() { return { engineId: 'worklet-sine', engineVersion: 1, runtimeABI: 'owned-sine-f64-command-v1', buildId: 'owned-sine-v7-owned-retirement' }; }
  flushDisplay() {
    if (this.displayAwaiting || !this.kernel.displayReady) return;
    const message = this.displayMessage; message.count = this.kernel.displayCount; message.sequence = this.kernel.displaySequence;
    message.revision = this.kernel.displayRevision; message.droppedWindows = this.kernel.displayDropped;
    message.data.set(this.kernel.displayData); this.kernel.displayReady = false; this.displayAwaiting = message.sequence; this.port.postMessage(message);
  }
  flushReceipts() {
    if (!this.kernel.receiptCount) return;
    if (this.laneTaps) for (let index = 0; index < this.kernel.receiptCount; index++) {
      const at = index * RECEIPT_WIDTH, code = this.kernel.receipts[at], slot = this.kernel.receipts[at + 2], token = this.kernel.receipts[at + 3];
      if ((code === ENDED || code === FAULTED || code === CANCELLED && !this.kernel.active[slot]) && slot >= 0 && this.laneTaps.tokens[slot] === token) this.laneTaps.routes[slot] = 0;
    }
    let copied = 0;
    while (copied < this.kernel.receiptCount) {
      this.message.count = Math.min(64, this.kernel.receiptCount - copied);
      for (let field = 0; field < this.message.count * RECEIPT_WIDTH; field++) this.message.data[field] = this.kernel.receipts[copied * RECEIPT_WIDTH + field];
      this.port.postMessage(this.message); copied += this.message.count;
    }
    this.kernel.receiptCount = 0;
  }
  process(_inputs, outputs) {
    if (this.retired) { for (const output of outputs) for (const channel of output) channel.fill(0); return false; }
    const output = outputs[0];
    if (!output?.[0]) return true;
    if (this.laneTaps && this.laneRouteCount) for (let index = 0; index < LIVE_LANE_TAP_LIMIT; index++) {
      const pre = outputs[1 + index * 2], post = outputs[2 + index * 2];
      if (!pre?.[0] || !pre[1] || !post?.[0] || !post[1] || pre[0].length !== output[0].length || post[0].length !== output[0].length) { this.kernel.panicPending = true; return false; }
      this.laneTaps.preChannels[index][0] = pre[0]; this.laneTaps.preChannels[index][1] = pre[1]; this.laneTaps.channels[index][0] = post[0]; this.laneTaps.channels[index][1] = post[1];
    }
    this.kernel.render(output[0], output[1], globalThis.currentFrame, this.laneRouteCount ? this.laneTaps : null); this.flushReceipts(); this.flushDisplay();
    if (this.routeBarrierCount) for (let index = 0; index < LIVE_LANE_TAP_LIMIT; index++) if (this.routeBarriers[index]) { const barrierId = this.routeBarriers[index]; this.routeBarriers[index] = 0; this.routeBarrierCount--; this.port.postMessage({ type: 'lane-route-ready', protocol: LIVE_LANE_TAP_PROTOCOL, stage: 'rendered-source-routing', barrierId, frame: globalThis.currentFrame + output[0].length }); }
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-sine-v1', OwnedSineProcessor);

export { OwnedSineKernel, OwnedSineProcessor, PROTOCOL, WIDTH, CAPACITY, MAX_VOICES, RECEIPT_WIDTH,
  DISPLAY_PROTOCOL, DISPLAY_WIDTH, DISPLAY_VOICES, DISPLAY_STATE_WIDTH,
  BEGIN, UPDATE, END, CANCEL, PANIC, LEASE, MIX, SCHEDULED, APPLIED, REJECTED, ENDED, CANCELLED, FAULTED };
