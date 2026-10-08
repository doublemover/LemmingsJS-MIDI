import { ERASE, NO_OVERWRITE, ONLY_OVERWRITE, stampRecipePlacements } from './ProcgenTerrainRecipes.js';

const createSourceGroupLibrary = (descriptor, pieces, excludedIds = new Set()) => {
  const available = new Map(pieces.map(piece => [piece.id, piece])), library = new Map();
  // Conditional or destructive stamps need a foundation-aware adapter before they are eligible.
  for (const group of descriptor?.groups || []) {
    if (!['route', 'decoration'].includes(group.role) || group.placements.some(p => p.f & (ERASE | NO_OVERWRITE | ONLY_OVERWRITE) || excludedIds.has(p.id) || !available.has(p.id) || available.get(p.id).isSteel)) continue;
    const width = Math.max(...group.placements.map(p => p.x + available.get(p.id).width));
    const height = Math.max(...group.placements.map(p => p.y + available.get(p.id).height));
    if (width > 112 || height > 94) continue;
    const { pixels, mask } = stampRecipePlacements({ placements: group.placements, terrainPieces: available, width, height });
    let left = width, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
    if (right <= left) continue;
    const w = right - left, h = bottom - top, rgba = new Uint32Array(w * h), frame = new Uint8Array(w * h); frame.fill(128);
    const columnTop = new Int16Array(w), columnBottom = new Int16Array(w); columnTop.fill(-1); columnBottom.fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[(y + top) * width + x + left]) {
      const at = y * w + x; frame[at] = 0; rgba[at] = (pixels[(y + top) * width + x + left] | 0xff000000) >>> 0;
      if (columnTop[x] < 0) columnTop[x] = y; columnBottom[x] = y;
    }
    let continuous = true;
    for (let x = 0; x < w; x++) for (let y = columnTop[x]; y >= 0 && y <= columnBottom[x]; y++) if (frame[y * w + x] & 128) continuous = false;
    const visited = new Uint8Array(frame.length), feet = [];
    for (let at = 0; at < frame.length; at++) if (!(frame[at] & 128) && !visited[at]) {
      const queue = [at]; visited[at] = 1; let foot = at;
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i], x = p % w, y = Math.floor(p / w); if (y > Math.floor(foot / w)) foot = p;
        for (const next of [x ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y ? p - w : -1, y + 1 < h ? p + w : -1]) if (next >= 0 && !visited[next] && !(frame[next] & 128)) { visited[next] = 1; queue.push(next); }
      }
      feet.push({ x: foot % w, y: Math.floor(foot / w) });
    }
    if (feet.length > 16 || group.role === 'route' && !continuous) continue;
    library.set(group, { group, columnTop, columnBottom, feet, piece: { id: group.placements[0].id, width: w, height: h, frame, rgba, image: { width: w, height: h } } });
  }
  return library;
};

const placeSourceGroups = ({ zone, library, code, chunk, baseSurface, baseSolid, occupied, gapX, gapWidth }) => {
  if (!zone || chunk === 0) return [];
  const placed = [];
  for (const group of zone.groups) {
    const compiled = library.get(group); if (!compiled || placed.length >= 2) continue;
    const { piece, feet, columnTop, columnBottom } = compiled;
    const x = 8 + ((code >>> (placed.length * 7)) % Math.max(1, 113 - piece.width));
    if (gapWidth && x + piece.width > gapX - 4 && x < gapX + gapWidth + 4 || occupied.some(p => !p.decor && x + piece.width > p.x - 2 && x < p.x + p.piece.width + 2)) continue;
    let y = -Infinity, valid = true;
    for (let dx = 0; dx < piece.width; dx++) if (baseSurface(x + dx) < 0) valid = false;
    if (group.role === 'route') { for (let dx = 0; dx < piece.width; dx++) if (columnTop[dx] >= 0) y = Math.max(y, baseSurface(x + dx) - columnTop[dx] - 2); }
    else { for (const foot of feet) y = Math.max(y, baseSurface(x + foot.x) - foot.y - 1); }
    if (!valid || !Number.isFinite(y) || y < 2 || y + piece.height > 96) continue;
    if (feet.some(foot => !baseSolid(x + foot.x, y + foot.y + 1))) continue;
    if (group.role === 'route') for (let dx = 0; dx < piece.width; dx++) if (columnTop[dx] >= 0 &&
      (y + columnTop[dx] < baseSurface(x + dx) - 2 || !baseSolid(x + dx, y + columnBottom[dx] + 1))) valid = false;
    if (valid) placed.push({ piece, x, y, flip: false, decor: group.role === 'decoration', canonicalGroup: group, sourceRevision: zone.sourceRevision });
  }
  return placed;
};
export { createSourceGroupLibrary, placeSourceGroups };
