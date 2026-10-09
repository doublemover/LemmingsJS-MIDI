import { expect } from 'chai';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { Level } from '../js/level/Level.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 900, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const findPlacement = (terrain, seed) => {
  for (let chunk = 2; chunk < 48; chunk++) { const descriptor = terrain.describe(seed, chunk); if (descriptor.objects.length) return { chunk, object: descriptor.objects[0] }; }
  throw new Error('No supported later source hazard fixture');
};
const bitAt = (chunk, x, y) => !!(chunk.solid[(y * 128 + x) >>> 5] & (1 << ((y * 128 + x) & 31)));

describe('generated gadget presentation', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('keeps source triggered traps idle without inventing an interactive lifecycle', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    const trap = terrain.objects.find(p => p.image.trigger_effect_id === TriggerTypes.TRAP);
    terrain.objects = [trap]; terrain.compiledAssemblies = []; terrain.compiledAssemblies = [];
    terrain.supportsFineGrowth = false; // Component presentation uses an explicitly revealed, prepared source chunk.
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42 });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    const placed = findPlacement(terrain, world.laneSeeds[0]); world.generatedThrough[0] = (placed.chunk + 1) * 128;
    renderer.follow = false; renderer.cameraX = placed.object.x - 24; renderer.render();
    expect(placed.object).to.include({ role: 'trap', animation: 'idle', interactive: false });
    world.tickIndex = 400; renderer.render();
    expect(renderer.objectFrames.has(trap.image.frames[0])).to.equal(true);
    expect(trap.image.frames.slice(1).some(frame => renderer.objectFrames.has(frame))).to.equal(false);
    expect(trap.image.animationLoop).to.equal(false);
    renderer.dispose(); world.dispose();
  });

  it('supports continuously looping source hazards and suppresses unanchored ambient ornaments', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 2);
    const hazard = terrain.objects.find(p => p.image.trigger_effect_id === TriggerTypes.KILL); terrain.objects = [hazard]; terrain.compiledAssemblies = []; terrain.compiledAssemblies = [];
    const placed = findPlacement(terrain, 42), object = placed.object;
    expect(object).to.include({ role: 'hazard', animation: 'loop', interactive: false });
    expect(object.supportY).to.equal(object.y + hazard.image.height);
    const descriptor = terrain.describe(42, placed.chunk);
    for (let dx = 0; dx < hazard.image.width; dx++) expect(terrain.solidSample(42, placed.chunk, object.x - placed.chunk * 128 + dx, object.supportY, descriptor)).to.equal(true);
  });

  it('gives water a bounded open cavity, complete floor and side supports with exact far-zoom sampling', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    const water = terrain.objects.find(p => p.image.trigger_effect_id === TriggerTypes.DROWN); terrain.objects = [water]; terrain.compiledAssemblies = []; terrain.compiledAssemblies = [];
    const placed = findPlacement(terrain, 42), chunkIndex = placed.chunk, chunk = terrain.getChunk(42, chunkIndex, true), object = placed.object, left = object.x - chunkIndex * 128, right = left + water.image.width;
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
      expect(terrain.solidSample(42, chunkIndex, x, y, chunk)).to.equal(bitAt(chunk, x, y));
      expect(terrain.rasterSample(42, chunkIndex, x, y, chunk)).to.equal(chunk.pixels[y * 128 + x]);
    }
    terrain.supportsFineGrowth = false;
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42 }), seed = world.laneSeeds[0];
    const generated = findPlacement(terrain, seed), placement = generated.object; world.generatedThrough[0] = (generated.chunk + 1) * 128;
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.cameraX = placement.x - 24; renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === water.image)).to.equal(true);
    world._setPixel(placement.x, placement.supportY, 0); renderer.render();
    expect(renderer.objectPlacements.some(p => p.image === water.image)).to.equal(false);
    renderer.dispose(); world.dispose();
  });

  it('omits generated dig-direction arrows while retaining the actual authored arrow trigger owner', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    const arrows = terrain.objects.filter(piece => [TriggerTypes.ONEWAY_LEFT, TriggerTypes.ONEWAY_RIGHT].includes(piece.image.trigger_effect_id));
    expect(arrows).to.have.length(2);
    for (const seed of [42, 4157451727]) for (const chunk of [0, 2, 8, 20]) expect(terrain.objectsAt(seed, chunk).some(object => arrows.includes(object.piece))).to.equal(false);
    const level = new Level(128, 96), images = []; for (const piece of terrain.objects) images[piece.id] = piece.image;
    level.setMapObjects(arrows.map((piece, index) => ({ id: piece.id, x: 16 + index * 40, y: 32, drawProperties: 0 })), images);
    expect(level.triggers.map(trigger => trigger.type)).to.deep.equal(arrows.map(piece => piece.image.trigger_effect_id));
    expect(level.triggers.every(trigger => trigger.owner)).to.equal(true);
  });
});
