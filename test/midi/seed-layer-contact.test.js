import { expect } from 'chai';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { createSeedLayerContactBinding, planSeedLayerContactBegin, planSeedLayerContactMotion } from '../../js/midi/content/SeedLayerMotion.js';
import { prepareSeedLayerPlan } from '../../js/app/midi-ui/SeedLayerPlan.js';
import { seedLayerDefinition, seedLayerPCM } from '../helpers/seedLayers.js';

const mapping = () => ({ id: 'bowed-contact', sourceKind: 'ContactSpanBegan', causeKind: 'support', pitchCents: 6900, velocity01: 0.6, role: 'contact', route: 'local',
  contactTravel: { spacingPixels: 1000000, lifetimeScope: 'contactSpan', metric: 'endpoint-chord', orientation: 'unsigned', phaseMode: 'contact-stroke', sustain: true } });
const batch = (tick, facts) => ({ version: 1, worldId: 'bowed-world', generation: 1, tick, sourceTimeMs: tick * 20, tickDurationMs: 20, batchId: 'bowed:1:' + tick, completeness: { status: 'complete', dropped: 0 },
  facts: facts.map((fact, index) => ({ causalSequence: tick * 100 + index + 1, eventId: 'bowed:' + tick + ':' + index, subTick: 0, precision: 'tick', actorId: 7, laneId: 0, ...fact })) });
const contact = tick => ({ kind: 'ContactSpanBegan', spanId: 'support:7:1', causeKind: 'support', anchor: { x: 0, y: 10 }, surfaceRevision: 1, observedTick: tick, physicalPayload: { evidence: 'completed-support-cell' } });
const motion = (from, to, extra = {}) => ({ kind: 'MotionCommitted', action: 'walking', contactSpanId: 'support:7:1', positionBefore: { x: from, y: 10 }, positionAfter: { x: to, y: 10 }, physicalPayload: { contactObserved: true, pathEvidence: 'endpoint-chord' }, ...extra });

describe('contact-owned seed travel admission (deferred runtime fixtures)', () => {
  let plan;
  before(async () => { const patch = seedLayerDefinition('bowed-scrap'); patch.seedLayers.motionBinding = createSeedLayerContactBinding(mapping()); plan = prepareSeedLayerPlan(patch, (await seedLayerPCM()).descriptor, 48000); });
  it('retains one actual contact begin through movement, rest, physical reversal, checkpoint and contact end', () => {
    const graph = { version: 1, revision: 1, instruments: [mapping()] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    const beginnings = engine.processBatch(batch(1, [contact(1)])); expect(beginnings.map(intent => intent.kind)).to.deep.equal(['begin']);
    const admitted = planSeedLayerContactBegin(plan, beginnings[0], 0), outbound = engine.processBatch(batch(2, [motion(0, 2)]));
    const snapshot = JSON.parse(JSON.stringify(engine.snapshot())), reopened = createCausalMusicEngine({ getGraph: () => graph }); reopened.restore(snapshot);
    const rest = reopened.processBatch(batch(3, [motion(2, 2)])), returned = reopened.processBatch(batch(4, [motion(2, 1)])), ended = reopened.processBatch(batch(5, [{ kind: 'ContactSpanEnded', spanId: 'support:7:1', reason: 'support-ended' }]));
    const updates = [outbound, rest, returned].flat(); expect(updates.map(intent => intent.kind)).to.deep.equal(['update', 'update', 'update']); expect(new Set([...beginnings, ...updates, ...ended].map(intent => intent.voiceId)).size).to.equal(1); expect(ended.map(intent => intent.kind)).to.deep.equal(['end']);
    const spans = updates.map((intent, index) => planSeedLayerContactMotion(plan, intent, index * 960)); expect(spans.map(span => span.ownerIdentity)).to.deep.equal(new Array(3).fill(admitted.ownerIdentity));
    expect(spans.map(span => [span.from * 2400, span.to * 2400])).to.deep.equal([[0, 200], [200, 200], [200, 300]]); expect(spans.every(span => span.receipt.semanticBegins === 0)).to.equal(true);
    engine.dispose(); reopened.dispose();
  });
  it('does not create a transient from arbitrary motion or continue a contact after unknown coverage or another span', () => {
    const graph = { version: 1, revision: 1, instruments: [mapping()] }, engine = createCausalMusicEngine({ getGraph: () => graph });
    expect(engine.processBatch(batch(1, [motion(0, 1)]))).to.have.length(0);
    const [begin] = engine.processBatch(batch(2, [contact(2)])); expect(() => planSeedLayerContactBegin(plan, { ...begin, physicalSourceKind: 'MotionCommitted' }, 0)).to.throw('real completed contact begin');
    expect(engine.processBatch(batch(3, [motion(1, 2, { contactSpanId: 'another-contact' })])).map(intent => intent.kind)).to.deep.equal(['end']);
    expect(engine.processBatch(batch(4, [motion(2, 3)]))).to.have.length(0); engine.dispose();
  });
  it('declines a contact policy attached to a gate, signed coordinate or unsupported preparation composition', () => {
    for (const change of [value => { value.sourceKind = 'MotionCommitted'; }, value => { value.contactTravel.orientation = 'signedX'; }, value => { value.route = 'midi'; }, value => { value.contactTravel.sustain = false; }]) {
      const value = mapping(); change(value); expect(() => validateCausalInstrumentGraph({ version: 1, revision: 1, instruments: [value] })).to.throw(); expect(() => createSeedLayerContactBinding(value)).to.throw();
    }
  });
});
