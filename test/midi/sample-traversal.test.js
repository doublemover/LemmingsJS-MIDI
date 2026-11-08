import { expect } from 'chai';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { createTravelAccumulator } from '../../js/app/procgen/workstation/TravelAccumulator.js';
import { prepareSampleCursorProfile } from '../../js/midi/content/SampleCursorProfile.js';
import { planSampleTraversal, validateSampleTraversalBinding } from '../../js/midi/content/SampleTraversal.js';
import { sampleTraversalBinding, sampleTravelGraph, sampleMotionBatch } from '../helpers/sampleTraversal.js';

const entry = (rate, binding = sampleTraversalBinding()) => ({ assetHash: 'a'.repeat(64), sourceFirst: 0, sourceEnd: 24000, sourceSampleRate: 44100,
  traversal: validateSampleTraversalBinding(binding), cursorProfile: prepareSampleCursorProfile({ sampleRate: rate, sourceSampleRate: 44100, decodedSampleRate: 48000,
    sourceFrames: 30000, decodedFrames: Math.round(30000 * 48000 / 44100), regionStartFrame: 0, regionEndFrame: 24000, bankHash: 'b'.repeat(64), mapRevision: 1 }) });

describe('canonical physical sample traversal (deferred runtime fixtures)', () => {
  it('preserves an outbound/rest/return path through walking, falling and landing and across checkpoints', () => {
    const graph = sampleTravelGraph(), engine = createCausalMusicEngine({ getGraph: () => graph });
    const outbound = engine.processBatch(sampleMotionBatch(1, 0, 128))[0];
    const saved = JSON.parse(JSON.stringify(engine.snapshot())), reopened = createCausalMusicEngine({ getGraph: () => graph }); reopened.restore(saved);
    const rest = reopened.processBatch(sampleMotionBatch(2, 128, 128, { action: 'falling' }))[0];
    const returned = reopened.processBatch(sampleMotionBatch(3, 128, 0, { action: 'landing' }))[0];
    expect([outbound.kind, rest.kind, returned.kind]).to.deep.equal(['begin', 'update', 'update']);
    expect(new Set([outbound, rest, returned].map(value => value.voiceId)).size).to.equal(1);
    for (const rate of [44100, 48000, 96000]) {
      const region = entry(rate), results = [outbound, rest, returned].map((intent, i) => planSampleTraversal(region, intent, Math.round(i * 0.06 * rate), rate));
      expect(results.map(result => [result.segment.firstSourceFrame, result.segment.endSourceFrame])).to.deep.equal([[0, 2560], [2560, 2560], [2560, 0]]);
      expect(results[2].segment.endOutputFrame).to.equal(Math.round(0.18 * rate));
      expect(results[0].receipt).to.include({ sourceSampleRate: 44100, framesPerWorldPixel: 20, lifetimeScope: 'actorJourney', acousticReceipt: false });
      expect(new Set(results.map(result => result.ownerIdentity)).size).to.equal(1);
    }
    reopened.dispose(); engine.dispose();
  });
  it('retains ordered committed writes, including a real reversal within one tick', () => {
    const engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() }), batch = sampleMotionBatch(1, 0, 2);
    batch.facts[0].physicalPayload.pathEvidence = 'committed-coordinate-write';
    batch.facts.push({ ...batch.facts[0], eventId: 'motion:1:return', causalSequence: 11, positionBefore: { x: 2, y: 10 }, positionAfter: { x: 1, y: 10 } });
    const intents = engine.processBatch(batch), plans = intents.map(intent => planSampleTraversal(entry(48000), intent, 0, 48000));
    expect(plans.map(plan => [plan.segment.firstSourceFrame, plan.segment.endSourceFrame])).to.deep.equal([[0, 40], [40, 20]]);
    expect(plans[0].segment.endOutputFrame).to.equal(plans[1].segment.firstOutputFrame); expect(plans[1].segment.endOutputFrame).to.equal(2880);
    expect(plans.map(plan => plan.receipt.sourceEventId)).to.deep.equal(['motion:1', 'motion:1:return']); engine.dispose();
  });
  it('keeps contact rubbing out of airborne travel and resets an action-scoped coordinate only on its declared instance', () => {
    const contact = createTravelAccumulator(), action = createTravelAccumulator(), first = sampleMotionBatch(1, 0, 3), next = sampleMotionBatch(2, 3, 8);
    first.facts[0].contactSpanId = next.facts[0].contactSpanId = 'contact:1'; first.facts[0].physicalPayload.contactObserved = true;
    const field = { spacingPixels: 1000000, metric: 'endpoint-chord', orientation: 'unsigned', lifetimeScope: 'contactSpan' };
    expect(contact.consume(first, first.facts[0], 'texture', field).observation.to.contactPathDistancePixels).to.equal(3);
    expect(contact.consume(next, next.facts[0], 'texture', field).status).to.equal('unsupported');
    expect(contact.snapshot().entries).to.have.length(0);
    const scoped = { ...field, lifetimeScope: 'actionInstance' };
    expect(action.consume(first, first.facts[0], 'texture', scoped).observation.to.pathDistancePixels).to.equal(3);
    expect(action.consume(next, next.facts[0], 'texture', scoped).observation.to.pathDistancePixels).to.equal(5);
  });
  it('refuses missing precision, an unsupported pitch-preserving mode and excessive physical read speed', () => {
    const engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() }), intent = engine.processBatch(sampleMotionBatch(1, 0, 128))[0];
    expect(() => planSampleTraversal(entry(48000, sampleTraversalBinding({ requiredPrecision: 'committed-coordinate-write' })), intent, 0, 48000)).to.throw('Canonical travel evidence');
    expect(() => planSampleTraversal(entry(48000, sampleTraversalBinding({ framesPerWorldPixel: 1000000 })), intent, 0, 48000)).to.throw('filtered read-rate');
    expect(() => validateSampleTraversalBinding(sampleTraversalBinding({ mode: 'glass-inscription' }))).to.throw('varispeed direction');
    const missing = structuredClone(intent); delete missing.articulationState.travel;
    expect(() => planSampleTraversal(entry(48000), missing, 0, 48000)).to.throw('Canonical travel evidence'); engine.dispose();
  });
});
