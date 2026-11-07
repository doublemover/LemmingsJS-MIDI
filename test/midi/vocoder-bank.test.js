import { expect } from 'chai';
import { prepareVocoderBankProfile } from '../../js/midi/content/VocoderBankProfile.js';
import { VocoderBankKernel } from '../../js/app/midi-ui/worklet/VocoderBankKernel.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';

const edge = (from, fromPort, to, toPort) => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort }, gain01: 1 });
const definition = parameters => ({ schema: 'lemmings-effect-graph/v1', id: 'test.true-vocoder', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 30,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'donor', kind: 'sidechain-in', parameters: { sourceBusId: 'lane:tools', tap: 'pre-fader', inputLayout: parameters.donorLayout || 'audioStereo' } },
    { id: 'bank', kind: 'multiband-vocoder', parameters }, { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [edge('donor', 'audio', 'bank', 'donorAudio'), edge('source', 'audio', 'bank', 'carrierAudio'), edge('bank', 'audio', 'output', 'audio')] });

describe('configurable true multiband cross-excitation (qualification execution deferred)', () => {
  for (const sampleRate of [44100, 48000, 96000]) for (const bands of [8, 16, 32]) {
    it('retains exact spectral state across a cut, ' + bands + ' bands at ' + sampleRate, () => {
      const options = { sampleRate, parameters: { bands, donorLayout: 'audioStereo' } }, first = new VocoderBankKernel(options), second = new VocoderBankKernel(options);
      const profile = first.profile; expect(profile.bands).to.have.length(bands); expect(profile.filterCount).to.equal(bands * 4); expect(profile.lookaheadFrames).to.equal(0);
      expect(profile.bands[0].centerHz).to.be.greaterThan(120); expect(profile.bands.at(-1).centerHz).to.be.lessThan(6000);
      for (let i = 0; i < 731; i++) first.sample(Math.sin(i * 0.13) * 0.5, -Math.sin(i * 0.13) * 0.5, Math.sin(i * 0.04) * 0.2, Math.cos(i * 0.07) * 0.2);
      const bytes = new Uint8Array(first.stateByteLength()); first.snapshotInto(bytes); second.restoreFrom(bytes);
      for (let i = 0; i < 900; i++) { const donor = Math.sin(i * 0.2) * 0.5; first.sample(donor, -donor, 0.3, -0.3); second.sample(donor, -donor, 0.3, -0.3); expect(second.leftSample).to.equal(first.leftSample); expect(second.rightSample).to.equal(first.rightSample); }
      expect(first.faults).to.equal(0); expect(first.state.byteLength + first.coefficients.byteLength).to.equal(profile.stateBytes);
    });
  }
  it('selects the expected analysis band with an independent center-frequency donor', () => {
    const sampleRate = 48000, kernel = new VocoderBankKernel({ sampleRate, parameters: { bands: 16, attackSeconds: 0, releaseSeconds: 0, referenceAmplitude: 1 } }), selected = 7;
    const frequency = kernel.profile.bands[selected].centerHz, envelopes = new Float64Array(16);
    for (let i = 0; i < sampleRate / 3; i++) {
      const donor = Math.sin(2 * Math.PI * frequency * i / sampleRate); kernel.sample(donor, -donor, Math.sin(i * 0.05), Math.sin(i * 0.07));
      if (i > sampleRate / 6) for (let band = 0; band < 16; band++) envelopes[band] += kernel.state[band * 9 + 8];
    }
    expect(envelopes.indexOf(Math.max(...envelopes))).to.equal(selected); expect(kernel.faults).to.equal(0);
    expect(envelopes[selected]).to.be.greaterThan(envelopes[selected - 2] * 1.5); expect(envelopes[selected]).to.be.greaterThan(envelopes[selected + 2] * 1.5);
  });
  it('has no donor-only output, keeps explicit dry carrier independent and quarantines nonfinite input', () => {
    const kernel = new VocoderBankKernel({ parameters: { dry01: 0.5, wetTrim01: 0 } });
    kernel.sample(1, -1, 0, 0); expect(kernel.leftSample).to.equal(0); expect(kernel.rightSample).to.equal(0);
    kernel.sample(0, 0, 0.4, -0.2, false); expect(kernel.leftSample).to.equal(0.2); expect(kernel.rightSample).to.equal(-0.1); expect(kernel.donorAvailable).to.equal(false);
    kernel.sample(NaN, 0, 0.4, 0); expect(kernel.faults).to.equal(1); expect(kernel.muted).to.equal(true); expect(kernel.state.every(value => value === 0)).to.equal(true);
    kernel.sample(1, 1, 1, 1); expect(kernel.leftSample).to.equal(0); expect(kernel.rightSample).to.equal(0);
  });
  it('preserves stereo-linked antiphase energy and releases an absent donor to its baseline', () => {
    const kernel = new VocoderBankKernel({ parameters: { baseline01: 0, referenceAmplitude: 0.25, releaseSeconds: 0.01 } });
    for (let i = 0; i < 8000; i++) { const value = Math.sin(i * 0.1); kernel.sample(value, -value, value * 0.2, value * 0.1); }
    expect(kernel.envelopePeak).to.be.greaterThan(0.1);
    for (let i = 0; i < 96000; i++) kernel.sample(1, 1, Math.sin(i * 0.1), 0, false, true);
    expect(kernel.envelopePeak).to.equal(0); expect(kernel.donorAvailable).to.equal(false); expect(kernel.carrierAvailable).to.equal(true); expect(kernel.faults).to.equal(0);
    expect(Math.abs(kernel.leftSample)).to.be.lessThan(1e-8);
  });
  it('uses the same bank and donor/carrier order inside the actual owned graph', async () => {
    const parameters = { bands: 12, donorLayout: 'audioMono', dry01: 0.1 }, graph = definition(parameters), render = await createOwnedEffectGraphKernel({ definition: graph }), reference = new VocoderBankKernel({ parameters }), donor = new Float32Array(2);
    for (let i = 0; i < 4000; i++) {
      donor[0] = Math.sin(i * 0.11) * 0.4; const left = Math.fround(Math.sin(i * 0.04) * 0.2), right = Math.fround(Math.cos(i * 0.06) * 0.2);
      reference.sample(donor[0], 0, left, right); render.sample(left, right, donor);
      expect(render.leftSample).to.equal(Math.fround(reference.leftSample)); expect(render.rightSample).to.equal(Math.fround(reference.rightSample));
    }
    const receipt = render.diagnostics().vocoderBanks[0]; expect(receipt.profile.bands).to.have.length(12); expect(receipt.profile.parameters.lowHz).to.equal(120); expect(receipt.profile.parameters.highHz).to.equal(6000);
    expect(render.plan.processingCost).to.include({ vocoderBiquadsPerFrame: 36, envelopeFollowersPerFrame: 12 });
  });
  it('rejects unsafe topology, unit mismatch and state from a different bank', async () => {
    for (const parameters of [{ bands: 1000000000 }, { lowHz: NaN }, { bandwidthRatio: 0 }, { baseline01: 0.5, depth01: 0.7 }, { highHz: 12000, lowHz: 80, bands: 8, bandwidthRatio: 2 }, { bandGains: [1] }]) expect(() => prepareVocoderBankProfile(parameters)).to.throw();
    const graph = definition({ donorLayout: 'audioMono' }); graph.nodes.find(node => node.id === 'donor').parameters.inputLayout = 'audioStereo'; expect(() => prepareEffectGraphRevision(graph)).to.throw('typed ports');
    const first = new VocoderBankKernel({ parameters: { bands: 8 } }), second = new VocoderBankKernel({ parameters: { bands: 16 } }), bytes = new Uint8Array(first.stateByteLength()); first.snapshotInto(bytes); expect(() => second.restoreFrom(bytes)).to.throw();
    const a = prepareEffectGraphRevision(definition({ bands: 12 })), b = prepareEffectGraphRevision(definition({ bands: 16 })); expect(await effectGraphHash(a)).not.to.equal(await effectGraphHash(b));
  });
});
