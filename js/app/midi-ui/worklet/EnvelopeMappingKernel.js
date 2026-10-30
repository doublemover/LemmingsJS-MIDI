import { prepareEnvelopeMappingProfile, envelopeMappingIdentity } from '../../../midi/content/EnvelopeMappingProfile.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

export class EnvelopeMappingKernel {
  constructor({ sampleRate = 48000, parameters = {} } = {}) {
    if (![44100, 48000, 96000].includes(sampleRate)) throw new RangeError('Unsupported envelope mapping sample rate.');
    this.profile = prepareEnvelopeMappingProfile(parameters); this.parameters = this.profile.parameters; this.identity = envelopeMappingIdentity(this.profile, sampleRate);
    this.state = new Float64Array(1); this.lookup = this.profile.lookupBytes ? new Float32Array(1025) : null;
    if (this.lookup) for (let i = 0; i < this.lookup.length; i++) this.lookup[i] = 10 ** ((this.parameters.neutralDb + this.parameters.polarity * this.parameters.depthDb * i / 1024) / 20);
    this.frame = 0; this.faults = 0; this.muted = false; this.output = 0;
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.identity, arrays: [this.state],
      scalars: [{ name: 'frame', type: 'number' }, { name: 'faults', type: 'number' }, { name: 'muted', type: 'boolean' }, { name: 'output', type: 'number' }], validate: data => {
        if (!Number.isSafeInteger(data.named('frame')) || data.named('frame') < 0 || !Number.isSafeInteger(data.named('faults')) || data.named('faults') < 0 ||
            data.named('output') < 0 || data.named('output') > 1 || data.planes[0].read(0) < 0 || data.planes[0].read(0) > 1) throw new Error('Invalid restored envelope mapping frontier.');
      } });
  }
  panic() { this.muted = true; this.state[0] = this.output = 0; }
  sample(envelope) {
    if (this.muted) { this.output = 0; this.frame++; return; }
    if (!Number.isFinite(envelope) || envelope < 0 || envelope > 1) { this.faults++; this.panic(); this.frame++; return; }
    this.state[0] = envelope;
    if (this.lookup) { const at = envelope * 1024, low = Math.floor(at), fraction = at - low; this.output = Math.min(1, this.lookup[low] + (this.lookup[Math.min(1024, low + 1)] - this.lookup[low]) * fraction); }
    else this.output = Math.max(0, Math.min(1, this.parameters.neutral01 + this.parameters.polarity * this.parameters.depth01 * envelope));
    this.frame++;
  }
  stateByteLength() { return this.stateTransfer.byteLength; }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
}
