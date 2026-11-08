import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { createSurveyTrial } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { surveyCacheBindingCorpus } from './helpers/surveyCacheBindingCorpus.js';

describe('physical world cache binding evidence', function() {
  this.timeout(30000); let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('refuses the exact ground-query false-match corpus, preserves legitimate cold storage, and retains behavioral continuations', async () => {
    const result = await surveyCacheBindingCorpus(scenario => createSurveyTrial({ masks, scenario }));
    expect(result.failures).to.have.length(9); expect(result.getters).to.equal(0); expect(result.compactionStable && result.heldPristineStable && result.activeAssistDistinct && result.wallContinuationDistinct).to.equal(true);
  });
  it('binds generated aliases to the actual seed and chunk key without touching cache residency', async () => {
    const terrain = await loadProcgenTerrain(), trial = createSurveyTrial({ masks, terrain, scenario: { id: 'generated-world-cache', mode: 'generated', horizonTicks: 32, laneHeight: 96 } });
    try {
      const world = trial.world, seed = world.laneSeeds[0]; world.hasGroundAt(36, 72); const before = trial.snapshot().physicalStateHash, good = world._laneChunk[0], wrong = terrain.getChunk(seed, 4);
      world._laneChunk[0] = wrong;
      let failure; try { trial.snapshot(); } catch (error) { failure = error; } finally { world._laneChunk[0] = good; }
      expect(failure?.code).to.equal('unverified-world-cache-binding'); expect(failure.field).to.equal('lane-collision'); expect(trial.snapshot().physicalStateHash).to.equal(before);
    } finally { trial.dispose(); }
  });
});
