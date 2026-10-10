import { expect } from 'chai';
import assert from 'node:assert/strict';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

describe('generated liquid retains original source foundation', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [pack, ground] of [['lemmings', 3], ['lemmings_ohNo', 3]]) it('carves an actual supported ' + pack + ' pool without adding walls or changing source trigger geometry', async () => {
    const terrain = await loadProcgenTerrain(pack, ground), water = terrain.objects.find(piece => piece.image.trigger_effect_id === Types.DROWN);
    terrain.objects = [water]; terrain.compiledAssemblies = []; terrain.supportsFineGrowth = false;
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42, laneHeight: 144, assists: false });
    const seed = world.laneSeeds[0]; let chunk, descriptor, object;
    for (let at = 2; at < 48 && !object; at++) {
      const candidate = terrain.describe(seed, at); if (candidate.objects.length) { descriptor = candidate; object = candidate.objects[0]; chunk = at; }
    }
    expect(object).to.exist;
    world.generatedThrough[0] = (chunk + 1) * 128;
    const original = { ...descriptor, objects: [] }, left = object.x - descriptor.origin, right = left + water.image.width, bottom = object.supportY;
    const image = water.image, final = terrain.getChunk(seed, chunk, true);
    for (let y = 0; y < world.laneHeight; y++) for (let x = 0; x < 128; x++) {
      const cavity = x >= left && x < right && y >= object.y && y < bottom;
      const priorSolid = terrain.solidSample(seed, chunk, x, y, original), actual = terrain.solidSample(seed, chunk, x, y, descriptor), index = y * 128 + x;
      assert.equal(actual, cavity ? false : priorSolid);
      assert.equal(actual, !!(final.solid[index >>> 5] & (1 << (index & 31))));
      assert.equal(terrain.rasterSample(seed, chunk, x, y, descriptor), final.pixels[index]);
      if (!cavity) assert.equal(final.pixels[index], terrain.rasterSample(seed, chunk, x, y, original));
    }
    for (let y = object.y - 4; y < object.y; y++) {
      expect(terrain.solidSample(seed, chunk, left - 1, y, descriptor)).to.equal(terrain.solidSample(seed, chunk, left - 1, y, original));
      expect(terrain.solidSample(seed, chunk, right, y, descriptor)).to.equal(terrain.solidSample(seed, chunk, right, y, original));
    }
    expect(world.hazards.placementReady(0, chunk, object, descriptor)).to.equal(true);
    const x = object.x + image.trigger_left + 1, y = object.y + image.trigger_top + 1;
    expect(world.hazards.trigger(x, y, world.actors[0], 1)).to.equal(Types.DROWN);
    const trigger = world.hazards.peek(0, chunk, 0).trigger;
    expect([trigger.x2 - trigger.x1, trigger.y2 - trigger.y1]).to.deep.equal([image.trigger_width, image.trigger_height]);
    world._setPixel(object.x - 1, object.y, 0);
    expect(world.hazards.placementReady(0, chunk, object, descriptor)).to.equal(false); world.dispose();
  });
});
