import { prepareSampleCursorProfile, sampleCursorIdentity, acceptsSampleCursorSegment } from '../../../midi/content/SampleCursorProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low = 0, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const kinds = Object.freeze({ continuous: 0, seek: 1, restore: 2, 'topology-rebind': 3 });
export const OWNED_SAMPLE_CURSOR_SCALARS = Object.freeze(['frame', 'head', 'length', 'lastSequence', 'lastEndFrame', 'lastEndPosition', 'position', 'previousPosition', 'crossfadeRemaining', 'gain', 'targetGain', 'gainRemaining', 'rejected', 'segmentsApplied', 'readDerivative', 'lastDiscontinuity', 'released', 'decodedPosition', 'previousDecodedPosition', 'seekMix01', 'lastSeekFrame']);
const scalarNames = OWNED_SAMPLE_CURSOR_SCALARS;
export class OwnedSampleCursor {
  constructor(parameters, { frameOrigin = 0, sourceFrame = parameters.regionStartFrame, queueStorage = null } = {}) {
    this.profile = prepareSampleCursorProfile(parameters); if (!integer(frameOrigin) || !finite(sourceFrame, -this.profile.maximumCoordinateSourceFrames, this.profile.maximumCoordinateSourceFrames)) throw new TypeError('Sample cursor needs an exact start frame and source coordinate.');
    const p = this.profile;
    if (queueStorage !== null && (!(queueStorage instanceof Float64Array) || !(queueStorage.buffer instanceof ArrayBuffer) || queueStorage.length !== p.capacity * p.queueWidth)) throw new TypeError('Invalid prepared sample cursor queue storage.');
    this.queue = queueStorage || new Float64Array(p.capacity * p.queueWidth); this.queue.fill(0); this.frame = frameOrigin; this.head = 0; this.length = 0; this.lastSequence = 0; this.lastEndFrame = frameOrigin; this.lastEndPosition = sourceFrame;
    this.position = sourceFrame; this.previousPosition = sourceFrame; this.crossfadeRemaining = 0; this.gain = this.targetGain = 0; this.gainRemaining = 0; this.rejected = 0; this.segmentsApplied = 0; this.readDerivative = 0; this.lastDiscontinuity = 0; this.released = 0;
    this.decodedPosition = this.map(sourceFrame); this.previousDecodedPosition = this.decodedPosition; this.seekMix01 = 1; this.lastSeekFrame = -p.slewFrames;
    this.transfer = createOwnedEffectState({ kernel: this, identity: sampleCursorIdentity(p), arrays: [this.queue], scalars: scalarNames.map(name => ({ name, type: 'number' })), validate: value => this.validateState(value) });
    if (this.transfer.byteLength !== p.transferBytes) throw new Error('Sample cursor storage differs from its prepared reservation.');
  }
  reset(frameOrigin, sourceFrame = this.profile.regionStartFrame) {
    const p = this.profile; if (!integer(frameOrigin) || !finite(sourceFrame, -p.maximumCoordinateSourceFrames, p.maximumCoordinateSourceFrames)) throw new TypeError('Sample cursor reset needs exact frame-domain coordinates.');
    this.queue.fill(0); this.frame = frameOrigin; this.head = this.length = this.lastSequence = 0; this.lastEndFrame = frameOrigin; this.lastEndPosition = sourceFrame;
    this.position = this.previousPosition = sourceFrame; this.crossfadeRemaining = 0; this.gain = this.targetGain = this.gainRemaining = 0; this.rejected = this.segmentsApplied = this.readDerivative = this.lastDiscontinuity = this.released = 0;
    this.decodedPosition = this.previousDecodedPosition = this.map(sourceFrame); this.seekMix01 = 1; this.lastSeekFrame = -p.slewFrames;
  }
  canEnqueueFields(firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity = 'continuous') {
    return acceptsSampleCursorSegment(this.profile, this, firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity);
  }
  enqueue({ firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity = 'continuous' } = {}) {
    return this.enqueueFields(firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity);
  }
  enqueueFields(firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity = 'continuous') {
    if (!this.canEnqueueFields(firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity)) { this.rejected++; return false; }
    const p = this.profile;
    const at = (this.head + this.length) % p.capacity * p.queueWidth;
    this.queue[at] = firstOutputFrame; this.queue[at + 1] = endOutputFrame; this.queue[at + 2] = firstSourceFrame; this.queue[at + 3] = endSourceFrame; this.queue[at + 4] = kinds[discontinuity]; this.queue[at + 5] = sequence; this.queue[at + 6] = 0;
    if (discontinuity !== 'continuous') this.lastSeekFrame = firstOutputFrame;
    this.length++; this.lastSequence = sequence; this.lastEndFrame = endOutputFrame; this.lastEndPosition = endSourceFrame; return true;
  }
  map(sourceFrame) {
    const p = this.profile, length = p.decodedEnd - p.decodedStart; let value = sourceFrame * p.sourceToDecoded - p.decodedStart;
    if (p.boundary === 'wrap') { value -= Math.floor(value / length) * length; return Math.max(p.decodedStart, Math.min(p.decodedEnd - Number.EPSILON * Math.max(1, p.decodedEnd) * 2, p.decodedStart + value)); }
    if (p.boundary === 'reflect') { const span = length - 1; value -= Math.floor(value / (2 * span)) * 2 * span; if (value > span) value = 2 * span - value; }
    return Math.max(p.decodedStart, Math.min(p.decodedEnd - 1, p.decodedStart + value));
  }

  setGate(value) { if (this.targetGain === value) return; this.targetGain = value; this.gainRemaining = this.profile.slewFrames; }
  advance(frame) {
    if (frame !== this.frame || !integer(frame, 0, Number.MAX_SAFE_INTEGER - 1)) throw new RangeError('Sample cursor must consume the shared output frame exactly once.');
    const p = this.profile; let moving = false; this.readDerivative = 0;
    while (this.length) {
      const at = this.head * p.queueWidth, first = this.queue[at], end = this.queue[at + 1]; if (frame < first) break;
      if (!this.queue[at + 6]) {
        this.queue[at + 6] = 1; this.segmentsApplied++; this.lastDiscontinuity = this.queue[at + 4];
        if (this.lastDiscontinuity) { this.previousPosition = this.position; this.crossfadeRemaining = p.slewFrames; }
      }
      if (frame >= end) { this.position = this.queue[at + 3]; this.queue.fill(0, at, at + p.queueWidth); this.head = (this.head + 1) % p.capacity; this.length--; continue; }
      const t = (frame - first) / (end - first), amount = p.interpolation === 'smoothstep' ? t * t * (3 - 2 * t) : t, distance = this.queue[at + 3] - this.queue[at + 2];
      this.position = this.queue[at + 2] + distance * amount; this.readDerivative = distance * p.sourceToDecoded / (end - first) * (p.interpolation === 'smoothstep' ? 6 * t * (1 - t) : 1);
      moving = distance !== 0 && (p.boundary !== 'stop' || this.position >= p.regionStartFrame && this.position < p.regionEndFrame); break;
    }
    this.setGate(moving && !this.released ? 1 : 0);
    if (this.gainRemaining > 0) { this.gain += (this.targetGain - this.gain) / this.gainRemaining; this.gainRemaining--; }
    if (!this.gainRemaining) this.gain = this.targetGain;
    this.decodedPosition = this.map(this.position); this.previousDecodedPosition = this.map(this.previousPosition);
    this.seekMix01 = this.crossfadeRemaining ? 1 - this.crossfadeRemaining / p.slewFrames : 1;
    if (this.crossfadeRemaining) this.crossfadeRemaining--; this.frame++; return this.decodedPosition;
  }
  release() {
    if (this.released) return false;
    const p = this.profile;
    while (this.length) {
      const at = this.head * p.queueWidth; if (this.queue[at + 1] > this.frame) break;
      this.position = this.queue[at + 3]; this.head = (this.head + 1) % p.capacity; this.length--;
    }
    this.decodedPosition = this.map(this.position); this.previousDecodedPosition = this.map(this.previousPosition);
    this.released = 1; this.queue.fill(0); this.head = this.length = 0; this.readDerivative = 0; this.setGate(0); return true;
  }
  panic() { this.release(); this.gain = this.targetGain = this.gainRemaining = this.crossfadeRemaining = this.readDerivative = 0; this.seekMix01 = 1; }
  stateByteLength() { return this.transfer.byteLength; }
  snapshotInto(bytes) { return this.transfer.write(bytes); }
  restoreFrom(bytes) { return this.transfer.restore(bytes); }
  validateState(value) {
    const read = value.scalar, q = value.planes[0].read, p = this.profile, maximum = p.maximumCoordinateSourceFrames;
    if (!integer(read(0)) || !integer(read(1), 0, p.capacity - 1) || !integer(read(2), 0, p.capacity) || !integer(read(3)) || !integer(read(4)) || !finite(read(5), -maximum, maximum) || !finite(read(6), -maximum, maximum) || !finite(read(7), -maximum, maximum) || !integer(read(8), 0, p.slewFrames) || !finite(read(9), 0, 1) || ![0, 1].includes(read(10)) || !integer(read(11), 0, p.slewFrames) || !integer(read(12)) || !integer(read(13)) || !finite(read(14), -p.maximumReadDerivative, p.maximumReadDerivative) || !integer(read(15), 0, 3) || ![0, 1].includes(read(16)) || read(16) && read(2)) throw new Error('Invalid observed sample cursor state.');
    if (read(17) !== this.map(read(6)) || read(18) !== this.map(read(7)) || !finite(read(19), 0, 1) || !integer(read(20), -p.slewFrames) || read(20) > read(4)) throw new Error('Sample cursor observation differs from its actual coordinates.');
    if (!read(2) && !read(16) && (read(6) !== read(5) || read(4) > read(0))) throw new Error('Sample cursor empty frontier is inconsistent.');
    let previousEnd = -1, previousPosition = null, previousSequence = 0, previousSeek = null;
    for (let index = 0; index < read(2); index++) {
      const at = (read(1) + index) % p.capacity * p.queueWidth, first = q(at), end = q(at + 1), start = q(at + 2), finish = q(at + 3), kind = q(at + 4), sequence = q(at + 5), begun = q(at + 6);
      if (!integer(first, 0) || !integer(end, first + 1) || end - first > p.sampleRate * 2 || first < previousEnd || !finite(start, -maximum, maximum) || !finite(finish, -maximum, maximum) || !integer(kind, 0, 3) || !integer(sequence, previousSequence + 1, read(3)) || ![0, 1].includes(begun) || begun && index !== 0 || index === 0 && (begun ? first >= read(0) || end < read(0) : first < read(0)) || index > 0 && kind === 0 && Math.abs(start - previousPosition) > 1e-7 || Math.abs(finish - start) * p.sourceToDecoded / (end - first) * (p.interpolation === 'smoothstep' ? 1.5 : 1) > p.maximumReadDerivative) throw new Error('Invalid pending sample cursor segment.');
      if (kind) { if (previousSeek !== null && first < previousSeek + p.slewFrames) throw new Error('Sample seek crossfades overlap.'); previousSeek = first; }
      previousEnd = end; previousPosition = finish; previousSequence = sequence;
    }
    if (previousSeek !== null && previousSeek !== read(20)) throw new Error('Sample seek frontier differs from its queued commands.');
    if (read(2) && (previousEnd !== read(4) || previousPosition !== read(5) || previousSequence !== read(3))) throw new Error('Sample cursor frontier differs from its queued history.');
    for (let index = 0; index < p.capacity; index++) { const distance = (index - read(1) + p.capacity) % p.capacity; if (distance >= read(2)) for (let field = 0; field < p.queueWidth; field++) if (q(index * p.queueWidth + field) !== 0) throw new Error('Sample cursor idle queue memory is not clear.'); }
  }
}
