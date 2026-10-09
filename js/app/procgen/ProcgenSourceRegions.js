import { classifySourceRegionPassages } from './ProcgenSourceRegionPassages.js';
import { compileAuthoredAssemblies } from './ProcgenAuthoredAssemblies.js';
import { placeAuthoredAssemblies } from './ProcgenAssemblyPlacement.js';
import { CLEAR_TERRAIN, PAINT_TERRAIN, compileTerrainGroup, terrainStampAt } from './ProcgenTerrainCompositing.js';

const MAX_REGION_WIDTH = 224, MAX_REGION_HEIGHT = 160, MAX_REGION_ALTERNATIVES = 4, MAX_REGION_SCAN = 128;
const composites = new Map(), MAX_REGION_COMPOSITES = 16;
const sourceFor = (group, anchor) => group.entry.sources.find(source => source.level === anchor.source.level);

const sourceParts = (group, support) => {
  const source = sourceFor(group, support), all = [...group.members.map((member, at) => ({ ...member, sourceIndex: source.terrainIndices[at] })),
    { ...support.anchor, sourceIndex: support.source.index }].sort((a, b) => a.sourceIndex - b.sourceIndex);
  const left = Math.min(...all.map(member => member.x)), top = Math.min(...all.map(member => member.y));
  const width = Math.max(...all.map(member => member.x + member.image.width)) - left;
  const height = Math.max(...all.map(member => member.y + member.image.height)) - top;
  if (width > MAX_REGION_WIDTH || height > MAX_REGION_HEIGHT) return null;
  const placements = all.map(member => ({ id: member.id, x: member.x - left, y: member.y - top, f: member.f }));
  return { all, left, top, width, height, placements };
};
const measureSourceShape = (group, support) => {
  const parts = sourceParts(group, support); if (!parts) return null;
  const { all, width, height, placements } = parts;
  const composite = compileTerrainGroup({ placements }, new Map(all.map(member => [member.id, member.piece])), width, height);
  let opaquePixels = 0, roofEmptyPixels = 0, clearanceColumns = 0;
  for (let x = 0; x < width; x++) {
    let roof = false, run = 0, longest = 0;
    for (let y = 0; y < height; y++) {
      if (!(composite.frame[y * width + x] & 128)) { opaquePixels++; roof = true; run = 0; }
      else if (roof) { roofEmptyPixels++; longest = Math.max(longest, ++run); }
    }
    if (longest >= 12) clearanceColumns++;
  }
  let supportColumns = 0, first = -1, last = -1;
  const anchor = support.anchor;
  for (let x = 0; x < anchor.image.width; x++) for (let y = 0; y < anchor.image.height; y++) {
    const sx = anchor.orientation.flipX ? anchor.image.width - x - 1 : x, sy = anchor.orientation.flipY ? anchor.image.height - y - 1 : y;
    if (anchor.pixels[sy * anchor.image.width + sx] & 128) continue;
    supportColumns++; if (first < 0) first = x; last = x; break;
  }
  // Source-empty clearance is a selection stratum, never a walking certificate.
  const stratum = [width > 112 ? 'wide' : 'narrow', clearanceColumns >= 8 ? 'clearance' : roofEmptyPixels ? 'perforated' : 'solid',
    supportColumns <= 16 ? 'point' : supportColumns <= 48 ? 'strip' : 'broad'].join('/');
  return Object.freeze({ width, height, opaquePixels, emptyPixels: width * height - opaquePixels, roofEmptyPixels,
    clearanceColumns, supportColumns, supportSpan: last - first + 1, stratum });
};
// This production admits complete, terrain-only source atoms. Objects remain on
// their existing single-tile owner until a joint object transaction is qualified.
const createSourceRegionLibrary = (catalog, terrain, objects, excludedIds = new Set()) =>
  compileAuthoredAssemblies(catalog, terrain, objects, { maxWidth: MAX_REGION_WIDTH, maxHeight: MAX_REGION_HEIGHT })
    .filter(group => !group.objects.length && group.members.every(member => !excludedIds.has(member.id)))
    .map(group => ({ ...group, supportAnchors: group.supportAnchors.filter(anchor => anchor.confidence >= 0.8 &&
      anchor.anchor.kind === 'terrain' && anchor.source.kind === 'terrain' && Number.isInteger(anchor.source.index) &&
      anchor.source.index >= 0 && anchor.source.index <= 4095 && !excludedIds.has(anchor.anchor.id) && sourceFor(group, anchor)) }))
    .filter(group => group.supportAnchors.length)
    .map(group => {
      const supportAnchors = group.supportAnchors.map(anchor => ({ ...anchor, sourceShape: measureSourceShape(group, anchor) }));
      const sourceStrata = Object.freeze([...new Set(supportAnchors.map(anchor => anchor.sourceShape?.stratum || 'complete-source-bounds'))].sort());
      return { ...group, supportAnchors, sourceStrata };
    });
const sourceRegionCandidates = (library, code) => {
  if (!library.length) return [];
  const first = (code >>> 0) % library.length, chosen = [library[first]], used = new Set([first]);
  const key = group => (group.sourceStrata || ['unmeasured']).join(','), strata = new Set([key(chosen[0])]);
  while (chosen.length < Math.min(MAX_REGION_ALTERNATIVES, library.length)) {
    let fallback = -1, next = -1;
    for (let offset = 1; offset < Math.min(library.length, MAX_REGION_SCAN); offset++) {
      const at = (first + offset) % library.length; if (used.has(at)) continue;
      if (fallback < 0) fallback = at;
      // Spend diversity on substantial whole source supports, not thin poles.
      // The original seeded choice and sequential fallback remain available.
      const bearing = library[at].supportAnchors.every(anchor => anchor.sourceShape && anchor.sourceShape.supportColumns >= 16 && anchor.sourceShape.width >= 32);
      if (bearing && !strata.has(key(library[at]))) { next = at; break; }
    }
    if (next < 0) next = fallback;
    used.add(next); chosen.push(library[next]); strata.add(key(library[next]));
  }
  return chosen;
};
const completePiece = (group, support) => {
  let piece = composites.get(support); if (piece) return piece;
  const parts = sourceParts(group, support); if (!parts) return null;
  const { all, left, top, width, height, placements } = parts;
  const composite = compileTerrainGroup({ placements }, new Map(all.map(member => [member.id, member.piece])), width, height);
  // Exact source background replaces only this atom's bounded box. It does not
  // become an extruded column of source color, and never borrows later ornaments.
  for (let at = 0; at < width * height; at++) if (composite.operations[at] < PAINT_TERRAIN) {
    composite.operations[at] = composite.operations[at + width * height] = CLEAR_TERRAIN;
  }
  piece = { id: all[0].id, width, height, frame: composite.frame, rgba: composite.rgba, composite, image: { width, height },
    sourceOffset: { x: left, y: top }, sourcePlacements: placements, sourceIndices: all.map(member => member.sourceIndex) };
  if (composites.size >= MAX_REGION_COMPOSITES) composites.delete(composites.keys().next().value);
  composites.set(support, piece); return piece;
};

const placeSourceRegion = ({ library = [], seed, firstChunk, code, height, occupied, surface, solid, steel, onAdmission }) => {
  const rejected = [], attempts = [], candidates = sourceRegionCandidates(library, code);
  const finish = (status, selectedAtom = null) => {
    const admission = Object.freeze({ seed, firstChunk, attemptLimit: MAX_REGION_ALTERNATIVES, status, selectedAtom,
      attempts: Object.freeze(attempts), crewStatus: 'unqualified' });
    onAdmission?.(admission); return admission;
  };
  const reject = (group, reason) => {
    const failure = Object.freeze({ id: group.entry.id, reason }); rejected.push(failure);
    attempts.push(Object.freeze({ ...failure, strata: Object.freeze((group.sourceStrata || []).slice()), shapes: Object.freeze(group.supportAnchors.map(anchor => anchor.sourceShape)), status: 'rejected' }));
  };
  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const group = candidates[attempt];
    const result = placeAuthoredAssemblies({ compiled: [group], chunk: firstChunk, origin: firstChunk * 128, code: (code >>> attempt) >>> 0,
      chunkWidth: 256, height, occupied, baseSolid: solid, baseSurface: surface });
    const assembly = result.assemblies[0];
    if (!assembly) { reject(group, 'source-support-or-placement'); continue; }
    const support = group.supportAnchors.find(anchor => JSON.stringify(anchor.source) === JSON.stringify(assembly.sourceSupport.source) &&
      anchor.anchor.x === assembly.sourceSupport.anchor.x && anchor.anchor.y === assembly.sourceSupport.anchor.y);
    const piece = support && completePiece(group, support);
    const x = assembly.bounds.x1 - firstChunk * 128, y = assembly.bounds.y1;
    if (!piece || x >= 128 || x + piece.width <= 128) { reject(group, 'complete-region-span'); continue; }
    const placement = { piece, x, y, flip: false, decor: false, sourceRevision: group.sourceRevision };
    let valid = true, steelBlocked = false;
    for (let dy = 0; dy < piece.height && valid; dy++) for (let dx = 0; dx < piece.width; dx++) {
      if (steel(x + dx, y + dy)) { valid = false; steelBlocked = true; break; }
    }
    const supportContacts = [], anchor = support.anchor;
    for (let dx = 0; dx < anchor.image.width; dx++) for (let dy = anchor.image.height - 1; dy >= 0; dy--) {
      const sx = anchor.orientation.flipX ? anchor.image.width - dx - 1 : dx;
      const sy = anchor.orientation.flipY ? anchor.image.height - dy - 1 : dy;
      if (anchor.pixels[sy * anchor.image.width + sx] & 128) continue;
      const px = x + anchor.x - piece.sourceOffset.x + dx, py = y + anchor.y - piece.sourceOffset.y + dy + 1;
      if (!solid(px, py) || (terrainStampAt(placement, px, py, true) & 3) === CLEAR_TERRAIN) valid = false;
      supportContacts.push(Object.freeze({ x: firstChunk * 128 + px, y: py })); break;
    }
    if (!valid || !supportContacts.length) { reject(group, steelBlocked ? 'protected-steel' : 'complete-source-support'); continue; }
    const sample = (px, py) => {
      const stamp = terrainStampAt(placement, px, py, solid(px, py)), operation = stamp & 3;
      return operation ? operation !== CLEAR_TERRAIN : solid(px, py);
    };
    const voids = [], ports = [];
    // Rectangular source-empty runs are obligations, not route certificates.
    for (let dy = 1; dy < piece.height && voids.length < 8; dy++) {
      let start = -1;
      for (let dx = 0; dx <= piece.width; dx++) {
        const roof = dx < piece.width && !sample(x + dx, y + dy) && sample(x + dx, y + dy - 1);
        if (roof && start < 0) start = dx;
        if (!roof && start >= 0) {
          if (dx - start >= 8) {
            let bottom = y + dy;
            while (bottom < height) {
              let empty = true;
              for (let px = x + start; px < x + dx && empty; px++) empty = !sample(px, bottom);
              if (!empty) break; bottom++;
            }
            if (bottom - y - dy >= 12 && bottom < height && voids.length < 8) {
              voids.push(Object.freeze({ x1: firstChunk * 128 + x + start, x2: firstChunk * 128 + x + dx, y1: y + dy, y2: bottom, purpose: 'source-underpass' }));
              if (sample(x + start, bottom)) ports.push(Object.freeze({ x: firstChunk * 128 + x + start, y: bottom, direction: 1, kind: 'standing-candidate', qualified: false }));
              if (sample(x + dx - 1, bottom)) ports.push(Object.freeze({ x: firstChunk * 128 + x + dx - 1, y: bottom, direction: -1, kind: 'standing-candidate', qualified: false }));
            }
          }
          start = -1;
        }
      }
    }
    const passages = classifySourceRegionPassages({ ports, protectedVoids: voids, height,
      solid: (px, py) => sample(px - firstChunk * 128, py),
      sourceSolid: (px, py) => (terrainStampAt(placement, px - firstChunk * 128, py, solid(px - firstChunk * 128, py)) & 3) >= PAINT_TERRAIN });
    const region = Object.freeze({ id: group.sourceRevision + ':' + seed + ':' + firstChunk + ':' + group.entry.id,
      production: voids.length ? 'source-overhang' : 'source-assembly', sourceAtom: group.entry.id, sourceRevision: group.sourceRevision,
      sourceShape: support.sourceShape, sourceStrata: group.sourceStrata,
      source: Object.freeze({ level: support.source.level, terrainIndices: Object.freeze(piece.sourceIndices.slice()) }),
      bounds: Object.freeze({ ...assembly.bounds }), touchedTiles: Object.freeze([firstChunk, firstChunk + 1]),
      sourcePlacements: Object.freeze(piece.sourcePlacements.map(member => Object.freeze({ ...member }))),
      supportContacts: Object.freeze(supportContacts),
      protectedVoids: Object.freeze(voids), ports: Object.freeze(ports), passages, rejectedAlternatives: Object.freeze(rejected), crewStatus: 'unqualified' });
    attempts.push(Object.freeze({ id: group.entry.id, status: 'admitted', strata: Object.freeze((group.sourceStrata || []).slice()), shape: support.sourceShape }));
    return { placement: { ...placement, sourceRegion: region }, region, admission: finish('admitted', group.entry.id) };
  }
  finish(library.length ? 'rejected' : 'unavailable'); return null;
};
const sourceRegionPayloadBytes = (library, descriptions) => {
  const pieces = new Set(), buffers = new Set(); let bytes = 0;
  for (const group of library) for (const support of group.supportAnchors) {
    const piece = composites.get(support); if (piece) pieces.add(piece);
  }
  for (const descriptor of descriptions.values()) for (const placement of descriptor.placements) if (placement.sourceRegion) pieces.add(placement.piece);
  for (const piece of pieces) for (const view of [piece.frame, piece.composite.operations, piece.composite.colors, piece.composite.impact]) {
    if (!buffers.has(view.buffer)) { buffers.add(view.buffer); bytes += view.buffer.byteLength; }
  }
  return bytes;
};
export { sourceRegionCandidates, sourceRegionPayloadBytes, createSourceRegionLibrary, placeSourceRegion, MAX_REGION_WIDTH, MAX_REGION_HEIGHT, MAX_REGION_ALTERNATIVES };
