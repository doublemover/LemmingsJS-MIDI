import { expect } from 'chai';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createPocketCathedralScore } from '../js/app/procgen/workstation/PocketCathedralScore.js';
import { createGlassOrbitScores } from '../js/app/procgen/workstation/GlassOrbitScore.js';
import { createGlassOrbitOrchestrations } from '../js/app/procgen/workstation/GlassOrbitOrchestration.js';
import { createGlassOrbitTrellisScores } from '../js/app/procgen/workstation/GlassOrbitTrellisScore.js';
import { createBuilderMinerScores } from '../js/app/procgen/workstation/BuilderMinerScore.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { materializePerformanceSceneProject } from '../js/app/procgen/workstation/PerformanceSceneProject.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { prepareSceneFocusAction, readSceneFocusControl } from '../js/app/procgen/workstation/SceneFocusAction.js';
import { prepareSceneAcousticControl, readSceneAcousticControl } from '../js/app/procgen/workstation/SceneAcousticControl.js';
import { sanitizeMidiProject, reduceMidiProject } from '../js/midi/project/MidiProject.js';

const sourceHash = 'b'.repeat(64), copy = value => JSON.parse(JSON.stringify(value));
const originFor = async item => ({ schema: 'lemmings-performance-scene-origin/v1', manifest: item.scene, recipe: item.recipe, sceneHash: await performanceSceneHash(item.scene), variants: [] });

describe('source-pinned scene orchestration (deferred grouped qualification)', () => {
  let descriptors, modal, fm, spectrum;
  before(async () => { descriptors = await describeNativeInstrumentEngines(['native-modal', 'native-fm', 'worklet-spectrum'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) }))); modal = descriptors.find(descriptor => descriptor.engineId === 'native-modal'); fm = descriptors.find(descriptor => descriptor.engineId === 'native-fm'); spectrum = descriptors.find(descriptor => descriptor.engineId === 'worklet-spectrum'); });
  it('pins and materializes all five Cathedral bodies, including exact non-default dependencies', async () => {
    const item = await createPocketCathedralScore({ sourceHash, descriptor: modal }), origin = await originFor(item); await verifyPerformanceSceneOrigin(origin, { sourceHash });
    const preflight = await checkPerformanceSceneRequirements(item.scene, { resolveDependency: async dependency => ({ ...dependency, status: 'available', storage: 'embedded' }) });
    expect(preflight.status).to.equal('ready'); expect(preflight.dependencies.filter(row => row.dependency.kind === 'patch').map(row => row.dependency.id).sort()).to.deep.equal(['material.glass', 'material.sheet-metal', 'material.slate', 'material.timber', 'material.unclassified']);
    const prepared = materializePerformanceSceneProject(origin); expect(prepared.project.procgen.lanes).to.have.length(3); for (const lane of prepared.project.procgen.lanes) { expect(lane.materialPalette.references).to.have.length(5); expect(lane.instrumentRef.patchId).to.equal('material.unclassified'); }
    const changed = copy(item.scene); changed.patchRefs[0].materialPalette.references.find(reference => reference.patchId === 'material.glass').definition.parameters.bodyT60Seconds = 0.2; let error; try { await checkPerformanceSceneRequirements(changed, { resolveDependency: async dependency => ({ ...dependency, status: 'available', storage: 'embedded' }) }); } catch (failure) { error = failure; } expect(error).to.be.instanceOf(Error);
  });
  it('publishes an acoustic edit through the canonical reducer without changing geometry or release policy', async () => {
    const item = await createPocketCathedralScore({ sourceHash, descriptor: modal }), project = sanitizeMidiProject(materializePerformanceSceneProject(await originFor(item)).project), state = readSceneAcousticControl(project, 'absorb'), action = prepareSceneAcousticControl(project, { ...state, value: 0.9 }), next = reduceMidiProject(project, action);
    expect(next.procgen.physicalGraph.acousticMap.controls.absorb01).to.equal(0.9); expect(project.procgen.physicalGraph.acousticMap.controls.absorb01).to.equal(0.35); expect(next.procgen.sceneOrigin.recipe.initialTerrainLayout).to.deep.equal(project.procgen.sceneOrigin.recipe.initialTerrainLayout); expect(next.procgen.releaseGesture).to.deep.equal(project.procgen.releaseGesture); expect(next.procgen.seed).to.equal(project.procgen.seed);
    expect(() => prepareSceneAcousticControl(next, { ...state, value: 0.4 })).to.throw('revision');
  });
  it('preserves the original Glass Orbit physical recipe while adding acoustic, paired or routed-body orchestration', async () => {
    const bases = await createGlassOrbitScores({ sourceHash, descriptor: fm }), variants = await createGlassOrbitOrchestrations({ sourceHash, scores: bases, spectrumDescriptor: spectrum }), trellis = await createGlassOrbitTrellisScores({ sourceHash, scores: bases });
    expect(variants).to.have.length(15); expect(trellis).to.have.length(9);
    for (const item of [...variants, ...trellis]) {
      const base = bases.find(base => item.scene.id.startsWith(base.scene.id)); expect(item.recipe.initialTerrainLayout).to.deep.equal(base.recipe.initialTerrainLayout); expect(item.recipe.initialReleaseGesture).to.deep.equal(base.recipe.initialReleaseGesture); expect(item.recipe.initialJunctions).to.deep.equal(base.recipe.initialJunctions); expect(item.scene.causalMappings.pickups).to.deep.equal(base.scene.causalMappings.pickups); await verifyPerformanceSceneOrigin(await originFor(item), { sourceHash });
    }
    for (const item of trellis) { expect(item.recipe.initialSympatheticBody.bodySourceRoutes).to.have.length(item.scene.cost.lanes); expect(item.recipe.initialSympatheticBody.bodySourceRoutes.some(route => route.bodyId === 'string-trellis-3')).to.equal(false); }
  });
  it('commits one complete workshop focus edit with preserved authored gain power and stale-target refusal', async () => {
    const [item] = await createBuilderMinerScores({ sourceHash, descriptor: modal }), project = sanitizeMidiProject(materializePerformanceSceneProject(await originFor(item)).project), power = project.procgen.lanes.reduce((sum, lane) => sum + lane.gain ** 2, 0), binding = readSceneFocusControl(project, 'focus'), action = prepareSceneFocusAction(project, { ...binding, value01: 0 }), next = reduceMidiProject(project, action);
    expect(next.procgen.lanes[0].gain).to.be.greaterThan(project.procgen.lanes[0].gain); expect(next.procgen.lanes[1].gain).to.equal(0); expect(next.procgen.lanes.reduce((sum, lane) => sum + lane.gain ** 2, 0)).to.be.closeTo(power, 1e-12); expect(next.procgen.physicalGraph).to.equal(project.procgen.physicalGraph); expect(next.procgen.releaseGesture).to.equal(project.procgen.releaseGesture);
    expect(() => reduceMidiProject(next, action)).to.throw('revision'); expect(readSceneFocusControl(project, 'focus').value01).to.be.closeTo(0.5, 1e-12);
  });
});
