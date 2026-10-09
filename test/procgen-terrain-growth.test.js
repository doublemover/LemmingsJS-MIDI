import { expect } from 'chai';
import assert from 'node:assert/strict';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenPackTerrain, loadProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 600, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};

describe('shared bounded collision/display terrain reveal', function() {
  this.timeout(30000);
  let masks, source, bubble;
  before(async () => {
    masks = await loadProcgenMasks(); bubble = await loadProcgenTerrain('lemmings_ohNo', 3); const p = new NodeFileProvider(process.cwd());
    source = (await loadProcgenPackTerrain({ styleNames: ['pillar'], config: { path: 'lemmings' }, fileProvider: p, book: await loadTerrainRecipeBook(p) })).themes[0];
  });
  it('services whole source sections and attached jobs across 64 and 1024 moving lanes with bounded work', () => {
    for (const count of [64, 1024]) {
      const growth = new ProcgenTerrainGrowth(count, 128), through = new Float64Array(count), frontiers = new Float64Array(count); frontiers.fill(36);
      const lanes = Array.from({ length: count }, () => ({ alive: 1 })), prepared = [], changes = [];
      const prepare = (lane, chunk) => {
        prepared.push([lane, chunk]);
        return { jobs: Array.from({ length: 32 }, (_, index) => ({ index, kind: index < 4 ? 'foundation' : 'object',
          x1: index < 4 ? index * 32 : 64, x2: index < 4 ? (index + 1) * 32 : 96, dependencies: index ? [index - 1] : [], sourceIds: [index] })), objectJobs: Array.from({ length: 28 }, (_, index) => index + 4) };
      };
      growth.reset(through, frontiers);
      for (let tick = 0; tick < 400; tick++) {
        frontiers.forEach((value, lane) => { frontiers[lane] = value + 2; growth.observe(lane, 2); });
        growth.update({ through, frontiers, lanes, prepare, reveal: (lane, before, after, chunk, job) => {
          assert.ok(after <= growth.preparedThrough[lane]); changes.push(after - before);
          const state = growth.states.get(growth._key(lane, chunk)); assert.ok(job.dependencies.every(index => state.active[index]));
        } });
        assert.ok(growth.stats.lastPrepared <= growth.preparationBudget); assert.ok(growth.stats.lastRevealed <= growth.revealBudget);
        for (let lane = 0; lane < count; lane++) assert.ok(through[lane] - frontiers[lane] >= 64, 'reachable foundation stays ahead');
      }
      expect(prepared.length).to.be.greaterThan(0); expect(growth.stats.minimumMargin).to.be.at.least(64);
      expect(changes.some(change => change === 32)).to.equal(true); expect(changes.every(change => change === 0 || change === 32)).to.equal(true);
      expect(growth.states.size).to.be.at.most(count * 8);
      for (let tick = 0; tick < 200; tick++) growth.update({ through, frontiers, lanes, prepare, reveal() {} });
      expect([...growth.pending].every(count => count === 0)).to.equal(true);
      lanes.forEach(lane => { lane.alive = 0; }); frontiers.fill(100000);
      growth.update({ through, frontiers, lanes, prepare() { throw Error('idle preparation'); }, reveal() {} });
      expect([...growth.pending].every(count => count === 0)).to.equal(true);
    }
  });
  it('prioritizes the fastest reachable piece, validates dependency order and resets all activation state', () => {
    const growth = new ProcgenTerrainGrowth(2, 128), through = new Float64Array(2), frontiers = Float64Array.of(36, 36), order = [];
    growth.reset(through, frontiers); frontiers.fill(140); growth.speed[1] = 2;
    growth.update({ through, frontiers, lanes: [{ alive: 1 }, { alive: 1 }], prepare: () => ({ jobs: [{ index: 0, kind: 'foundation', x1: 0, x2: 32, dependencies: [] }], objectJobs: [] }), reveal: lane => order.push(lane) });
    expect(order[0]).to.equal(1); expect(growth.stateFor(0, 2)).to.equal(null);
    expect(growth.stateFor(0, 10).active.length).to.equal(0);
    expect(() => growth._prepare(0, 10, () => ({ jobs: [{ x1: 0, x2: 32, dependencies: [0] }] }))).to.throw('dependencies');
    growth.pending.fill(20); growth.speed.fill(2); frontiers.fill(36); growth.reset(through, frontiers);
    expect([...growth.pending]).to.deep.equal([0, 0]); expect([...growth.speed]).to.deep.equal([1, 1]); expect([...through]).to.deep.equal([256, 256]); expect(growth.states.size).to.equal(0);
  });
  it('gates hidden source collision, steel and color at the same boundary without composing future chunks', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: new ProcgenPackTerrain([source]), seed: 42 });
    const x = world.generatedThrough[0], before = source.terrain.stats.generated;
    expect(world.hasGroundAt(x, 90)).to.equal(false); expect(world.baseGroundAt(x, 90)).to.equal(0); expect(world.basePixelAt(x, 90)).to.equal(0);
    expect(world.hasSteelAt(x, 90)).to.equal(false); expect(world.getColumnStepHeight(x, 83, 8)).to.equal(0); expect(world.getColumnGapDepth(x, 83, 8)).to.equal(9);
    expect(source.terrain.stats.generated).to.equal(before); world.dispose();
  });
  it('places whole source sections at a stationary camera and preserves edits, builders, caches and gadget footprints', () => {
    const terrain = new ProcgenPackTerrain([source]), world = new ProcgenLaneWorld({ masks, terrain, seed: 42, assists: false });
    const canvas = canvasFixture(); canvas.width = 1200; canvas.height = 96;
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.scale = 1; renderer.render();
    const edge = world.generatedThrough[0], row = 90 * renderer.buffer.width;
    expect(renderer.pixels[row + edge]).to.equal(0xff0e0807); expect(world.hasGroundAt(edge, 90)).to.equal(false);
    world.setGroundAt(40, 20); world._setPixel(45, 80, 0);
    const actor = world.actors[0]; actor.x = edge - 56; actor.y = terrain.surface(world.laneSeeds[0], actor.x) - 1; actor.setAction(world.actions[State.WALKING]);
    world.step(); renderer.render(); expect(world.generatedThrough[0]).to.be.greaterThan(edge); const state = world.terrainGrowth.stateFor(0, Math.floor(edge / terrain.chunkWidth)); expect(state?.active.some(Boolean) ?? true).to.equal(true);
    expect(renderer.pixels[row + edge]).to.equal(world.basePixelAt(edge, 90)); expect(renderer.pixels[row + world.generatedThrough[0]]).to.equal(0xff0e0807);
    expect(renderer.pixels[20 * renderer.buffer.width + 40]).to.equal(0xff86cbea); expect(renderer.pixels[80 * renderer.buffer.width + 45]).to.equal(0xff0e0807);
    const pixels = renderer.pixels.slice(); renderer._terrainPixels(renderer.buffer.width, renderer.buffer.height, true); expect(renderer.pixels).to.deep.equal(pixels);
    const rebuilds = renderer.terrainRebuilds; renderer.render(false); expect(renderer.terrainRebuilds).to.equal(rebuilds);
    let object;
    for (let chunk = 2; chunk < 32 && !object; chunk++) object = terrain.describe(world.laneSeeds[0], chunk).objects.find(o => !o.assembly);
    expect(object).to.exist; renderer.cameraX = object.x - 24;
    const complete = object.x + object.piece.image.width + (object.role === 'liquid' ? 1 : 0);
    world.generatedThrough[0] = complete - 1; world.terrainRevision++; world.frontierRevision++; renderer.lastGeometryKey = ''; renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === object.piece.image)).to.equal(false);
    world.terrainGrowth._remember(0, Math.floor(object.x / terrain.chunkWidth) * terrain.chunkWidth, Math.ceil(complete / terrain.chunkWidth) * terrain.chunkWidth); world.generatedThrough[0] = complete; world.terrainRevision++; world.frontierRevision++; renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === object.piece.image)).to.equal(true);
    renderer.viewWidth = complete - 1; renderer.lastPlacementKey = ''; renderer._prepareObjectPlacements();
    expect(renderer.objectPlacements.some(p => p.image === object.piece.image)).to.equal(true);
    renderer.dispose(); world.dispose();
  });
  it('assembles real authored pieces with matching collision and display, then body before attached head', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: bubble, seed: 42, cohorts: true, assists: false }); world.laneSeeds[0] = 42;
    const chunk = 57, origin = chunk * 128, plan = bubble.growthPlan(42, chunk), descriptor = plan.descriptor;
    const bodyIndex = descriptor.objects.findIndex(object => object.piece.id === 10), headIndex = descriptor.objects.findIndex(object => object.piece.id === 8);
    expect(bodyIndex).to.be.at.least(0); expect(headIndex).to.be.at.least(0); expect(plan.objectJobs[bodyIndex]).to.not.equal(plan.objectJobs[headIndex]);
    const state = world.terrainGrowth._prepare(0, chunk, () => plan), canvas = canvasFixture(); canvas.width = 128; canvas.height = 96;
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: {}, windowRef: { devicePixelRatio: 1, performance } }); renderer.follow = false; renderer.scale = 1; renderer.cameraX = origin;
    let sawBodyFirst = false, added = 0;
    for (let index = 0; index < plan.jobs.length; index++) {
      const job = plan.jobs[index]; expect(job.dependencies.every(dependency => !!state.active[dependency])).to.equal(true);
      expect(world.terrainGrowth._activate(state, index, world.generatedThrough, world._revealGrowth)).to.equal(true); added++;
      renderer.render();
      for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
        const globalX = origin + x, expected = world.basePixelAt(globalX, y);
        expect(renderer.pixels[y * 128 + x]).to.equal(expected || 0xff0e0807);
        expect(world.baseGroundAt(globalX, y)).to.equal(globalX < world.generatedThrough[0] && bubble.solidSample(42, chunk, x, y, descriptor, state.complete ? null : state) ? 1 : 0);
      }
      const bodyReady = world.terrainGrowth.objectReady(0, chunk, bodyIndex), headReady = world.terrainGrowth.objectReady(0, chunk, headIndex);
      if (bodyReady && !headReady) {
        sawBodyFirst = true; expect(renderer.objectPlacements.some(p => p.image === descriptor.objects[bodyIndex].piece.image)).to.equal(true);
        expect(renderer.objectPlacements.some(p => p.image === descriptor.objects[headIndex].piece.image)).to.equal(false);
        expect(world.hazards.placementReady(0, chunk, descriptor.objects[headIndex], descriptor)).to.equal(false);
      }
    }
    expect(sawBodyFirst).to.equal(true); expect(state.complete).to.equal(true); expect(added).to.equal(plan.jobs.length);
    const before = state.active.slice(); renderer.render(); expect(state.active).to.deep.equal(before);
    const hiddenX = origin - 128; expect(world.hasGroundAt(hiddenX, 90)).to.equal(false);
    renderer.dispose(); world.dispose();
  });
  it('combines bounded source work with external work protection, completes it while actors stop, and resets generation queues', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: new ProcgenPackTerrain([source]), seed: 42, cohorts: true });
    const actor = world._spawn(0, false); actor.x = 150; actor.y = 72; actor.setAction(world.actions[State.OHNO]);
    world.setPendingTerrainWork(0, 2); world.step(); expect(world.getLaneMusicSignals(0).pendingTerrainWork).to.be.greaterThan(2);
    for (let tick = 0; tick < 20; tick++) world.step(); expect(world.terrainGrowth.pending[0]).to.equal(0); expect(world.getLaneMusicSignals(0).pendingTerrainWork).to.equal(2);
    world.setPendingTerrainWork(0, 0); world.step(); expect(world.getLaneMusicSignals(0).pendingTerrainWork).to.equal(0);
    const before = world.tickIndex; world._restart([]); expect(world.tickIndex).to.equal(before); expect([...world.terrainGrowth.pending]).to.deep.equal([0]); expect([...world.pendingTerrainWork]).to.deep.equal([0]);
    expect(world.generatedThrough[0]).to.equal(256); world.dispose();
  });
});
