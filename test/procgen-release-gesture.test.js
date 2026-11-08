import { expect } from 'chai';
import { validateReleaseGesture, releaseLanePhases, validatePopulationReleaseState } from '../js/app/procgen/ReleaseGesture.js';
import { ProcgenPopulationPolicy } from '../js/app/procgen/ProcgenPopulationPolicy.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenWorkstationProject, reduceCanonicalProcgenProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
const gesture = extra => validateReleaseGesture({ version: 1, id: 'spray', revision: 1, nominalGapTicks: 17, spreadTicks: 12, finiteBurstCount: 5, grouping: 'cohort-spray', clockMode: 'locked', lanePhase: [], phaseStepTicks: 1, liveChangeBoundary: 'next-cohort', seed: 42, ...extra });
const command = (world, id = 'gesture-command', extra = {}) => ({ id, kind: 'set-release-gesture', origin: 'manual', target: { generation: world.generation }, parameters: { gesture: gesture(extra) } });
const advance = (world, tick, presentation = 0) => { while (world.tickIndex < tick) world.step(typeof presentation === 'function' ? presentation(world.tickIndex) : presentation + world.tickIndex * 3); };
describe('physical release gesture ownership', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  const world = options => { const result = new ProcgenLaneWorld({ masks, seed: 42, laneCount: 8, cohorts: true, assists: false, maxActors: 128, stallPolicy: { releaseIntervalTicks: 17, secondsWithoutProgress: 1000 }, ...options }); result.baseGroundAt = (_x, y) => y % result.laneHeight >= result.laneHeight - 16 ? 1 : 0; return result; };
  it('validates bounded integer ticks and canonical lane phases before publication', () => {
    for (const extra of [{ spreadTicks: 17 }, { nominalGapTicks: 1.1 }, { finiteBurstCount: 4097 }, { paused: 'false' }, { lanePhase: [{ laneId: 0, offsetTicks: 1 }, { laneId: 0, offsetTicks: 2 }] }]) expect(() => gesture(extra)).to.throw();
    const policy = new ProcgenPopulationPolicy(8), before = policy.snapshot(); expect(() => policy.setReleaseGesture({ ...gesture(), lanePhase: [{ laneId: 8, offsetTicks: 0 }] })).to.throw(); expect(policy.snapshot()).to.deep.equal(before);
    const a = releaseLanePhases(gesture(), { laneCount: 128, generation: 1, cohortOrdinal: 3, worldSeed: 42 }); expect([...a]).to.deep.equal([...releaseLanePhases(gesture(), { laneCount: 128, generation: 1, cohortOrdinal: 3, worldSeed: 42 })]); expect(Math.max(...a)).to.be.at.most(12);
    const shifted = gesture({ grouping: 'phase-shift', lanePhase: [{ laneId: 0, offsetTicks: 3 }] }); expect(releaseLanePhases(shifted, { laneCount: 8, generation: 1, cohortOrdinal: 1 })[0]).to.equal(4);
  });
  it('freezes the admitted cohort, switches at the future boundary, and separates locked pressure', () => {
    const p = new ProcgenPopulationPolicy(8, 17, {}, true); p.phaseAt(4, 0); const start = p.cohortStartTick, spread = p.cohortSpreadTicks;
    p.setReleaseGesture(gesture({ nominalGapTicks: 31, spreadTicks: 3 }), 'request'); expect(p.cohortStartTick).to.equal(start); expect(p.cohortSpreadTicks).to.equal(spread); expect(p.nextCohortTick).to.equal(32);
    p.phaseAt(32, 100000); expect(p.cohortSpreadTicks).to.equal(3); expect(p.intervalTicks).to.equal(31); expect(p.releaseGestureCommandId).to.equal('request');
    p.setReleaseGesture(gesture({ revision: 2, clockMode: 'adaptive' })); p.phaseAt(p.nextCohortTick, 100000); expect(p.intervalTicks).to.be.greaterThan(17);
  });
  it('installs a finite initial score before the first real cohort without fabricating a manual command', () => {
    for (const paused of [false, true]) {
      const initial = gesture({ id: 'initial-score', finiteBurstCount: 2, spreadTicks: 12, lanePhase: [{ laneId: 0, offsetTicks: 0 }, { laneId: 1, offsetTicks: 12 }], grouping: 'free', paused });
      const w = world({ laneCount: 2, initialReleaseGesture: initial }), facts = []; w.soundEvents.onBatch.on(batch => facts.push(...batch.facts));
      expect(w.tickIndex).to.equal(0); expect(w.activeCount).to.equal(0); expect(w.population.pendingReleaseGesture).to.equal(null); expect(w.population.releaseGesture).to.deep.equal(initial);
      advance(w, 120); const births = facts.filter(fact => fact.kind === 'ActorBorn'); expect(births).to.have.length(paused ? 0 : 2);
      if (!paused) { expect(births.map(fact => fact.spawnTick)).to.deep.equal([1, 13]); expect(births.every(fact => !fact.releaseGesture.sourceCommandId)).to.equal(true); expect(w.population.gestureRun.remaining).to.equal(0); }
      expect(facts.some(fact => fact.kind === 'ReleaseGestureRequested')).to.equal(false); expect(() => w.population.initializeReleaseGesture(initial)).to.throw('before any cohort');
      w.dispose();
    }
  });
  it('counts five attempted slots once; capacity misses never become backlog or phantom births', () => {
    for (const cap of [8, 128]) {
      const w = world({ maxActors: cap }), facts = []; w.soundEvents.onBatch.on(batch => facts.push(...batch.facts)); w.prepareIntervention(command(w)).commit(); advance(w, 60);
      const births = facts.filter(f => f.kind === 'ActorBorn' && f.releaseGesture?.id === 'spray'), misses = facts.filter(f => f.kind === 'BirthAdmissionMissed' && f.gestureId === 'spray');
      expect(births.length + misses.length).to.equal(5); expect(births).to.have.length(cap === 8 ? 0 : 5); expect(w.population.gestureRun.status).to.equal('exhausted');
      expect(facts.some(f => f.kind === 'ReleaseGestureRequested' && f.sourceCommandId === 'gesture-command')).to.equal(true); expect(facts.some(f => f.kind === 'ReleaseScheduleCommitted' && f.requestedGapTicks === 17 && f.clockMode === 'locked')).to.equal(true);
      w.maxActors = 256; advance(w, 120); expect(facts.filter(f => f.kind === 'ActorBorn' && f.releaseGesture?.id === 'spray')).to.have.length(births.length); w.dispose();
    }
  });
  it('roots downstream attacks only in actual moving actors with renderer-independent command logs', () => {
    const run = presentation => {
      const w = world(), graph = { version: 1, revision: 1, instruments: [{ id: 'gate', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 6000, velocity01: 0.5, role: 'gate', route: 'local' }] }, engine = createCausalMusicEngine({ getGraph: () => graph }), births = new Map(), attacks = [], birthFacts = [];
      w.soundEvents.onBatch.on(batch => { for (const f of batch.facts) if (f.kind === 'ActorBorn' && f.releaseGesture) { births.set(f.actorId, f); birthFacts.push(f); } for (const intent of engine.processBatch(batch)) if (intent.kind === 'begin' && births.has(intent.actorId)) attacks.push({ tick: batch.tick, actorId: intent.actorId, sourceEventIds: intent.sourceEventIds }); });
      w.prepareIntervention(command(w)).commit(); advance(w, 160, presentation); expect(birthFacts).to.have.length(5); expect(attacks).to.have.length(5); for (const note of attacks) expect(note.tick).to.be.greaterThan(births.get(note.actorId).spawnTick); for (const birth of birthFacts) expect(birth.parentCauseIds).to.include('gesture-command');
      const result = { births: birthFacts, attacks }; w.dispose(); engine.dispose(); return result;
    };
    const reference = run(0); expect(run(100000)).to.deep.equal(reference);
    expect(run(tick => Math.floor(tick / 8) * 1000 / 30)).to.deep.equal(reference);
    expect(run(tick => Math.floor(tick / 2) * 1000 / 144)).to.deep.equal(reference);
  });
  it('restores partially consumed finite policies and command identities without repeating slots', () => {
    const a = world(), b = world(), factsA = [], factsB = []; a.prepareIntervention(command(a)).commit(); advance(a, 20); restoreProcgenCheckpoint(b, JSON.parse(JSON.stringify(captureProcgenCheckpoint(a))));
    a.soundEvents.onBatch.on(value => factsA.push(value)); b.soundEvents.onBatch.on(value => factsB.push(value)); advance(a, 90); advance(b, 90, 9999); expect(factsB).to.deep.equal(factsA); expect(b.population.snapshot()).to.deep.equal(a.population.snapshot()); a.dispose(); b.dispose();
  });
  it('clears unfinished finite runs at generation reset and rejects malformed continuation', () => {
    const p = new ProcgenPopulationPolicy(8); p.setReleaseGesture(gesture()); p.phaseAt(p.nextCohortTick, 0); p.admitGestureSlot(true); p.reset(200); expect(p.gestureRun.status).to.equal('generation-discarded'); expect(p.admitGestureSlot(true).status).to.equal('suppressed');
    expect(() => validatePopulationReleaseState({ releaseGesture: gesture(), gestureRun: { remaining: 5, admitted: 1, missed: 0, cohortOrdinal: 0, status: 'active' } }, 8)).to.throw('Incoherent');
    p.gestureRun = { remaining: null, admitted: Number.MAX_SAFE_INTEGER, missed: 0, cohortOrdinal: 0, status: 'active' }; p.releaseGesture = p.cohortReleaseGesture = gesture({ finiteBurstCount: null }); expect(() => p.admitGestureSlot(true)).to.throw('exhausted'); expect(p.gestureRun.admitted).to.equal(Number.MAX_SAFE_INTEGER);
  });
  it('fails the tick if an adapter throws after changing population instead of claiming harmless rejection', () => {
    const w = world(), set = w.setReleaseGesture.bind(w); w.setReleaseGesture = (...args) => { set(...args); throw new Error('after population publication'); }; w.prepareIntervention(command(w)).commit(); expect(() => w.step()).to.throw('after population publication'); expect(w._failedTick).to.equal(true); w.dispose();
  });
  it('remaps saved lane phases on deletion without performing the recipe', () => {
    let p = createProcgenWorkstationProject({}, { lanes: [{}, {}, {}] }); p = reduceCanonicalProcgenProject(p, { type: 'procgen/releaseGesture', gesture: gesture({ lanePhase: [{ laneId: 0, offsetTicks: 1 }, { laneId: 2, offsetTicks: 4 }] }) }); const original = p;
    p = reduceCanonicalProcgenProject(p, { type: 'procgen/removeLane', laneId: p.procgen.lanes[1].id }); expect(p.procgen.releaseGesture.lanePhase).to.deep.equal([{ laneId: 0, offsetTicks: 1 }, { laneId: 1, offsetTicks: 4 }]); expect(original.procgen.releaseGesture.lanePhase[1].laneId).to.equal(2); expect(p.procgen).not.to.have.property('pendingReleaseGesture');
  });
});
