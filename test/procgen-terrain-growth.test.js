import { expect } from 'chai';
import assert from 'node:assert/strict';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenPackTerrain, loadProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 600, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};

describe('shared bounded collision/display terrain reveal', function() {
  this.timeout(30000);
  let masks, source;
  before(async () => {
    masks = await loadProcgenMasks(); const p = new NodeFileProvider(process.cwd());
    source = (await loadProcgenPackTerrain({ styleNames: ['pillar'], config: { path: 'lemmings' }, fileProvider: p, book: await loadTerrainRecipeBook(p) })).themes[0];
  });
  it('services 64 continuously advancing lanes within shared budgets with conservative lead and immutable preparation first', () => {
    const count = 64, growth = new ProcgenTerrainGrowth(count, 128), through = new Float64Array(count), frontiers = new Float64Array(count); frontiers.fill(36);
    const lanes = Array.from({ length: count }, () => ({ alive: 1 })), prepared = [];
    growth.reset(through, frontiers);
    for (let tick = 0; tick < 400; tick++) {
      frontiers.forEach((value, lane) => { frontiers[lane] = value + 2; growth.observe(lane, 2); });
      const previous = through.slice();
      growth.update({ through, frontiers, lanes, prepare: (lane, chunk) => prepared.push([lane, chunk]), reveal: (lane, before, after) => assert.ok(after <= growth.preparedThrough[lane]) });
      assert.ok(growth.stats.lastPrepared <= growth.preparationBudget); assert.ok(growth.stats.lastRevealed <= growth.revealBudget);
      for (let lane = 0; lane < count; lane++) { assert.ok(through[lane] - frontiers[lane] >= 64); assert.ok([0, 8].includes(through[lane] - previous[lane])); }
    }
    expect(prepared.length).to.be.greaterThan(0); expect(growth.stats.minimumMargin).to.be.at.least(64);
    for (let tick = 0; tick < 32; tick++) growth.update({ through, frontiers, lanes, prepare() {}, reveal() {} });
    expect([...growth.pending].every(count => count === 0)).to.equal(true);
    lanes.forEach(lane => { lane.alive = 0; }); frontiers.fill(100000); growth.update({ through, frontiers, lanes, prepare() { throw Error('idle preparation'); }, reveal() {} });
    expect([...growth.pending].every(count => count === 0)).to.equal(true);
  });
  it('prioritizes the actual quickest reachable edge and resets without timers or inherited work', () => {
    const growth = new ProcgenTerrainGrowth(2, 128), through = Float64Array.of(104, 104), frontiers = Float64Array.of(36, 36), order = [];
    growth.reset(through, frontiers); through.fill(96); growth.speed[1] = 2;
    growth.update({ through, frontiers, lanes: [{ alive: 1 }, { alive: 1 }], prepare() {}, reveal: lane => order.push(lane) });
    expect(order[0]).to.equal(1); growth.pending.fill(20); growth.speed.fill(2); growth.reset(through, frontiers);
    expect([...growth.pending]).to.deep.equal([0, 0]); expect([...growth.speed]).to.deep.equal([1, 1]); expect([...through]).to.deep.equal([104, 104]);
  });
  it('gates hidden source collision, steel and color at the same boundary without composing future chunks', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: new ProcgenPackTerrain([source]), seed: 42 });
    const x = world.generatedThrough[0], before = source.terrain.stats.generated;
    expect(world.hasGroundAt(x, 90)).to.equal(false); expect(world.baseGroundAt(x, 90)).to.equal(0); expect(world.basePixelAt(x, 90)).to.equal(0);
    expect(world.hasSteelAt(x, 90)).to.equal(false); expect(world.getColumnStepHeight(x, 83, 8)).to.equal(0); expect(world.getColumnGapDepth(x, 83, 8)).to.equal(9);
    expect(source.terrain.stats.generated).to.equal(before); world.dispose();
  });
  it('reveals only eight new columns at a stationary camera and preserves source edits, builders, caches and complete gadget footprints', () => {
    const terrain = new ProcgenPackTerrain([source]), world = new ProcgenLaneWorld({ masks, terrain, seed: 42, assists: false });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.scale = 1; renderer.render();
    const edge = world.generatedThrough[0], row = 90 * renderer.buffer.width;
    expect(renderer.pixels[row + edge]).to.equal(0xff0e0807); expect(world.hasGroundAt(edge, 90)).to.equal(false);
    world.setGroundAt(40, 20); world._setPixel(45, 80, 0);
    const actor = world.actors[0]; actor.x = edge - 56; actor.y = terrain.surface(world.laneSeeds[0], actor.x) - 1; actor.setAction(world.actions[State.WALKING]);
    world.step(); renderer.render(); expect(world.generatedThrough[0]).to.equal(edge + 8);
    expect(renderer.pixels[row + edge]).to.equal(world.basePixelAt(edge, 90)); expect(renderer.pixels[row + edge + 8]).to.equal(0xff0e0807);
    expect(renderer.pixels[20 * renderer.buffer.width + 40]).to.equal(0xff86cbea); expect(renderer.pixels[80 * renderer.buffer.width + 45]).to.equal(0xff0e0807);
    const pixels = renderer.pixels.slice(); renderer._terrainPixels(renderer.buffer.width, renderer.buffer.height, true); expect(renderer.pixels).to.deep.equal(pixels);
    const rebuilds = renderer.terrainRebuilds; renderer.render(false); expect(renderer.terrainRebuilds).to.equal(rebuilds);
    const object = terrain.describe(world.laneSeeds[0], 0).objects[0], complete = object.x + object.piece.image.width + (object.role === 'liquid' ? 1 : 0);
    world.generatedThrough[0] = complete - 1; world.terrainRevision++; world.frontierRevision++; renderer.lastGeometryKey = ''; renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === object.piece.image)).to.equal(false);
    world.generatedThrough[0] = complete; world.terrainRevision++; world.frontierRevision++; renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === object.piece.image)).to.equal(true);
    renderer.viewWidth = complete - 1; renderer.lastPlacementKey = ''; renderer._prepareObjectPlacements();
    expect(renderer.objectPlacements.some(p => p.image === object.piece.image)).to.equal(true);
    renderer.dispose(); world.dispose();
  });
  it('combines bounded source work with external work protection, completes it while actors stop, and resets generation queues', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: new ProcgenPackTerrain([source]), seed: 42, cohorts: true });
    const actor = world._spawn(0, false); actor.x = 80; actor.y = 72; actor.setAction(world.actions[State.OHNO]);
    world.setPendingTerrainWork(0, 2); world.step(); expect(world.getLaneMusicSignals(0).pendingTerrainWork).to.be.greaterThan(2);
    for (let tick = 0; tick < 20; tick++) world.step(); expect(world.terrainGrowth.pending[0]).to.equal(0); expect(world.getLaneMusicSignals(0).pendingTerrainWork).to.equal(2);
    world.setPendingTerrainWork(0, 0); world.step(); expect(world.getLaneMusicSignals(0).pendingTerrainWork).to.equal(0);
    const before = world.tickIndex; world._restart([]); expect(world.tickIndex).to.equal(before); expect([...world.terrainGrowth.pending]).to.deep.equal([0]); expect([...world.pendingTerrainWork]).to.deep.equal([0]);
    expect(world.generatedThrough[0]).to.equal(104); world.dispose();
  });
});
