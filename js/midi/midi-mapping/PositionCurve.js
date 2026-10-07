// Position transfer functions use a normalized spatial axis, never musical time.
const positionCurveValue = (entry, axis, min, max) => {
  if (!Array.isArray(entry?.points) || !entry.points.length) return min + (max - min) * axis;
  const x = Math.max(0, Math.min(1, axis));
  let left = 0, right = 1, low = min, high = max;
  for (const point of entry.points) {
    const position = point.position ?? point.beat;
    if (!Number.isFinite(position) || position < 0 || position > 1 || !Number.isFinite(point.value)) continue;
    if (position <= x && position >= left) { left = position; low = point.value; }
    else if (position > x && position <= right) { right = position; high = point.value; }
  }
  return x === left ? low : low + (high - low) * (x - left) / (right - left);
};

export { positionCurveValue };
