import { createCasinoTerrainPieces } from './CasinoArchitecture.js';
import { createOldVegasPack } from './OldVegasPack.js';
import { createNeonCabaretTheme } from './NeonCabaretTheme.js';
import { createCabaretPiece, NEON_CABARET_PALETTE } from './NeonCabaretPack.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import { ColorPalette } from '../render/ColorPalette.js';

// MAIN.DAT's classic HUD uses these fixed VGA slots, independently of scene art.
const hudPalette = new ColorPalette();
for (let i = 0; i < 16; i++) hudPalette.setColorInt(i, NEON_CABARET_PALETTE.getColor(i));
[[0, 0, 0], [64, 64, 224], [0, 176, 0], [240, 208, 208], [240, 240, 0], [240, 32, 32], [128, 128, 128]]
  .forEach(([r, g, b], i) => hudPalette.setColorRGB(i, r, g, b));
const gamePalette = { ...NEON_CABARET_PALETTE, hudPalette };

const NEON_CABARET_STYLE = {
  groundSet: 100,
  customAssets: true,
  terrainPieces: ['Velvet riveted foundation', 'Glass catwalk slab', 'Brass staircase', 'Steel amplifier block', 'Brass connector column', 'Heart marquee arch'].map((name, id) => ({ id, name })).concat(createCasinoTerrainPieces().map(p => ({ id: p.id, name: p.name }))),
  gadgetPieces: ['Encore exit', 'Stage entrance', 'Live arc gap', 'Velvet curtain press', 'Rose coolant bath', 'Encore bulb garland', 'Dancing spotlight rail', 'Heart of the show transformer', 'Velvet dynamo', 'Turquoise glass catwalk fascia', 'Footlight encore chase'].map((name, id) => ({ id, name })).concat([{ id: 11, name: 'Dense cigarette-smoke cloud' }], createOldVegasPack().pieces.map((p, i) => ({ id: i + 12, name: p.name })))
};
function createNeonCabaretGroundSet() {
  const theme = createNeonCabaretTheme();
  const exit = createCabaretPiece('exit', 'Encore exit', 48, 48, 'stage', (p, f) => {
    p.rect(3, 5, 42, 43, 0); p.rect(5, 7, 38, 40, 9); p.rect(9, 11, 30, 34, 3);
    p.rect(17, 20, 14, 25, 0); p.rect(18, 21, 12, 23, 19); p.line(19, 22, 28, 22, 14);
    for (let y = 12; y < 44; y += 8) { p.ellipse(7, y, 2, 2, (f + y) % 8 < 4 ? 10 : 11); p.ellipse(41, y, 2, 2, 11); }
    p.heart(24, 10, 7, 5); p.rect(0, 45, 48, 3, 9);
  }, { triggerEffectId: TriggerTypes.EXIT_LEVEL, trigger: { x: 18, y: 30, width: 12, height: 15 } });
  const entrance = createCabaretPiece('entrance', 'Stage entrance', 48, 32, 'ceiling', (p, f) => {
    p.rect(2, 0, 44, 6, 9); p.rect(5, 6, 38, 19, 1); p.rect(7, 7, 34, 15, 0);
    const open = Math.min(12, f); p.rect(7, 7, 17 - open, 15, 3); p.rect(24 + open, 7, 17 - open, 15, 4);
    p.line(7, 24, 40, 24, 9); for (let x = 7; x < 43; x += 8) p.ellipse(x, 3, 2, 2, 10);
  });
  const terrainImages = theme.terrainPieces.map(p => ({ ...p.image, steelWidth: p.isSteel ? p.width : 0, steelHeight: p.isSteel ? p.height : 0 }));
  const objectImages = [exit, entrance, ...theme.hazards, ...theme.pieces, theme.smokeHazard, ...theme.casinoScenery].map((p, id) => ({ ...p.image,
    animationLoop: id !== 1 && p.triggerEffectId !== TriggerTypes.TRAP, firstFrameIndex: 0,
    trigger_left: p.trigger?.x || 0, trigger_top: p.trigger?.y || 0,
    trigger_width: p.trigger?.width || 0, trigger_height: p.trigger?.height || 0,
    characterHazard: p.characterHazard || ({ 2: 'electric', 3: 'crush', 4: 'acid' })[id] || null,
    trigger_effect_id: p.triggerEffectId || 0, preview_image_index: 0, trap_sound_effect_id: -1 }));
  // TRAP uses the normal one-shot animation and frame-count cooldown. Its final
  // frame is the idle raised press, ready for the next engine trigger.
  objectImages[3].frames[15] = objectImages[3].frames[0];
  return { groundPalette: NEON_CABARET_PALETTE, colorPalette: gamePalette,
    getTerrainImages: () => terrainImages, getObjectImages: () => objectImages };
}
export { NEON_CABARET_STYLE, createNeonCabaretGroundSet };
