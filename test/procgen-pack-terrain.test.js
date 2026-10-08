import { expect } from 'chai';
import { ProcgenPackTerrain, procgenThemeOrder, loadProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { ProcgenAssetManager } from '../js/app/ProcgenAssetManager.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { fileURLToPath } from 'node:url';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

describe('seeded selected-pack lane themes', function() {
  this.timeout(30000);
  it('distributes repeats evenly after every available theme appears, deterministically', () => {
    const fixtures = Array.from({ length: 5 }, (_, index) => ({ styleName: `theme${index}`, terrain: { chunkWidth: 128, recipe: { id: `source${index}` }, objects: [], pieces: [] } }));
    const terrain = new ProcgenPackTerrain(fixtures), seeds = Uint32Array.from({ length: 64 }, (_, index) => index + 1);
    terrain.registerLanes(seeds, 42);
    expect(new Set(terrain.laneThemes.slice(0, 5)).size).to.equal(5);
    const counts = fixtures.map(theme => terrain.laneThemes.filter(name => name === theme.styleName).length);
    expect(Math.max(...counts) - Math.min(...counts)).to.equal(1);
    const first = terrain.laneThemes.slice(); terrain.registerLanes(seeds, 42); expect(terrain.laneThemes).to.deep.equal(first);
    terrain.registerLanes(seeds, 42, 2); expect(terrain.laneThemes[0]).to.equal(first[1]);
    expect(procgenThemeOrder(5, 42)).to.deep.equal(procgenThemeOrder(5, 42));
  });
  it('preserves actual sourced gadget metadata and source trigger/animation flags through pack loading', async () => {
    const provider = new NodeFileProvider(fileURLToPath(new URL('../', import.meta.url))), config = { path: 'lemmings' };
    const assets = await new ProcgenAssetManager({ styleName: 'pillar', config, fileProvider: provider }).load();
    const terrain = await loadProcgenPackTerrain({ styleNames: ['pillar'], config, fileProvider: provider, book: await loadTerrainRecipeBook(provider), initialAssets: assets });
    const source = terrain.themes[0].terrain;
    for (const object of source.objects) {
      expect(object.image).to.equal(assets.assets.gadgetImages[object.id]);
      for (const key of Object.keys(assets.assets.gadgets[object.id])) expect(object[key]).to.deep.equal(assets.assets.gadgets[object.id][key]);
    }
    const trap = source.objects.find(object => object.image.trigger_effect_id === 4);
    expect(trap.image.animationLoop).to.equal(false);
    expect(source.objects.filter(object => object.image.trigger_effect_id === 7 || object.image.trigger_effect_id === 8)).to.have.length(2);
  });
  it('dispatches exact sourced collision, alpha and descriptors per lane and reassigns on restart', async () => {
    const [masks, fire, pillar] = await Promise.all([loadProcgenMasks(), loadProcgenTerrain('lemmings', 1), loadProcgenTerrain('lemmings', 3)]);
    const terrain = new ProcgenPackTerrain([{ styleName: 'fire', terrain: fire }, { styleName: 'pillar', terrain: pillar }]);
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 4, seed: 42 });
    expect(new Set(terrain.laneThemes.slice(0, 2)).size).to.equal(2);
    for (let lane = 0; lane < 4; lane++) {
      const seed = world.laneSeeds[lane], source = terrain.forSeed(seed), descriptor = terrain.describe(seed, 1);
      expect(descriptor.themeId).to.equal(source.recipe.id);
      expect(terrain.getChunk(seed, 1, true).pixels).to.deep.equal(source.getChunk(seed, 1, true).pixels);
      for (let y = 0; y < 96; y += 6) for (let x = 0; x < 128; x += 6) expect(terrain.solidSample(seed, 1, x, y, descriptor)).to.equal(source.collisionAt(seed, 128 + x, y));
    }
    const first = terrain.laneThemes.slice(); world._restart([]);
    expect(terrain.laneThemes[0]).to.equal(first[1]); expect(terrain.assignments.size).to.equal(4);
    expect(world.getDebugState().laneThemes).to.deep.equal(terrain.laneThemes);
    world.dispose();
  });
});
