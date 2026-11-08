const createProcgenLaneProjection = ({ laneCount, height, firstLane = 0, laneIndices = null, mode = 'strip', physicalHeight = 144, minimumRow = 76, maxVisibleRows = 8 }) => {
  if (laneIndices && (laneIndices.length > laneCount || new Set(laneIndices).size !== laneIndices.length || laneIndices.some(index => !Number.isInteger(index) || index < 0 || index >= laneCount))) throw new Error('Invalid visible physical lane order.');
  const total = laneIndices ? laneIndices.length : laneCount;
  const count = Math.min(total, Math.max(1, Math.min(8, Math.trunc(maxVisibleRows))), Math.max(1, Math.floor(height / minimumRow)));
  const first = Math.max(0, Math.min(total - count, Math.trunc(firstLane)));
  const indices = Object.freeze(laneIndices ? laneIndices.slice(first, first + count) : Array.from({ length: count }, (_, row) => first + row));
  const rowHeight = height / Math.max(1, count), stripHeight = mode === 'strip' ? 25 : 0;
  return { firstLane: indices[0] ?? 0, firstVisible: first, laneIndices: indices, mapped: !count || indices.some((lane, row) => lane !== indices[0] + row), count, rowHeight, stripHeight, physicalHeight, mode, scale: 1, rowSourceY: [],
    laneAt(y) { return indices[Math.max(0, Math.min(count - 1, Math.floor(y / rowHeight)))] ?? null; },
    worldY(y) { const row = Math.max(0, Math.min(count - 1, Math.floor(y / rowHeight))), scale = this.scale || 1;
      const source = this.rowSourceY[row] ?? physicalHeight - Math.min(physicalHeight, (rowHeight - stripHeight) / scale);
      return count ? indices[row] * physicalHeight + source + Math.min(rowHeight - stripHeight, y - row * rowHeight) / scale : null; }
  };
};
export { createProcgenLaneProjection };
