import { ERASE, NO_OVERWRITE, ONLY_OVERWRITE } from './ProcgenTerrainRecipes.js';
import { CLEAR_TERRAIN, PAINT_TERRAIN, PAINT_STEEL, compileTerrainGroup, terrainStampAt, terrainStampColor } from './ProcgenTerrainCompositing.js';

const SOURCE_GROUP_ROLES = new Set(['route', 'decoration', 'join', 'overlap', 'repeat', 'erase']);
const MAX_SOURCE_GROUP_WIDTH = 112, MAX_SOURCE_GROUP_HEIGHT = 94, MAX_SOURCE_GROUPS_PER_CHUNK = 2;
const createSourceGroupLibrary = (descriptor, pieces, excludedIds = new Set(), { maxWidth = MAX_SOURCE_GROUP_WIDTH } = {}) => {
  const available = new Map(pieces.map(piece => [piece.id, piece])), library = new Map();
  for (const group of (descriptor?.groups || []).slice(0, 12)) {
    if (!SOURCE_GROUP_ROLES.has(group.role) || !group.placements.length || group.placements.length > 8 || group.placements.some(p => excludedIds.has(p.id) || !available.has(p.id))) continue;
    const width = Math.max(...group.placements.map(p => p.x + available.get(p.id).width));
    const height = Math.max(...group.placements.map(p => p.y + available.get(p.id).height));
    if (width > maxWidth || height > MAX_SOURCE_GROUP_HEIGHT || width < 1 || height < 1) continue;
    const composite = compileTerrainGroup(group, available, width, height), columnTop = new Int16Array(width), columnBottom = new Int16Array(width);
    columnTop.fill(-1); columnBottom.fill(-1); let paints = false, continuous = true;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!(composite.frame[y * width + x] & 128)) {
      paints = true; if (columnTop[x] < 0) columnTop[x] = y; columnBottom[x] = y;
    }
    for (let x = 0; x < width; x++) for (let y = columnTop[x]; y >= 0 && y <= columnBottom[x]; y++) if (composite.frame[y * width + x] & 128) continuous = false;
    if (group.role === 'route' && paints && !continuous || !composite.impact.some(Boolean)) continue;
    const piece = { id: group.placements[0].id, width, height, frame: composite.frame, rgba: composite.rgba, composite, image: { width, height } };
    library.set(group, { group, columnTop, columnBottom, paints, conditional: group.placements.some(p => p.f & (ERASE | NO_OVERWRITE | ONLY_OVERWRITE)),
      destructive: group.placements.some(p => p.f & ERASE), piece });
  }
  return library;
};

// Admission uses complete source/foundation masks once during cached descriptor
// creation. It neither consults actors nor borrows mutable materialization flags.
const placeSourceGroups = ({ zone, library, code, chunk, baseSurface, baseSolid, baseSteel = () => false, baseColor = null,
  occupied, gapX, gapWidth, progression = {}, height = 96, width = 128, maxGroups = MAX_SOURCE_GROUPS_PER_CHUNK, centered = false, allowVerticalSeparation = false, validate = () => true }) => {
  if (!zone || chunk === 0) return [];
  const placed = [];
  const sample = (x, y, kind) => {
    let solid = baseSolid(x, y), value = kind === 'solid' ? solid : kind === 'steel' ? baseSteel(x, y) : baseColor?.(x, y) || 0;
    for (const p of placed) {
      const stamp = terrainStampAt(p, x, y, solid), operation = stamp & 3; if (!operation) continue;
      solid = operation !== CLEAR_TERRAIN;
      value = kind === 'solid' ? solid : kind === 'steel' ? operation === PAINT_STEEL : operation === CLEAR_TERRAIN ? 0 : terrainStampColor(p, stamp);
    }
    return value;
  };
  for (const group of zone.groups) {
    const compiled = library.get(group); if (!compiled || placed.length >= maxGroups) continue;
    const { piece, columnTop, columnBottom, paints } = compiled;
    const x = centered ? Math.floor((width - piece.width) / 2) : 8 + ((code >>> (placed.length * 7)) % Math.max(1, width - 15 - piece.width));
    if (gapWidth && x + piece.width > gapX - 4 && x < gapX + gapWidth + 4) continue;
    let y = -Infinity, valid = true;
    for (let dx = 0; dx < piece.width; dx++) if (baseSurface(x + dx) < 0) valid = false;
    if (paints) {
      for (let dx = 0; dx < piece.width; dx++) if (columnTop[dx] >= 0) y = Math.max(y, baseSurface(x + dx) - columnTop[dx] - 2);
      if (group.role === 'decoration') {
        y = Infinity;
        for (let dx = 0; dx < piece.width; dx++) if (columnBottom[dx] >= 0) y = Math.min(y, baseSurface(x + dx) - columnBottom[dx] - 1);
      }
    } else {
      // Erase-only/occupied-only observed groups can shape/color the existing
      // deep foundation, while the walking support band remains protected.
      for (let dx = 0; dx < piece.width; dx++) y = Math.max(y, baseSurface(x + dx) + 8);
    }
    if (!valid || !Number.isFinite(y) || y < 2 || y + piece.height > height) continue;
    if (occupied.some(p => x + piece.width > p.x - 2 && x < p.x + p.piece.width + 2 &&
      (!allowVerticalSeparation || !Number.isFinite(p.y) || !Number.isFinite(p.piece.height) || y + piece.height > p.y - 2 && y < p.y + p.piece.height + 2))) continue;
    const placement = { piece, x, y, flip: false, decor: false, canonicalGroup: group, sourceRevision: zone.sourceRevision };
    const added = new Uint8Array(piece.width * piece.height); let changed = 0;
    for (let dy = 0; dy < piece.height && valid; dy++) for (let dx = 0; dx < piece.width; dx++) {
      const px = x + dx, py = y + dy, before = sample(px, py, 'solid'), stamp = terrainStampAt(placement, px, py, before), operation = stamp & 3;
      if (!operation) continue;
      const after = operation !== CLEAR_TERRAIN;
      if (sample(px, py, 'steel') || before && !after && py < baseSurface(px) + 8 || progression.safeIntro && !before && after && py < baseSurface(px) - 2) { valid = false; break; }
      if (!before && after) added[dy * piece.width + dx] = 1;
      if (before !== after || operation >= PAINT_TERRAIN && (!baseColor || terrainStampColor(placement, stamp) !== sample(px, py, 'color'))) changed++;
    }
    // Every newly added connected component needs actual retained foundation
    // contact. Pure color/erasure has no new airborne component to ground.
    const visited = new Uint8Array(added.length);
    for (let at = 0; at < added.length && valid; at++) if (added[at] && !visited[at]) {
      const queue = [at]; visited[at] = 1; let supported = false;
      for (let index = 0; index < queue.length; index++) {
        const p = queue[index], dx = p % piece.width, dy = Math.floor(p / piece.width);
        for (const [nx, ny] of [[dx - 1, dy], [dx + 1, dy], [dx, dy - 1], [dx, dy + 1]]) {
          const next = ny * piece.width + nx;
          if (nx >= 0 && nx < piece.width && ny >= 0 && ny < piece.height && added[next]) { if (!visited[next]) { visited[next] = 1; queue.push(next); } }
          else if (x + nx >= 0 && x + nx < width && y + ny >= 0 && y + ny < height && sample(x + nx, y + ny, 'solid') &&
            (terrainStampAt(placement, x + nx, y + ny, true) & 3) !== CLEAR_TERRAIN) supported = true;
        }
      }
      if (!supported) valid = false;
    }
    if (valid && changed && validate([...placed, placement])) placed.push(placement);
  }
  return placed;
};
export { createSourceGroupLibrary, placeSourceGroups, MAX_SOURCE_GROUP_WIDTH, MAX_SOURCE_GROUP_HEIGHT, MAX_SOURCE_GROUPS_PER_CHUNK };
