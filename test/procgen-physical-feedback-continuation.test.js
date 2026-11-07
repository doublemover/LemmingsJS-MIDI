import { expect } from 'chai';
import { runPhysicalMusicStudy } from '../js/app/procgen/workstation/PhysicalMusicStudy.js';
import { createPhysicalMusicStarterGoal } from '../js/app/procgen/workstation/PhysicalMusicStarter.js';
import { summarizePhysicalMusicSensitivity } from '../js/app/procgen/workstation/PhysicalMusicSensitivity.js';
import { createHash } from 'node:crypto';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { routeCircuitLayout, routeCircuitGraph } from './helpers/actualRouteCircuits.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createCausalPerformanceState, captureCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenContinuationCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createPhysicalFeedbackController, applyRecordedPhysicalFeedback } from '../js/app/procgen/workstation/physical/PhysicalFeedback.js';
import { prepareProcgenSimulationRealm } from '../js/app/procgen/ProcgenSimulationRealm.js';
import { createProcgenSimulationCore } from '../js/app/procgen/ProcgenSimulationCore.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../js/app/procgen/ProcgenRetirement.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const policy = physicalFeedbackMode => ({ schema: 'lemmings-simulation-execution-policy/v1', physicalFeedbackMode });
const finish = async host => { if (!host) return; const receipt = host.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); };
describe('actual intervention layers across isolated continuation and exact command tape', function() {
  this.timeout(180000);
  it('continues canonical layer fuel/occurrences once and never doubles exact recorded commands', async () => {
    const masks = await loadProcgenMasks(), layout = routeCircuitLayout(), factory = await createActualScoredWorldFactory({ masks }), original = await factory(layout), world = original.world,
      clock = createProcgenPhysicalScoreClock(), performance = createCausalPerformanceState(captureCausalPerformanceState([{ id: 'lane0' }, { id: 'lane1' }]));
    const graph = routeCircuitGraph(); delete graph.routes;
    graph.feedback = { version: 1, conductors: [], layers: [{ id: 'builder-overdub', revision: 1, enabled: true, baseReferences: [], rules: [{ id: 'builder-entry', revision: 1,
      source: { kind: 'PickupCrossing', pickupId: 'entry0', direction: 'positive' }, target: { version: 1, kind: 'source-actor' }, command: { kind: 'assign-worker', parameters: { workerKind: 'builders' } },
      fuel: 8, every: 1, offset: 0, refractoryTicks: 1, eligibilityTicks: 4 }] }] }; world.configurePhysicalAuthoring(graph);
    const engine = createCausalMusicEngine({ world, getGraph: () => world.physicalAuthoring.graph, scoreTimeline: clock, traceLimit: 0,
      getLaneState: source => performance.getLaneState(source), getPerformanceState: () => performance.snapshot(), getOnsetControls: (source, id) => performance.getControls(source, id),
      getTimeTransformPolicy: source => performance.getTimeTransformPolicy(source), getScoreContextPolicy: source => performance.getScoreContextPolicy(source),
      getPianoPolicy: source => performance.getPianoPolicy(source), getPianoControls: source => performance.getPianoControls(source), getOrchestralPolicy: source => performance.getOrchestralPolicy(source),
      getPercussionPolicy: source => performance.getPercussionPolicy(source), getPhysicalControlKinds: source => performance.getPhysicalControlKinds(source) });
    const inputs = [], feedback = createPhysicalFeedbackController({ world, resourceBudget: original.budget, getGraph: () => world.physicalAuthoring.graph,
      recordInput(input) { inputs.push(JSON.parse(JSON.stringify(input))); return { status: 'accepted' }; } });
    const warm = batch => { clock.observe(batch, { bpm: 120 }); engine.processBatch(batch); feedback.observe(batch, engine.physicalAnalysis()); }; world.soundEvents.onBatch.on(warm);
    for (let tick = 0; tick < 32; tick++) world.step(0); world.soundEvents.onBatch.off(warm);
    feedback.arm({ epoch: 'actual-layer-continuation' }); world.timer.speedFactor = 0;
    const manifest = { schema: 'lemmings-authoritative-simulation/v1', ownerId: 'layer-continuation', ownerEpoch: 1, documentRevision: 1, rootPath: '/', resourceProfile: 'compact-v1',
      checkpoint: captureProcgenCheckpoint(world), semantic: engine.snapshot(), timeline: clock.snapshot(), graph: world.physicalAuthoring.graph, performance: performance.snapshot(), bpm: 120, nominalSpeed: 3, playing: true, scoreTimeline: true };
    inputs.length = 0;
    const hashes = [0, 1, 2].map(() => createHash('sha256')), counts = [0, 0, 0], worlds = [], budget = createResourceBudget({ limitBytes: 384 * 1048576 }), metadataBudget = createResourceBudget();
    const consume = index => packet => { hashes[index].update(JSON.stringify(packet)); counts[index]++; return { accepted: true }; };
    const createWorld = async () => { const owner = await factory(layout), scope = createProcgenRetirementScope(); worlds.push(owner.world); return { world: owner.world, dispose: () => scope.retire([{ name: 'actual-world', run: owner.dispose }]) }; };
    let baseline = null, continued = null, exact = null, started = false;
    try {
      continued = (await prepareProcgenSimulationRealm({ manifest: { ...manifest, executionPolicy: policy('preserve-live') }, resourceBudget: budget, requiredConsumer: consume(1), createWorld })).host;
      exact = (await prepareProcgenSimulationRealm({ manifest: { ...manifest, executionPolicy: policy('exact-command-tape') }, resourceBudget: budget, requiredConsumer: consume(2), createWorld })).host;
      const retirement = createProcgenRetirementScope();
      baseline = createProcgenSimulationCore({ world, engine, clock, resourceBudget: metadataBudget, nominalSpeed: 3, documentRevision: 1, scoreTimeline: true, playing: true, bpm: 120,
        getPerformance: () => performance.snapshot(), getExecutionPolicy: () => policy('preserve-live'), observePhysicalFeedback: (batch, analysis) => feedback.observe(batch, analysis), requiredConsumer: consume(0),
        disposeWorld: () => retirement.retire([{ name: 'feedback', run: () => feedback.dispose() }, { name: 'world', run: () => afterProcgenRetirement([feedback.dispose()], original.dispose) }]) }); started = true;
      for (let offset = 0; offset < 600; offset++) {
        const from = inputs.length; await baseline.advance({ steps: 1, timestamp: 0 }); await continued.advance({ steps: 1, timestamp: 0 }); await exact.advance({ steps: 1, timestamp: 0 });
        for (const input of inputs.slice(from)) applyRecordedPhysicalFeedback(worlds[1], input);
        if (offset === 160 || offset === 400) {
          const before = inputs.length; feedback.muteLayer('builder-overdub', offset === 160);
          for (const input of inputs.slice(before)) { applyRecordedPhysicalFeedback(worlds[0], input); applyRecordedPhysicalFeedback(worlds[1], input); }
        }
      }
      expect(counts).to.deep.equal([600, 600, 600]); const canonical = hashes.map(hash => hash.digest('hex')); expect(canonical[1]).to.equal(canonical[0]); expect(canonical[2]).to.equal(canonical[0]);
      const snapshots = [];
      for (const host of [baseline, continued, exact]) snapshots.push(await host.checkpoint());
      const physical = await Promise.all(snapshots.map(snapshot => hashProcgenContinuationCheckpoint(snapshot.world)));
      expect(physical[1]).to.equal(physical[0]); expect(physical[2]).to.equal(physical[0]); expect(snapshots[1].engine).to.deep.equal(snapshots[0].engine); expect(snapshots[2].engine).to.deep.equal(snapshots[0].engine);
      expect(world.physicalFeedback.commands.length).to.be.greaterThan(0); expect(worlds[0].physicalFeedback).to.deep.equal(world.physicalFeedback); expect(worlds[1].physicalFeedback).to.deep.equal(world.physicalFeedback);
      expect(snapshots[1].executionPolicy.physicalFeedbackMode).to.equal('preserve-live'); expect(snapshots[2].executionPolicy.physicalFeedbackMode).to.equal('exact-command-tape');
      expect(feedback.diagnostics().fault).to.equal(null);
      const beforeStudy = await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world)), goal = JSON.parse(JSON.stringify(createPhysicalMusicStarterGoal()));
      goal.allowedEdits = [{ id: 'overdub-mute', kind: 'layer-muted', layerId: 'builder-overdub', values: [0, 1] }];
      const buildId = 'a'.repeat(64), study = await runPhysicalMusicStudy({ mode: 'sensitivity', goal, applicationBuildId: buildId, projectRevision: 1, sourceVersions: { applicationBuildId: buildId, physical: 2, musical: 1 }, rootPath: '/',
        source: { world: manifest.checkpoint, engine: manifest.semantic, timeline: manifest.timeline, performance: manifest.performance, executionPolicy: policy('preserve-live'),
          authoring: { graph: world.physicalAuthoring.graph, instances: world.physicalAuthoring.instances, junctions: world.physicalJunctions.definitions }, replay: { version: 2, playing: true, scoreTimeline: true, bpm: 120, nominalSpeed: 3 } } },
      { createWorld, executionIdentity: { activeExecution: 'bound', buildId } });
      expect(study.rows).to.have.length(2);
      expect(study.rows[0].trace.causeKinds).to.include('sfx:builder-step');
      expect(study.rows.every(row => row.trace.causeKinds.every(kind => typeof kind === 'string'))).to.equal(true);
      for (const row of study.rows) expect(row.metrics.semanticMetrics.realizedInterventionLayers.muted.includes('layer:builder-overdub')).to.equal(row.values['overdub-mute'] === 1);
      expect(study.rows[1].metrics.semanticMetrics.realizedInterventionLayers.totalProposals).to.equal(0);
      expect(summarizePhysicalMusicSensitivity(study).edges[0].status).to.equal('categorical-physical-control-comparison;no-derivative');
      expect(await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world))).to.equal(beforeStudy);
    } finally { await Promise.all([finish(baseline), finish(continued), finish(exact)]); if (!started) { const receipt = feedback.dispose(); await receipt.completion; engine.dispose(); await original.dispose(); } }
    expect(budget.diagnostics().accountedBytes).to.equal(0); expect(metadataBudget.diagnostics().accountedBytes).to.equal(0);
  });
});
