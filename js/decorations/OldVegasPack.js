// Deterministic indexed pixel art: generated once, then shared by every lane.
const COLORS = ['#120b12', '#370b21', '#6d102c', '#ad1635', '#ed2949', '#ff6b68', '#fff4df', '#f4c66b', '#9f6636', '#ffffff', '#3e66ee', '#193697', '#70b6ff', '#ff873e'];
const rgba = hex => { const n = parseInt(hex.slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n & 65280) | n >>> 16) >>> 0; };
const palette = { getColor: i => rgba(COLORS[i] || COLORS[0]) };
const FONT = { M:['101','111','111','101','101'], A:['010','101','111','101','101'], C:['111','100','100','100','111'], E:['111','100','110','100','111'], G:['111','100','101','101','111'], H:['101','101','111','101','101'], I:['111','010','010','010','111'], J:['001','001','001','101','111'], K:['101','101','110','101','101'], L:['100','100','100','100','111'], N:['101','111','111','111','101'], O:['111','101','101','101','111'], P:['110','101','110','100','100'], R:['110','101','110','101','101'], S:['111','100','111','001','111'], T:['111','010','010','010','010'], V:['101','101','101','101','010'], W:['101','101','111','111','101'], Y:['101','101','010','010','010'], D:['110','101','101','101','110'], U:['101','101','101','101','111'], B:['110','101','110','101','110'], '7':['111','001','010','010','010'] };
function painter(width, height) {
  const data = new Uint8Array(width * height).fill(128);
  const dot = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = c; };
  const rect = (x, y, w, h, c) => { for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) dot(xx, yy, c); };
  const ellipse = (x, y, rx, ry, c) => { for (let yy = -ry; yy <= ry; yy++) for (let xx = -rx; xx <= rx; xx++) if (xx * xx / (rx * rx) + yy * yy / (ry * ry) <= 1) dot(x + xx, y + yy, c); };
  const line = (x, y, xx, yy, c) => { const n = Math.max(Math.abs(xx - x), Math.abs(yy - y), 1); for (let i = 0; i <= n; i++) dot(x + (xx - x) * i / n, y + (yy - y) * i / n, c); };
  const text = (word, y, color = 6, scale = 1) => { const x = (width - (word.length * 4 - 1) * scale) / 2; [...word].forEach((letter, i) => (FONT[letter] || []).forEach((row, j) => [...row].forEach((on, k) => { if (on === '1') rect(x + (i * 4 + k) * scale, y + j * scale, scale, scale, color); }))); };
  return { data, dot, rect, ellipse, line, text };
}
function bulb(p, x, y, phase, index, style = 0) {
  const lit = (index - phase + 32) % 8 < 3;
  if (style === 1) { p.rect(x - 1, y - 1, 3, 3, lit ? 5 : 3); p.dot(x, y, lit ? 9 : 4); }
  else if (style === 2) { p.line(x - 2, y, x + 2, y, lit ? 6 : 8); p.line(x, y - 2, x, y + 2, lit ? 6 : 8); p.dot(x, y, lit ? 9 : 7); }
  else { p.ellipse(x, y, 2, 2, lit ? 7 : 8); p.ellipse(x, y, 1, 1, lit ? 9 : 7); }
}
function suit(p, kind, x, y, size, color) {
  if (kind === 'diamond') { for (let dy = -size; dy <= size; dy++) p.rect(x - (size - Math.abs(dy)) / 2, y + dy, size - Math.abs(dy) + 1, 1, color); }
  else if (kind === 'heart' || kind === 'spade') {
    const sign = kind === 'heart' ? 1 : -1;
    p.ellipse(x - size / 3, y - sign * size / 3, size / 2, size / 2, color); p.ellipse(x + size / 3, y - sign * size / 3, size / 2, size / 2, color);
    for (let dy = 0; dy <= size; dy++) p.rect(x - (size - dy) * 0.7, y + sign * dy, (size - dy) * 1.4 + 1, 1, color);
    if (sign < 0) { p.rect(x - 1, y + 2, 3, size, color); p.rect(x - 3, y + size, 7, 1, color); }
  } else { p.ellipse(x, y - size / 2, size / 2, size / 2, color); p.ellipse(x - size / 2, y + 1, size / 2, size / 2, color); p.ellipse(x + size / 2, y + 1, size / 2, size / 2, color); p.rect(x - 1, y, 3, size + 1, color); }
}
function marquee(p, w, h, phase, style) {
  p.rect(1, 1, w - 2, h - 2, 8); p.rect(2, 2, w - 4, h - 4, 7); p.rect(5, 5, w - 10, h - 10, 1);
  let i = 0;
  for (let x = 4; x < w - 3; x += 6) { bulb(p, x, 3, phase, i++, style); bulb(p, w - x - 1, h - 4, phase, i++, style); }
  for (let y = 9; y < h - 6; y += 6) { bulb(p, w - 4, y, phase, i++, style); bulb(p, 3, h - y - 1, phase, i++, style); }
}
function showgirl(p, phase) {
  // The established hydro silhouette: blue triangle, two tall eyes, orange beret.
  const a = phase / 16 * Math.PI * 2, sway = Math.round(Math.sin(a) * 3), bounce = Math.round(Math.cos(a * 2));
  for (let i = 0; i < 11; i++) {
    const t = (i - 5) * 0.24 + Math.sin(a - 0.6) * 0.08, x = 48 + Math.sin(t) * 35, y = 31 - Math.cos(t) * 26;
    p.line(48 + sway, 38, x, y, 8); p.ellipse(x, y, 4, 10, i % 2 ? 6 : 3); p.line(x, y - 6, 48 + sway, 38, i % 2 ? 9 : 5);
  }
  const cy = 37 + bounce;
  for (let y = 0; y < 21; y++) { const r = 3 + y * 0.7; p.rect(48 + sway - r, cy - 10 + y, r * 2, 1, y < 12 ? 10 : 11); }
  p.line(45 + sway, cy - 6, 34 + sway, cy + 8, 12);
  p.rect(43 + sway, cy - 1, 3, 7, 0); p.rect(51 + sway, cy - 1, 3, 7, 0);
  p.ellipse(48 + sway, cy - 11, 10, 3, 13); p.rect(49 + sway, cy - 16, 4, 5, 13);
  // Opaque red velvet bodice, scalloped hem and delayed gold tassels.
  for (let y = 8; y <= 13; y++) p.rect(48 + sway - 14, cy + y, 28, 1, y % 3 ? 3 : 4);
  p.line(35 + sway, cy + 8, 61 + sway, cy + 8, 7);
  for (let i = 0; i < 7; i++) { const x = 36 + sway + i * 4, lag = Math.round(Math.sin(a - i * 0.35) * 2); p.line(x, cy + 10, x + lag, cy + 15, 7); p.dot(x + lag, cy + 16, 6); }
  p.ellipse(48, 61, 29, 2, 8); p.ellipse(48, 59, 28, 2, 3);
  for (let i = 0; i < 9; i++) bulb(p, 24 + i * 6, 61, phase, i, 0);
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
  add('slot-reels', 'Triple seven slot reels', 64, 28, 'ceiling', (p, t) => { marquee(p, 64, 28, t, 1); for (let i = 0; i < 3; i++) { p.rect(12 + i * 14, 8, 12, 12, 6); suit(p, ['heart', 'club', 'diamond', 'spade'][(Math.floor(t / 4) + i) % 4], 18 + i * 14, 13, 4, i === 1 ? 0 : 4); } });
  add('fan-lights', 'Art deco fan light', 64, 28, 'ceiling', (p, t) => { for (let i = 0; i < 13; i++) { const a = Math.PI + i * Math.PI / 12; p.line(32, 27, 32 + Math.cos(a) * 30, 27 + Math.sin(a) * 25, 8); bulb(p, 32 + Math.cos(a) * 28, 27 + Math.sin(a) * 23, t, i, 2); } p.ellipse(32, 26, 7, 5, 3); });
  add('hydro-showgirl', 'hydro feather revue', 96, 64, 'stage', showgirl);
  cached = { id: 'old-vegas', label: 'Old Vegas · velvet & bulbs', pieces, palette: COLORS, frameCount: 16, tickDivisor: 4 };
  return cached;
}
export { createOldVegasPack };
