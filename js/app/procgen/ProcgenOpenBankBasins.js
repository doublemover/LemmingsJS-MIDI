const BASIN_SHORE_WIDTH = 24;
const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const frozen = value => Object.freeze(value);

// This is an explicit negative-void production over the existing sourced
// motif foundation, not an authored basin or a certified builder route.
// Source placements and their supports are never excavated to make it fit.
const planOpenBankBasin = ({ object, descriptor, route, height, sourceRevision, solid, steel }) => {
  const image = object.piece.image, x1 = object.x, x2 = x1 + image.width, bankY = object.y, floorY = bankY + image.height;
  const bounds = { x1: x1 - BASIN_SHORE_WIDTH, x2: x2 + BASIN_SHORE_WIDTH, y1: 0, y2: floorY + 1 };
  const trigger = { x1: x1 + image.trigger_left, x2: x1 + image.trigger_left + image.trigger_width,
    y1: bankY + image.trigger_top, y2: bankY + image.trigger_top + image.trigger_height };
  if (object.role !== 'liquid' || object.assembly || !route?.source || !sourceRevision || bankY < 48 || floorY >= height ||
      bounds.x1 < descriptor.origin || bounds.x2 > descriptor.origin + 128 ||
      trigger.x1 < x1 || trigger.x2 > x2 || trigger.y1 < bankY || trigger.y2 > floorY ||
      trigger.x1 >= trigger.x2 || trigger.y1 >= trigger.y2 || !Object.values(trigger).every(Number.isFinite)) return null;
  const protectedBounds = { ...bounds, x1: bounds.x1 - 2, x2: bounds.x2 + 2 };
  if (descriptor.gapWidth && descriptor.gapX < bounds.x2 && descriptor.gapX + descriptor.gapWidth > bounds.x1) return null;
  if (descriptor.placements.some(p => overlaps(protectedBounds, { x1: descriptor.origin + p.x, x2: descriptor.origin + p.x + p.piece.width,
    y1: p.y, y2: p.y + p.piece.height })) || descriptor.assemblies.some(a => overlaps(protectedBounds, a.bounds))) return null;
  const word = descriptor.word;
  if (word && overlaps(protectedBounds, { x1: descriptor.origin + word.x, x2: descriptor.origin + word.x + word.width,
    y1: word.y, y2: word.baseline + 2 })) return null;
  if (descriptor.objects.some(other => {
    const i = other.piece.image;
    return overlaps(protectedBounds, { x1: Math.min(other.x, other.x + i.trigger_left) - 2,
      x2: Math.max(other.x + i.width, other.x + i.trigger_left + i.trigger_width) + 2,
      y1: Math.min(other.y, other.y + i.trigger_top), y2: other.role === 'liquid' ? height : Math.max(other.supportY + 8, other.y + i.trigger_top + i.trigger_height) });
  })) return null;
  let removedFoundationPixels = 0;
  for (let x = bounds.x1; x < bounds.x2; x++) {
    const localX = x - descriptor.origin, shore = x < x1 || x >= x2;
    for (let y = 0; y <= floorY; y++) {
      if (steel(localX, y) || y >= (shore ? bankY : floorY) && !solid(localX, y)) return null;
      if (y < (shore ? bankY : floorY) && solid(localX, y)) removedFoundationPixels++;
    }
  }
  const sourcePlacements = frozen(route.placements.map(p => frozen({ ...p })));
  const foundation = frozen({ kind: 'source-motif-column-foundation', motif: route.id, period: route.period,
    source: frozen({ ...route.source, terrainIndices: frozen([...route.source.terrainIndices]) }), sourcePlacements });
  return frozen({ id: `${sourceRevision}:${descriptor.origin}:${object.piece.id}:${x1}:open-bank`, production: 'source-foundation-open-bank',
    sourceRevision, foundation, object: frozen({ id: object.piece.id, x: x1, y: bankY, width: image.width, height: image.height, transformed: false }),
    bounds: frozen(bounds), trigger: frozen(trigger), touchedTiles: frozen([descriptor.origin / 128]), removedFoundationPixels,
    protectedVoids: frozen([frozen({ x1, x2, y1: 0, y2: floorY, purpose: 'whole-liquid-opening' }),
      frozen({ x1: bounds.x1, x2: x1, y1: 0, y2: bankY, purpose: 'left-shore-headroom' }),
      frozen({ x1: x2, x2: bounds.x2, y1: 0, y2: bankY, purpose: 'right-shore-headroom' })]),
    shores: frozen([frozen({ x1: bounds.x1, x2: x1, y: bankY, direction: 1, qualified: false }),
      frozen({ x1: x2, x2: bounds.x2, y: bankY, direction: -1, qualified: false })]),
    floor: frozen({ x1, x2, y: floorY, supportColumns: image.width }), crewStatus: 'unqualified' });
};

const basinVoidAt = (basin, x, y) => !!basin && x >= basin.bounds.x1 && x < basin.bounds.x2 && y >= 0 &&
  y < (x >= basin.object.x && x < basin.object.x + basin.object.width ? basin.floor.y : basin.object.y);

export { planOpenBankBasin, basinVoidAt, BASIN_SHORE_WIDTH };
