import { expect } from 'chai';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { validatePhysicalTuning, tuningDegree } from '../js/app/procgen/workstation/physical/Tuning.js';
import { minimumMotionAssignment } from '../js/app/procgen/workstation/physical/FormationHarmony.js';

const tuning = { version: 1, id: 'just', kind: 'ratios', values: [[1, 1], [5, 4], [3, 2]], referenceCents: 6000, referenceHz: 440 };
const field = (overrides = {}) => ({ id: 'cavern', revision: 1, geometry: { kind: 'band', bounds: { x1: 0, x2: 100, y1: -10, y2: 10 } }, tuning,
  heldPolicy: 'retune-held', coordinateMap: { mode: 'x-degrees', pixelsPerDegree: 10 }, ...overrides });
const instrument = overrides => ({ id: 'voice', sourceKind: 'ActionEntered', action: 'blocking', pitchCents: 6000, velocity01: 0.8, route: 'local', role: 'held', ...overrides });
const actor = (actorId, x) => ({ actorId, x, y: 0, laneId: 0, action: 'blocking' });
const entry = actorId => ({ kind: 'ActionEntered', actorId, action: 'blocking', actionInstanceId: `block:${actorId}` });
const motion = (actorId, from, to) => ({ kind: 'MotionCommitted', actorId, positionBefore: { x: from, y: 0 }, positionAfter: { x: to, y: 0 }, physicalPayload: { displacementPixels: Math.abs(to - from) } });
const batch = (tick, actors, facts = []) => ({ version: 1, worldId: 'scene', generation: 1, tick, batchId: `scene:1:${tick}`, completeness: { status: 'complete', dropped: 0 },
  snapshot: { worldId: 'scene', generation: 1, tick, revision: tick, actors }, facts: facts.map((fact, index) => ({ laneId: 0, eventId: `fact:${tick}:${index}`, causalSequence: tick * 100 + index, ...fact })) });
const fieldGraph = fields => ({ version: 1, revision: 1, harmonicFields: fields, instruments: [instrument({ harmonicFields: true })] });
const formationGraph = (overrides = {}) => ({ version: 1, revision: 1, instruments: [instrument({ formationId: 'swarm' })],
  ensembles: [{ id: 'crew', selector: { kind: 'lane', laneId: 0 }, membershipMode: 'dynamic', maximumMembers: 64 }],
  formations: [{ id: 'swarm', revision: 1, ensembleId: 'crew', metric: 'laneX', tuning, maximumVoices: 4, spacingPixels: 10, hysteresisPixels: 1, ...overrides }] });

describe('physical harmonic fields and formation voices', () => {
  it('preserves rational declarations and numerical cents independently of renderer quantization', () => {
    const parsed = validatePhysicalTuning(tuning), pitch = tuningDegree(parsed, 1);
    expect(pitch.ratio).to.deep.equal([5, 4]); expect(pitch.cents).to.be.closeTo(6000 + 1200 * Math.log2(5 / 4), 1e-9);
    expect(() => validatePhysicalTuning({ ...tuning, values: [[0, 1]] })).to.throw();
    expect(() => validatePhysicalTuning({ ...tuning, periodCents: 0 })).to.throw();
  });
  it('solves bounded minimum-motion assignments with deterministic ties', () => {
    expect(minimumMotionAssignment([[10, 1], [1, 10]])).to.deep.equal([1, 0]);
    expect(minimumMotionAssignment([[0, 0], [0, 0]])).to.deep.equal([0, 1]);
    expect(() => minimumMotionAssignment(Array.from({ length: 33 }, () => Array(33).fill(0)))).to.throw();
  });
  it('retunes a held physical voice without changing its onset and restores its independent field state', () => {
    const graph = fieldGraph([field()]), engine = createCausalMusicEngine({ getGraph: () => graph });
    const [start] = engine.processBatch(batch(1, [actor(1, 1), actor(2, 21)], [entry(1), entry(2)]));
    const moved = engine.processBatch(batch(2, [actor(1, 11), actor(2, 21)], [motion(1, 1, 11)]));
    expect(moved).to.have.length(1); expect(moved[0]).to.include({ kind: 'update', voiceId: start.voiceId });
    expect(moved[0].expression.pitchOffsetCents).to.be.closeTo(1200 * Math.log2(5 / 4), 1e-9);
    const resumed = createCausalMusicEngine({ getGraph: () => graph }); resumed.restore(engine.snapshot());
    const next = batch(3, [actor(1, 21), actor(2, 21)], [motion(1, 11, 21)]); expect(resumed.processBatch(next)).to.deep.equal(engine.processBatch(next));
  });
  it('owns nested restored voice data and publishes an immutable normalized snapshot', () => {
    const graph = fieldGraph([field()]), engine = createCausalMusicEngine({ getGraph: () => graph }), restored = createCausalMusicEngine({ getGraph: () => graph });
    try {
      engine.processBatch(batch(1, [actor(1, 1)], [entry(1)])); const imported = JSON.parse(JSON.stringify(engine.snapshot())); restored.restore(imported); const accepted = restored.snapshot(), expected = JSON.parse(JSON.stringify(accepted));
      expect(Object.isFrozen(imported.active[0].onsetPitch)).to.equal(false); imported.active[0].onsetPitch.cents += 700; imported.active[0].tonalState.fieldId = 'foreign'; imported.active[0].rootedSourceEventIds[0] = 'foreign-cause';
      expect(restored.snapshot()).to.equal(accepted); expect(accepted).to.deep.equal(expected); expect(Object.isFrozen(accepted.active[0].onsetPitch)).to.equal(true); expect(() => { accepted.active[0].onsetPitch.cents = 0; }).to.throw(TypeError);
      const next = batch(2, [actor(1, 11)], [motion(1, 1, 11)]); expect(restored.processBatch(next)).to.deep.equal(engine.processBatch(next));
    } finally { engine.dispose(); restored.dispose(); }
  });
  it('retains a boundary with hysteresis and never attacks for silent actors or inspector-only edits', () => {
    let graph = fieldGraph([field({ boundary: 'hysteretic', width: 2, coordinateMap: { mode: 'nearest' } })]);
    const engine = createCausalMusicEngine({ getGraph: () => graph }); expect(engine.processBatch(batch(1, [actor(1, 1)]))).to.have.length(0);
    engine.processBatch(batch(2, [actor(1, 1)], [entry(1)]));
    engine.processBatch(batch(3, [actor(1, -1)], [motion(1, 1, -1)]));
    expect(engine.diagnostics().tonal.fields.views[0].field.id).to.equal('cavern');
    graph = { ...graph, revision: 2, harmonicFields: [field({ revision: 2, heldPolicy: 'release-retrigger', coordinateMap: { mode: 'nearest' } })], editCommandId: 'edit:2' };
    expect(engine.processBatch(batch(4, [actor(1, -1)]))).to.have.length(0);
  });
  it('rearticulates only physically rooted held voices on an explicit field edit with both ancestries', () => {
    let graph = fieldGraph([field({ heldPolicy: 'release-retrigger', coordinateMap: { mode: 'nearest' } })]);
    const engine = createCausalMusicEngine({ getGraph: () => graph }); const [start] = engine.processBatch(batch(1, [actor(1, 5), actor(2, 5)], [entry(1)]));
    graph = { ...graph, revision: 2, editCommandId: 'edit:2', harmonicFields: [field({ revision: 2, heldPolicy: 'release-retrigger', tuning: { ...tuning, referenceCents: 6100 }, coordinateMap: { mode: 'nearest' } })] };
    const changed = engine.processBatch(batch(2, [actor(1, 5), actor(2, 5)]));
    expect(changed.map(value => value.kind)).to.deep.equal(['end', 'begin']); expect(changed[1].voiceId).not.to.equal(start.voiceId);
    expect(changed[1].sourceEventIds).to.deep.equal(start.sourceEventIds); expect(changed[1].mappingEdit.commandId).to.equal('edit:2'); expect(changed.every(value => value.actorId === 1)).to.equal(true);
  });
  it('uses followers, not leader position, and keeps assignments invariant under actor-array permutation', () => {
    const graph = formationGraph(), first = [actor(1, 0), actor(2, 1), actor(3, 2), actor(4, 3)];
    const a = createCausalMusicEngine({ getGraph: () => graph }), b = createCausalMusicEngine({ getGraph: () => graph });
    const facts = first.map(value => entry(value.actorId)); expect(a.processBatch(batch(1, first, facts))).to.deep.equal(b.processBatch(batch(1, [...first].reverse(), facts)));
    const spread = [actor(1, -90), actor(2, -60), actor(3, -30), actor(4, 3)], changes = spread.slice(0, 3).map((value, index) => motion(value.actorId, first[index].x, value.x));
    const result = a.processBatch(batch(2, spread, changes)); expect(result).to.deep.equal(b.processBatch(batch(2, [...spread].reverse(), changes)));
    expect(result.some(value => value.kind === 'update')).to.equal(true); expect(result.some(value => value.kind === 'begin')).to.equal(false);
    expect(a.diagnostics().tonal.formations.views[0].spreadTier).to.be.greaterThan(0);
  });
  it('declares aggregation, freeze-voicing and unknown route coordinates rather than inventing harmony', () => {
    const graph = formationGraph({ policy: 'freeze-voicing', maximumVoices: 2 }), engine = createCausalMusicEngine({ getGraph: () => graph });
    const first = [actor(1, 0), actor(2, 1), actor(3, 2), actor(4, 3)]; engine.processBatch(batch(1, first, first.map(value => entry(value.actorId))));
    expect(engine.diagnostics().tonal.formations.views[0]).to.include({ representativeCount: 2, aggregated: 2 });
    expect(engine.processBatch(batch(2, first.map(value => ({ ...value, x: value.x * 100 })), [motion(2, 1, 100)]))).to.have.length(0);
    expect(() => validateCausalInstrumentGraph(formationGraph({ metric: 'routeDistance', routeId: 'missing' }))).to.throw();
    const corrupt = structuredClone(engine.snapshot()); corrupt.tonalInterpretation.formations.states[0].assignments[0].pitch.cents = NaN;
    const before = engine.snapshot(); expect(() => engine.restore(corrupt)).to.throw(); expect(engine.snapshot()).to.deep.equal(before);
  });
});
