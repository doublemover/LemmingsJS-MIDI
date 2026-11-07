import { expect } from 'chai';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createDiggingOcarinaScores } from '../js/app/procgen/workstation/DiggingOcarinaScore.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { renderPerformanceSceneRehearsal } from '../js/app/procgen/workstation/PerformanceSceneRehearsalRender.js';
import { prepareSceneCavityRehearsal } from '../js/app/procgen/workstation/SceneCavityRehearsal.js';
import { canonicalDataText, hashData } from '../js/core/CanonicalData.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { captureActualCavityRehearsal } from './helpers/actualCavityRehearsal.js';

const buildId = 'a'.repeat(64), refused = work => work().then(() => { throw new Error('Expected refusal'); }, error => error);
describe('actual initial-cavity private rehearsal', function() {
  this.timeout(120000); let jobs, factory, descriptors, scores, sources;
  before(async () => { jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-cavity-rehearsal' }) }); descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'b'.repeat(64) }]); scores = await createDiggingOcarinaScores({ sourceHash: buildId, descriptor: descriptors[0] }); factory = await createActualScoredWorldFactory({ masks: await loadProcgenMasks(), jobs }); sources = []; for (const score of scores) { const actual = await captureActualCavityRehearsal({ createWorld: factory, score }); expect(actual.health.rejectedBegins).to.equal(0); expect(actual.source.durationSeconds).to.be.within(0, 6.1); expect(actual.facts.some(fact => fact.kind === 'ContactSpanBegan' && fact.anchor?.x < 78)).to.equal(true); sources.push({ ...actual.source, sceneHash: await performanceSceneHash(score.scene) }); } });
  after(() => jobs?.dispose());
  const input = index => ({ scene: scores[index].scene, recipe: scores[index].recipe, sceneHash: sources[index].sceneHash, source: sources[index], sampleRate: 48000 });
  const render = (value, options = {}) => renderPerformanceSceneRehearsal(value, { descriptors, buildId, maxWorkingBytes: 128 * 1048576, yieldControl: async () => {}, ...options });
  it('renders all three actual unposed contact prefixes through their exact existing modal graph and complete tail', async () => {
    for (let index = 0; index < scores.length; index++) { const before = await hashData(sources[index]), result = await render(input(index)), body = result.manifest.body; expect(body).to.include({ kind: 'authored-cavity', strategy: 'initial-cavity-static-geometry', semanticOnsetsAdded: 0, faults: 0 }); expect(result.bytes.byteLength).to.be.greaterThan(canonicalDataText(input(index)).bytes.length * 2); expect(result.bytes.byteLength).to.be.lessThan(16 * 1048576); expect(body.sourceOnsets).to.equal(sources[index].intents.filter(intent => intent.kind === 'begin').length); expect(body.sourceOnsets).to.be.greaterThan(0); expect(body.bodyCount).to.equal(index === 1 ? 2 : 1); expect(body.retainedBodiesDeclared).to.equal(body.bodyCount * 2); expect(body.targetBindings[0].frequencyHz).to.equal(220); expect(body.tailFrames).to.be.greaterThan(0); expect(result.manifest.frames).to.equal(body.sourceFrames + body.tailFrames); expect(result.manifest.statistics.peak).to.be.within(1e-8, 1); expect(result.manifest).to.include({ currentWorldAdvanced: false, nextWorldAdvanced: false, externalOutput: false, historicalPerformanceEvidence: false }); expect(await hashData(sources[index])).to.equal(before); }
  });
  it('refuses actual geometry changes instead of rendering a final shape as the whole private prefix', async () => { const error = await refused(() => captureActualCavityRehearsal({ createWorld: factory, score: scores[0], editAtTick: 10 })); expect(error.message).to.include('unchanged initial geometry'); });
  it('refuses absent or partial geometry and altered source ancestry, revision ledgers and body targets', async () => {
    const original = input(0), corruptions = [value => { delete value.source.cavity; }, value => { value.source.cavity.initial.coverage = 'partial'; }, value => { value.source.cavity.revisions[0].sourceRevision++; }, value => { value.source.intents.find(intent => intent.kind === 'begin').topologyBinding.boundTopologyRevision = 999; }, value => { value.source.intents.find(intent => intent.kind === 'begin').sourceEventIds = []; }, value => { value.source.intents.find(intent => intent.kind === 'begin').topologyBinding.bodyId = 'foreign-body'; }, value => { value.source.intents.find(intent => intent.kind === 'begin').pitch.cents += 100; }, value => { value.source.intents.find(intent => intent.kind === 'begin').scoreTime.simTick = 0; }, value => { value.scene.cost.sharedBodies = 1; }];
    for (const corrupt of corruptions) { const value = structuredClone(original); corrupt(value); const error = await refused(() => prepareSceneCavityRehearsal({ scene: value.scene, mechanism: value.recipe.initialCavityBody, source: value.source, sampleRate: 48000 })); expect(error.code).to.equal('scene-cavity-rehearsal-unavailable'); }
  });
  it('cancels the bounded owned render without changing retained source or publishing a partial cue', async () => {
    const controller = new AbortController(), before = await hashData(sources[0]); let yields = 0; const error = await refused(() => render(input(0), { signal: controller.signal, yieldControl: async () => { if (++yields === 2) controller.abort(); } })); expect(error.name).to.equal('AbortError'); expect(await hashData(sources[0])).to.equal(before);
  });
});
