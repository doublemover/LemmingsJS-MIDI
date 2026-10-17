import assert from 'node:assert/strict';
import { loadProcgenMixedTerrain, DEFAULT_PROCGEN_LANE_THEMES } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('natural eight-lane workstation terrain growth', function() {
  this.timeout(60000);
  let masks, book, provider;
  before(async () => { provider = new NodeFileProvider(process.cwd()); book = await loadTerrainRecipeBook(provider); masks = await loadProcgenMasks(); });
  for (const seed of [42, 7, 2026]) it(`keeps seed ${seed} advancing for 3000 real simulation ticks with bounded publication and scenery`, async () => {
    const terrain = await loadProcgenMixedTerrain({ configs: ['lemmings', 'lemmings_ohNo', 'holiday94'].map(path => ({ path })), fileProvider: provider, book });
    const world = new ProcgenLaneWorld({ terrain, masks, seed, laneCount: 8, laneHeight: 144, workstation: true, cohorts: true, spawnSpreadTicks: 12 });
    try {
      assert.deepEqual(terrain.laneThemes, DEFAULT_PROCGEN_LANE_THEMES);
      for (let tick = 0; tick < 3000; tick++) {
        world.step();
        if (tick % 60) continue;
        for (let lane = 0; lane < 8; lane++) {
          assert.ok(world.generatedThrough[lane] >= world.frontiers[lane] + 32);
          assert.ok(world.scenery.entries[lane].length <= 19);
        }
        assert.ok(world.terrainGrowth.states.size <= 8 * 8);
        assert.ok(world.actors.every(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y)));
      }
      assert.equal(world.generation, 1); assert.equal(world.tickIndex, 3000);
      assert.ok([...world.frontiers].every(frontier => frontier > 700));
      assert.ok(world.stats.builds > 0 && world.stats.bashes > 0 && world.stats.mines > 0);
      assert.ok(world.terrainGrowth.stats.normalRevealed > world.terrainGrowth.stats.normalPrepared);
      assert.ok(world.terrainGrowth.stats.minimumMargin >= 64);
      for (const theme of terrain.themes) assert.ok(theme.terrain.growthPlans.size <= theme.terrain.descriptionLimit);
    } finally { world.dispose(); }
  });
});
