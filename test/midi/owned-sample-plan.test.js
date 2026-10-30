import { expect } from 'chai';
import { prepareOwnedSamplePlan } from '../../js/app/midi-ui/OwnedSamplePlan.js';
import { createOwnedPcmSetDescriptor } from '../../js/app/resources/OwnedPcmSetVerification.js';
import { validateSampleInstrumentMap, createSampleMapResolver, sampleMapRenderIdentity, OWNED_SAMPLE_MAP_PROFILE } from '../../js/midi/content/SampleInstrumentMap.js';
import { singleSampleMap } from '../helpers/sampleMap.js';

const a = 'a'.repeat(64), b = 'b'.repeat(64), refs = [{ sha256: a, bytes: 1000, required: true }, { sha256: b, bytes: 1000, required: true }];
const bank = (assetHash, sourceRate = 44100, decodedRate = 48000) => ({ schema: 'lemmings-owned-pcm-bank/v1', assetHash, pcmHash: 'c'.repeat(64), bankHash: assetHash,
  format: 'float32-planar-le', sourceFrames: sourceRate, sourceSampleRate: sourceRate, frames: decodedRate, sampleRate: decodedRate, channels: 1, bytes: decodedRate * 4,
  decoderVersion: 'fixture-v1', peak: 0.25, sampleMagnitudeLimit: 16, evidence: 'copied-decoded-pcm-not-acoustic-qualification' });
const advanced = () => {
  const map = singleSampleMap(a, { frames: 44100 }); map.rendererProfile = OWNED_SAMPLE_MAP_PROFILE;
  map.zones[0].onsetFrame = 1; map.zones[0].loop = { mode: 'sustain', startFrame: 101, endFrame: 40001, crossfadeFrames: 441, gainLaw: 'linear' };
  map.zones[0].releaseRegion = { assetHash: b, onsetFrame: 0, endFrame: 32000, rootCents: 6000, tuningCents: 0, gain01: 0.4,
    pitchRange: { minCents: 5400, maxCents: 6600, maxTransposeCents: 600 } }; return map;
};
const patch = map => ({ id: 'sample-plan', revision: 1, parameters: { releaseSeconds: 0.05 }, sampleMap: map, sampleRefs: refs, voicePolicy: { maxVoices: 2 } });
const intent = extra => ({ version: 1, kind: 'begin', worldId: 'world', generation: 1, actorId: 7, onsetId: 'onset', voiceId: 'voice', laneId: 0,
  pitch: { cents: 6000 }, velocity01: 0.5, expression: {}, ...extra });

describe('owned sample map preparation (fixtures deferred with runtime validation)', () => {
  it('leaves legacy render identities unchanged and refuses advanced maps in native playback', () => {
    const legacy = singleSampleMap(a), map = advanced();
    expect(sampleMapRenderIdentity(validateSampleInstrumentMap(legacy, refs))).not.to.have.property('rendererProfile');
    expect(() => validateSampleInstrumentMap(map, refs)).to.throw('renderer profile');
    const first = validateSampleInstrumentMap(map, refs, { rendererProfile: OWNED_SAMPLE_MAP_PROFILE }), changed = structuredClone(map); changed.zones[0].loop.gainLaw = 'equal-power';
    expect(sampleMapRenderIdentity(first)).not.to.deep.equal(sampleMapRenderIdentity(validateSampleInstrumentMap(changed, refs, { rendererProfile: OWNED_SAMPLE_MAP_PROFILE })));
  });
  for (const sampleRate of [44100, 48000, 96000]) it('preserves original frame units, fractional loop period and fixed release selection at ' + sampleRate + ' Hz', async () => {
    const map = advanced(), descriptor = await createOwnedPcmSetDescriptor([bank(b, 32000, 32000), bank(a)]), plan = prepareOwnedSamplePlan(patch(map), descriptor, sampleRate), selected = plan.select(intent());
    const attack = plan.entries[0].attack, loop = attack.loop;
    expect(attack.first).to.equal(48000 / 44100); expect(attack.guardFirst).to.equal(1); expect(attack.guardEnd).to.equal(48000);
    expect(loop.end - loop.first).to.be.closeTo(39900 * 48000 / 44100, 1e-8); expect(loop.crossfade).to.be.closeTo(480, 1e-10);
    expect(loop.seamPolicy).to.equal('fixed-period-symmetric-edge-held-v1'); expect(plan.entries[0].release.assetIndex).to.equal(1);
    expect(selected.readDerivative).to.equal(48000 / sampleRate); expect(selected.releaseReadDerivative).to.equal(32000 / sampleRate);
    expect(plan.select(intent())).to.deep.equal(selected); expect(selected.region.selection.zoneId).to.equal('center-0');
    expect(selected.articulation.releaseSeconds).to.equal(0.05); expect(plan.footprint).to.include({ maximumVoices: 2, layersPerVoice: 2, realTimeCapacityQualified: false });
    expect(Object.isFrozen(plan.descriptor.banks[0])).to.equal(true);
    const shared = createSampleMapResolver(map, refs, { patchId: 'sample-plan', patchRevision: 1, rendererProfile: OWNED_SAMPLE_MAP_PROFILE });
    expect(selected.region).to.deep.equal(shared(intent()));
  });
  it('prepares reverse reads and refuses out-of-domain release pitches before an onset can publish', async () => {
    const descriptor = await createOwnedPcmSetDescriptor([bank(a, 48000, 192000), bank(b, 32000, 32000)]), map = advanced(); map.zones[0].playbackMode = 'reverse';
    const plan = prepareOwnedSamplePlan(patch(map), descriptor, 48000), selected = plan.select(intent()); expect(selected.readDerivative).to.equal(-4);
    expect(() => plan.select(intent({ expression: { pitchOffsetCents: 1 } }))).to.throw('four-decoded-frame');
    const child = advanced(); child.zones[0].releaseRegion.pitchRange = { minCents: 6000, maxCents: 6000, maxTransposeCents: 0 };
    expect(() => prepareOwnedSamplePlan(patch(child), descriptor, 48000).select(intent({ expression: { pitchOffsetCents: -1 } }))).to.throw('Selected attack or release');
  });
  it('prepares position-driven cursor pools with explicit rest, wrap and pitch policies', async () => {
    const map = advanced(); map.zones[0].loop = null; map.zones[0].playbackMode = 'positionDriven'; map.zones[0].positionPolicy = {
      boundary: 'wrap', interpolation: 'smoothstep', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 441, gainLaw: 'linear' };
    const descriptor = await createOwnedPcmSetDescriptor([bank(a), bank(b, 32000, 32000)]), plan = prepareOwnedSamplePlan(patch(map), descriptor, 48000);
    expect(plan.entries[0].attack.cursorProfile).to.include({ capacity: 32, restPolicy: 'hold-cursor-and-fade-to-zero;no-held-sample-DC' });
    expect(plan.entries[0].attack.positionSeam.crossfade).to.be.closeTo(480, 1e-10); expect(plan.footprint.cursorCount).to.equal(2);
    expect(plan.select(intent())).to.include({ readDerivative: 0, pitchPolicy: 'note-selects-zone;observed-position-derivative-owns-varispeed-pitch' });
    expect(() => plan.select(intent({ expression: { pitchOffsetCents: 1 } }))).to.throw('independent pitch offset');
    const invalid = structuredClone(map); invalid.zones[0].positionPolicy.crossfadeFrames = 1;
    expect(() => prepareOwnedSamplePlan(patch(invalid), descriptor, 48000)).to.throw('position-driven policy');
    invalid.zones[0].positionPolicy.crossfadeFrames = 441; invalid.zones[0].loop = advanced().zones[0].loop;
    expect(() => prepareOwnedSamplePlan(patch(invalid), descriptor, 48000)).to.throw('position-driven policy');
  });
  it('refuses a missing release asset and sub-frame decoded loop before allocating renderer voices', async () => {
    const descriptor = await createOwnedPcmSetDescriptor([bank(a), bank(b, 32000, 32000)]), map = advanced();
    expect(() => prepareOwnedSamplePlan({ ...patch(map), sampleRefs: refs.slice(0, 1) }, descriptor, 48000)).to.throw('inventory');
    map.zones[0].loop = { mode: 'forward', startFrame: 1, endFrame: 2, crossfadeFrames: 0, gainLaw: 'linear' };
    expect(() => prepareOwnedSamplePlan(patch(map), descriptor, 48000)).to.throw('decoded loop');
  });
});
