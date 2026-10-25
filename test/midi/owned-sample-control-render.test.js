import { expect } from 'chai';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { prepareOwnedPcmSet } from '../../js/app/midi-ui/OwnedPcmSet.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';
import { prepareOwnedSamplePlan } from '../../js/app/midi-ui/OwnedSamplePlan.js';
import { createOwnedSampleControlFixture } from '../../js/app/midi-ui/OwnedSampleControlFixture.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { singleSampleMap } from '../helpers/sampleMap.js';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
const pin = hash => {
  const samples = Float32Array.from({ length: 16000 }, (_, i) => (i % 400 < 4 ? 0.5 : Math.sin(i * 0.04) * 0.2));
  const ref = { contentHash: hash, kind: 'sample', bytes: 64044, frames: samples.length, channels: 1, sourceSampleRate: 48000 };
  const make = () => ({ ref, variant: { contentHash: hash, frames: samples.length, channels: 1, targetSampleRate: 48000, decoderVersion: 'control-fixture-v1' },
    buffer: { length: samples.length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples }, isActive: () => true, retain: make, release: () => true });
  return make();
};
const definition = mode => {
  const sampleMap = singleSampleMap(a, { frames: 16000 }); sampleMap.rendererProfile = 'owned-sample-v1';
  const zone = sampleMap.zones[0]; zone.playbackMode = mode;
  zone.loop = mode === 'positionDriven' ? null : { mode: 'sustain', startFrame: 0, endFrame: 16000, crossfadeFrames: 256, gainLaw: 'linear' };
  if (mode === 'positionDriven') zone.positionPolicy = { boundary: 'wrap', interpolation: 'smoothstep', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 256, gainLaw: 'linear' };
  zone.releaseRegion = { assetHash: b, onsetFrame: 0, endFrame: 16000, rootCents: 6000, tuningCents: 0, gain01: 0.5, pitchRange: { ...zone.pitchRange } };
  return { schemaVersion: 2, id: 'sample-controls', revision: 1, name: 'Sample controls', author: 'Fixture', tags: [], engineId: 'worklet-sample', engineVersion: 1,
    parameters: { attackSeconds: 0.005, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.01 }, modulations: [], macros: [], causalBindings: [],
    sampleRefs: [a, b].map((sha256, index) => ({ id: 'asset-' + index, sha256, bytes: 64044, required: true })), sampleMap,
    voicePolicy: { maxVoices: 1, steal: 'reject' }, mix: { gain01: 0.8, pan01: 0 } };
};

describe('owned multi-asset sample control references (deferred runtime fixtures)', () => {
  for (const mode of ['forward', 'reverse', 'positionDriven']) it('renders selected ' + mode + ' controls and the original release child at each output rate', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'c'.repeat(64) }]);
    expect(descriptor).to.include({ maximumVoices: 2 }); expect(descriptor.capabilities).to.include({ samples: true, advancedSampleMaps: true, offlineRender: true });
    const resources = createAudioResourceLeases(), set = await prepareOwnedPcmSet([pin(a), pin(b)], { resources, owner: 'control-fixture' }), copy = await set.copyForProcessor();
    try {
      const patch = definition(mode), source = { packId: 'fixture', packVersion: '1', contentHash: 'd'.repeat(64), patchIdentity: patch.id + '@1', definitionHash: await hashData(patch), attribution: 'Fixture' };
      let seed;
      for (const sampleRate of [44100, 48000, 96000]) {
        const result = await renderOwnedSourceControls({ definition: patch, descriptor, pcm: copy.payload, source, sampleRate }, { yieldControl: async () => {} });
        expect(result.manifest.sourceBank.bankHash).to.equal(set.descriptor.bankHash); expect(result.manifest.sampleMap).to.include({ physicalSourcePool: 2, logicalVoiceLimit: 1 });
        expect(result.manifest.sampleSelection.region.playbackMode).to.equal(mode); expect(result.manifest.statistics.peak).to.be.greaterThan(0);
        expect(result.manifest.tail.childFrames).to.be.greaterThan(result.manifest.tail.releaseFrames); expect(result.manifest.tail.state).to.equal('all-voices-ended');
        expect(result.manifest).to.include({ physicalTakeEvidence: false, acousticReceipt: false });
        expect(new DataView(result.bytes.buffer).getUint32(44, true)).to.equal(result.manifest.frames);
        if (seed !== undefined) expect(result.manifest.sampleSelection.region.selectionSeed).to.equal(seed); seed = result.manifest.sampleSelection.region.selectionSeed;
        const fixture = createOwnedSampleControlFixture(prepareOwnedSamplePlan(patch, set.descriptor, sampleRate));
        expect(fixture.fixture).to.deep.equal(result.manifest.fixture);
        expect(fixture.fixture.events.filter(event => event.kind === 'position')).to.have.length(mode === 'positionDriven' ? 2 : 0);
      }
    } finally { await copy.release().completion; await set.discard().completion; expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion; }
  });
});
