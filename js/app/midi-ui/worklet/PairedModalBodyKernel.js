import { OWNED_STATE_BUNDLE_HEADER, writeOwnedStateBundle, readOwnedStateBundle } from './OwnedStateBundle.js';
import { prepareResonatorBlendBodyProfile, resonatorBlendBodyIdentity } from '../../../midi/content/ResonatorBlendProfile.js';
import { ResonatorBlendKernel } from './ResonatorBlendKernel.js';
import { preparePairedModalBodyProfile, pairedModalBodyIdentity } from '../../../midi/content/PairedModalBodyProfile.js';
import { ResonatorMorphKernel, admitResonatorMorphKernelProfile } from './ResonatorMorphKernel.js';

export class PairedModalBodyKernel {
  constructor({ sampleRate = 48000, parameters, strategy = 'paired' } = {}) {
    if (!['paired', 'blend'].includes(strategy)) throw new TypeError('Choose the explicit paired or prepared-blend body strategy.');
    this.profile = strategy === 'blend' ? prepareResonatorBlendBodyProfile(parameters, sampleRate) : preparePairedModalBodyProfile(parameters, sampleRate); this.identity = strategy === 'blend' ? resonatorBlendBodyIdentity(this.profile) : pairedModalBodyIdentity(this.profile);
    this.strategy = strategy; this.stateIdentity = { kind: 'paired-modal-host', profile: strategy === 'blend' ? this.profile.body.identity : this.profile.parameters.profileIdentity, rate: sampleRate, strategy, inputGain01: this.profile.parameters.inputGain01, authoredMorph01: this.profile.parameters.morph01 };
    this.body = strategy === 'blend' ? new ResonatorBlendKernel(this.profile.body) : new ResonatorMorphKernel(admitResonatorMorphKernelProfile(this.profile.body, this.profile.parameters.profileIdentity));
    this.body.setMorph(this.profile.parameters.morph01); this.frame = this.faults = this.leftSample = this.rightSample = 0; this.muted = false;
  }
  panic() { this.body.panic(); this.leftSample = this.rightSample = 0; this.muted = true; }
  sample(left, right, morph01 = this.profile.parameters.morph01) {
    this.leftSample = this.rightSample = 0;
    if (this.muted) { this.frame++; return; }
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32 || !Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) { this.faults++; this.panic(); this.frame++; return; }
    this.body.sample((left * 0.5 + right * 0.5) / 32 * this.profile.parameters.inputGain01, this.frame++, Math.fround(morph01));
    if (this.body.state[7]) { this.faults++; this.panic(); return; }
    this.leftSample = this.body.leftSample * 0.25; this.rightSample = this.body.rightSample * 0.25;
  }
  get snapshotBytes() { return OWNED_STATE_BUNDLE_HEADER + this.body.snapshotBytes; }
  snapshotInto(bytes) {
    const body = new Uint8Array(this.body.snapshotBytes); this.body.snapshotInto(body);
    return writeOwnedStateBundle(bytes, { identity: this.stateIdentity, frontier: { frame: this.frame, faults: this.faults, leftSample: this.leftSample, rightSample: this.rightSample, muted: this.muted }, components: [{ key: 'body', bytes: body }] });
  }
  restoreFrom(bytes) {
    const { frontier, components } = readOwnedStateBundle(bytes, this.stateIdentity, ['body']);
    if (!Number.isSafeInteger(frontier.frame) || frontier.frame < 0 || !Number.isSafeInteger(frontier.faults) || frontier.faults < 0 || typeof frontier.muted !== 'boolean' || ![frontier.leftSample, frontier.rightSample].every(value => Number.isFinite(value) && Math.abs(value) <= 8)) throw new Error('Invalid paired body host frontier.');
    const staged = new PairedModalBodyKernel({ sampleRate: this.profile.sampleRate, parameters: this.profile.parameters, strategy: this.strategy }); staged.body.restoreFrom(components[0].bytes);
    if (!frontier.muted && (staged.body.state[0] !== frontier.frame - 1 || frontier.leftSample !== staged.body.leftSample * 0.25 || frontier.rightSample !== staged.body.rightSample * 0.25) || frontier.muted && (frontier.leftSample || frontier.rightSample)) throw new Error('Body state and host output frontier disagree.');
    this.body = staged.body; this.frame = frontier.frame; this.faults = frontier.faults; this.leftSample = frontier.leftSample; this.rightSample = frontier.rightSample; this.muted = frontier.muted; return true;
  }
  diagnostics() { return { ...this.body.diagnostics(), frame: this.frame, faults: this.faults, muted: this.muted, input: 'same-owner-stereo-average;fixed-absolute-32-input-reference', output: 'fixed-quarter-readout;absolute-eight-fault-bound', semanticSource: 'unchanged-upstream-owner-sum', restoration: 'graph-deterministic-preroll;private-body-cut-is-not-a-live-host-cut' }; }
}
