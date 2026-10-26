import { OwnedSineKernel, OwnedSineProcessor } from './OwnedSineProcessor.js';
import { OwnedGranularSource } from './OwnedGranularProcessor.js';
import { OwnedSampleReader } from './OwnedSampleReader.js';
import { OwnedSampleBody } from './OwnedSampleBody.js';
import { prepareSeedLayerPlan } from '../SeedLayerPlan.js';
import { SEED_LAYER_LAYOUT, GRANULAR_LAYOUT } from '../OwnedSourceLayout.js';
import { canonicalDataText } from '../../../core/CanonicalData.js';

const WIDTH = SEED_LAYER_LAYOUT.state, CLOUD = GRANULAR_LAYOUT.cloudState, GRAIN = GRANULAR_LAYOUT.grainState;
const S = Object.freeze({ active: 0, token: 1, epoch: 2, generation: 3, start: 4, frame: 5, inputEnd: 6, release: 7, releaseFrames: 8,
  forced: 9, transient: 10, sustained: 11, residual: 12, decay: 13, amplitude: 14, released: 16, frequency: 18, tail: 20, lease: 21, deadline: 22,
  attack: 23, envelopeDecay: 24, sustain: 25, releaseGain: 26 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => { throw new TypeError('Layered seed source: ' + message); };

export class OwnedSeedLayerSource {
  constructor(rate, pcm, patch, voices = SEED_LAYER_LAYOUT.voices, sourceBank = null, auxiliary = {}) {
    this.plan = prepareSeedLayerPlan(patch, pcm?.descriptor, rate);
    if (!integer(voices, 1, SEED_LAYER_LAYOUT.voices) || voices < patch.voicePolicy.maxVoices) fail('Voice capacity does not cover the complete composite patch.');
    if (this.plan.profile.family === 'bowed-scrap') fail('Bowed Scrap requires the contact-begin admission adapter before it can be prepared.');
    this.rate = rate; this.voices = voices; this.descriptor = this.plan.descriptor;
    const buffers = new Set();
    if (!Array.isArray(pcm.banks) || pcm.banks.length !== 3) fail('The three complete component banks are unavailable.');
    this.pcm = pcm.banks.map((bank, index) => {
      const expected = this.descriptor.banks[index];
      if (canonicalDataText(bank.descriptor).text !== canonicalDataText(expected).text || !Array.isArray(bank.planes) || bank.planes.length !== 2 || bank.planes.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.byteOffset !== 0 || plane.byteLength !== plane.buffer.byteLength || plane.length !== expected.frames || buffers.has(plane.buffer))) fail('Private component planes differ from the exact aligned PCM inventory.');
      for (const plane of bank.planes) buffers.add(plane.buffer); return Object.freeze([...bank.planes]);
    });
    this.reader = new OwnedSampleReader(sourceBank); this.bank = this.reader.bank;
    const sustained = this.plan.regions[1].assetIndex;
    this.cloud = new OwnedGranularSource(rate, { descriptor: this.descriptor.banks[sustained], planes: this.pcm[sustained] }, voices, auxiliary['grain-window-v1']);
    this.cloudState = this.cloud.state; this.grains = this.cloud.grains;
    this.state = new Float64Array(voices * WIDTH); this.body = this.plan.body ? new OwnedSampleBody(this.plan.body, this.state, WIDTH, voices) : null;
    this.bodyPacket = new Float64Array(40); this.bodyPacket[34] = 1; this.bodyPacket[35] = this.plan.bodyT60; this.bodyPacket[37] = 1; this.bodyPacket[39] = this.plan.body?.count || 0;
    this.sourceGain = 0.9 / (3 * this.reader.maximumL1 * Math.max(1, ...this.descriptor.banks.map(bank => bank.peak)));
    this.cloudInputGain = 0.9 / (GRANULAR_LAYOUT.grains * this.cloud.sourceGain * Math.max(1, this.cloud.descriptor.peak));
    this.cloudOutputGain = this.body ? 0.75 : 1 / 3;
    this.configuration = canonicalDataText({ profile: 'owned-seed-layers-v1', plan: this.plan.identity, voices }, { maxBytes: 524288, maxNodes: 32768 }).bytes;
    this.stereo = this.ownsEnvelope = this.cancelQueuedOnForcedEnd = true; this.maxUpdateMask = 1023;
    this.leftSample = this.rightSample = 0;
  }
  get birthBucket() { return this.cloud.birthBucket; }
  set birthBucket(value) { this.cloud.birthBucket = value; }
  get bucketBirths() { return this.cloud.bucketBirths; }
  set bucketBirths(value) { this.cloud.bucketBirths = value; }
  finished(slot) { return this.state[slot * WIDTH + S.active] === 0; }
  begin(slot, frequency, packet, frame) {
    const region = this.plan.regions[1];
    if (!integer(slot, 0, this.voices - 1) || !integer(frame, 0) || !integer(packet[16], frame + 1) || !integer(packet[13], 1, this.rate * 4) || packet[24] !== 0 || packet[25] !== region.sourceFrames || packet[27] !== 0 || packet[33] !== 0 || !finite(packet[34], 0, 1) || !finite(packet[35], 0, 1) || !finite(packet[36], 0, 1) || !finite(packet[37], 0.02, 2.5)) return 0;
    for (let field = 38; field < SEED_LAYER_LAYOUT.width; field++) if (packet[field] !== 0) return 0;
    if (!integer(packet[10], 0, this.rate * 2) || !integer(packet[11], 0, this.rate * 4) || !finite(packet[12], 0, 1) || this.body && !this.body.accepts(frequency, this.bodyPacket)) return 0;
    if (this.cloud.begin(slot, frequency, packet, frame) !== 1) return 0;
    const at = slot * WIDTH, s = this.state; s.fill(0, at, at + WIDTH);
    s[at + S.active] = 1; s[at + S.token] = packet[5]; s[at + S.epoch] = packet[0]; s[at + S.generation] = packet[17];
    s[at + S.start] = frame; s[at + S.frame] = frame - 1; s[at + S.inputEnd] = frame + Math.ceil(region.end / region.readDerivative);
    s[at + S.transient] = packet[34]; s[at + S.sustained] = packet[35]; s[at + S.residual] = packet[36];
    s[at + S.decay] = Math.exp(-Math.log(1000) / (packet[37] * this.rate)); s[at + S.amplitude] = 1;
    s[at + S.frequency] = frequency; s[at + S.tail] = packet[13]; s[at + S.lease] = s[at + S.deadline] = packet[16];
    s[at + S.attack] = packet[10]; s[at + S.envelopeDecay] = packet[11]; s[at + S.sustain] = packet[12];
    this.body?.begin(slot, frequency, this.bodyPacket, frame); return 1;
  }
  validFrequency(slot, frequency) { return frequency === this.state[slot * WIDTH + S.frequency] && this.cloud.validFrequency(slot, frequency); }
  validUpdate(slot, mask, packet) { return this.cloud.validUpdate(slot, mask, packet); }
  applyUpdate(slot, mask, packet) { if (!this.state[slot * WIDTH + S.released]) this.cloud.applyUpdate(slot, mask, packet); }
  envelope(at, frame) {
    const s = this.state;
    if (s[at + S.released]) return s[at + S.releaseGain] * Math.max(0, 1 - (frame - s[at + S.release]) / Math.max(1, s[at + S.releaseFrames]));
    const age = frame - s[at + S.start], attack = s[at + S.attack], decay = s[at + S.envelopeDecay];
    return age < attack ? age / attack : age < attack + decay ? 1 - (1 - s[at + S.sustain]) * (age - attack) / decay : s[at + S.sustain];
  }
  release(slot, frames, frame, reason = 1, _packet = null, parentDeadline = Number.MAX_SAFE_INTEGER) {
    const at = slot * WIDTH, s = this.state; if (!s[at + S.active]) return;
    const forced = reason !== 1 && reason !== 7;
    const first = !s[at + S.released];
    if (first || forced) { s[at + S.releaseGain] = this.envelope(at, frame); s[at + S.released] = 1; s[at + S.release] = frame; s[at + S.releaseFrames] = frames; this.cloud.release(slot); }
    s[at + S.deadline] = Math.min(s[at + S.deadline], parentDeadline, frame + frames);
    if (forced) s[at + S.forced] = 1;
    if (first || forced) this.body?.release(slot, frames, frame, forced, s[at + S.deadline]);
  }
  retire(slot) { this.state.fill(0, slot * WIDTH, (slot + 1) * WIDTH); this.cloud.retire(slot); this.cloudState.fill(0, slot * CLOUD, (slot + 1) * CLOUD); this.grains.fill(0, slot * GRANULAR_LAYOUT.grains * GRAIN, (slot + 1) * GRANULAR_LAYOUT.grains * GRAIN); }
  sample(slot, frequency, frame) {
    const at = slot * WIDTH, s = this.state;
    if (!s[at + S.active] || !this.validFrequency(slot, frequency) || !integer(frame, s[at + S.frame] + 1) || frame !== s[at + S.frame] + 1) return NaN;
    s[at + S.frame] = frame;
    if (!s[at + S.released] && frame >= s[at + S.inputEnd]) this.release(slot, s[at + S.tail], frame, 1, null, s[at + S.lease]);
    if (!Number.isFinite(this.cloud.sample(slot, frequency, frame))) return NaN;
    let left = 0, right = 0;
    if (!s[at + S.released]) {
      const region = this.plan.regions[0], position = (frame - s[at + S.start]) * region.readDerivative;
      if (position < region.end) for (let role = 0; role <= 2; role += 2) {
        const planes = this.pcm[this.plan.regions[role].assetIndex], gain = s[at + (role === 0 ? S.transient : S.residual)] * (role === 0 ? 1 : s[at + S.amplitude]) * this.sourceGain;
        if (!this.reader.read(planes[0], planes[1], position, region.readDerivative, 0, region.end, 'zero')) return NaN;
        left += this.reader.leftSample * gain; right += this.reader.rightSample * gain;
      }
    }
    s[at + S.amplitude] *= s[at + S.decay];
    const fade = this.envelope(at, frame) * Math.max(0, Math.min(1, (s[at + S.deadline] - frame - 1) / Math.ceil(this.rate * 0.005)));
    let sustainedL = this.cloud.leftSample * this.cloudInputGain, sustainedR = this.cloud.rightSample * this.cloudInputGain;
    if (this.body) { this.body.sample(slot, frame, sustainedL, sustainedR, !s[at + S.released]); sustainedL = this.body.left; sustainedR = this.body.right; }
    this.leftSample = (left + sustainedL * s[at + S.sustained] * this.cloudOutputGain) * fade; this.rightSample = (right + sustainedR * s[at + S.sustained] * this.cloudOutputGain) * fade;
    if (frame + 1 >= s[at + S.deadline]) { s[at + S.active] = 0; this.cloud.retire(slot); }
    return (this.leftSample + this.rightSample) * 0.5;
  }
  synchronizeState() {}
  rehydrateState() { this.cloud.leftSample = this.cloud.rightSample = this.reader.leftSample = this.reader.rightSample = 0; }
  inspect() { return { kind: 'owned-seed-layers', family: this.plan.profile.family, semanticSources: this.state.filter((value, index) => index % WIDTH === S.active && value === 1).length,
    childRoles: this.plan.profile.components.map(component => component.role), parentBackingLayers: 0, completePcmBytes: this.descriptor.bytes, sourceBanks: this.plan.sourceBanks, cloud: this.cloud.inspect(), quality: 'creative-revoice;not-neutral-reconstruction-or-qualified-warp' }; }
  validateStoredState(read, cloud, grain, context) {
    for (let slot = 0; slot < this.voices; slot++) {
      const at = slot * WIDTH, get = field => read(at + field), ca = slot * CLOUD;
      if (!context.active(slot)) {
        for (let field = 0; field < WIDTH; field++) if (get(field)) fail('Inactive source state is not canonical.');
        for (let field = 0; field < CLOUD; field++) if (cloud(ca + field)) fail('Inactive cloud state is not canonical.');
        for (let field = 0; field < GRANULAR_LAYOUT.grains * GRAIN; field++) if (grain(slot * GRANULAR_LAYOUT.grains * GRAIN + field)) fail('Inactive grain state is not canonical.');
        continue;
      }
      if (![S.active, S.released, S.forced].every(field => [0, 1].includes(get(field))) || get(S.token) !== context.voice(slot, 2) || get(S.epoch) !== context.voice(slot, 0) || get(S.generation) !== context.voice(slot, 1) || get(S.start) !== context.voice(slot, 15) || !integer(get(S.frame), get(S.start) - 1, context.frame) || !integer(get(S.lease), get(S.start) + 1) || !integer(get(S.deadline), get(S.start) + 1, get(S.lease)) || !integer(get(S.tail), 1, this.rate * 4) || !finite(get(S.frequency), 20, 2000) || !finite(get(S.decay), 0, 1) || !finite(get(S.amplitude), 0, 1) || ![S.transient, S.sustained, S.residual].every(field => finite(get(field), 0, 1))) fail('Composite identity, source clock, gain or lifetime differs.');
      if (get(S.inputEnd) !== get(S.start) + Math.ceil(this.plan.regions[0].end / this.plan.regions[0].readDerivative) || get(S.released) && (!integer(get(S.release), get(S.start), context.frame) || !integer(get(S.releaseFrames), 1, this.rate * 4) || get(S.deadline) > get(S.release) + get(S.releaseFrames)) || !get(S.released) && (get(S.release) || get(S.releaseFrames) || get(S.deadline) !== get(S.lease))) fail('Child closure frontier differs from its parent.');
      if (!integer(get(S.attack), 0, this.rate * 2) || !integer(get(S.envelopeDecay), 0, this.rate * 4) || !finite(get(S.sustain), 0, 1) || !finite(get(S.releaseGain), 0, 1) || !get(S.released) && get(S.releaseGain) || !finite(get(S.decay), Math.exp(-Math.log(1000) / (0.02 * this.rate)), Math.exp(-Math.log(1000) / (2.5 * this.rate)))) fail('Envelope or independent residual loss exceeds the prepared range.');
      for (let field = 0; field < 48; field++) if (!Object.values(S).includes(field) && get(field)) fail('Reserved layered source state is nonzero.');
      if (this.body) this.body.validate(slot, read, { released: !!get(S.released), releaseFrame: get(S.release) });
      else for (let field = 48; field < WIDTH; field++) if (get(field)) fail('A dry layer has undeclared modal state.');
      if (!integer(cloud(ca), 0, 0xffffffff) || ![15, 17, 18, 37].every(field => [0, 1].includes(cloud(ca + field))) || cloud(ca + 17) !== 0 || cloud(ca + 22) !== 0 || cloud(ca + 23) !== this.plan.regions[1].end || cloud(ca + 40) !== get(S.epoch) || cloud(ca + 41) !== get(S.generation) || cloud(ca + 42) !== get(S.token) || cloud(ca + 38) !== get(S.frame) || cloud(ca + 21) !== Number(!get(S.released) && get(S.active))) fail('Sustained child has a different clock, region or owner.');
      const ranges = [[0, 1], [0, 48], [Math.round(this.rate * 0.02), Math.round(this.rate * 0.14)], [0, 1], [0, 1], [0, 1]];
      for (let field = 0; field < ranges.length; field++) for (const first of [2, 8]) if (!finite(cloud(ca + first + field), ...ranges[field])) fail('Sustained child control exceeds its bounded cloud profile.');
      if (!integer(cloud(ca + 14), 0, this.rate * 4) || !finite(cloud(ca + 16), 0, 1) || !finite(cloud(ca + 19), 20, 20000) || !finite(cloud(ca + 20), 0, 1 + 48 / this.rate) || !finite(cloud(ca + 24), 0.25, 4) || cloud(ca + 25) !== get(S.frequency) * 2 ** (-400 / 1200) || cloud(ca + 26) !== get(S.frequency) * 2 ** (400 / 1200) || ![1, 27, 28, 29, 30].every(field => integer(cloud(ca + field), 0)) || !finite(cloud(ca + 31), 0, 48) || ![32, 33].every(field => finite(cloud(ca + field), -4, 4)) || !finite(cloud(ca + 34), 0, 1) || !integer(cloud(ca + 35), -1, 7) || cloud(ca + 36) || !finite(cloud(ca + 39), 0, 1) || cloud(ca + 43)) fail('Sustained child filter, pitch or grain admission state is invalid.');
      let active = 0;
      for (let index = 0; index < GRANULAR_LAYOUT.grains; index++) {
        const offset = (slot * GRANULAR_LAYOUT.grains + index) * GRAIN, remaining = grain(offset); if (!remaining) continue; active++;
        if (!integer(remaining, 1, Math.ceil(this.rate * 0.14)) || !integer(grain(offset + 1), remaining, Math.ceil(this.rate * 0.14)) || ![2, 6].every(field => finite(grain(offset + field), -16777216, 16777216)) || !finite(grain(offset + 3), -16, 16) || !integer(grain(offset + 7), 1, cloud(ca + 1)) || grain(offset + 8) !== get(S.token) || !integer(grain(offset + 9), get(S.start), get(S.frame)) || grain(offset + 4) !== this.cloud.sourceGain || [5, 10, 11, 12, 13].some(field => grain(offset + field))) fail('A grain exceeds the composite lifetime or fixed child budget.');
      }
      if (active !== cloud(ca + 27)) fail('The sustained child count differs from its saved grains.');
    }
  }
}
export class OwnedSeedLayerKernel extends OwnedSineKernel {
  constructor(rate, pcm, patch, voices = SEED_LAYER_LAYOUT.voices, sourceBank = null, auxiliary = {}) { super(rate, voices, { width: SEED_LAYER_LAYOUT.width, source: new OwnedSeedLayerSource(rate, pcm, patch, voices, sourceBank, auxiliary) }); }
}
export class OwnedSeedLayerProcessor extends OwnedSineProcessor {
  createKernel(rate, voices, options) { return new OwnedSeedLayerKernel(rate, options?.pcm, options?.samplePatch, Math.min(voices, SEED_LAYER_LAYOUT.voices), options?.sourceBank, options?.auxiliarySourceBanks); }
  runtimeIdentity() { const source = this.kernel.source; return { engineId: 'worklet-seed-layers', engineVersion: 1, runtimeABI: 'owned-seed-layers-f64-command-v1', buildId: 'owned-seed-layers-v1', sourceBankHash: source.bank.hash,
    auxiliarySourceBankHashes: { 'grain-window-v1': source.cloud.bank.hash }, pcmBankHash: source.descriptor.bankHash, samplePlanIdentity: source.plan.identity }; }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('lemmings-owned-seed-layers-v1', OwnedSeedLayerProcessor);
