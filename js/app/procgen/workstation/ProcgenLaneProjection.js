const createProcgenLaneProjection = ({ laneCount, height, firstLane = 0, mode = 'strip', physicalHeight = 144, minimumRow = 76, maxVisibleRows = 8 }) => {
  const count = Math.min(laneCount, Math.max(1, Math.trunc(maxVisibleRows)), Math.max(1, Math.floor(height / minimumRow)));
  const first = Math.max(0, Math.min(laneCount - count, Math.trunc(firstLane)));
  const rowHeight = height / count, stripHeight = mode === 'strip' ? 25 : 0;
  return { firstLane: first, count, rowHeight, stripHeight, physicalHeight, mode, scale: 1, rowSourceY: [],
    laneAt(y) { return Math.min(laneCount - 1, first + Math.max(0, Math.floor(y / rowHeight))); },
    worldY(y) { const row = Math.max(0, Math.min(count - 1, Math.floor(y / rowHeight))), scale = this.scale || 1;
      const source = this.rowSourceY[row] ?? physicalHeight - Math.min(physicalHeight, (rowHeight - stripHeight) / scale);
      return (first + row) * physicalHeight + source + Math.min(rowHeight - stripHeight, y - row * rowHeight) / scale; }
  };
};
export { createProcgenLaneProjection };
