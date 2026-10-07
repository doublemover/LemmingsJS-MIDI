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
