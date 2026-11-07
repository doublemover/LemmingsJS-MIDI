import { expect } from 'chai';
import { canonicalDataText, hashDataText } from '../js/core/CanonicalData.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { routeCircuitLayout, routeCircuitGraph } from './helpers/actualRouteCircuits.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { captureCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenContinuationCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createProcgenRetirementScope } from '../js/app/procgen/ProcgenRetirement.js';
import { createPhysicalMusicStarterGoal } from '../js/app/procgen/workstation/PhysicalMusicStarter.js';
import { evaluatePhysicalMusicGoal } from '../js/app/procgen/workstation/PhysicalMusicGoal.js';
import { runPhysicalMusicStudy } from '../js/app/procgen/workstation/PhysicalMusicStudy.js';
import { summarizePhysicalMusicSensitivity } from '../js/app/procgen/workstation/PhysicalMusicSensitivity.js';

const build = 'a'.repeat(64), executionIdentity = { activeExecution: 'bound', buildId: build, closureDigest: 'b'.repeat(64), harnessVersion: 1, stateSchema: 2, assetDigest: 'c'.repeat(64), capabilityProfile: 'browser-background-jobs' };
const mutable = value => JSON.parse(JSON.stringify(value));
const traceRows = study => study.rows.map(row => ({ id: row.id, status: row.status, metrics: row.metrics, traceHash: row.traceHash, continuationHash: row.continuationHash, verification: row.verification }));
describe('real physical musical-goal composition', function() {
  this.timeout(180000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const setup = async () => {
    const layout = routeCircuitLayout(), factory = await createActualScoredWorldFactory({ masks }), owner = await factory(layout), world = owner.world, clock = createProcgenPhysicalScoreClock();
    const graph = routeCircuitGraph(); delete graph.routes; world.configurePhysicalAuthoring(graph);
    const engine = createCausalMusicEngine({ world, getGraph: () => world.physicalAuthoring.graph, scoreTimeline: clock, traceLimit: 0 });
    const observe = batch => { clock.observe(batch, { bpm: 120 }); engine.processBatch(batch); }; world.soundEvents.onBatch.on(observe);
    // Let the ordinary initial actors land through real shared actions; never pose their coordinates/action frames.
    for (let tick = 0; tick < 32; tick++) world.step(0);
    world.timer.speedFactor = 0;
    const source = { world: captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: clock.snapshot(), performance: captureCausalPerformanceState([{ id: 'lane0' }, { id: 'lane1' }]),
      authoring: { graph: world.physicalAuthoring.graph, instances: world.physicalAuthoring.instances, junctions: world.physicalJunctions.definitions }, replay: { version: 2, playing: true, bpm: 120, scoreTimeline: true, nominalSpeed: 3 } };
    const createWorld = async () => { const isolated = await factory(layout), scope = createProcgenRetirementScope(); return { world: isolated.world, dispose: () => scope.retire([{ name: 'actual-fixture-world', run: isolated.dispose }]) }; };
    return { world, source, createWorld, input: { source, projectRevision: 1, applicationBuildId: build, sourceVersions: { physical: 2, musical: 1, applicationBuildId: build }, rootPath: '/' },
      async dispose() { world.soundEvents.onBatch.off(observe); engine.dispose(); await owner.dispose(); } };
  };
  it('finds120/160 from real crossings, agrees with a cache-off search and keeps the original source unchanged', async () => {
    const fixture = await setup(), before = await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(fixture.world));
    try {
      const goal = createPhysicalMusicStarterGoal(), run = cacheEnabled => runPhysicalMusicStudy({ ...fixture.input, goal, cacheEnabled }, { createWorld: fixture.createWorld, executionIdentity });
      const cached = await run(true), baseline = await run(false);
      expect(cached.status).to.equal('qualified'); expect(cached.selected.verification.matched).to.equal(true);
      expect(cached.rows.find(row => row.id === cached.selected.candidateId).values['right-wall-0']).to.equal(81);
      expect(cached.rows.find(row => row.id === cached.selected.candidateId).metrics.periods.map(period => period.meanTicks)).to.deep.equal([120, 160]);
      expect(traceRows(cached)).to.deep.equal(traceRows(baseline)); expect(cached.work.logicalTicks).to.equal(1440); expect(cached.work.verificationTicks).to.equal(480);
      expect(cached.selected.auditionContinuation.world.graph.owners.find(owner => owner.name === 'world').props.tickIndex).to.equal(cached.base.tick);
      expect(cached.selected.applyContinuation.world.graph.owners.find(owner => owner.name === 'world').props.tickIndex).to.equal(cached.base.tick + 1);
      expect(await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(fixture.world))).to.equal(before); expect(fixture.world.interventionState.pending).to.have.length(0);
    } finally { await fixture.dispose(); }
  });
  it('reports121 as unmatched only in its fully enumerated seven-value wall domain', async () => {
    const fixture = await setup();
    try { const result = await runPhysicalMusicStudy({ ...fixture.input, goal: createPhysicalMusicStarterGoal({ unreachable: true }) }, { createWorld: fixture.createWorld, executionIdentity });
      expect(result.status).to.equal('no-match-in-finite-domain'); expect(result.coverage.completeDomain).to.equal(true); expect(result.rows).to.have.length(7);
      expect(result.rows.map(row => row.metrics.periods[0].meanTicks)).to.deep.equal([114, 116, 118, 120, 122, 124, 126]);
      expect(result.rows.every(row => !row.metrics.requestedMetricsMet)).to.equal(true); expect(result.coverage.claim).to.include('no-continuum-or-universal');
    } finally { await fixture.dispose(); }
  });
  it('samples118/120/122 without interpolating unsafe or untested worlds', async () => {
    const fixture = await setup();
    try { const result = await runPhysicalMusicStudy({ ...fixture.input, mode: 'sensitivity', goal: createPhysicalMusicStarterGoal() }, { createWorld: fixture.createWorld, executionIdentity }), report = summarizePhysicalMusicSensitivity(result);
      expect(report.samples.map(sample => sample.periods[0].meanTicks)).to.deep.equal([118, 120, 122]); expect(report.domain.completeFiniteGrid).to.equal(true);
      expect(report.edges.every(edge => edge.continuousSafetyClaim === false && edge.continuousDerivativeClaim === false)).to.equal(true);
      expect(report.samples.every(sample => sample.safetyFailures.length === 0)).to.equal(true); expect(result.selected).to.equal(null);
    } finally { await fixture.dispose(); }
  });
  it('cannot use one actual attack for two simultaneous desired onsets', () => {
    const goal = mutable(createPhysicalMusicStarterGoal()); goal.periodGoals = []; goal.periodRatios = []; goal.requiredCauseKinds = [];
    goal.targetOnsets = [{ time: 12, tolerance: 0, mappingId: 'voice0' }, { time: 12, tolerance: 0, mappingId: 'voice0' }];
    const result = evaluatePhysicalMusicGoal(goal, [{ intentId: 'one-real-attack', timeTicks: 12, mappingId: 'voice0' }]);
    expect(result.matched).to.have.length(1); expect(result.missedTargets).to.have.length(1); expect(result.requestedMetricsMet).to.equal(false);
  });
  it('counts logical work independently of prefix savings across64 late skill siblings', async () => {
    const fixture = await setup(), goal = mutable(createPhysicalMusicStarterGoal());
    goal.allowedEdits = [{ id: 'late-builder', kind: 'worker-tick', actorId: fixture.world.actors[0].id, skillType: 'builder', values: Array.from({ length: 64 }, (_, index) => 401 + index) }];
    goal.skillInventory.builder = 1;
    try { const result = await runPhysicalMusicStudy({ ...fixture.input, mode: 'sensitivity', goal }, { createWorld: fixture.createWorld, executionIdentity });
      expect(result.rows).to.have.length(64); expect(result.rows.every(row => row.completed === true), result.rows.find(row => row.reason)?.reason).to.equal(true);
      expect(result.rows.every(row => row.trace.causeKinds.includes('sfx:builder-step'))).to.equal(true);
      const retained = canonicalDataText(result.rows, { maxBytes: 4 * 1048576, maxNodes: 1 + 64 * 32768 });
      expect(result.work.retainedResultBytes).to.equal(retained.bytes.length); expect(result.work.retainedResultNodes).to.equal(retained.nodes);
      expect(retained.bytes.length).to.be.at.most(4 * 1048576);
      for (const row of result.rows) {
        const packed = row.trace.correspondence, decoded = packed.indices.map(index => packed.dictionary[index]);
        expect(packed.schema).to.equal('lemmings-physical-cause-dictionary/v1'); expect(decoded).to.have.length(packed.count);
        expect(await hashDataText(canonicalDataText(decoded).text)).to.equal(packed.sha256);
        expect(decoded.some(cause => cause[0] === 'sfx:builder-step' && cause[1] === fixture.world.actors[0].id && cause[2] === 0)).to.equal(true);
      } expect(result.work.logicalTicks).to.equal(30720); expect(result.work.cache.restoredCheckpoints).to.be.greaterThan(0);
      expect(result.work.computedTicks).to.be.lessThan(30720 * .35); expect(result.work.restoredTicks).to.be.greaterThan(0); expect(result.work.restoreMs).to.be.at.least(0);
      expect(result.work.verificationTicks).to.equal(0); expect(result.work.cache.reservedBytes).to.be.greaterThan(0);
    } finally { await fixture.dispose(); }
  });
});
