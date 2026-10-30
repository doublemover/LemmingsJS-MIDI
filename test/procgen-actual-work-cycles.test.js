import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';
import { qualifyActualWorkCycles } from './helpers/actualWorkCycles.js';

describe('actual authored work-cycle acceptance corpus', function() {
  this.timeout(120000);
  it('derives cycle ratios, material policies, row groups, warning ancestry and interrupted lifetimes from real processors', async () => {
    const masks = await loadProcgenMasks();
    const result = await qualifyActualWorkCycles({ async createWorld(layout) {
      const budget = createResourceBudget({ limitBytes: 96 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-work-fixture' }) });
      const terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], layout.lanes.length), layout, { resourceBudget: budget, jobs }); await terrain.prepare();
      const world = new ProcgenLaneWorld({ masks, terrain, seed: 42, laneCount: layout.lanes.length, laneHeight: layout.laneHeight, assists: false, maxActors: layout.lanes.length, stallPolicy: { secondsWithoutProgress: 1000 } });
      return { world, async dispose() { world.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); } };
    } });
    expect(result.measuredCycles).to.deep.equal({ builder: 12, miner: 8, ratio: '3:2' });
  });
});
