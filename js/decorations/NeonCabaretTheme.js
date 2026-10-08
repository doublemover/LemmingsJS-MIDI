import { createCasinoTerrainPieces, createCasinoSmokeHazard } from './CasinoArchitecture.js';
import { createOldVegasPack } from './OldVegasPack.js';
import { createNeonCabaretPack, createCabaretPainter, createCabaretPiece, NEON_CABARET_PALETTE } from './NeonCabaretPack.js';
import { TriggerTypes } from '../level/TriggerTypes.js';

function terrain(id, name, width, height, draw, isSteel = false) {
  const p = createCabaretPainter(width, height); draw(p);
  return { id, name, width, height, isSteel, image: { width, height, frames: [p.frame], frameCount: 1, palette: NEON_CABARET_PALETTE, isSteel } };
}
/** Asset-only theme contract. Trigger rectangles are local, fixed and explicit. */
function createNeonCabaretTheme() {
  const terrainPieces = [
    terrain(0, 'Velvet riveted foundation', 64, 24, p => { p.rect(0, 0, 64, 24, 2); p.rect(0, 0, 64, 3, 9); for (let x = 2; x < 64; x += 8) { p.rect(x, 5, 3, 17, 3); p.rect(x + 3, 5, 2, 17, 4); } p.line(0, 23, 63, 23, 0); p.bolts(0, 2, 64, 21); }),
    terrain(1, 'Glass catwalk slab', 64, 12, p => { p.rect(0, 0, 64, 12, 19); p.rect(0, 0, 64, 2, 15); for (let x = 0; x < 64; x += 16) { p.rect(x, 2, 2, 8, 9); p.line(x + 4, 8, x + 10, 3, 14); } p.rect(0, 10, 64, 2, 7); }),
    terrain(2, 'Brass staircase', 32, 32, p => { for (let x = 0; x < 32; x++) { const y = 24 - Math.floor(x / 8) * 8; p.rect(x, y, 1, 32 - y, 12); p.dot(x, y, 10); for (let j = y + 4; j < 32; j += 8) p.dot(x, j, 9); } }),
    terrain(3, 'Steel amplifier block', 32, 32, p => { p.rect(0, 0, 32, 32, 7); p.rect(1, 1, 30, 2, 9); p.rect(4, 5, 24, 22, 0); for (let y = 7; y < 27; y += 3) p.line(6, y, 25, y, 8); p.bolts(0, 0, 32, 32); }, true),
    terrain(4, 'Brass connector column', 16, 48, p => { p.rect(3, 0, 10, 48, 12); p.rect(5, 0, 3, 48, 9); for (let y = 0; y < 48; y += 12) { p.rect(0, y, 16, 4, 7); p.line(0, y, 15, y, 9); } }),
    terrain(5, 'Heart marquee arch', 56, 40, p => { p.heart(28, 18, 21, 9); p.heart(28, 18, 18, 3); p.heart(28, 18, 14, 128); p.rect(4, 27, 7, 13, 12); p.rect(45, 27, 7, 13, 12); for (const x of [9, 18, 38, 47]) p.ellipse(x, 7, 2, 2, 10); })
  ];
  const hazards = [
    createCabaretPiece('cabaret-arc-gap', 'Live arc gap', 64, 40, 'stage', (p, f) => {
      p.rect(0, 32, 64, 8, 0); p.rect(1, 33, 62, 6, 11); for (let x = 2; x < 62; x += 8) { p.line(x, 38, x + 5, 33, 0); p.line(x + 1, 38, x + 6, 33, 0); }
      for (const x of [8, 51]) { p.rect(x, 6, 5, 26, 7); for (let y = 8; y < 30; y += 5) p.rect(x - 3, y, 11, 2, 9); p.ellipse(x + 2, 5, 5, 4, 14); p.dot(x + 1, 3, 15); }
      let lastX = 14, lastY = 20; for (let x = 20; x <= 50; x += 6) { const y = 17 + ((x * 5 + f * 7) % 9); p.line(lastX, lastY, x, y, 14); p.line(lastX, lastY - 1, x, y - 1, 15); lastX = x; lastY = y; }
    }, { triggerEffectId: TriggerTypes.FRYING, trigger: { x: 16, y: 12, width: 32, height: 20 }, hazardCue: 'Cyan live arc over yellow-black danger strip', active: true }),
    createCabaretPiece('cabaret-velvet-press', 'Velvet curtain press', 64, 56, 'stage', (p, f) => {
      p.rect(3, 0, 58, 5, 9); for (const x of [3, 55]) { p.rect(x, 4, 6, 46, 7); p.line(x, 5, x, 50, 9); }
      p.rect(9, 5, 46, 7, 3); for (let x = 10; x < 54; x += 6) p.rect(x, 5, 2, 7, 5);
      const y = 13 + Math.round((1 - Math.cos(f * Math.PI / 8)) * 9);
      p.rect(18, 7, 4, y - 5, 8); p.rect(42, 7, 4, y - 5, 8); p.rect(12, y, 40, 7, 7); p.line(12, y, 51, y, 9); p.line(12, y + 6, 51, y + 6, 16);
      p.rect(1, 48, 62, 8, 0); for (let x = 3; x < 60; x += 8) p.line(x, 53, x + 5, 49, 11); p.ellipse(32, 4, 2, 2, 16);
    }, { triggerEffectId: TriggerTypes.TRAP, trigger: { x: 18, y: 36, width: 28, height: 12 }, hazardCue: 'Red press edge, red lamp and striped crush zone', active: true }),
    createCabaretPiece('cabaret-coolant-bath', 'Rose coolant bath', 80, 24, 'trim', (p, f) => {
      p.rect(0, 5, 80, 19, 0); p.rect(3, 7, 74, 13, 3); p.line(2, 5, 77, 5, 16);
      for (let y = 8; y < 20; y += 4) for (let x = 4; x < 75; x += 12) p.line(x + f % 4, y, x + 6 + f % 4, y, y % 8 ? 4 : 5);
      for (const x of [12, 38, 64]) { const y = 10 - (f + x) % 8; p.ellipse(x, y, 2, 2, 5); p.dot(x, y - 1, 6); }
      p.rect(0, 21, 80, 3, 9); for (let x = 2; x < 80; x += 10) p.line(x, 23, x + 3, 21, 0);
    }, { triggerEffectId: TriggerTypes.DROWN, trigger: { x: 4, y: 7, width: 72, height: 13 }, hazardCue: 'Rose liquid, red rim and striped containment basin', active: true })
  ];
  terrainPieces.push(...createCasinoTerrainPieces(terrainPieces.length));
  const casino = createOldVegasPack();
  return { ...createNeonCabaretPack(), casinoScenery: [...casino.pieces], smokeHazard: createCasinoSmokeHazard(), terrainPieces, hazards, version: 2, background: '#160f29', description: 'A neon cabaret housed in a velvet-and-brass power station.' };
}
export { createNeonCabaretTheme };
