import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createOldVegasPack } from '../js/decorations/OldVegasPack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = createOldVegasPack(), cellW = 128, cellH = 72;
const atlas = new PNG({ width: cellW * 16, height: cellH * pack.pieces.length });
const contact = new PNG({ width: cellW * 3 * 3, height: cellH * Math.ceil(pack.pieces.length / 3) * 3 });
function stamp(target, piece, frame, ox, oy, scale) {
  const { width, height, palette } = piece.image;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ci = frame[y * width + x]; if (ci & 128) continue;
    const color = palette.getColor(ci);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = ((oy + y * scale + dy) * target.width + ox + x * scale + dx) * 4;
      target.data[at] = color & 255; target.data[at + 1] = color >>> 8 & 255; target.data[at + 2] = color >>> 16 & 255; target.data[at + 3] = 255;
    }
  }
}
for (let i = 0; i < contact.data.length; i += 4) { contact.data[i] = 18; contact.data[i + 1] = 11; contact.data[i + 2] = 18; contact.data[i + 3] = 255; }
const previewRank = p => p.id.startsWith('hydro-showgirl') ? 0 : p.id === 'slot-reels' ? 1 : p.id.startsWith('suit-') ? 2 : p.id.startsWith('card-') ? 3 : p.id.startsWith('chips-') ? 4 : 5;
const previewOrder = [...pack.pieces].sort((a, b) => previewRank(a) - previewRank(b));
pack.pieces.forEach((piece, row) => {
  const previewIndex = previewOrder.indexOf(piece);
  piece.image.frames.forEach((frame, col) => stamp(atlas, piece, frame, col * cellW, row * cellH, 1));
  stamp(contact, piece, piece.image.frames[row % 16], (previewIndex % 3) * cellW * 3 + Math.floor((cellW - piece.width) * 1.5), Math.floor(previewIndex / 3) * cellH * 3 + Math.floor((cellH - piece.height) * 1.5), 3);
});
const output = path.join(root, 'assets/decorations/old-vegas'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'atlas.png'), PNG.sync.write(atlas));
fs.writeFileSync(path.join(output, 'contact-sheet.png'), PNG.sync.write(contact));
fs.writeFileSync(path.join(output, 'pack.json'), JSON.stringify({ id: pack.id, label: pack.label, source: 'js/decorations/OldVegasPack.js', format: 'indexed-animation-catalog-v1', transparency: 128, frameCount: 16, atlas: 'atlas.png', cellWidth: cellW, cellHeight: cellH, palette: pack.palette, denominations: pack.denominations, pieces: pack.pieces.map((p, row) => ({ id: p.id, name: p.name, width: p.width, height: p.height, placement: p.placement, atlasRow: row, interactive: false })) }, null, 2) + '\n');
console.log(`Exported ${pack.pieces.length} pieces, ${pack.pieces.length * 16} frames to ${output}`);
