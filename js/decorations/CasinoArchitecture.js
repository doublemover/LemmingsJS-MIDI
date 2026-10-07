import { createCabaretPainter } from './NeonCabaretPack.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
const COLORS = ['#130e1a', '#300c1b', '#550e24', '#841731', '#b9223d', '#ec4661', '#fff5df', '#ffdf83', '#b2863c', '#ffffff', '#235be0', '#122d77', '#83c6ff', '#ff853b', '#f2d1b4', '#a78c94', '#706475', '#3f4451', '#cbd3df', '#e9ecf2', '#8d98aa', '#b6a779', '#fbc346', '#75561d', '#d1cad0', '#aaa4b1', '#827d8b', '#55505f', '#2cffdd', '#ff47bd', '#a543ed', '#d00d35'];
const palette = { getColor: i => { const n = parseInt((COLORS[i] || COLORS[0]).slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n & 65280) | n >>> 16) >>> 0; } };
const makePiece = (id, name, width, height, placement, paint, animated = true) => {
  const first = createCabaretPainter(width, height); paint(first, 0);
  const frames = Array.from({ length: 16 }, (_, phase) => { if (!animated || !phase) return first.frame; const p = createCabaretPainter(width, height); paint(p, phase); return p.frame; });
  return { id, name, width, height, placement, animated, paletteColors: COLORS, interactive: false, image: { width, height, frames, palette } };
};
function gold(p, x, y, w, h) { p.rect(x, y, w, h, 23); p.rect(x + 1, y, w - 2, 1, 7); p.rect(x + 1, y + 1, w - 2, Math.max(1, h - 3), 8); p.rect(x + 2, y + 1, w - 4, 1, 22); p.rect(x + 1, y + h - 2, w - 2, 1, 21); }
function marble(p, x, y, w, h, dark = false) {
  p.rect(x, y, w, h, dark ? 0 : 19);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const v = Math.sin(xx * 0.079 + yy * 0.115 + Math.sin(yy * 0.091) * 2.7) + Math.sin(xx * 0.19 - yy * 0.05) * 0.18;
    if (Math.abs(v) < 0.045) p.dot(x + xx, y + yy, dark ? 17 : 20);
    else if (Math.abs(v) < 0.09) p.dot(x + xx, y + yy, dark ? 16 : 18);
    if ((xx * 31 + yy * 47) % 397 === 0) p.dot(x + xx, y + yy, dark ? 21 : 9);
  }
}
function column(p, dark, phase) {
  gold(p, 3, 0, 58, 7); gold(p, 8, 8, 48, 7); gold(p, 12, 16, 40, 5);
  marble(p, 17, 21, 30, 116, dark);
  for (let x = 18; x < 46; x += 5) { p.line(x, 22, x, 136, dark ? 16 : 18); p.line(x + 1, 22, x + 1, 136, dark ? 20 : 9); }
  gold(p, 12, 137, 40, 6); gold(p, 8, 144, 48, 7); gold(p, 3, 152, 58, 8);
  for (const y of [4, 147, 156]) { const x = 8 + phase * 3 % 48; p.dot(x, y, 9); p.dot(x + 1, y, 7); }
}
function velvet(p, w, h, phase = 0) {
  for (let x = 0; x < w; x++) {
    const wave = Math.sin(x * 0.29 + Math.sin(phase * Math.PI / 8) * 0.05), shade = wave > 0.6 ? 5 : wave > 0 ? 4 : wave > -0.6 ? 3 : 2;
    p.rect(x, 0, 1, h, shade); if (x % 23 === 0) p.rect(x, 0, 1, h, 1);
  }
}
let cached;
function createCasinoArchitecture() {
  if (cached) return cached;
  const pieces = [
    makePiece('casino-marble-floor', 'Grand black marble promenade', 256, 40, 'trim', p => { marble(p, 0, 0, 256, 40, true); gold(p, 0, 0, 256, 7); for (let x = 0; x < 256; x += 64) p.line(x, 8, x, 39, 23); gold(p, 0, 34, 256, 6); }, false),
    makePiece('casino-white-pillar', 'Ivory marble Corinthian pillar', 64, 160, 'stage', (p, t) => column(p, false, t)),
    makePiece('casino-black-pillar', 'Black marble gilded pillar', 64, 160, 'stage', (p, t) => column(p, true, t)),
    makePiece('casino-grand-stairs', 'Wide velvet and gold staircase', 128, 96, 'stage', p => { for (let i = 0; i < 8; i++) { const x = i * 16, y = 84 - i * 12; marble(p, x, y, 16, 96 - y, true); p.rect(x, y + 3, 16, 6, 3); gold(p, x, y, 16, 3); } }, false),
    makePiece('casino-velvet-dais', 'Grand crimson velvet dais', 192, 64, 'stage', (p, t) => { velvet(p, 192, 64, t); gold(p, 0, 0, 192, 7); gold(p, 0, 58, 192, 6); for (let x = 8; x < 190; x += 12) { p.ellipse(x, 13, 3, 3, 8); p.dot(x, 12, (x + t) % 5 ? 7 : 9); } }),
    makePiece('casino-gold-cornice', 'Long gilded palace cornice', 256, 24, 'ceiling', (p, t) => { gold(p, 0, 0, 256, 24); p.rect(0, 8, 256, 8, 0); for (let x = 4; x < 256; x += 8) { p.ellipse(x, 12, 2, 2, 7); p.dot(x, 11, (x / 4 + t) % 4 ? 22 : 9); } }),
    makePiece('casino-bulb-rope', 'Long double festoon bulb ropes', 256, 56, 'ceiling', (p, t) => {
      for (let strand = 0; strand < 2; strand++) for (let x = 0; x < 256; x++) { const y = 4 + strand * 16 + Math.sin(x * Math.PI / 256) * 23; p.dot(x, y, 8); if (x % 10 === 0) { const lit = (x / 10 - t + strand * 4 + 32) % 8 < 4; p.rect(x - 1, y + 1, 3, 4, 23); p.ellipse(x, y + 7, 3, 4, lit ? 7 : 8); p.ellipse(x, y + 6, 1, 2, lit ? 9 : 22); } }
    }),
    makePiece('casino-velvet-proscenium', 'Grand velvet proscenium arch', 256, 160, 'stage', (p, t) => {
      velvet(p, 256, 160, t); p.rect(37, 40, 182, 120, 128);
      for (let x = 0; x < 256; x++) { const y = 17 + Math.abs(Math.sin(x * Math.PI / 128)) * 25; p.dot(x, y, 7); p.dot(x, y + 1, 8); }
      gold(p, 0, 0, 256, 8); gold(p, 0, 8, 8, 152); gold(p, 248, 8, 8, 152);
      for (const x of [34, 222]) { p.ellipse(x, 94, 6, 8, 8); p.ellipse(x, 92, 4, 6, 7); p.line(x, 100, x + Math.sin(t * Math.PI / 8) * 2, 126, 7); }
    }),
    makePiece('casino-neon-crown', 'Oversized neon crown and rays', 192, 80, 'ceiling', (p, t) => {
      for (let pass = 0; pass < 3; pass++) { const c = pass === 0 ? 30 : pass === 1 ? 29 : 6, d = 2 - pass; const points = [[26,22],[53,43],[70,10],[96,36],[122,10],[139,43],[166,22],[155,64],[37,64],[26,22]]; for (let i = 1; i < points.length; i++) { const a = points[i-1], b = points[i]; for (let o = -d; o <= d; o++) p.line(a[0]+o,a[1],b[0]+o,b[1],c); } }
      for (let i = 0; i < 9; i++) { const x = 32 + i * 16; p.ellipse(x, 72, 3, 2, (i+t)%5 < 2 ? 9 : 28); }
    })
  ];
  cached = { id: 'casino-architecture', pieces, paletteColors: COLORS };
  return cached;
}
function createCasinoTerrainPieces(startId = 6) {
  return createCasinoArchitecture().pieces.filter(p => ['casino-marble-floor','casino-white-pillar','casino-black-pillar','casino-grand-stairs','casino-velvet-dais','casino-gold-cornice'].includes(p.id)).map((p, i) => ({ ...p, id: startId + i, isSteel: p.id === 'casino-gold-cornice', image: { ...p.image, frames: [p.image.frames[0]], frameCount: 1, isSteel: p.id === 'casino-gold-cornice' } }));
}
function createCasinoSmokeHazard() {
  const piece = makePiece('casino-cigarette-smoke', 'Dense cigarette-smoke cloud', 96, 88, 'stage', (p, t) => {
    p.ellipse(48, 80, 30, 6, 17); p.ellipse(48, 78, 27, 4, 20); p.ellipse(48, 77, 22, 3, 0);
    p.line(34, 75, 58, 70, 6); p.line(34, 76, 58, 71, 18); p.line(52, 71, 58, 70, 13); p.dot(34, 75, 31);
    for (let layer = 0; layer < 4; layer++) for (let puff = 0; puff < 6; puff++) {
      const y = 65 - layer * 15 - (t + puff * 3) % 8, x = 48 + Math.sin((puff * 2 + layer + t / 5)) * (14 + layer * 5), r = 10 + layer * 2;
      p.ellipse(x, y, r, r * 0.72, 27 - Math.min(3, layer)); p.ellipse(x - 3, y - 3, r * 0.7, r * 0.45, 26 - Math.min(2, layer));
    }
  });
  return { ...piece, triggerEffectId: TriggerTypes.FRYING, characterHazard: 'smoke', trigger: { x: 7, y: 12, width: 82, height: 66 }, hazardCue: 'Dense gray cigarette cloud rising from a lit ashtray', active: true };
}
export { createCasinoArchitecture, createCasinoTerrainPieces, createCasinoSmokeHazard };
