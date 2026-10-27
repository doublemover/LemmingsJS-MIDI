import { validOwnedPcmPlanes } from '../../../midi/content/OwnedPcmFormat.js';
import { OwnedSampleBody } from './OwnedSampleBody.js';
import { SAMPLE_LAYOUT } from '../OwnedSourceLayout.js';
import { SAMPLE_BODY_STATE_OFFSET } from '../../../midi/content/SampleBodyProfile.js';
import { acceptsSampleCursorSegment } from '../../../midi/content/SampleCursorProfile.js';
import { prepareOwnedSamplePlan, OWNED_SAMPLE_VOICES, OWNED_SAMPLE_CURSOR_CAPACITY } from '../OwnedSamplePlan.js';
import { OwnedSampleCursor, OWNED_SAMPLE_CURSOR_SCALARS } from './OwnedSampleCursor.js';
import { OwnedSampleReader } from './OwnedSampleReader.js';
import { canonicalDataText } from '../../../core/CanonicalData.js';

export const OWNED_SAMPLE_STATE_WIDTH = SAMPLE_LAYOUT.state;
const QUEUE = OWNED_SAMPLE_CURSOR_CAPACITY * 7, SCALARS = OWNED_SAMPLE_CURSOR_SCALARS.length;
const discontinuities = Object.freeze(['continuous', 'seek', 'restore', 'topology-rebind']);
const S = Object.freeze({ zone: 0, active: 1, start: 2, frame: 3, position: 4, derivative: 5, released: 6, releaseFrame: 7, releaseFrames: 8, releaseGain: 9,
  attackGain: 10, attackDone: 11, childActive: 12, childPosition: 13, childStart: 14, childEnd: 15, childGain: 16, childDerivative: 17, forced: 18,
  frequency: 19, attack: 20, decay: 21, sustain: 22, turns: 23, looping: 24, token: 25, epoch: 26, generation: 27, heads: 28, seed: 29,
  cycle: 30, childForceFrame: 31, childForceGain: 32, childForceFrames: 33, childVelocity: 34, loopExitPending: 35, childDeadline: 36, filterLeft: 37, filterRight: 38, filterAlpha: 39, filterHz: 40 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;

export class OwnedSampleSource {
  constructor(rate, pcm, patch, voices = patch?.voicePolicy?.maxVoices ?? OWNED_SAMPLE_VOICES, sourceBank) {
    if (!integer(voices, 1, Math.min(OWNED_SAMPLE_VOICES, patch?.voicePolicy?.maxVoices ?? 0))) throw new TypeError('Invalid owned sample voice pool.');
    this.plan = prepareOwnedSamplePlan(patch, pcm?.descriptor, rate); this.descriptor = this.plan.descriptor; this.rate = rate; this.voices = voices;
    if (!Array.isArray(pcm.banks) || pcm.banks.length !== this.descriptor.banks.length) throw new TypeError('Owned sample PCM planes are unavailable.');
    const buffers = new Set();
    this.pcm = pcm.banks.map((bank, index) => {
      const expected = this.descriptor.banks[index];
      if (canonicalDataText(bank.descriptor).text !== canonicalDataText(expected).text || !validOwnedPcmPlanes(bank.planes, expected, buffers)) throw new TypeError('Owned sample private PCM differs from the verified aggregate source.');
      for (const plane of bank.planes) buffers.add(plane.buffer); return Object.freeze([...bank.planes]);
    });
    this.reader = new OwnedSampleReader(sourceBank); this.bank = this.reader.bank; this.stereo = this.descriptor.banks.some(bank => bank.channels === 2); this.ownsEnvelope = true; this.cancelQueuedOnForcedEnd = true; this.maxUpdateMask = 15;
    this.sourceGain = 0.9 / (2 * Math.SQRT2 * this.reader.maximumL1 * Math.max(1, ...this.descriptor.banks.map(bank => bank.peak)));
    this.state = new Float64Array(voices * OWNED_SAMPLE_STATE_WIDTH); this.cursorQueues = new Float64Array(voices * this.plan.entries.length * QUEUE); this.cursorScalars = new Float64Array(voices * this.plan.entries.length * SCALARS);
    this.body = this.plan.body ? new OwnedSampleBody(this.plan.body, this.state, OWNED_SAMPLE_STATE_WIDTH, voices) : null;
    this.cursors = new Array(voices * this.plan.entries.length).fill(null);
    for (let zone = 0; zone < this.plan.entries.length; zone++) if (this.plan.entries[zone].attack.cursorProfile) for (let slot = 0; slot < voices; slot++) {
      const index = zone * voices + slot, entry = this.plan.entries[zone].attack;
      this.cursors[index] = new OwnedSampleCursor(entry.cursorProfile.parameters, { sourceFrame: entry.sourceFirst, queueStorage: this.cursorQueues.subarray(index * QUEUE, (index + 1) * QUEUE) });
    }
    this.configuration = canonicalDataText({ profile: 'owned-sample-source-v5-instance-zones', plan: this.plan.identity, voices }, { maxBytes: 524288, maxNodes: 32768 }).bytes;
    this.beginFrontier = { frame: 0, released: false, length: 0, lastSequence: 0, lastEndFrame: 0, lastEndPosition: 0, lastSeekFrame: 0 };
    this.leftSample = this.rightSample = this.readLeft = this.readRight = 0;
  }
  cursor(slot, zone = this.state[slot * OWNED_SAMPLE_STATE_WIDTH + S.zone]) { return this.cursors[zone * this.voices + slot]; }
  finished(slot) { return this.state[slot * OWNED_SAMPLE_STATE_WIDTH + S.active] === 0; }
  frequencyValid(entry, frequency) {
    if (!finite(frequency, 0.1, this.rate / 2 - 1)) return false;
    const cents = 6900 + 1200 * Math.log2(frequency / 440), ratio = entry.pitchTracking === 'fixed' ? 1 : frequency / entry.rootFrequencyHz, derivative = ratio * entry.decodedSampleRate / this.rate;
    return finite(cents, entry.pitchRange.minCents - 1e-9, entry.pitchRange.maxCents + 1e-9) && finite(ratio, 1 / 16, 16) && (entry.mode === 'positionDriven' || derivative <= 4);
  }
  validFrequency(slot, frequency) {
    const at = slot * OWNED_SAMPLE_STATE_WIDTH, entry = this.plan.entries[this.state[at + S.zone]];
    return !!entry && (!this.body || frequency === this.state[at + S.frequency]) && (entry.attack.mode !== 'positionDriven' || frequency === this.state[at + S.frequency]) && this.frequencyValid(entry.attack, frequency) && (!entry.release || this.frequencyValid(entry.release, frequency));
  }
  begin(slot, frequency, packet, frame) {
    const zone = packet[18], entry = this.plan.entries[zone];
    if (!integer(slot, 0, this.voices - 1) || !integer(frame, 0) || !integer(zone, 0, this.plan.entries.length - 1) || !entry || !this.frequencyValid(entry.attack, frequency) || entry.release && !this.frequencyValid(entry.release, frequency) || !integer(packet[19], 0, 0xffffffff) || packet[31] !== 0 && !finite(packet[31], 80, 20000) || !finite(packet[32], 0, 1) || !finite(packet[33], 0, 1)) return 0;
    if (this.body ? !this.body.accepts(frequency, packet) : packet[39] !== 0) return 0;
    const profile = entry.attack.cursorProfile, initial = packet[21] === 1 ? packet[20] : entry.attack.sourceFirst;
    if (![0, 1].includes(packet[21]) || ![0, 1].includes(packet[30]) || !profile && (packet[21] || packet[30]) || profile && !finite(initial, -profile.maximumCoordinateSourceFrames, profile.maximumCoordinateSourceFrames)) return 0;
    if (packet[30]) {
      const f = this.beginFrontier; f.frame = f.lastEndFrame = frame; f.lastEndPosition = initial; f.lastSeekFrame = -profile.slewFrames;
      if (packet[29] !== 0 || !acceptsSampleCursorSegment(profile, f, packet[24], packet[25], packet[26], packet[27], packet[28], 'continuous')) return 0;
    }
    const at = slot * OWNED_SAMPLE_STATE_WIDTH, s = this.state; s.fill(0, at, at + OWNED_SAMPLE_STATE_WIDTH);
    s[at + S.zone] = zone; s[at + S.active] = 1; s[at + S.start] = s[at + S.frame] = frame;
    s[at + S.position] = entry.attack.mode === 'reverse' ? entry.attack.end - 1 : entry.attack.first; s[at + S.frequency] = frequency;
    s[at + S.attack] = Math.round(packet[10]); s[at + S.decay] = Math.round(packet[11]); s[at + S.sustain] = packet[12]; s[at + S.looping] = Number(!!entry.attack.loop);
    s[at + S.token] = packet[5]; s[at + S.epoch] = packet[0]; s[at + S.generation] = packet[17]; s[at + S.seed] = packet[19];
    const cutoff = packet[31] ? Math.max(80, Math.min(this.rate * 0.4, packet[31] * (1 - packet[32] + packet[32] * packet[33]))) : 0;
    s[at + S.filterHz] = cutoff; s[at + S.filterAlpha] = cutoff && (packet[31] < 20000 || packet[32] > 0) ? 1 - Math.exp(-2 * Math.PI * cutoff / this.rate) : 0;
    this.body?.begin(slot, frequency, packet, frame);
    const cursor = this.cursor(slot); cursor?.reset(frame, initial);
    if (cursor) s[at + S.position] = cursor.decodedPosition;
    if (packet[30] && !cursor.enqueueFields(packet[24], packet[25], packet[26], packet[27], packet[28], 'continuous')) throw new Error('A preflighted initial travel segment changed during onset.');
    return 1;
  }
  validUpdate(slot, mask, packet) {
    if (!(mask & 8)) return true;
    const cursor = this.cursor(slot);
    return !!cursor && !this.state[slot * OWNED_SAMPLE_STATE_WIDTH + S.released] && packet[18] === packet[1] && integer(packet[23], 0, 3) &&
      cursor.canEnqueueFields(packet[18], packet[19], packet[20], packet[21], packet[22], discontinuities[packet[23]]);
  }
  applyUpdate(slot, mask, packet) {
    if (mask & 8) { if (!this.cursor(slot).enqueueFields(packet[18], packet[19], packet[20], packet[21], packet[22], discontinuities[packet[23]])) throw new Error('A preflighted owned cursor segment changed before application.'); }
  }
  envelope(at, frame) {
    const s = this.state;
    if (s[at + S.released]) return s[at + S.releaseGain] * Math.max(0, 1 - (frame - s[at + S.releaseFrame]) / s[at + S.releaseFrames]);
    const age = frame - s[at + S.start], attack = s[at + S.attack], decay = s[at + S.decay];
    return age < attack ? age / attack : age < attack + decay ? 1 - (1 - s[at + S.sustain]) * (age - attack) / decay : s[at + S.sustain];
  }
  validRelease(packet, frame) { return integer(packet[13], 1, this.rate * 4) && [0, 1].includes(packet[20]) && [0, 1].includes(packet[21]) && [0, 1].includes(packet[8]) && (packet[8] === 0 || finite(packet[7], 0, 1)) && (packet[16] === 0 || integer(packet[16], frame + 1)); }
  release(slot, frames, frame, reason = 1, packet = null, parentDeadline = Number.MAX_SAFE_INTEGER) {
    const at = slot * OWNED_SAMPLE_STATE_WIDTH, s = this.state; if (!s[at + S.active] || reason === 1 && s[at + S.released]) return;
    this.body?.release(slot, frames, frame, reason !== 1, parentDeadline);
    const entry = this.plan.entries[s[at + S.zone]], gain = packet?.[21] === 1 && frame === s[at + S.start] ? 0 : this.envelope(at, frame);
    s[at + S.releaseGain] = gain; s[at + S.releaseFrame] = frame; s[at + S.releaseFrames] = Math.max(1, Math.round(frames)); s[at + S.released] = 1;
    if (reason === 1 && entry.attack.loop?.mode === 'sustain') s[at + S.loopExitPending] = 1;
    this.cursor(slot)?.release();
    if (reason !== 1) {
      s[at + S.forced] = 1; s[at + S.childForceFrame] = frame; s[at + S.childForceGain] = s[at + S.childGain]; s[at + S.childForceFrames] = Math.max(1, Math.round(frames)); return;
    }
    if (entry.release) {
      const child = entry.release, deadline = Math.min(parentDeadline, frame + this.rate * 4, packet && integer(packet[16], frame + 1) ? packet[16] : frame + this.rate * 4);
      s[at + S.childActive] = 1; s[at + S.childPosition] = child.first; s[at + S.childStart] = frame; s[at + S.childEnd] = s[at + S.childDeadline] = deadline;
      s[at + S.childVelocity] = packet?.[8] === 1 ? packet[7] : 1; s[at + S.childGain] = 0;
      s[at + S.childActive] = Number(s[at + S.childVelocity] > 0);
    }
  }
  read(region, position, derivative, at) {
    const bank = this.pcm[region.assetIndex], s = this.state;
    const clamped = Math.max(region.first, Math.min(region.end - Number.EPSILON * Math.max(1, region.end) * 2, position));
    s[at + S.heads]++;
    if (s[at + S.heads] > 4 || !this.reader.read(bank[0], bank[1] || null, clamped, derivative, region.guardFirst, region.guardEnd, 'clamp')) { this.readLeft = this.readRight = NaN; return; }
    const gain = this.stereo && bank.length === 1 ? Math.SQRT1_2 : 1;
    this.readLeft = this.reader.leftSample * gain; this.readRight = this.reader.rightSample * gain;
  }
  readLoop(region, position, derivative, at, loop, wrapped) {
    const seam = loop?.crossfade || 0, first = loop?.first ?? region.first, end = loop?.end ?? region.end, phase = position - first, half = seam * 0.5;
    const early = seam && phase < half && (derivative < 0 || wrapped), late = seam && phase > end - first - half && (derivative >= 0 || wrapped);
    if (!early && !late) { this.read(region, position, derivative, at); return; }
    const distance = early ? phase : position - end, amount = (distance + half) / seam;
    this.read(region, Math.min(end - 1, end + distance), distance < 0 ? derivative : 0, at); const tailLeft = this.readLeft, tailRight = this.readRight;
    this.read(region, Math.max(first, first + distance), distance > 0 ? derivative : 0, at);
    const oldGain = loop.gainLaw === 'equal-power' ? Math.cos(amount * Math.PI / 2) : 1 - amount, newGain = loop.gainLaw === 'equal-power' ? Math.sin(amount * Math.PI / 2) : amount;
    this.readLeft = tailLeft * oldGain + this.readLeft * newGain; this.readRight = tailRight * oldGain + this.readRight * newGain;
  }
  sample(slot, frequency, frame) {
    const at = slot * OWNED_SAMPLE_STATE_WIDTH, s = this.state, entry = this.plan.entries[s[at + S.zone]], attack = entry.attack;
    if (frame !== s[at + S.frame]) throw new RangeError('Owned sample voices must consume the shared output frame exactly once.');
    s[at + S.heads] = 0; s[at + S.frequency] = frequency; s[at + S.attackGain] = this.envelope(at, frame);
    let l = 0, r = 0;
    if (!s[at + S.attackDone]) {
      const cursor = this.cursor(slot); let position = s[at + S.position], derivative;
      if (cursor) {
        position = cursor.advance(frame); derivative = cursor.readDerivative;
        const cycle = Math.floor((cursor.position - attack.sourceFirst) / (attack.sourceEnd - attack.sourceFirst));
        if (cycle !== s[at + S.cycle]) { s[at + S.turns]++; s[at + S.cycle] = cycle; }
      } else derivative = (attack.pitchTracking === 'fixed' ? 1 : frequency / attack.rootFrequencyHz) * attack.decodedSampleRate / this.rate * (attack.mode === 'reverse' ? -1 : 1);
      s[at + S.derivative] = derivative;
      if (s[at + S.loopExitPending]) {
        const loop = attack.loop, half = loop.crossfade * 0.5;
        if (position < loop.first || position >= loop.end || position >= loop.first + half && position <= loop.end - half) { s[at + S.looping] = s[at + S.loopExitPending] = 0; }
      }
      const loop = cursor && attack.positionSeam ? attack.positionSeam : s[at + S.looping] && position >= attack.loop.first && position < attack.loop.end ? attack.loop : null;
      if (cursor && cursor.gain === 0 || s[at + S.attackGain] === 0) this.readLeft = this.readRight = 0;
      else this.readLoop(attack, position, derivative, at, loop, s[at + S.turns] > 0);
      if (cursor?.seekMix01 < 1 && cursor.gain > 0 && s[at + S.attackGain] > 0) {
        const currentLeft = this.readLeft, currentRight = this.readRight; this.read(attack, cursor.previousDecodedPosition, 0, at);
        this.readLeft = this.readLeft * (1 - cursor.seekMix01) + currentLeft * cursor.seekMix01; this.readRight = this.readRight * (1 - cursor.seekMix01) + currentRight * cursor.seekMix01;
      }
      const gain = s[at + S.attackGain] * attack.gain01 * (cursor ? cursor.gain : 1); l = this.readLeft * gain; r = this.readRight * gain;
      if (!cursor) {
        position += derivative;
        if (s[at + S.looping] && (derivative > 0 && position >= attack.loop.end || derivative < 0 && position < attack.loop.first)) {
          const span = attack.loop.end - attack.loop.first; position = attack.loop.first + ((position - attack.loop.first) % span + span) % span; s[at + S.turns]++;
        } else if (position < attack.first || position >= attack.end) s[at + S.attackDone] = 1;
      }
      s[at + S.position] = position;
      if (s[at + S.released] && (s[at + S.attackGain] === 0 || frame + 1 >= s[at + S.releaseFrame] + s[at + S.releaseFrames])) s[at + S.attackDone] = 1;
    }
    if (s[at + S.childActive]) {
      const child = entry.release, position = s[at + S.childPosition], derivative = (child.pitchTracking === 'fixed' ? 1 : frequency / child.rootFrequencyHz) * child.decodedSampleRate / this.rate, slew = Math.ceil(this.rate * 0.005);
      if (frame === s[at + S.childStart]) s[at + S.childEnd] = Math.min(s[at + S.childDeadline], frame + Math.ceil((child.end - child.first) / derivative));
      const gain = s[at + S.forced] ? s[at + S.childForceGain] * Math.max(0, 1 - (frame - s[at + S.childForceFrame]) / s[at + S.childForceFrames]) :
        s[at + S.childVelocity] * Math.max(0, Math.min(1, (frame - s[at + S.childStart]) / slew, (s[at + S.childEnd] - frame) / slew));
      this.read(child, position, derivative, at); l += this.readLeft * child.gain01 * gain; r += this.readRight * child.gain01 * gain;
      s[at + S.childDerivative] = derivative; s[at + S.childGain] = gain; s[at + S.childPosition] += derivative;
      if (s[at + S.childPosition] >= child.end || frame + 1 >= s[at + S.childEnd] || s[at + S.forced] && (gain === 0 || frame + 1 >= s[at + S.childForceFrame] + s[at + S.childForceFrames])) s[at + S.childActive] = 0;
    }
    if (s[at + S.released] && s[at + S.attackDone] && !s[at + S.childActive]) s[at + S.active] = 0;
    if (s[at + S.filterAlpha]) {
      s[at + S.filterLeft] += s[at + S.filterAlpha] * (l - s[at + S.filterLeft]); s[at + S.filterRight] += s[at + S.filterAlpha] * (r - s[at + S.filterRight]);
      const end = s[at + S.released] ? Math.max(s[at + S.releaseFrame] + s[at + S.releaseFrames], s[at + S.childActive] ? s[at + S.childEnd] : 0) : Infinity;
      const fade = Math.max(0, Math.min(1, (end - frame - 1) / Math.ceil(this.rate * 0.005)));
      l = s[at + S.filterLeft] * fade; r = s[at + S.filterRight] * fade;
    }
    s[at + S.frame] = frame + 1; this.leftSample = l * this.sourceGain; this.rightSample = r * this.sourceGain;
    if (this.body) { const active = this.body.sample(slot, frame, this.leftSample, this.rightSample, !s[at + S.released] && (this.cursor(slot)?.gain ?? 0) > 0); this.leftSample = this.body.left; this.rightSample = this.body.right; if (active) s[at + S.active] = 1; }
    return (this.leftSample + this.rightSample) * 0.5;
  }
  retire(slot) { this.body?.clear(slot); this.cursor(slot)?.panic(); this.state[slot * OWNED_SAMPLE_STATE_WIDTH + S.active] = 0; }
  synchronizeState() {
    for (let index = 0; index < this.cursors.length; index++) if (this.cursors[index]) for (let field = 0; field < SCALARS; field++) this.cursorScalars[index * SCALARS + field] = this.cursors[index][OWNED_SAMPLE_CURSOR_SCALARS[field]];
  }
  rehydrateState() {
    for (let index = 0; index < this.cursors.length; index++) if (this.cursors[index]) for (let field = 0; field < SCALARS; field++) this.cursors[index][OWNED_SAMPLE_CURSOR_SCALARS[field]] = this.cursorScalars[index * SCALARS + field];
  }
  validateStoredState(read, queue, scalar) {
    for (let slot = 0; slot < this.voices; slot++) {
      const at = slot * OWNED_SAMPLE_STATE_WIDTH, get = field => read(at + field);
      for (let field = 0; field < OWNED_SAMPLE_STATE_WIDTH; field++) if (!Number.isFinite(get(field))) throw new Error('Nonfinite owned sample state.');
      if (![S.active, S.released, S.attackDone, S.childActive, S.forced, S.looping, S.loopExitPending].every(field => [0, 1].includes(get(field))) || !integer(get(S.zone), 0, this.plan.entries.length - 1)) throw new Error('Invalid sample layer or selected region identity.');
      if (!get(S.token)) { for (let field = 0; field < OWNED_SAMPLE_STATE_WIDTH; field++) if (get(field)) throw new Error('Unused sample voice state is noncanonical.'); continue; }
      const entry = this.plan.entries[get(S.zone)], child = entry.release;
      if (!integer(get(S.token), 1, 0xffffffff) || !integer(get(S.epoch), 0) || !integer(get(S.generation), 0) || !integer(get(S.seed), 0, 0xffffffff) ||
          !integer(get(S.start), 0) || !integer(get(S.frame), get(S.start)) || !integer(get(S.releaseFrame), 0, get(S.frame)) || !integer(get(S.releaseFrames), 0, this.rate * 4) ||
          get(S.released) && (!get(S.releaseFrames) || get(S.releaseFrame) < get(S.start)) || ![S.attackGain, S.releaseGain, S.childGain, S.childForceGain, S.childVelocity, S.sustain].every(field => finite(get(field), 0, 1)) ||
          !integer(get(S.attack), 0, this.rate * 2) || !integer(get(S.decay), 0, this.rate * 4) || !integer(get(S.turns), 0) || !integer(get(S.cycle), -1073741824) ||
          !integer(get(S.heads), 0, 4) || !finite(get(S.derivative), -4, 4) || !finite(get(S.position), entry.attack.first - 4, entry.attack.end + 4) || !this.frequencyValid(entry.attack, get(S.frequency)) ||
          get(S.looping) && !entry.attack.loop || get(S.childActive) && (!child || !get(S.released) || !integer(get(S.childStart), get(S.start), get(S.frame)) || !integer(get(S.childEnd), get(S.childStart) + 1, get(S.childStart) + this.rate * 4))) throw new Error('Invalid sample playhead, envelope or release lifetime.');
      if (child && (!finite(get(S.childPosition), 0, child.end + 4) || !finite(get(S.childDerivative), 0, 4) || !this.frequencyValid(child, get(S.frequency)))) throw new Error('Invalid selected release source state.');
      if (get(S.loopExitPending) && (entry.attack.loop?.mode !== 'sustain' || !get(S.released))) throw new Error('Invalid pending sustain loop exit.');
      if (get(S.forced) && (!get(S.released) || !integer(get(S.childForceFrame), get(S.start), get(S.frame)) || !integer(get(S.childForceFrames), 1, this.rate * 4)) ||
          get(S.childActive) && !integer(get(S.childDeadline), get(S.childEnd), get(S.childStart) + this.rate * 4)) throw new Error('Invalid sample cancellation or child deadline.');
      if (get(S.filterHz) !== 0 && get(S.filterHz) < 80 || get(S.filterAlpha) !== 0 && Math.abs(get(S.filterAlpha) - (1 - Math.exp(-2 * Math.PI * get(S.filterHz) / this.rate))) > 1e-12) throw new Error('Owned sample filter coefficient differs from its cutoff.');
      if (!finite(get(S.filterLeft), -128, 128) || !finite(get(S.filterRight), -128, 128) || !finite(get(S.filterAlpha), 0, 1) || !finite(get(S.filterHz), 0, 20000)) throw new Error('Invalid owned sample filter state.');
      for (let field = S.filterHz + 1; field < SAMPLE_BODY_STATE_OFFSET; field++) if (get(field)) throw new Error('Reserved sample state is noncanonical.');
    }
    for (let slot = 0; slot < this.voices; slot++) {
      if (this.body) { const at = slot * OWNED_SAMPLE_STATE_WIDTH; this.body.validate(slot, read, { released: !!read(at + S.released), releaseFrame: read(at + S.releaseFrame) }); if (read(at + SAMPLE_BODY_STATE_OFFSET) && !read(at + S.active)) throw new Error('An active graft body has no logical source owner.'); }
      else for (let field = SAMPLE_BODY_STATE_OFFSET; field < OWNED_SAMPLE_STATE_WIDTH; field++) if (read(slot * OWNED_SAMPLE_STATE_WIDTH + field)) throw new Error('Unprepared graft state is noncanonical.');
    }
    for (let index = 0; index < this.cursors.length; index++) {
      const cursor = this.cursors[index], q = offset => queue(index * QUEUE + offset), value = offset => scalar(index * SCALARS + offset);
      if (cursor) cursor.validateState({ scalar: value, planes: [{ read: q }] });
      else { for (let field = 0; field < QUEUE; field++) if (q(field)) throw new Error('Unprepared sample cursor queue is noncanonical.'); for (let field = 0; field < SCALARS; field++) if (value(field)) throw new Error('Unprepared sample cursor state is noncanonical.'); }
    }
  }
  inspect() {
    const voices = [];
    for (let slot = 0; slot < this.voices; slot++) { const at = slot * OWNED_SAMPLE_STATE_WIDTH, s = this.state; if (!s[at + S.active]) continue;
      const entry = this.plan.entries[s[at + S.zone]]; voices.push({ slot, zoneId: entry.zoneId, token: s[at + S.token], epoch: s[at + S.epoch], generation: s[at + S.generation],
        frame: s[at + S.frame], assetHash: entry.attack.assetHash, sourcePosition: this.cursor(slot)?.position ?? s[at + S.position] * entry.attack.sourceSampleRate / entry.attack.decodedSampleRate,
        rateRatio: entry.attack.pitchTracking === 'fixed' ? 1 : s[at + S.frequency] / entry.attack.rootFrequencyHz, loopActive: !!s[at + S.looping], loopTurns: s[at + S.turns], decodedPosition: s[at + S.position], readDerivative: s[at + S.derivative], mode: entry.attack.mode, childActive: !!s[at + S.childActive], childDecodedPosition: s[at + S.childPosition], readHeads: s[at + S.heads], ...(this.body ? { body: this.body.inspect(slot, s[at + S.frame]) } : {}) }); }
    return { kind: 'owned-sample-source', pcmHash: this.descriptor.pcmHash, bankHash: this.descriptor.bankHash, mapId: this.plan.map.mapId, mapRevision: this.plan.map.revision,
      sourceGain: this.sourceGain, voices, sourceFrames: 'authored-original-rate', decodedFrames: 'private-PCM-rate', panPolicy: 'mono-equal-power-or-stereo-balance', interpolation: this.reader.profile, realTimeCapacityQualified: false };
  }
}
export { S as OWNED_SAMPLE_STATE_FIELDS };
