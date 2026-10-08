/** Original, deterministic indexed pixel art. Generated once, then renderer-cached. */
const COLORS = ['#160f29', '#302044', '#58304f', '#912b68', '#d44983', '#ff77b6', '#ffe3eb', '#61436c', '#957292', '#e5bd8a', '#fff2b2', '#ffcc55', '#c97c36', '#257e91', '#47c4cf', '#b4fff0', '#e85357', '#f79457', '#452e39', '#1b485d'];
const palette = { getColor(index) {
  const hex = COLORS[index] || COLORS[0], n = parseInt(hex.slice(1), 16);
  return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0;
}, getR(index) { return this.getColor(index) & 255; }, getG(index) { return (this.getColor(index) >>> 8) & 255; }, getB(index) { return (this.getColor(index) >>> 16) & 255; } };
function painter(width, height) {
  const frame = new Uint8Array(width * height).fill(128);
  const dot = (x, y, color) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < width && y < height) frame[y * width + x] = color; };
  const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dot(i, j, c); };
  const line = (x0, y0, x1, y1, c) => { const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= steps; i++) { const t = steps ? i / steps : 0; dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c); } };
  const ellipse = (cx, cy, rx, ry, c) => { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if (x * x / (rx * rx) + y * y / (ry * ry) <= 1) dot(cx + x, cy + y, c); };
  const bulb = (x, y, lit) => { ellipse(x, y, 4, 5, lit ? 12 : 7); ellipse(x, y - 1, 3, 4, lit ? 11 : 8); if (lit) { rect(x - 1, y - 3, 2, 4, 10); dot(x - 2, y - 2, 6); } rect(x - 2, y + 4, 5, 3, 9); line(x - 2, y + 5, x + 2, y + 5, 7); };
  const bolts = (x, y, w, h) => { for (const dx of [2, w - 3]) for (const dy of [2, h - 3]) { dot(x + dx, y + dy, 9); dot(x + dx + 1, y + dy, 7); } };
  const heart = (cx, cy, scale, c) => { for (let y = -scale; y <= scale; y++) for (let x = -scale; x <= scale; x++) { const nx = x / scale * 1.3, ny = -y / scale * 1.3 + 0.2; if (Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * ny * ny * ny <= 0) dot(cx + x, cy + y, c); } };
  return { frame, dot, rect, line, ellipse, bulb, bolts, heart };
}
function piece(id, name, width, height, placement, draw, extra = {}) {
  const frames = Array.from({ length: 16 }, (_, phase) => { const p = painter(width, height); draw(p, phase); return p.frame; });
  return { id, name, width, height, placement, image: { width, height, frames, frameCount: frames.length, palette }, ...extra };
}
function createNeonCabaretPack() {
  const pieces = [
    piece('cabaret-bulb-garland', 'Encore bulb garland', 112, 28, 'ceiling', (p, f) => {
      p.rect(0, 0, 112, 3, 1); p.line(0, 2, 111, 2, 9);
      for (let x = 8, i = 0; x < 112; x += 16, i++) { const y = 10 + (i % 3) * 3; p.line(x, 3, x, y - 5, 7); p.bulb(x, y, (i + Math.floor(f / 2)) % 4 !== 0); }
      for (let x = 0; x < 112; x += 8) p.dot(x, 0, 11);
    }),
    piece('cabaret-dancing-spots', 'Dancing spotlight rail', 112, 28, 'ceiling', (p, f) => {
      p.rect(0, 0, 112, 4, 7); p.line(0, 0, 111, 0, 9);
      for (let x = 18, i = 0; x < 112; x += 38, i++) {
        const sway = Math.round(Math.sin((f + i * 5) * Math.PI / 8) * 5);
        p.line(x, 3, x, 8, 9); p.line(x - 5, 7, x + 5, 7, 7);
        for (let y = 15; y < 28; y++) { const cx = x + sway * (y - 10) / 9; for (let dx = -Math.floor((y - 10) / 3); dx <= (y - 10) / 3; dx++) if ((Math.round(cx + dx) + y) % 3 === 0) p.dot(cx + dx, y, i % 2 ? 13 : 3); }
        p.rect(x - 5 + sway / 2, 9, 11, 7, 0); p.rect(x - 4 + sway / 2, 9, 9, 4, 7); p.line(x - 4 + sway / 2, 15, x + 4 + sway / 2, 15, i % 2 ? 15 : 5); p.dot(x - 3, 10, 9);
      }
    }),
    piece('cabaret-heart-transformer', 'Heart of the show transformer', 64, 58, 'stage', (p, f) => {
      p.rect(6, 49, 52, 8, 0); p.rect(8, 49, 48, 5, 7); p.bolts(8, 49, 48, 5);
      for (const x of [12, 49]) { p.rect(x, 27, 4, 23, 12); for (let y = 28; y < 47; y += 4) { p.rect(x - 3, y, 10, 2, 9); p.rect(x - 3, y + 2, 10, 1, 7); } p.ellipse(x + 2, 24, 5, 4, 7); p.dot(x + 1, 22, 15); }
      p.heart(32, 26, 19, 0); p.heart(32, 25, 17, 9); p.heart(32, 25, 15, 3); p.heart(32, 25, 12, 4); p.heart(32, 24, 10, f < 8 ? 5 : 4);
      p.line(32, 15, 27, 25, 10); p.line(27, 25, 35, 25, 10); p.line(35, 25, 30, 35, 10);
      p.rect(4, 43, 56, 3, 13); p.line(5, 43, 58, 43, 15); for (let x = 5; x < 60; x += 8) p.rect(x, 44, 2, 9, 13);
      p.bulb(7, 8, f % 8 < 6); p.bulb(56, 8, (f + 4) % 8 < 6);
    }),
    piece('cabaret-velvet-dynamo', 'Velvet dynamo', 76, 56, 'stage', (p, f) => {
      p.rect(3, 5, 70, 47, 0); p.rect(5, 7, 66, 44, 2);
      for (let x = 6; x < 72; x += 7) { p.rect(x, 8, 3, 41, 3); p.rect(x + 3, 8, 2, 41, 4); }
      p.rect(3, 3, 70, 4, 9); p.rect(3, 50, 70, 5, 7); p.line(3, 50, 72, 50, 9);
      p.ellipse(38, 27, 21, 21, 0); p.ellipse(38, 27, 19, 19, 9); p.ellipse(38, 27, 16, 16, 1);
      for (let i = 0; i < 6; i++) { const a = (i / 6 + f / 96) * Math.PI * 2; p.line(38, 27, 38 + Math.cos(a) * 14, 27 + Math.sin(a) * 14, 12); p.line(38, 28, 38 + Math.cos(a) * 12, 28 + Math.sin(a) * 12, 11); }
      p.ellipse(38, 27, 5, 5, 13); p.ellipse(38, 27, 2, 2, 15);
      for (let x = 9; x < 72; x += 12) p.ellipse(x, 4, 2, 2, (x + f) % 4 ? 11 : 10);
      for (const x of [8, 64]) { p.rect(x, 23, 4, 15, 0); p.rect(x + 1, 25 + f % 4, 2, 9 - f % 4, 14); }
    }),
    piece('cabaret-glass-catwalk', 'Turquoise glass catwalk fascia', 128, 16, 'trim', p => {
      p.rect(0, 0, 128, 16, 0); p.rect(0, 1, 128, 10, 19); p.line(0, 0, 127, 0, 15); p.line(0, 2, 127, 2, 14);
      for (let x = 0; x < 128; x += 16) { p.rect(x, 2, 2, 11, 9); p.line(x + 3, 10, x + 10, 3, 13); p.line(x + 7, 10, x + 14, 3, 14); p.dot(x, 14, 11); }
      p.rect(0, 12, 128, 2, 7); p.line(0, 15, 127, 15, 9);
    }),
    piece('cabaret-bulb-chase', 'Footlight encore chase', 128, 16, 'trim', (p, f) => {
      p.rect(0, 0, 128, 16, 0); p.rect(0, 1, 128, 13, 2); p.line(0, 0, 127, 0, 9); p.line(0, 15, 127, 15, 12);
      for (let x = 8, i = 0; x < 128; x += 16, i++) { p.ellipse(x, 7, 5, 5, 7); p.ellipse(x, 7, 4, 4, 12); p.ellipse(x, 7, 3, 3, (i + Math.floor(f / 2)) % 4 < 2 ? 10 : 11); p.dot(x - 1, 6, 6); }
    })
  ];
  return { id: 'neon-cabaret', label: 'Neon Cabaret Power Station', pieces };
}

export { createNeonCabaretPack, palette as NEON_CABARET_PALETTE, COLORS as NEON_CABARET_COLORS, painter as createCabaretPainter, piece as createCabaretPiece };
