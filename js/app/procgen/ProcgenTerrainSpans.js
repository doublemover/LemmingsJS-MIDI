import { placeSourceGroups } from './ProcgenTerrainGroups.js';
import { placeSourceRegion } from './ProcgenSourceRegions.js';

const SHARED_TERRAIN_WIDTH = 256, SHARED_TERRAIN_MINIMUM_X = 1024;
// Cold, complete source geometry only. Neither sibling descriptor construction
// nor mutable materialization flags participate in this bounded admission.
const placeTerrainSpan = ({ seed, firstChunk, code, descriptors, height, wordPlanner, groupLibrary, regionLibrary = [], zone, surface, solid, steel, color, sourceRevision, onRegionAdmission }) => {
  if (descriptors.some(d => d.gapWidth)) return null;
  const occupied = descriptors.flatMap((d, part) => [
    ...d.placements.map(p => ({ ...p, x: p.x + part * 128 })),
    ...d.assemblies.map(a => ({ x: a.bounds.x1 - firstChunk * 128 - 2, y: a.bounds.y1 - 2, piece: { width: a.bounds.x2 - a.bounds.x1 + 4, height: a.bounds.y2 - a.bounds.y1 + 4 } })),
    ...d.objects.map(o => { const i = o.piece.image;
      const left = o.basin?.bounds.x1 ?? Math.min(o.x, o.x + i.trigger_left), right = o.basin?.bounds.x2 ?? Math.max(o.x + i.width, o.x + i.trigger_left + i.trigger_width);
      const top = o.basin ? 0 : Math.min(o.y, o.y + i.trigger_top), bottom = o.role === 'liquid' ? height : Math.max(o.y + i.height, o.y + i.trigger_top + i.trigger_height);
      return { x: left - firstChunk * 128 - 2, y: top - 2, piece: { width: right - left + 4, height: bottom - top + 4 } }; })
  ]);
  const objectEnvelopes = descriptors.flatMap(d => d.objects.map(o => {
    const i = o.piece.image;
    return { x1: (o.basin?.bounds.x1 ?? Math.min(o.x, o.x + i.trigger_left)) - firstChunk * 128,
      x2: (o.basin?.bounds.x2 ?? Math.max(o.x + i.width, o.x + i.trigger_left + i.trigger_width)) - firstChunk * 128,
      y1: o.basin ? 0 : Math.min(o.y, o.y + i.trigger_top), y2: o.role === 'liquid' ? height : Math.max(o.y + i.height, o.y + i.trigger_top + i.trigger_height) };
  }));
  // Full terrain alpha was already checked by the glyph planner. An attachment's
  // broad box cannot turn transparent source margins into invisible collision.
  // Objects retain their full artwork/contact envelope, including external triggers.
  const wordClear = word => !objectEnvelopes.some(o => word.x + word.width > o.x1 - 2 && word.x < o.x2 + 2 &&
    word.baseline > o.y1 - 2 && word.y < o.y2 + 2);
  let word = null, placements = [], region = null, regionTried = false;
  if (code & 1) {
    word = wordPlanner?.planWide(code, SHARED_TERRAIN_WIDTH, surface, solid, null, wordClear) || null;
    if (word) placements = word.placements;
  }
  const tryRegion = () => {
    if (regionTried) return; regionTried = true;
    const result = placeSourceRegion({ library: regionLibrary, seed, firstChunk, code, height, occupied, surface, solid, steel, onAdmission: onRegionAdmission });
    if (result) { placements = [result.placement]; region = result.region; }
  };
  if (!placements.length && code & 16) tryRegion();
  if (!placements.length) placements = placeSourceGroups({ zone, library: groupLibrary, code, chunk: firstChunk, width: SHARED_TERRAIN_WIDTH,
    maxGroups: 1, centered: true, allowVerticalSeparation: true, height, baseSurface: surface, baseSolid: solid, baseSteel: steel, baseColor: color,
    occupied, gapX: 0, gapWidth: 0 });
  if (!placements.length) tryRegion();
  if (!placements.length) return null;
  const x1 = Math.min(...placements.map(p => p.x)), x2 = Math.max(...placements.map(p => p.x + p.piece.width));
  if (x1 >= 128 || x2 <= 128 || x1 < 8 || x2 > SHARED_TERRAIN_WIDTH - 8) return null;
  const shared = Object.freeze({ id: `${sourceRevision}:${seed}:${firstChunk}:${region?.sourceAtom || word?.text || `${placements[0].canonicalGroup.role}:${placements[0].canonicalGroup.source.level}:${placements[0].canonicalGroup.source.terrainIndices.join(',')}`}`,
    firstChunk, lastChunk: firstChunk + 1, cost: 2, sourceRevision: region?.sourceRevision || sourceRevision, x1, x2, word: word?.text || null, ...(region ? { region } : {}) });
  for (let part = 0; part < 2; part++) {
    const descriptor = descriptors[part], local = placements.filter(p => p.x < (part + 1) * 128 && p.x + p.piece.width > part * 128)
      .map(p => ({ ...p, x: p.x - part * 128, sharedSpan: shared }));
    descriptor.sharedSpan = shared; descriptor.placements.push(...local);
    if (region) descriptor.region = region;
    if (word) descriptor.word = { ...word, x: word.x - part * 128, placements: local,
      readable: word.readable.map(g => ({ ...g, x: g.x - part * 128, right: g.right - part * 128 })), sharedSpan: shared };
  }
  return shared;
};
export { placeTerrainSpan, SHARED_TERRAIN_WIDTH, SHARED_TERRAIN_MINIMUM_X };
