import { expect } from 'chai';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createDiggingOcarinaScores } from '../js/app/procgen/workstation/DiggingOcarinaScore.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualCavitySound } from './helpers/actualCavitySound.js';

const sourceHash = 'a'.repeat(64), descriptor = async () => (await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'b'.repeat(64) }]))[0];
describe('Digging Ocarina actual authored source and body recipes', function() {
  this.timeout(120000);
  it('binds three original maps to exact scene recipes and declares every retained body', async () => {
    const scores = await createDiggingOcarinaScores({ sourceHash, descriptor: await descriptor() }); expect(scores).to.have.length(3);
    for (const score of scores) { const origin = await verifyPerformanceSceneOrigin({ schema: 'lemmings-performance-scene-origin/v1', manifest: score.scene, sceneHash: await performanceSceneHash(score.scene), recipe: score.recipe, variants: [] }, { sourceHash }); expect(origin.manifest.cost.sharedBodies).to.equal(score.recipe.initialCavityBody.map.bodyRecipe === 'throat-duet' ? 4 : 2); expect(origin.manifest.physicalControls).to.have.length(2); }
  });
  it('sculpts actual64/256pixel cavities through accepted physical commands and keeps real worker/steel ancestry', async () => {
    const jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-cavity-sound' }) });
    try { const result = await qualifyActualCavitySound({ descriptor: await descriptor(), sourceHash, createWorld: await createActualScoredWorldFactory({ masks: await loadProcgenMasks(), jobs }) }); expect(result.recipes.every(row => row.geometryOnlyIntents === 0 && row.restoredBodyEqual)).to.equal(true); expect(result.work[1].intents.filter(intent => intent.kind === 'begin')).to.have.length(0); }
    finally { jobs.dispose(); }
  });
});
