import { expect } from 'chai';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 900, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const bitAt = (chunk, x, y) => !!(chunk.solid[(y * 128 + x) >>> 5] & (1 << ((y * 128 + x) & 31)));

describe('generated gadget presentation', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('keeps source triggered traps idle without inventing an interactive lifecycle', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    const trap = terrain.objects.find(p => p.image.trigger_effect_id === TriggerTypes.TRAP);
    terrain.objects = [trap];
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42 });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.render();
    expect(terrain.objectsAt(world.laneSeeds[0], 0)[0]).to.include({ role: 'trap', animation: 'idle', interactive: false });
    world.tickIndex = 400; renderer.render();
    expect(renderer.objectFrames.has(trap.image.frames[0])).to.equal(true);
    expect(trap.image.frames.slice(1).some(frame => renderer.objectFrames.has(frame))).to.equal(false);
    expect(trap.image.animationLoop).to.equal(false);
    renderer.dispose(); world.dispose();
  });

  it('supports continuously looping source hazards while leaving ambient ornaments free', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 2);
    const hazard = terrain.objects.find(p => p.image.trigger_effect_id === TriggerTypes.KILL); terrain.objects = [hazard];
    const object = terrain.objectsAt(42, 0)[0];
    expect(object).to.include({ role: 'hazard', animation: 'loop', interactive: false });
    expect(object.supportY).to.equal(object.y + hazard.image.height);
    const descriptor = terrain.describe(42, 0);
    for (let dx = 0; dx < hazard.image.width; dx++) expect(terrain.solidSample(42, 0, object.x + dx, object.supportY, descriptor)).to.equal(true);
  });

  it('gives water a bounded open cavity, complete floor and side supports with exact far-zoom sampling', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    const water = terrain.objects.find(p => p.image.trigger_effect_id === TriggerTypes.DROWN); terrain.objects = [water];
    const chunk = terrain.getChunk(42, 0, true), object = chunk.objects[0], left = object.x, right = left + water.image.width;
    expect(object).to.include({ role: 'liquid', interactive: false, animation: 'loop' });
    expect(left).to.be.greaterThan(0); expect(right).to.be.lessThan(128);
    expect(object.supportY).to.be.lessThan(96);
    for (let x = left; x < right; x++) {
      for (let y = object.y; y < object.supportY; y++) expect(bitAt(chunk, x, y)).to.equal(false);
      expect(bitAt(chunk, x, object.supportY)).to.equal(true);
    }
    for (let y = object.y; y <= object.supportY; y++) {
      expect(bitAt(chunk, left - 1, y)).to.equal(true); expect(bitAt(chunk, right, y)).to.equal(true);
    }
    for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
      expect(terrain.solidSample(42, 0, x, y, chunk)).to.equal(bitAt(chunk, x, y));
      expect(terrain.rasterSample(42, 0, x, y, chunk)).to.equal(chunk.pixels[y * 128 + x]);
    }
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42 }), seed = world.laneSeeds[0];
    const placement = terrain.objectsAt(seed, 0)[0];
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === water.image)).to.equal(true);
    world._setPixel(placement.x, placement.supportY, 0); renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === water.image)).to.equal(false);
    renderer.dispose(); world.dispose();
  });

  it('attaches seed 42 pillar arrows to matching terrain and invalidates their mask after digging', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42 }); world.generatedThrough[0] = 512;
    const descriptor = terrain.describe(world.laneSeeds[0], 2), object = descriptor.objects.find(p => p.piece.id === 4);
    expect(object).to.include({ x: 272, y: 64, clipToTerrain: true, role: 'terrain-overlay', interactive: false });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.cameraX = 256; renderer.render();
    const placement = renderer.objectPlacements.find(p => p.image === object.piece.image);
    expect(placement).to.exist;
    let edited = -1;
    for (let index = 0; index < placement.clip.length; index++) {
      const x = object.x + index % object.piece.image.width, y = object.y + Math.floor(index / object.piece.image.width);
      expect(!!placement.clip[index]).to.equal(terrain.solidSample(world.laneSeeds[0], 2, x - 256, y, descriptor));
      if (placement.clip[index] && !(object.piece.image.frames[0][index] & 128)) edited = index;
    }
    expect(edited).to.be.at.least(0);
    const generated = terrain.stats.generated, rasterized = terrain.stats.rasterized;
    world._setPixel(object.x + edited % object.piece.image.width, object.y + Math.floor(edited / object.piece.image.width), 0);
    renderer.render();
    expect(renderer.objectPlacements.find(p => p.image === object.piece.image).clip[edited]).to.equal(0);
    expect(terrain.stats.generated).to.equal(generated); expect(terrain.stats.rasterized).to.equal(rasterized);
    renderer.dispose(); world.dispose();
  });
});
