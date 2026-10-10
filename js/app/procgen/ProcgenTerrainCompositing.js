import { ERASE, FLIP_X, FLIP_Y, NO_OVERWRITE, ONLY_OVERWRITE } from './ProcgenTerrainRecipes.js';

const KEEP_TERRAIN = 0, CLEAR_TERRAIN = 1, PAINT_TERRAIN = 2, PAINT_STEEL = 3;
const opaque = value => (value | 0xff000000) >>> 0;

// Two bounded transitions per pixel retain the entire ordered source group.
// KEEP borrows the actual foundation/prior stamp, including its color/steel;
// the empty and occupied cases must never be flattened into one blank raster.
const compileTerrainGroup = (group, pieces, width, height) => {
  const size = width * height, operations = new Uint8Array(size * 2), colors = new Uint32Array(size * 2), impact = new Uint8Array(size);
  for (let occupied = 0; occupied < 2; occupied++) {
    const mask = new Uint8Array(size); if (occupied) mask.fill(1);
    for (const p of group.placements) {
      const piece = pieces.get(p.id), image = piece.image || piece, flags = p.f || 0;
      const frame = piece.frame || image.frames[0];
      for (let dy = 0; dy < piece.height; dy++) for (let dx = 0; dx < piece.width; dx++) {
        const sx = flags & FLIP_X ? piece.width - 1 - dx : dx, sy = flags & FLIP_Y ? piece.height - 1 - dy : dy;
        const source = sy * piece.width + sx, ci = frame[source]; if (ci & 128) continue;
        const at = (p.y + dy) * width + p.x + dx, out = occupied * size + at; impact[at] = 1;
        if (flags & ERASE) { mask[at] = 0; operations[out] = CLEAR_TERRAIN; colors[out] = 0; }
        else if (!(flags & NO_OVERWRITE && mask[at]) && !(flags & ONLY_OVERWRITE && !mask[at])) {
          mask[at] = 1; operations[out] = piece.isSteel || image.isSteel ? PAINT_STEEL : PAINT_TERRAIN;
          colors[out] = piece.rgba?.[source] || opaque(image.palette?.getColor(ci) ?? 0);
        }
      }
    }
  }
  const frame = new Uint8Array(size); frame.fill(128);
  for (let at = 0; at < size; at++) if (operations[at] >= PAINT_TERRAIN) frame[at] = 0;
  return { operations, colors, impact, frame, rgba: colors.subarray(0, size) };
};

// Encodes operation, the already-read palette index and source index without
// allocating a per-pixel object or reading raw source frames a second time.
const terrainStampAt = (placement, x, y, solid) => {
  const piece = placement.piece, width = piece.width ?? piece.image?.width ?? 0, height = piece.height ?? piece.image?.height ?? 0;
  const dx = x - placement.x, dy = y - placement.y;
  if (dx < 0 || dx >= width || dy < 0 || dy >= height) return 0;
  const flags = placement.f ?? ((placement.flip ? FLIP_X : 0) | (placement.flipY ? FLIP_Y : 0));
  const sx = flags & FLIP_X ? width - 1 - dx : dx, sy = flags & FLIP_Y ? height - 1 - dy : dy;
  let at = sy * width + sx;
  if (piece.composite) {
    if (solid) at += width * height;
    const operation = piece.composite.operations[at]; return operation ? (at + 1) * 1024 + operation : 0;
  }
  const frame = piece.frame || piece.image.frames[0], ci = frame[at]; if (ci & 128) return 0;
  if (flags & ERASE) return (at + 1) * 1024 + (ci << 2) + CLEAR_TERRAIN;
  if (flags & NO_OVERWRITE && solid || flags & ONLY_OVERWRITE && !solid) return 0;
  return (at + 1) * 1024 + (ci << 2) + (piece.isSteel || piece.image?.isSteel ? PAINT_STEEL : PAINT_TERRAIN);
};
const terrainStampColor = (placement, stamp) => {
  const at = Math.floor(stamp / 1024) - 1, piece = placement.piece;
  if (piece.composite) return piece.composite.colors[at];
  return piece.rgba?.[at] || opaque(piece.image.palette?.getColor((stamp >>> 2) & 255) ?? 0);
};
const stampTerrainPlacement = (placement, width, height, solid, steel, pixels) => {
  const pieceWidth = placement.piece.width ?? placement.piece.image?.width ?? 0, pieceHeight = placement.piece.height ?? placement.piece.image?.height ?? 0;
  for (let y = Math.max(0, placement.y); y < Math.min(height, placement.y + pieceHeight); y++)
    for (let x = Math.max(0, placement.x); x < Math.min(width, placement.x + pieceWidth); x++) {
      const at = y * width + x, word = at >>> 5, bit = 1 << (at & 31), before = !!(solid[word] & bit);
      const stamp = terrainStampAt(placement, x, y, before), operation = stamp & 3; if (!operation) continue;
      if (placement.decor) { if (pixels && !before && operation >= PAINT_TERRAIN) pixels[at] = terrainStampColor(placement, stamp); continue; }
      if (operation === CLEAR_TERRAIN) { solid[word] &= ~bit; steel[word] &= ~bit; if (pixels) pixels[at] = 0; }
      else { solid[word] |= bit; if (operation === PAINT_STEEL) steel[word] |= bit; else steel[word] &= ~bit; if (pixels) pixels[at] = terrainStampColor(placement, stamp); }
    }
};
export { KEEP_TERRAIN, CLEAR_TERRAIN, PAINT_TERRAIN, PAINT_STEEL, compileTerrainGroup, terrainStampAt, terrainStampColor, stampTerrainPlacement };
