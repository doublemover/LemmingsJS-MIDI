import { createHydroRevue } from './HydroRevue.js';
import { createCasinoArchitecture } from './CasinoArchitecture.js';
// Deterministic indexed pixel art: generated once, then shared by every lane.
const COLORS = ['#120b12', '#370b21', '#6d102c', '#ad1635', '#ed2949', '#ff6b68', '#fff4df', '#f4c66b', '#9f6636', '#ffffff', '#3e66ee', '#193697', '#70b6ff', '#ff873e', '#ffd2ad', '#cc8c78', '#704250', '#2e9b68', '#9a5ccb', '#f3dc84', '#bfc5d0', '#44dec5', '#ee94c2', '#958075'];
const rgba = hex => { const n = parseInt(hex.slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n & 65280) | n >>> 16) >>> 0; };
const palette = { getColor: i => rgba(COLORS[i] || COLORS[0]) };
const FONT = { '0':['111','101','101','101','111'], '1':['010','110','010','010','111'], '2':['110','001','010','100','111'], '3':['110','001','010','001','110'], '4':['101','101','111','001','001'], '5':['111','100','110','001','110'], '6':['011','100','111','101','111'], '8':['111','101','111','101','111'], '9':['111','101','111','001','110'], Q:['111','101','101','111','001'], M:['101','111','111','101','101'], A:['010','101','111','101','101'], C:['111','100','100','100','111'], E:['111','100','110','100','111'], G:['111','100','101','101','111'], H:['101','101','111','101','101'], I:['111','010','010','010','111'], J:['001','001','001','101','111'], K:['101','101','110','101','101'], L:['100','100','100','100','111'], N:['101','111','111','111','101'], O:['111','101','101','101','111'], P:['110','101','110','100','100'], R:['110','101','110','101','101'], S:['111','100','111','001','111'], T:['111','010','010','010','010'], V:['101','101','101','101','010'], W:['101','101','111','111','101'], Y:['101','101','010','010','010'], D:['110','101','101','101','110'], U:['101','101','101','101','111'], B:['110','101','110','101','110'], '7':['111','001','010','010','010'] };
function painter(width, height) {
  const data = new Uint8Array(width * height).fill(128);
  const dot = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = c; };
  const rect = (x, y, w, h, c) => { for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) dot(xx, yy, c); };
  const ellipse = (x, y, rx, ry, c) => { for (let yy = -ry; yy <= ry; yy++) for (let xx = -rx; xx <= rx; xx++) if (xx * xx / (rx * rx) + yy * yy / (ry * ry) <= 1) dot(x + xx, y + yy, c); };
  const line = (x, y, xx, yy, c) => { const n = Math.max(Math.abs(xx - x), Math.abs(yy - y), 1); for (let i = 0; i <= n; i++) dot(x + (xx - x) * i / n, y + (yy - y) * i / n, c); };
  const textAt = (word, x, y, color = 6, scale = 1) => [...word].forEach((letter, i) => (FONT[letter] || []).forEach((row, j) => [...row].forEach((on, k) => { if (on === '1') rect(x + (i * 4 + k) * scale, y + j * scale, scale, scale, color); })));
  const text = (word, y, color = 6, scale = 1) => textAt(word, (width - (word.length * 4 - 1) * scale) / 2, y, color, scale);
  const blit = (source, sw, sh, ox, oy) => { for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (!(source[y * sw + x] & 128)) dot(ox + x, oy + y, source[y * sw + x]); };
  const polygon = (points, color) => { const minY = Math.floor(Math.min(...points.map(p => p[1]))), maxY = Math.ceil(Math.max(...points.map(p => p[1]))); for (let y = minY; y <= maxY; y++) { const crossings = []; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); } crossings.sort((a, b) => a - b); for (let i = 0; i + 1 < crossings.length; i += 2) rect(Math.ceil(crossings[i]), y, Math.floor(crossings[i + 1]) - Math.ceil(crossings[i]) + 1, 1, color); } };
  return { data, dot, rect, ellipse, line, text, textAt, blit, polygon };
}
function bulb(p, x, y, phase, index, style = 0) {
  const lit = (index - phase + 32) % 8 < 3;
  if (style === 1) { p.rect(x - 1, y - 1, 3, 3, lit ? 5 : 3); p.dot(x, y, lit ? 9 : 4); }
  else if (style === 2) { p.line(x - 2, y, x + 2, y, lit ? 6 : 8); p.line(x, y - 2, x, y + 2, lit ? 6 : 8); p.dot(x, y, lit ? 9 : 7); }
  else { p.ellipse(x, y, 2, 2, lit ? 7 : 8); p.ellipse(x, y, 1, 1, lit ? 9 : 7); }
}
const SUITS = {
  heart: ['00110001100', '01111011110', '11111111111', '11111111111', '01111111110', '00111111100', '00011111000', '00001110000', '00000100000', '00000000000', '00000000000'],
  spade: ['00000100000', '00001110000', '00011111000', '00111111100', '01111111110', '11111111111', '11111111111', '01110101110', '00000100000', '00001110000', '00011111000'],
  club: ['00001110000', '00011111000', '00011111000', '00001110000', '01110101110', '11111111111', '11111111111', '01110101110', '00000100000', '00001110000', '00011111000'],
  diamond: ['00000100000', '00001110000', '00001110000', '00011111000', '00111111100', '01111111110', '00111111100', '00011111000', '00001110000', '00001110000', '00000100000']
};
function suit(p, kind, x, y, size, color) {
  const micro = { heart: ['01010','11111','11111','01110','00100'], club: ['00100','01110','10101','11111','00100'], spade: ['00100','01110','11111','10101','00100'], diamond: ['00100','01110','11111','01110','00100'] };
  if (size === 2) { micro[kind].forEach((row, dy) => [...row].forEach((on, dx) => { if (on === '1') p.dot(x - 2 + dx, y - 2 + dy, color); })); return; }
  const pattern = SUITS[kind], side = size * 2 + 1;
  for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) if (pattern[Math.round(dy * 10 / (side - 1))][Math.round(dx * 10 / (side - 1))] === '1') p.dot(x - size + dx, y - size + dy, color);
}
const CHIP_DENOMINATIONS = [
  { value: 1, label: '1', color: 6 }, { value: 5, label: '5', color: 4 },
  { value: 25, label: '25', color: 17 }, { value: 100, label: '100', color: 0 },
  { value: 500, label: '500', color: 18 }, { value: 1000, label: '1K', color: 19 },
  { value: 5000, label: '5K', color: 13 }, { value: 25000, label: '25K', color: 10 }
];
function chipFace(p, denomination, phase) {
  const { color, label } = denomination, index = CHIP_DENOMINATIONS.indexOf(denomination), edge = [[10,13],[6,10],[6,22],[18,20],[21,6],[13,0],[22,20],[6,4]][index];
  p.ellipse(32, 33, 30, 30, 0); p.ellipse(31, 31, 29, 29, 8); p.ellipse(31, 31, 28, 28, color);
  // Modern split edge spots are continued on the side-view stacks.
  for (let n = 0; n < 6 + index % 3 * 2; n++) { const a = n * Math.PI * 2 / (6 + index % 3 * 2); for (let r = 22; r <= 28; r++) for (let d = -3; d <= 3; d++) p.dot(31 + Math.cos(a) * r + Math.sin(a) * d, 31 + Math.sin(a) * r - Math.cos(a) * d, edge[d < 0 ? 0 : 1]); }
  p.ellipse(31, 31, 21, 21, 8); p.ellipse(31, 31, 20, 20, 6); p.ellipse(31, 31, 18, 18, 0);
  for (let n = 0; n < 24; n++) { const a = n * Math.PI / 12; p.dot(31 + Math.cos(a) * 19, 31 + Math.sin(a) * 19, 7); }
  p.textAt('HYDRO', 22, 18, 7); p.textAt(label, 31 - (label.length * 4 - 1), 27, 9, 2); p.textAt('VEGAS', 22, 41, 6);
  p.line(22, 24, 40, 24, 8); p.line(22, 38, 40, 38, 8);
  for (let n = 0; n < 4; n++) suit(p, ['heart','club','spade','diamond'][n], 31 + Math.cos(n*Math.PI/2)*25, 31 + Math.sin(n*Math.PI/2)*25, 2, n%2 ? edge[0] : edge[1]);
  p.dot(31 + Math.cos(phase*Math.PI/8)*28,31 + Math.sin(phase*Math.PI/8)*28,9);
}
function chipStack(p, denomination, phase) {
  const { color, label } = denomination, index = CHIP_DENOMINATIONS.indexOf(denomination), accent = [[10,13],[6,10],[6,22],[18,20],[21,6],[13,0],[22,20],[6,4]][index];
  for (let stack = 2; stack >= 0; stack--) {
    const x = 15 + stack * 20, count = 8 - stack * 2;
    for (let i = 0; i < count; i++) { const y = 32 - i * 3; p.ellipse(x, y+2, 13, 3, 0); p.ellipse(x,y,13,3,color); p.line(x-12,y+2,x+12,y+2,8); for (const dx of [-9,-2,7]) { p.rect(x+dx,y,2,2,accent[0]); p.rect(x+dx+2,y,2,2,accent[1]); } }
    const y = 32 - (count-1)*3; p.ellipse(x,y,9,2,6); p.ellipse(x,y,6,1,0); p.dot(x+phase%8-4,y-2,9);
  }
  p.rect(20,35,32,9,8); p.rect(21,36,30,7,0); p.text(label,37,6);
}
function playingCard(p, kind, rank, phase) {
  const color = ['heart', 'diamond'].includes(kind) ? 4 : 0;
  p.rect(2, 2, 34, 48, 8); p.rect(1, 1, 34, 48, 6); p.rect(2, 2, 32, 46, 9);
  p.textAt(rank, 4, 4, color); suit(p, kind, 5, 14, 2, color);
  // The lower index is a true 180-degree rotated copy, as on a playing card.
  const corner = painter(9, 14); corner.textAt(rank, 1, 0, color); suit(corner, kind, 3, 10, 2, color);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 9; x++) { const ci = corner.data[y * 9 + x]; if (ci !== 128) p.dot(32 - x, 45 - y, ci); }
  if (rank === 'A') suit(p, kind, 18, 26, 8, color);
  else { for (const x of [11, 24]) for (const y of [12, 21, 30, 39]) suit(p, kind, x, y, 3, color); for (const y of [16, 35]) suit(p, kind, 18, y, 3, color); }
  const edge = phase % 16; p.dot(3 + edge, 1, 7); p.dot(34, 18 + edge, 7);
}
function rollingSlots(p, phase) {
  marquee(p, 64, 28, phase, 1);
  for (let reel = 0; reel < 3; reel++) {
    const viewport = painter(12, 16); viewport.rect(0, 0, 12, 16, 6);
    const offset = (phase * 3 + reel * 12) % 48;
    for (let symbol = -1; symbol < 5; symbol++) {
      const index = (symbol + 4) % 4, y = symbol * 12 - offset + 6;
      for (const wrap of [0, 48]) suit(viewport, ['heart', 'club', 'diamond', 'spade'][index], 6, y + wrap, 4, index === 1 || index === 3 ? 0 : 4);
    }
    viewport.rect(0, 0, 12, 1, 8); viewport.rect(0, 15, 12, 1, 8);
    p.blit(viewport.data, 12, 16, 11 + reel * 14, 6);
  }
  p.line(9, 14, 10, 14, 7); p.line(53, 14, 54, 14, 7);
}
function marquee(p, w, h, phase, style) {
  p.rect(1, 1, w - 2, h - 2, 8); p.rect(2, 2, w - 4, h - 4, 7); p.rect(5, 5, w - 10, h - 10, 1);
  let i = 0;
  for (let x = 4; x < w - 3; x += 6) { bulb(p, x, 3, phase, i++, style); bulb(p, w - x - 1, h - 4, phase, i++, style); }
  for (let y = 9; y < h - 6; y += 6) { bulb(p, w - 4, y, phase, i++, style); bulb(p, 3, h - y - 1, phase, i++, style); }
}
let cached;
function createOldVegasPack() {
  if (cached) return cached;
  const pieces = [];
  const add = (id, name, width, height, placement, paint) => {
    const frames = Array.from({ length: 16 }, (_, phase) => { const p = painter(width, height); paint(p, phase); return p.data; });
    pieces.push({ id, name, width, height, placement, interactive: false, image: { width, height, frames, palette } });
  };
  for (const [i, label] of ['OLD VEGAS', 'JACKPOT', 'CABARET', 'HYDRO', 'LUCKY 7', 'SHOWTIME'].entries()) add(`marquee-${i}`, `${label} chasing marquee`, 112, 28, 'ceiling', (p, t) => { marquee(p, 112, 28, t, i % 3); p.text(label, 9, i % 2 ? 9 : 6, 2); });
  for (const [i, kind] of ['heart', 'club', 'spade', 'diamond'].entries()) add(`suit-${kind}`, `${kind} illuminated medallion`, 40, 28, 'ceiling', (p, t) => { p.ellipse(20, 14, 18, 13, 8); p.ellipse(20, 14, 15, 10, 6); suit(p, kind, 20, 12, 7, ['club', 'spade'].includes(kind) ? 0 : 4); for (let n = 0; n < 12; n++) { const a = n * Math.PI / 6; bulb(p, 20 + Math.cos(a) * 17, 14 + Math.sin(a) * 11, t, n, 1); } });
  for (let style = 0; style < 3; style++) add(`bulbs-${style}`, ['Pearl runway chase', 'Ruby square chase', 'Diamond star chase'][style], 128, 12, 'trim', (p, t) => { p.rect(0, 2, 128, 8, 1); p.rect(0, 2, 128, 1, 7); p.rect(0, 9, 128, 1, 8); for (let x = 4; x < 128; x += 6) bulb(p, x, 6, t, Math.floor(x / 6), style); });
  add('velvet-swag', 'Garnet velvet with gold tassels', 128, 28, 'ceiling', (p, t) => { for (let x = 0; x < 128; x++) { const depth = 9 + Math.round(Math.abs(Math.sin(x / 128 * Math.PI * 3)) * 12); p.rect(x, 0, 1, depth, [2, 3, 4, 3, 2, 1][x % 6]); p.dot(x, depth, 7); } for (let x = 0; x <= 128; x += 42) { const dx = Math.round(Math.sin(t * Math.PI / 8 - x) * 1); p.line(x, 7, x + dx, 25, 7); p.ellipse(x + dx, 25, 2, 2, 6); } });
  add('roulette', 'Roulette rosette', 40, 28, 'ceiling', (p, t) => { p.ellipse(20, 14, 18, 13, 7); for (let y = 3; y < 26; y++) for (let x = 4; x < 37; x++) if ((x - 20) ** 2 / 256 + (y - 14) ** 2 / 100 < 1) p.dot(x, y, Math.floor((Math.atan2(y - 14, x - 20) + Math.PI) * 8 / Math.PI) % 2 ? 4 : 0); p.ellipse(20, 14, 8, 6, 8); p.line(12, 14, 28, 14, 7); p.line(20, 8, 20, 20, 7); p.dot(20 + Math.cos(t * Math.PI / 8) * 14, 14 + Math.sin(t * Math.PI / 8) * 9, 9); });
  add('slot-reels', 'Continuously rolling slot reels', 64, 28, 'ceiling', rollingSlots);
  add('fan-lights', 'Art deco fan light', 64, 28, 'ceiling', (p, t) => { for (let i = 0; i < 13; i++) { const a = Math.PI + i * Math.PI / 12; p.line(32, 27, 32 + Math.cos(a) * 30, 27 + Math.sin(a) * 25, 8); bulb(p, 32 + Math.cos(a) * 28, 27 + Math.sin(a) * 23, t, i, 2); } p.ellipse(32, 26, 7, 5, 3); });
  pieces.push(...createHydroRevue());
  for (const denomination of CHIP_DENOMINATIONS) {
    add(`chips-side-${denomination.value}`, `${denomination.label} chips · stacked side view`, 72, 44, 'stage', (p, t) => chipStack(p, denomination, t));
    add(`chips-face-${denomination.value}`, `${denomination.label} chip · face-on`, 64, 64, 'stage', (p, t) => chipFace(p, denomination, t));
  }
  for (const kind of ['heart', 'club', 'spade', 'diamond']) for (const rank of ['A', '10']) add(`card-${rank}-${kind}`, `${rank} of ${kind}s · full card`, 38, 50, 'stage', (p, t) => playingCard(p, kind, rank, t));
  pieces.push(...createCasinoArchitecture().pieces);
  cached = { id: 'old-vegas', label: 'Old Vegas · Grand Revue', pieces, denominations: CHIP_DENOMINATIONS, palette: COLORS, frameCount: 16, tickDivisor: 4 };
  return cached;
}
export { createOldVegasPack, CHIP_DENOMINATIONS, SUITS };
