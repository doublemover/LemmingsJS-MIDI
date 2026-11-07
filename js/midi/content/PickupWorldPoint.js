export function pickupWorldPoint(graph, gateId, gateRevision, local) {
  const gate = graph?.pickups?.find(gate => gate.id === gateId && gate.revision === gateRevision);
  if (!gate || !Number.isFinite(local) || local < 0 || local > 1) return null;
  const bounds = gate.geometry.bounds, points = gate.geometry.kind === 'band' ? [{ x: bounds.x1, y: bounds.y1 }, { x: bounds.x2, y: bounds.y1 }, { x: bounds.x2, y: bounds.y2 }, { x: bounds.x1, y: bounds.y2 }, { x: bounds.x1, y: bounds.y1 }] : gate.geometry.points, lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = local * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) { const length = lengths[index]; if (remaining <= length || index === lengths.length - 1) { const fraction = length ? Math.max(0, Math.min(1, remaining / length)) : 0; return { x: points[index].x + (points[index + 1].x - points[index].x) * fraction, y: points[index].y + (points[index + 1].y - points[index].y) * fraction }; } remaining -= length; }
  return null;
}
