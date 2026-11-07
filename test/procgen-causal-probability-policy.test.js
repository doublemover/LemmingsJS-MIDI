import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { causalRandomDecision } from '../js/app/procgen/workstation/CausalRandom.js';
import { validateCausalSeedSet, causalNamespaceSeed, validateCausalProbabilityPolicy, createCausalProbabilityContext, causalPolicyDecision } from '../js/app/procgen/workstation/CausalProbabilityPolicy.js';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { ProcgenPopulationPolicy } from '../js/app/procgen/ProcgenPopulationPolicy.js';
import { planTerrainChallenge } from '../js/app/procgen/ProcgenTerrainChallenges.js';
import { createCausalTakeRecorder } from '../js/app/procgen/workstation/CausalTake.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const vectors = JSON.parse(readFileSync(new URL('./fixtures/causal-random-v1.json', import.meta.url), 'utf8'));
const policy = extra => validateCausalProbabilityPolicy({ version: 1, probability01: 0.5, ...extra });
const decision = extra => causalPolicyDecision({ policy: policy(), namespace: 'musical-response', seed: 42, mappingId: 'wall', generation: 1, stableCauseId: 'contact:1', ...extra });
const actors = [{ actorId: 7, laneId: 0, x: 10, y: 20, birthCohortId: 'cohort:one', action: 'walking' }, { actorId: 8, laneId: 1, x: 11, y: 21, birthCohortId: 'cohort:one', action: 'walking' }];
const batch = (tick = 1, source = actors) => ({ version: 1, worldId: 'world', generation: 1, tick, batchId: `b:${tick}`, completeness: { status: 'complete', dropped: 0 }, snapshot: { actors: source }, facts: [{ kind: 'ContactResolved', actorId: 7, laneId: 0, causeKind: 'wall', eventId: `contact:${tick}`, causalSequence: tick, physicalPayload: {} }] });
describe('versioned scoped causal probability and namespace isolation', () => {
  it('matches independently authored fixed UTF-16 vectors in all four namespaces', () => {
    for (const vector of vectors.vectors) expect(causalRandomDecision(vector.input).drawUint32).to.equal(vector.drawUint32);
  });
  it('changes only an explicitly selected namespace seed', () => {
    const changed = validateCausalSeedSet({ version: 1, seeds: { 'musical-response': 'new-take' } });
    for (const namespace of ['terrain', 'population', 'physical-route', 'musical-response']) { const a = decision({ namespace }), b = decision({ namespace, seed: causalNamespaceSeed(changed, namespace, 42) }); expect(b.drawUint32 === a.drawUint32).to.equal(namespace !== 'musical-response'); }
    expect(() => validateCausalSeedSet({ version: 1, seeds: { wallclock: 1 } })).to.throw();
    expect(() => validateCausalInstrumentGraph({ version: 1, revision: 1, instruments: [], randomSeeds: { version: 1, seeds: { terrain: 1 } } })).to.throw();
  });
  it('binds per-actor/cohort/encounter draws to stable identities with explicit generation reseeding', () => {
    const context = createCausalProbabilityContext(batch())({ actorId: 7, responseDescriptor: { episodeId: 'meeting:one' } });
    for (const identity of ['actor', 'cohort', 'encounter']) {
      const p = policy({ identity }), a = decision({ policy: p, context }), b = decision({ policy: p, context, stableCauseId: 'later-contact' }); expect(a.drawUint32).to.equal(b.drawUint32); expect(a.sourceCauseId).not.to.equal(b.sourceCauseId);
      expect(decision({ policy: p, context, generation: 2 }).drawUint32).not.to.equal(a.drawUint32);
      const stable = policy({ identity, reseed: 'stable' }); expect(decision({ policy: stable, context, generation: 2 }).drawUint32).to.equal(decision({ policy: stable, context }).drawUint32);
    }
    expect(decision({ policy: policy({ identity: 'encounter' }), context: {} })).to.include({ accepted: false, drawUint32: null, reason: 'missing-encounter-identity' });
  });
  it('uses bounded actual local descriptors, clamps thresholds and refuses unknown evidence', () => {
    const get = createCausalProbabilityContext(batch(), { terrainSolidBelow: () => true }), context = get({ actorId: 7, physicalPayload: { attemptedCells: 12, changedSolidCells: 3 }, positionBefore: { x: 10, y: 20 }, positionAfter: { x: 13, y: 24 } });
    expect(context.descriptors).to.include({ crowdCellCount: 2, changedSolidCells: 3, travelPixels: 5, terrainSolidBelow: 1 });
    const p = policy({ probability01: 2, conditions: [{ descriptor: 'crowdCellCount', operator: 'gte', value: 2, multiply: 0 }] }); expect(decision({ policy: p, context })).to.include({ probability01: 0, accepted: false });
    expect(decision({ policy: p })).to.include({ accepted: false, reason: 'unknown-local-descriptor' }); expect(policy({ probability01: Infinity }).probability01).to.equal(0);
    expect(() => policy({ conditions: [{ descriptor: 'wallClock', operator: 'gte', value: 0, multiply: 1 }] })).to.throw(); expect(() => policy({ algorithmVersion: 'future' })).to.throw();
  });
  it('preserves decisions under actor order, extra/muted instruments and backend rejection without inventing a source', () => {
    const instrument = id => ({ id, sourceKind: 'ContactResolved', pitchCents: 6000, velocity01: 0.5, role: 'contact', route: 'local', probability: policy({ identity: 'cohort' }) });
    const run = (extra, reverse = false) => { const graph = { version: 1, revision: 1, seed: 42, instruments: [instrument('wall'), ...extra] }, engine = createCausalMusicEngine({ getGraph: () => graph, deliver() { throw new Error('output unavailable'); } }); engine.processBatch(batch(1, reverse ? [...actors].reverse() : actors)); const result = engine.probabilityAnalysis().decisions.filter(value => value.mappingId === 'wall'); const quiet = batch(2); quiet.facts = []; expect(engine.processBatch(quiet)).to.have.length(0); return result; };
    expect(run([instrument('other')], true)).to.deep.equal(run([])); expect(run([{ ...instrument('other'), mute: true }])).to.deep.equal(run([]));
  });
  it('migrates scout/challenge choices to separate namespaces without a shared draw cursor', () => {
    const population = new ProcgenPopulationPolicy(8), before = Array.from({ length: 64 }, (_, ordinal) => population.scoutDecision(42, ordinal));
    for (let chunk = 0; chunk < 100; chunk++) planTerrainChallenge({ seed: 42, chunk, left: 72, right: 72, height: 96, varied: true });
    expect(Array.from({ length: 64 }, (_, ordinal) => population.scoutDecision(42, ordinal))).to.deep.equal(before); expect(before.filter(value => value.selected)).to.have.length(8); expect(before.every(value => value.cadence.namespace === 'population')).to.equal(true);
    const challenge = planTerrainChallenge({ seed: 42, chunk: 3, left: 72, right: 72, height: 96 }); expect(challenge.version).to.equal(3); expect(challenge.random.shape.namespace).to.equal('terrain');
  });
  it('journals negative probability companions atomically with untouched physical facts', async () => {
    const graph = { version: 1, revision: 1, instruments: [{ id: 'silent', sourceKind: 'ContactResolved', pitchCents: 6000, velocity01: 0.5, role: 'contact', route: 'local', probability: policy({ probability01: 0 }) }] }, store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage }), recorder = await createCausalTakeRecorder({ journal, takeId: 'take:probability', documentId: 'doc:probability', sourceVersions: { generator: 'procgen-workstation-2', causalProbabilityPolicy: 1 }, assetRefs: [], mapping: graph, initialCheckpoint: { world: { tick: 0 } }, boundaryState: { voices: [] } }), engine = createCausalMusicEngine({ getGraph: () => graph }), source = batch();
    const intents = engine.processBatch(source), probability = engine.probabilityAnalysis(); expect(recorder.recordCommittedBatch({ batch: source, intents, probability }).status).to.equal('accepted'); await recorder.stop({ boundaryState: { voices: [] } }); const records = await journal.query({ takeId: 'take:probability', kinds: ['musical-intents'] }); expect(records.records[0].payload.probability).to.deep.equal(probability); expect(records.records[0].payload.intents).to.have.length(0);
  });
  it('records bounded negative why-not-play decisions independently from raw-source coverage', () => {
    const graph = { version: 1, revision: 1, instruments: [{ id: 'silent', sourceKind: 'ContactResolved', pitchCents: 6000, velocity01: 0.5, role: 'contact', route: 'local', probability: policy({ probability01: 0 }) }] }, engine = createCausalMusicEngine({ getGraph: () => graph }), source = batch(); source.facts = Array.from({ length: 8192 }, (_, index) => ({ ...source.facts[0], causalSequence: index + 1, eventId: `contact:${index}` }));
    expect(engine.processBatch(source)).to.have.length(0); const result = engine.probabilityAnalysis(); expect(result.requested).to.equal(8192); expect(result.omitted).to.be.greaterThan(0); expect(result.coverage).to.equal('capped'); expect(source.completeness.status).to.equal('complete'); expect(result.decisions.every(value => value.reason === 'probability-not-selected')).to.equal(true);
  });
});
describe('conditional physical branch admission stays under actual affordance authority', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('logs an impossible selected worker as rejected and never fabricates route completion', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }), actor = world.actors[0], batches = []; actor.y = 10; actor.setAction(world.actions[State.FALLING]); world.soundEvents.onBatch.on(value => batches.push(value));
    try { world.enqueueIntervention({ id: 'impossible', kind: 'assign-worker', origin: 'manual', target: { generation: world.generation, actorId: actor.id }, parameters: { workerKind: 'builders' }, probability: policy({ probability01: 1, identity: 'actor' }) }); world.step(); const receipt = batches[0].facts.find(value => value.commandId === 'impossible'); expect(receipt.kind).to.equal('CommandRejected'); expect(receipt.decision.accepted).to.equal(true); expect(batches[0].facts.some(value => ['RouteCompleted', 'CrewRouteConnected'].includes(value.kind))).to.equal(false); }
    finally { world.dispose(); }
  });
  it('refuses an older random/terrain checkpoint before changing a live world', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }); try { const saved = { ...captureProcgenCheckpoint(world), generator: 'procgen-workstation-1' }, actor = world.actors[0], x = actor.x; expect(() => restoreProcgenCheckpoint(world, saved)).to.throw(); expect(world.actors[0]).to.equal(actor); expect(actor.x).to.equal(x); } finally { world.dispose(); }
  });
  it('rejects unsupported conditional branch actions before queue publication', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }); try { expect(() => world.enqueueIntervention({ id: 'not-a-branch', kind: 'nuke-all', target: { generation: world.generation }, parameters: {}, probability: policy() })).to.throw(); expect(world.interventionState.pending).to.have.length(0); } finally { world.dispose(); }
  });
});
