import { expect } from 'chai';
import { createSampleMapResolver, validateSampleInstrumentMap, validateSampleMapAssets, sampleMapRenderIdentity, retainSampleSelectionReceipt } from '../../js/midi/content/SampleInstrumentMap.js';
import { createCausalIntentDispatcher } from '../../js/app/procgen/workstation/CausalIntentDispatcher.js';
import { singleSampleMap } from '../helpers/sampleMap.js';
import { sampleMapControlFixture } from '../../js/midi/content/SoundContentControlFixture.js';
import { hashData } from '../../js/core/CanonicalData.js';

const hash = 'a'.repeat(64), refs = [{ id: 'material', sha256: hash, bytes: 128, required: true }];
const onset = overrides => ({ version: 1, kind: 'begin', voiceId: 'v', onsetId: 'original-onset', worldId: 'world', generation: 1, actorId: 7, laneId: 1,
  mappingId: 'brush-contact', sampleKitId: 'drum', sampleGesture: 'center', pitch: { cents: 6000.12345 }, expression: {}, velocity01: 0.5, ...overrides });
const resolver = map => createSampleMapResolver(map, refs, { patchId: 'fixture', patchRevision: 1 });
const layered = () => {
  const map = singleSampleMap(hash), base = map.zones[0];
  map.zones = [0, 1].flatMap(layer => [0, 1].map(alternate => ({ ...base, id: 'layer-' + layer + '-alt-' + alternate, roundRobinGroup: 'layer-' + layer,
    alternateIndex: alternate, velocityMin01: layer / 2, velocityMax01: (layer + 1) / 2, gain01: 0.4 + layer * 0.4 })));
  return map;
};
describe('authored immutable sample instrument maps', () => {
  it('records bounded actual selection evidence through dispatch without claiming applied samples', () => {
    const region = resolver(layered())(onset()), outcome = { status: 'accepted', stage: 'scheduled', region, rateRatio: 1 };
    const dispatcher = createCausalIntentDispatcher({ sinks: [{ id: 'local', route: 'local', backend: { begin: () => outcome } }], toTargetFrame: () => 48000 });
    const [receipt] = dispatcher.dispatch([{ ...onset(), route: 'local', intentId: 'onset-dispatch', sourceEventIds: [] }], { generation: 1, batchId: 'batch' });
    expect(receipt.selectedSource).to.include({ zoneId: region.selection.zoneId, assetHash: hash, evidenceClass: 'native-source-selection-api', appliedFrame: null, acousticReceipt: false });
    expect(Object.isFrozen(receipt.selectedSource)).to.equal(true);
    expect(retainSampleSelectionReceipt({ ...outcome, region: { ...region, onsetFrame: NaN } })).to.equal(null);
  });
  it('includes the audition gesture in the immutable fixture identity without altering control timing', async () => {
    const map = singleSampleMap(hash); map.articulations.push({ id: 'muted', name: 'Muted' });
    const neutral = sampleMapControlFixture(map), muted = sampleMapControlFixture(map, 'muted');
    expect(neutral.events.map(event => event.seconds)).to.deep.equal(muted.events.map(event => event.seconds));
    expect(muted.events[0].sampleGesture).to.equal('muted'); expect(await hashData(neutral)).not.to.equal(await hashData(muted));
    expect(muted.physicalTakeEvidence).to.equal(false);
  });
  it('resolves discrete velocity boundaries without interpolating or adding another logical onset', () => {
    const select = resolver(layered());
    for (const velocity01 of [0, 0.499999, 0.5, 1]) {
      const region = select(onset({ velocity01 }));
      expect(region.selection.roundRobinGroup).to.equal(velocity01 < 0.5 ? 'layer-0' : 'layer-1');
      expect(region.selection.advanceOn).to.equal('semantic-onset'); expect(Object.isFrozen(region)).to.equal(true);
    }
  });
  it('keeps selection identical after actor traversal changes, rejected playback and resolver reconstruction', () => {
    const map = layered(), select = resolver(map), captured = Array.from({ length: 32 }, (_, index) => onset({ actorId: index, onsetId: 'strike-' + index, voiceId: 'voice-' + index }));
    const baseline = new Map(captured.map(intent => [intent.onsetId, select(intent)]));
    map.zones.reverse(); const restored = resolver(map);
    for (const intent of captured.slice().reverse()) expect(restored(intent)).to.deep.equal(baseline.get(intent.onsetId));
    expect(select(captured[0])).to.deep.equal(baseline.get(captured[0].onsetId));
    expect(new Set([...baseline.values()].map(region => region.selection.alternateIndex)).size).to.equal(2);
  });
  it('keeps an authored event-only fixture selection stable across fresh playback execution generations', () => {
    const select = resolver(layered()), request = onset({ worldId: null, actorId: null, onsetId: 'control-fixture' });
    const a = select(request), b = select({ ...request, generation: 99 });
    expect(a.selectionSeed).to.equal(b.selectionSeed); expect(a.selection).to.deep.equal(b.selection);
    expect(a.selection.identityScope).to.equal('event-only-fallback'); expect(a.chokeScope).not.to.equal(b.chokeScope);
  });
  it('names neutral fallback and isolates exact kit ownership without hashed scope collisions', () => {
    const select = resolver(singleSampleMap(hash)), a = select(onset({ sampleGesture: 'brush' }));
    expect(a.selection).to.include({ neutralFallback: true, requestedArticulationId: 'brush', articulationId: 'center' });
    expect(a.chokeScope).to.equal(select(onset({ mappingId: 'other-contact' })).chokeScope);
    expect(a.chokeScope).not.to.equal(select(onset({ sampleKitId: 'another-kit' })).chokeScope);
    expect(a.chokeScope).not.to.equal(select(onset({ worldId: 'another-world' })).chokeScope);
    expect(() => select({ ...onset(), kind: 'end' })).to.throw('semantic onset');
  });
  it('chooses the nearest authored root with a stable lower tie and respects the pitch reference frequency', () => {
    const map = singleSampleMap(hash), upper = structuredClone(map.zones[0]);
    upper.id = 'upper-root'; upper.roundRobinGroup = 'upper'; upper.rootCents = 7200; upper.pitchRange = { minCents: 6600, maxCents: 7800, maxTransposeCents: 600 }; map.zones.push(upper);
    const select = resolver(map);
    expect(select(onset({ pitch: { cents: 6600 } })).rootCents).to.equal(6000);
    expect(select(onset({ pitch: { cents: 6600.001 } })).rootCents).to.equal(7200);
    expect(select(onset({ pitch: { cents: 6000, referenceHz: 880 } })).rootCents).to.equal(7200);
  });
  it('rejects wrong source bounds, pitch outside the authored range, unsupported crossfades and ambiguous layers', () => {
    const map = singleSampleMap(hash); expect(() => resolver(map)(onset({ pitch: { cents: 6600.001 } }))).to.throw('no authored zone');
    expect(() => validateSampleMapAssets(validateSampleInstrumentMap(map, refs), [{ isActive: () => true, ref: { contentHash: hash, frames: 63, channels: 1 } }])).to.throw('actual pinned source');
    const invalid = structuredClone(map); invalid.zones[0].loop = { mode: 'forward', startFrame: 8, endFrame: 48, crossfadeFrames: 8 };
    expect(() => resolver(invalid)).to.throw('crossfade');
    const overlap = layered(); overlap.zones[2].velocityMin01 = overlap.zones[3].velocityMin01 = 0.4; expect(() => resolver(overlap)).to.throw('overlapping layers');
  });
  it('separates gesture labels and evidence references from effective sample selection identity', () => {
    const first = singleSampleMap(hash), second = structuredClone(first); second.articulations[0].name = 'A new label';
    second.rightsRef = 'other-credits'; second.normalizationRef = 'b'.repeat(64);
    expect(sampleMapRenderIdentity(validateSampleInstrumentMap(first, refs))).to.deep.equal(sampleMapRenderIdentity(validateSampleInstrumentMap(second, refs)));
    second.zones[0].gain01 = 0.6;
    expect(sampleMapRenderIdentity(validateSampleInstrumentMap(first, refs))).not.to.deep.equal(sampleMapRenderIdentity(validateSampleInstrumentMap(second, refs)));
  });
});
