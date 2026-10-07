import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCasinoArchitecture, createCasinoTerrainPieces, createCasinoSmokeHazard } from '../js/decorations/CasinoArchitecture.js';
import { createNeonCabaretGroundSet, NEON_CABARET_STYLE } from '../js/decorations/NeonCabaretGroundSet.js';
import { CASINO_SHOWCASE } from '../js/decorations/CasinoShowcase.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

describe('Casino Grand Revue spectacle', () => {
  it('exports large original architecture as both scenery and real terrain', () => {
    const catalog = createCasinoArchitecture(), terrain = createCasinoTerrainPieces();
    assert.equal(catalog.pieces.length,9); assert.equal(terrain.length,6);
    assert.ok(terrain.some(p => p.width === 256)); assert.ok(terrain.some(p => p.height === 160));
    assert.deepEqual(terrain.map(p => p.id),[6,7,8,9,10,11]);
    assert.ok(catalog.pieces.every(p => p.interactive === false));
    assert.equal(catalog.pieces.find(p => p.id === 'casino-bulb-rope').width,256);
  });
  it('routes the dense gray smoke through an existing trigger with explicit smoke presentation', () => {
    const hazard = createCasinoSmokeHazard(), objects = createNeonCabaretGroundSet().getObjectImages();
    assert.equal(hazard.triggerEffectId,TriggerTypes.FRYING); assert.equal(hazard.characterHazard,'smoke');
    assert.equal(objects[11].trigger_effect_id,TriggerTypes.FRYING); assert.equal(objects[11].characterHazard,'smoke');
    assert.ok(hazard.image.frames.every(f => f.filter(c => c >= 24 && c <= 27).length > 1500));
    assert.ok(hazard.trigger.x + hazard.trigger.width <= hazard.width);
    assert.ok(hazard.trigger.y + hazard.trigger.height <= hazard.height);
    assert.equal(NEON_CABARET_STYLE.gadgetPieces[11].id,11);
  });
  it('keeps the smoke clustered, fully indexed and seamless across its sixteen-frame loop', () => {
    const smoke = createCasinoSmokeHazard(), again = createCasinoSmokeHazard();
    assert.deepEqual([smoke.width, smoke.height, smoke.image.frames.length], [96, 88, 16]);
    assert.deepEqual(smoke.trigger, { x: 7, y: 12, width: 82, height: 66 });
    const changes = smoke.image.frames.map((frame, phase) => {
      assert.deepEqual(frame, again.image.frames[phase]);
      assert.ok(frame.includes(128));
      assert.ok(frame.every(c => c === 128 || c < smoke.paletteColors.length));
      for (const color of [24, 25, 26, 27]) assert.ok(frame.includes(color));
      assert.equal(frame[78 * smoke.width + 48], 0, 'ashtray bowl stays open and recognizable');
      return frame.reduce((n, value, i) => n + (value !== smoke.image.frames[(phase + 1) % 16][i]), 0);
    });
    assert.ok(changes.every(n => n > 0 && n < smoke.width * smoke.height / 4));
    assert.ok(changes[15] <= Math.max(...changes.slice(0, 15)), 'loop seam has no larger jump than the ordinary motion');
  });
  it('draws one unbroken rounded crown tube with a stable core and symmetric pixel glow', () => {
    const crown = createCasinoArchitecture().pieces.find(p => p.id === 'casino-neon-crown');
    assert.deepEqual([crown.width, crown.height, crown.image.frames.length], [192, 80, 16]);
    for (const frame of crown.image.frames) {
      const start = 69 * crown.width + 96, seen = new Set([start]), pending = [start];
      while (pending.length) {
        const at = pending.pop(), x = at % crown.width, y = Math.floor(at / crown.width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, next = yy * crown.width + xx;
          if (xx < 0 || yy < 0 || xx >= crown.width || yy >= crown.height || seen.has(next) || frame[next] !== 6) continue;
          seen.add(next); pending.push(next);
        }
      }
      assert.ok(seen.size > 350, 'core remains a complete connected crown rather than separate strokes');
      assert.ok([...seen].some(at => Math.floor(at / crown.width) === 8), 'central crown point connects to the base');
      assert.ok([...seen].some(at => at % crown.width === 32));
      assert.ok([...seen].some(at => at % crown.width === 160));
      assert.deepEqual([66, 67, 68, 69, 70, 71, 72].map(y => frame[y * crown.width + 56]), [32, 33, 29, 6, 29, 33, 32]);
      for (let y = 5; y < 75; y++) for (let x = 28; x < 165; x++) {
        assert.equal(frame[y * crown.width + x], crown.image.frames[0][y * crown.width + x], 'only the surrounding rays chase, never the main tube');
      }
    }
  });
  it('keeps stable old gadget IDs and makes every new showcase placement resolve', () => {
    const ground = createNeonCabaretGroundSet();
    assert.equal(ground.getObjectImages()[0].trigger_effect_id,TriggerTypes.EXIT_LEVEL);
    assert.equal(ground.getObjectImages()[2].characterHazard,'electric');
    assert.equal(ground.getObjectImages()[3].characterHazard,'crush');
    assert.equal(ground.getObjectImages()[4].characterHazard,'acid');
    for (const t of CASINO_SHOWCASE.terrain) assert.ok(ground.getTerrainImages()[t.id]);
    for (const g of CASINO_SHOWCASE.gadgets) assert.ok(ground.getObjectImages()[g.id]);
    assert.match(fs.readFileSync(new URL('../examples/neon-cabaret/grand-revue.nxlv',import.meta.url),'utf8'),/HEIGHT 320/);
    assert.ok(CASINO_SHOWCASE.gadgets.some(g => ground.getObjectImages()[g.id].height === 192));
  });
});
