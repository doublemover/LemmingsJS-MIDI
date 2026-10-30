import { expect } from 'chai';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

const instrument = (id, extra = {}) => ({ id, sourceKind: 'MotionCommitted', pitchCents: 6000, velocity01: 0.75, role: 'percussion', route: 'local', ...extra });
const graph = instruments => ({ version: 1, revision: 1, instruments });
const batch = (tick, from, to) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: 'batch-' + tick, completeness: { status: 'complete', dropped: 0 }, facts: [
  { eventId: 'event-' + tick, causalSequence: tick, kind: 'MotionCommitted', actorId: 7, laneId: 0, positionBefore: { x: from, y: 0 }, positionAfter: { x: to, y: 0 } }] });
const heldGraph = () => graph([instrument('held', { articulation: { spacingPixels: 10, sustain: true, lifetimeScope: 'actorJourney' } }), instrument('other', { sourceKind: 'TerrainWorkCommitted' })]);

describe('canonical producer mapping provenance', () => {
  it('caps optional producer allocations at 512 records and reports the remaining construction count once', () => {
    const current = graph([instrument('work', { sourceKind: 'TerrainWorkCommitted' })]), evidence = [], engine = createCausalMusicEngine({ getGraph: () => current, maxBeginsPerBatch: 4096, onIntentProvenance: value => evidence.push(value) });
    try {
      const source = batch(1, 0, 1); source.facts = Array.from({ length: 300 }, (_, index) => ({ ...source.facts[0], kind: 'TerrainWorkCommitted', eventId: 'event-' + index, causalSequence: index, actorId: index, physicalPayload: { changedSolidCells: 1 } }));
      const intents = engine.processBatch(source); expect(intents).to.have.length(600); expect(evidence.filter(value => value.intentId)).to.have.length(512);
      expect(evidence.filter(value => value.kind === 'omitted')).to.deep.equal([{ version: 1, kind: 'omitted', batchId: 'batch-1', generation: 1, count: 88 }]);
    } finally { engine.dispose(); }
  });
  it('publishes frozen mapping evidence without changing canonical intents, snapshots or delivery', () => {
    const current = heldGraph(), evidence = [], delivered = [], plain = createCausalMusicEngine({ getGraph: () => current }), observed = createCausalMusicEngine({ getGraph: () => current, onIntentProvenance: value => evidence.push(value), deliver: intents => delivered.push(intents) });
    try { const source = batch(1, 0, 6), expected = plain.processBatch(source), actual = observed.processBatch(source);
      expect(actual).to.deep.equal(expected); expect(delivered[0]).to.equal(actual); expect(observed.snapshot()).to.deep.equal(plain.snapshot());
      expect(evidence[0]).to.include({ intentId: actual[0].intentId, mappingId: 'held', graphRevision: 1, mappingRevision: 1, evidence: 'canonical-intent-construction' }); expect(Object.isFrozen(evidence[0])).to.equal(true);
      expect(actual[0]).not.to.have.property('mappingRevision'); expect(actual[0]).not.to.have.property('graphRevision');
    } finally { plain.dispose(); observed.dispose(); }
  });
  it('retains an unchanged definition origin and the old owner when a new graph ends it', () => {
    let current = heldGraph(); const evidence = [], engine = createCausalMusicEngine({ getGraph: () => current, onIntentProvenance: value => evidence.push(value) });
    try { engine.processBatch(batch(1, 0, 6)); current = { ...current, revision: 2, instruments: current.instruments.map(value => value.id === 'other' ? { ...value, pitchCents: 6300 } : value) };
      const update = engine.processBatch(batch(2, 6, 11)).find(value => value.kind === 'update'); expect(evidence.find(value => value.intentId === update.intentId)).to.include({ graphRevision: 2, mappingRevision: 1 });
      current = { ...current, revision: 3, instruments: current.instruments.map(value => value.id === 'held' ? { ...value, pitchCents: 7200 } : value) };
      const changed = engine.processBatch(batch(3, 11, 20)), end = changed.find(value => value.terminationReason === 'mapping-changed'), begin = changed.find(value => value.kind === 'begin');
      expect(evidence.find(value => value.intentId === end.intentId)).to.include({ graphRevision: 3, mappingRevision: 1 }); expect(evidence.find(value => value.intentId === begin.intentId)).to.include({ graphRevision: 3, mappingRevision: 3 });
      expect(end.pitch.cents).to.equal(6000); expect(begin.pitch.cents).to.equal(7200);
    } finally { engine.dispose(); }
  });
  it('restores existing saved definition epochs and leaves absent legacy origins unknown', () => {
    let current = heldGraph(); const source = createCausalMusicEngine({ getGraph: () => current }); const restoredEvidence = [], legacyEvidence = [];
    const restored = createCausalMusicEngine({ getGraph: () => current, onIntentProvenance: value => restoredEvidence.push(value) }), legacy = createCausalMusicEngine({ getGraph: () => current, onIntentProvenance: value => legacyEvidence.push(value) });
    try { source.processBatch(batch(1, 0, 6)); current = { ...current, revision: 2, instruments: current.instruments.map(value => value.id === 'other' ? { ...value, pitchCents: 6300 } : value) }; source.processBatch(batch(2, 6, 11));
      const checkpoint = source.snapshot(); restored.restore(checkpoint); const old = { ...checkpoint }; delete old.instrumentEpochs; legacy.restore(old);
      expect(restored.processBatch(batch(3, 11, 15))).to.deep.equal(source.processBatch(batch(3, 11, 15)));
      const terminal = batch(3, 11, 15); terminal.facts[0].kind = 'ActorTerminated';
      const ended = legacy.processBatch(terminal).find(intent => intent.kind === 'end' && intent.voiceId === checkpoint.active[0].voiceId);
      expect(restoredEvidence[0]).to.include({ graphRevision: 2, mappingRevision: 1 }); expect(legacyEvidence.find(value => value.intentId === ended.intentId)).to.include({ graphRevision: 2, mappingRevision: null });
    } finally { source.dispose(); restored.dispose(); legacy.dispose(); }
  });
  it('isolates a failed optional observer without changing intents or resource retirement', () => {
    const current = heldGraph(), plain = createCausalMusicEngine({ getGraph: () => current }), observed = createCausalMusicEngine({ getGraph: () => current, onIntentProvenance: () => { throw new Error('observer failed'); } });
    try { expect(observed.processBatch(batch(1, 0, 6))).to.deep.equal(plain.processBatch(batch(1, 0, 6))); expect(observed.snapshot()).to.deep.equal(plain.snapshot()); }
    finally { plain.dispose(); observed.dispose(); }
  });
  it('does not treat an inherited Object member as a restored mapping origin', () => {
    const current = graph([instrument('constructor', { articulation: { spacingPixels: 10, sustain: true, lifetimeScope: 'actorJourney' } })]), source = createCausalMusicEngine({ getGraph: () => current }), evidence = [], restored = createCausalMusicEngine({ getGraph: () => current, onIntentProvenance: value => evidence.push(value) });
    try { source.processBatch(batch(1, 0, 6)); const checkpoint = { ...source.snapshot(), instrumentEpochs: {} }; restored.restore(checkpoint); restored.processBatch(batch(2, 6, 11)); expect(evidence[0].mappingRevision).to.equal(null); }
    finally { source.dispose(); restored.dispose(); }
  });
});
