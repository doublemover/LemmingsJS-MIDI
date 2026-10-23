import assert from 'node:assert/strict';
import { loadProcgenMixedTerrain, DEFAULT_PROCGEN_LANE_THEMES, PROCGEN_THEME_FAMILIES } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { ProcgenScenery } from '../js/app/procgen/ProcgenScenery.js';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenRenderResources } from '../js/app/procgen/ProcgenRenderResources.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createProcgenLaneProjection } from '../js/app/procgen/workstation/ProcgenLaneProjection.js';

describe('workstation mixed source terrain', function() {
  this.timeout(30000);
  let terrain;
  const seeds = Uint32Array.from({ length: 8 }, (_, lane) => 42 + lane * 739);
  before(async () => {
    const provider = new NodeFileProvider(process.cwd());
    terrain = await loadProcgenMixedTerrain({ configs: ['lemmings', 'lemmings_ohNo', 'holiday94'].map(path => ({ path })), fileProvider: provider, book: await loadTerrainRecipeBook(provider) });
    terrain.configure(8, 128, { workstation: true, laneHeight: 144 }); terrain.registerLanes(seeds, 42);
  });
  it('loads ten actual pack families and preserves eight explicit lane assignments across generations and snapshots', () => {
    assert.equal(terrain.themes.length, 10); assert.deepEqual(terrain.unavailableThemes, []);
    assert.deepEqual(terrain.laneThemes, DEFAULT_PROCGEN_LANE_THEMES);
    for (const family of PROCGEN_THEME_FAMILIES) {
      const theme = terrain.themes.find(theme => theme.familyId === family.id);
      assert.equal(theme.provenance.groundSet, family.groundSet); assert.equal(theme.provenance.pack, family.pack);
      assert.ok(theme.terrain.recipe.sources.some(source => source.pack === family.pack && source.groundSet === family.groundSet));
    }
    const saved = terrain.exportAssignments(); terrain.registerLanes(seeds, 938, 15);
    assert.deepEqual(terrain.laneThemes, DEFAULT_PROCGEN_LANE_THEMES);
    terrain.restoreAssignments(JSON.parse(JSON.stringify(saved))); assert.deepEqual(terrain.exportAssignments(), saved);
  });
  it('varies silhouettes, terrain runs and obstacle geometry at equivalent lane distances, repeatably', () => {
    const signatures = [], runs = new Set(), obstacles = new Set();
    for (let lane = 0; lane < seeds.length; lane++) {
      const source = terrain.forSeed(seeds[lane]), signature = [];
      for (let chunk = 2; chunk < 18; chunk++) {
        const descriptor = source.describe(seeds[lane], chunk); runs.add(descriptor.profile.runLength);
        if (descriptor.challenge) obstacles.add(JSON.stringify(descriptor.challenge));
        for (let x = 0; x < 128; x += 8) signature.push(source._surface(seeds[lane], chunk, x, descriptor));
      }
      signatures.push(signature.join(','));
    }
    assert.equal(new Set(signatures).size, 8); assert.ok(runs.size >= 3); assert.ok(obstacles.size >= 12);
    const source = terrain.forSeed(seeds[0]), before = source.getChunk(seeds[0], 22).topProfile.slice();
    source.reset(); assert.deepEqual(source.getChunk(seeds[0], 22).topProfile, before);
  });
  it('spaces independent hazard envelopes with approach and recovery support', () => {
    let hazards = 0;
    for (let lane = 0; lane < seeds.length; lane++) {
      const source = terrain.forSeed(seeds[lane]); let previous = -Infinity;
      for (let chunk = 2; chunk < 160; chunk++) {
        const descriptor = source.describe(seeds[lane], chunk);
        for (const object of descriptor.objects) {
          if (!['trap', 'liquid', 'hazard'].includes(object.role) || object.assembly) continue;
          const image = object.piece.image, left = Math.min(object.x, object.x + image.trigger_left), right = Math.max(object.x + image.width, object.x + image.trigger_left + image.trigger_width);
          assert.ok(left - previous >= source.hazardSpacing); previous = right; hazards++;
          assert.ok(left >= descriptor.origin + 24); assert.ok(right <= descriptor.origin + 96);
          const plan = source.growthPlan(seeds[lane], chunk, { piecewise: true }), job = plan.jobs[plan.objectJobs[descriptor.objects.indexOf(object)]];
          for (const section of plan.foundationSections) if (section.x2 > left - descriptor.origin - 24 && section.x1 < right - descriptor.origin + 32) assert.ok(job.dependencies.includes(section.index));
        }
      }
    }
    assert.ok(hazards > 0, 'spacing must retain real sourced hazards');
  });
  it('restores changed family assignments, spacing and scenery seed references into a fresh mixed world', async () => {
    const provider = new NodeFileProvider(process.cwd()), masks = await loadProcgenMasks();
    const fresh = await loadProcgenMixedTerrain({ configs: ['lemmings', 'lemmings_ohNo', 'holiday94'].map(path => ({ path })), fileProvider: provider, book: await loadTerrainRecipeBook(provider) });
    terrain.setLaneAssignments([...DEFAULT_PROCGEN_LANE_THEMES].reverse());
    const original = new ProcgenLaneWorld({ terrain, masks, seed: 42, laneCount: 8, laneHeight: 144, workstation: true, hazardSpacing: 256, cohorts: true });
    const restored = new ProcgenLaneWorld({ terrain: fresh, masks, seed: 42, laneCount: 8, laneHeight: 144, workstation: true, cohorts: true });
    const state = world => ({ seeds: [...world.laneSeeds], actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.frameIndex, actor.action.actionName]), frontiers: [...world.frontiers], growth: world.terrainGrowth.exportState(), scenery: world.scenery.snapshot() });
    try {
      for (let tick = 0; tick < 240; tick++) original.step();
      restoreProcgenCheckpoint(restored, JSON.parse(JSON.stringify(captureProcgenCheckpoint(original))));
      assert.deepEqual(restored.terrain.exportAssignments(), original.terrain.exportAssignments());
      assert.ok(restored.terrain.themes.every(theme => theme.terrain.hazardSpacing === 256));
      assert.equal(restored.scenery.laneSeeds, restored.laneSeeds); assert.deepEqual(state(restored), state(original));
      for (let tick = 0; tick < 100; tick++) { original.step(); restored.step(); }
      assert.deepEqual(state(restored), state(original));
    } finally { original.dispose(); restored.dispose(); }
  });
});

describe('just ahead source publication and scenery', () => {
  it('keeps eight readable rows while projecting zoomed source coordinates exactly', () => {
    const projection = createProcgenLaneProjection({ laneCount: 16, height: 1000, firstLane: 5, minimumRow: 64 });
    assert.equal(projection.count, 8); assert.equal(projection.firstLane, 5);
    projection.scale = 3; projection.rowSourceY[2] = 94;
    assert.equal(projection.laneAt(projection.rowHeight * 2 + 30), 7);
    assert.equal(projection.worldY(projection.rowHeight * 2 + 30), 7 * 144 + 104);
  });
  const prepare = () => ({ jobs: Array.from({ length: 4 }, (_, index) => ({ index, kind: 'foundation', x1: index * 32, x2: (index + 1) * 32, dependencies: index ? [index - 1] : [] })), objectJobs: [] });
  it('starts without completed chunks and publishes only approached pieces, including exact snapshot continuation', () => {
    const growth = new ProcgenTerrainGrowth(1, 128, { justAhead: true }), through = new Float64Array(1), frontiers = Float64Array.of(0);
    const context = { through, frontiers, lanes: [{ alive: 1 }], prepare, reveal() {} };
    growth.reset(through, frontiers); assert.equal(through[0], 0); assert.equal(growth.columnReady(0, 0), false);
    for (let tick = 0; tick < 20; tick++) growth.update(context);
    assert.equal(through[0], 96); assert.equal(growth.columnReady(0, 95), true); assert.equal(growth.columnReady(0, 96), false);
    assert.ok(growth.preparedThrough[0] > through[0], 'preparation does not publish pixels/collision');
    const restored = new ProcgenTerrainGrowth(1, 128, { justAhead: true }); restored.restoreState(JSON.parse(JSON.stringify(growth.exportState())), prepare);
    const copy = { ...context, through: through.slice(), frontiers: frontiers.slice() };
    for (let tick = 0; tick < 60; tick++) {
      context.frontiers[0] += 2; copy.frontiers[0] += 2;
      growth.ensureLocal(0, context.frontiers[0], context); restored.ensureLocal(0, copy.frontiers[0], copy);
      growth.update(context); restored.update(copy);
      assert.deepEqual(copy.through, through); assert.equal(restored.columnReady(0, copy.frontiers[0] + 12), true);
      assert.deepEqual(restored.exportState(), growth.exportState());
    }
  });
  it('keeps distant dither world anchored, paused, noncolliding, replayable and bounded', () => {
    const piece = { id: 1, width: 16, height: 16, frame: new Uint32Array(256).fill(0xff78bcde) };
    let collisionReads = 0;
    const terrain = { ingredients: [piece], solidSample() { collisionReads++; throw new Error('scenery collision access'); }, getChunk() { throw new Error('scenery generation access'); } };
    const create = () => new ProcgenScenery({ terrain, laneSeeds: Uint32Array.of(42), laneHeight: 144, solidLead: 84 });
    const scenery = create(), draw = (left = 0, right = 400) => { const pixels = []; scenery.drawLane({ lane: 0, left, right, drawPixel: (...pixel) => pixels.push(pixel) }); return pixels; };
    scenery.update({ frontiers: [80], tick: 1 }); const initial = scenery.snapshot();
    const stillPixels = []; scenery.drawLane({ lane: 0, reducedMotion: true, drawPixel: (...pixel) => stillPixels.push(pixel) });
    assert.ok(stillPixels.length > draw().length); assert.deepEqual(scenery.snapshot(), initial);
    scenery.update({ frontiers: [500], tick: 500, paused: true }); assert.deepEqual(scenery.snapshot(), initial);
    scenery.update({ frontiers: [80], tick: 25 }); const saved = scenery.snapshot(), before = draw(); assert.ok(before.length);
    assert.deepEqual(draw(80, 160), before.filter(([x]) => x >= 80 && x < 160)); assert.deepEqual(scenery.snapshot(), saved);
    const restored = create(); restored.restore(JSON.parse(JSON.stringify(saved)));
    scenery.update({ frontiers: [120], tick: 41 }); restored.update({ frontiers: [120], tick: 41 }); assert.deepEqual(restored.snapshot(), scenery.snapshot());
    for (let tick = 42; tick < 500; tick++) scenery.update({ frontiers: [tick * 20], tick });
    assert.ok(scenery.entries[0].length <= 18); assert.equal(collisionReads, 0);
    restored.update({ frontiers: [400], tick: 42, reducedMotion: true }); assert.ok(restored.entries[0].every(entry => entry.progress === 8));
  });
  it('uploads scenery once per changed image and clips it behind solid terrain without per-pixel canvas calls', () => {
    let uploads = 0, draws = 0, samples = 0, lastReducedMotion = null;
    const context = { createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() { uploads++; }, drawImage() { draws++; }, fillRect() { throw new Error('Per-pixel canvas calls'); } };
    const renderer = Object.create(ProcgenLaneRenderer.prototype);
    Object.assign(renderer, { canvas: { ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } }, bufferContext: context,
      originX: 0, originY: 0, viewWidth: 8, viewHeight: 8, rasterStep: 1, pixels: new Uint32Array(64).fill(0xff0e0807),
      world: { laneCount: 1, laneHeight: 8, scenery: { revision: 1, drawLane({ drawPixel, reducedMotion }) { samples++; lastReducedMotion = reducedMotion; drawPixel(1, 1, 0xff0000ff); drawPixel(2, 1, 0xff0000ff); } } } });
    renderer.resources = new ProcgenRenderResources(renderer.canvas.ownerDocument); renderer.sceneryImageKey = {};
    renderer.pixels[10] = 0xffabcdef;
    renderer._drawScenery('terrain:0', 8, 8); renderer._drawScenery('terrain:0', 8, 8);
    assert.equal(uploads, 1); assert.equal(samples, 1); assert.equal(draws, 2);
    assert.equal(renderer.sceneryPixels[9], 0xff0000ff); assert.equal(renderer.sceneryPixels[10], 0);
    renderer.world.scenery.revision++; renderer._drawScenery('terrain:0', 8, 8); assert.equal(uploads, 2);
    renderer._drawScenery('terrain:1', 8, 8); assert.equal(uploads, 3);
    renderer.reducedMotion = { matches: true }; renderer._drawScenery('terrain:1', 8, 8);
    assert.equal(uploads, 4); assert.equal(lastReducedMotion, true); assert.equal(renderer.world.scenery.reducedMotion, undefined);
    renderer.resources.dispose();
  });
});
