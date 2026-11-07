import { cloneData, freezeData } from '../../core/CanonicalData.js';
const point = value => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => ['x', 'y'].includes(key)) && [value.x, value.y].every(number => Number.isFinite(number) && Math.abs(number) <= 10000000);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const between = (a, b, c) => Math.abs(cross(a, b, c)) <= 1e-9 && c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || between(a, b, c) || between(a, b, d) || between(c, d, a) || between(c, d, b);
export function validateWorldRegion(raw) {
  const value = cloneData(raw, { maxBytes: 8192, maxNodes: 256 });
  if (value?.kind === 'rectangle' && Object.keys(value).every(key => ['kind', 'bounds'].includes(key))) {
    const b = value.bounds;
    if (!b || Object.keys(b).some(key => !['x1', 'y1', 'x2', 'y2'].includes(key)) || !point({ x: b.x1, y: b.y1 }) || !point({ x: b.x2, y: b.y2 }) || b.x2 <= b.x1 || b.y2 <= b.y1) throw new TypeError('A world rectangle needs a finite positive extent.');
  } else if (value?.kind === 'polygon' && Object.keys(value).every(key => ['kind', 'points'].includes(key)) && Array.isArray(value.points) && value.points.length >= 3 && value.points.length <= 32 && value.points.every(point)) {
    const p = value.points, count = p.length; let area = 0;
    for (let i = 0; i < count; i++) {
      const a = p[i], b = p[(i + 1) % count]; area += a.x * b.y - a.y * b.x;
      if (a.x === b.x && a.y === b.y) throw new TypeError('World polygon edges must have positive length.');
      const c = p[(i + 2) % count];
      if (Math.abs(cross(a, b, c)) <= 1e-9) throw new TypeError('World polygon vertices must form nondegenerate corners.');
      for (let j = i + 2; j < count; j++) if (!(i === 0 && j === count - 1) && intersects(a, b, p[j], p[(j + 1) % count])) throw new TypeError('World polygon edges may not cross or touch themselves.');
    }
    if (Math.abs(area) < 1e-6) throw new TypeError('World polygons need positive area.');
  } else throw new TypeError('Choose one bounded world rectangle or simple polygon.');
  return freezeData(value);
}
export function worldRegionDepth(region, position) {
  const { x, y } = position;
  if (region.kind === 'rectangle') {
    const b = region.bounds, dx = Math.max(b.x1 - x, 0, x - b.x2), dy = Math.max(b.y1 - y, 0, y - b.y2);
    return dx || dy ? -Math.hypot(dx, dy) : Math.min(x - b.x1, b.x2 - x, y - b.y1, b.y2 - y);
  }
  let inside = false, distance = Infinity; const p = region.points;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j], b = p[i], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? distance : -distance;
}
