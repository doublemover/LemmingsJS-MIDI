import { expect } from 'chai';
import { createMetamorphicBridgeScore } from '../js/app/procgen/workstation/MetamorphicBridgeScore.js';
import { renderPerformanceSceneRehearsal } from '../js/app/procgen/workstation/PerformanceSceneRehearsalRender.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const buildId = 'b'.repeat(64), descriptors = () => describeNativeInstrumentEngines(['worklet-sine', 'worklet-friction'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
const fixture = async () => {
  const engines = await descriptors(), score = await createMetamorphicBridgeScore({ sourceHash: buildId, descriptor: engines[1] }), sceneHash = await performanceSceneHash(score.scene), budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 1), score.recipe.initialTerrainLayout, { resourceBudget: budget, jobs });
  await terrain.prepare(); const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), terrain, laneCount: 1, laneHeight: 96, seed: score.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: score.recipe.initialReleaseGesture, stallPolicy: { secondsWithoutProgress: 1000 } }), engine = createCausalMusicEngine({ getGraph: () => score.scene.causalMappings }), intents = []; let last;
  world.configurePhysicalAuthoring(score.scene.causalMappings, []); world.soundEvents.onBatch.on(batch => { last = batch; intents.push(...engine.processBatch(batch)); });
  try { for (let tick = 0; tick < 32; tick++) world.step(); const source = { schema: 'lemmings-scene-rehearsal-source/v1', sceneHash, initialTick: 0, ticks: 32, sourceTimeMs: 0, durationSeconds: (last.sourceTimeMs + last.tickDurationMs) / 1000, worldId: world.worldId, generation: world.generation, seed: world.seed, intents }; return { input: { scene: score.scene, sceneHash, source, recipe: score.recipe, sampleRate: 48000 }, engines }; }
  finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
};
const refusal = async operation => { try { await operation(); } catch (caught) { return caught; } throw new Error('Expected refusal.'); };

describe('shared-body scene rehearsal (real DSP fixtures authored, qualification deferred)', function() {
  this.timeout(120000);
  for (const rate of [44100, 48000, 96000]) it('renders actual private route intents and the complete same-body tail at ' + rate, async () => {
    const f = await fixture(), input = { ...f.input, sampleRate: rate }, before = JSON.stringify(input.source), result = await renderPerformanceSceneRehearsal(input, { descriptors: f.engines, buildId, yieldControl: async () => {} }), manifest = result.manifest;
    expect(manifest).to.include({ recipeHash: input.scene.worldRecipeRef.hash, currentWorldAdvanced: false, nextWorldAdvanced: false, externalOutput: false, historicalPerformanceEvidence: false, acousticReceipt: false }); expect(manifest.body).to.include({ mapHash: input.recipe.initialMorphMechanism.map.hash, semanticOnsetsAdded: 0, faults: 0, physicalTakeEvidence: false }); expect(manifest.body.controlCount).to.be.greaterThan(0); expect(manifest.body.tailFrames).to.equal(Math.ceil(4.2 * rate)); expect(manifest.frames).to.equal(manifest.body.sourceFrames + manifest.body.tailFrames); expect(manifest.frames).to.be.greaterThan(Math.ceil(input.source.durationSeconds * rate)); expect(manifest.body.controlScheduleHash).to.match(/^[a-f0-9]{64}$/); expect(manifest.lanes.reduce((sum, lane) => sum + lane.begins, 0)).to.equal(input.source.intents.filter(intent => intent.kind === 'begin').length); expect(JSON.stringify(input.source)).to.equal(before); expect(result.bytes.byteLength).to.be.lessThan(16 * 1048576);
    if (rate === 48000) { const repeated = await renderPerformanceSceneRehearsal(input, { descriptors: f.engines, buildId, yieldControl: async () => {} }); expect(repeated.manifest.pcmHash).to.equal(manifest.pcmHash); expect(repeated.manifest.body.controlScheduleHash).to.equal(manifest.body.controlScheduleHash); }
  });
  it('refuses missing/stale recipe, undersized complete workspace, cancellation and stale owner', async () => {
    const f = await fixture(), options = { descriptors: f.engines, buildId, yieldControl: async () => {} }, missing = { ...f.input }; delete missing.recipe; expect(await refusal(() => renderPerformanceSceneRehearsal(missing, options))).to.be.instanceOf(Error);
    const changed = JSON.parse(JSON.stringify(f.input)); changed.recipe.initialMorphMechanism.travelPixels = 256; expect((await refusal(() => renderPerformanceSceneRehearsal(changed, options))).message).to.include('exact authored recipe'); expect((await refusal(() => renderPerformanceSceneRehearsal(f.input, { ...options, maxWorkingBytes: 64 * 1048576 }))).message).to.include('96 MiB');
    const controller = new AbortController(); controller.abort(new Error('explicit-stop')); expect((await refusal(() => renderPerformanceSceneRehearsal(f.input, { ...options, signal: controller.signal }))).message).to.equal('explicit-stop'); expect((await refusal(() => renderPerformanceSceneRehearsal(f.input, { ...options, isCurrent: () => false }))).message).to.include('execution changed');
  });
});
