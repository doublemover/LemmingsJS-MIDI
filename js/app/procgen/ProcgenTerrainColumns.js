const MAX_COLUMN_PIECES = 16;
// A complete source ingredient must contain one connected alpha body and at
// least one uninterrupted vertical column. No resampling, wedge clipping or
// decorative collision override can manufacture the load-bearing footprint.
const createSourceColumnLibrary = (routes, pieces, excluded = new Set()) => {
  const available = new Map(pieces.map(piece => [piece.id, piece])), result = [];
  const seen = new Set();
  for (const route of routes) for (const source of route.placements) {
    const piece = available.get(source.id);
    if (!piece || seen.has(piece.id) || excluded.has(piece.id) || source.f & 17 || piece.isSteel || piece.image?.isSteel || piece.width > 32 || piece.width < 8 || piece.height < 16 || piece.height > 64) continue;
    seen.add(piece.id);
    let spine = -1;
    for (let x = 0; x < piece.width && spine < 0; x++) {
      let complete = true; for (let y = 0; y < piece.height; y++) if (piece.frame[y * piece.width + x] & 128) complete = false;
      if (complete) spine = x;
    }
    if (spine < 0) continue;
    const seenPixels = new Uint8Array(piece.frame.length), queue = []; let components = 0;
    for (let at = 0; at < piece.frame.length; at++) if (!(piece.frame[at] & 128) && !seenPixels[at]) {
      if (++components > 1) break;
      queue.push(at); seenPixels[at] = 1;
      for (let index = 0; index < queue.length; index++) {
        const point = queue[index], x = point % piece.width, y = Math.floor(point / piece.width);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const next = ny * piece.width + nx;
          if (nx >= 0 && nx < piece.width && ny >= 0 && ny < piece.height && !(piece.frame[next] & 128) && !seenPixels[next]) { seenPixels[next] = 1; queue.push(next); }
        }
      }
    }
    if (components === 1) result.push({ piece, source, routeId: route.id, provenance: route.source });
  }
  return result;
};
const placeSourceColumn = ({ library, code, origin, height, surface, solid, steel, occupied, gapX, gapWidth, sourceRevision }) => {
  if (!library.length || origin < 1024 || (code & 15) !== 3) return [];
  const ingredient = library[(code >>> 8) % library.length], { piece, source } = ingredient;
  const x = 48 + (code >>> 16) % Math.max(1, 41 - piece.width), floor = surface(x);
  if (floor <= piece.height || floor >= height || gapWidth && x + piece.width > gapX - 4 && x < gapX + gapWidth + 4 ||
      occupied.some(p => x + piece.width > p.x - 2 && x < p.x + p.piece.width + 2)) return [];
  for (let dx = 0; dx < piece.width; dx++) {
    if (surface(x + dx) !== floor || !solid(x + dx, floor) || steel(x + dx, floor)) return [];
    for (let y = 0; y < floor; y++) if (solid(x + dx, y) || steel(x + dx, y)) return [];
  }
  const column = Object.freeze({ kind: 'complete-source-column', x, floor, top: 0, width: piece.width, sourceId: piece.id, sourceFlags: source.f,
    sourceRevision, routeId: ingredient.routeId, provenance: ingredient.provenance });
  const placements = []; let top = floor - piece.height;
  while (true) {
    if (placements.length >= MAX_COLUMN_PIECES) return [];
    placements.push({ piece, x, y: top, f: source.f, flip: !!(source.f & 8), flipY: !!(source.f & 2), decor: false, sourcedColumn: column, sourceRevision, columnOrder: placements.length });
    if (top === 0) return placements;
    top = Math.max(0, top - piece.height + 1);
  }
};
export { MAX_COLUMN_PIECES, createSourceColumnLibrary, placeSourceColumn };
