const MAX_PASSAGE_PORTS = 16, MAX_PASSAGE_VOIDS = 8, PASSAGE_APPROACH_COLUMNS = 8, PASSAGE_HEADROOM = 12;
// Cold source samples only. These classifications expose geometric obligations;
// live materialization, actors and action proofs remain on their physical owners.
const classifySourceRegionPassages = ({ ports = [], protectedVoids = [], height, solid, sourceSolid = () => false }) => {
  const classify = port => {
    let role = 'opening-candidate', inspectedColumns = 0;
    if (![port.x, port.y].every(Number.isInteger) || port.x < 0 || ![-1, 1].includes(port.direction) || port.y < PASSAGE_HEADROOM || port.y >= height) role = 'out-of-bounds';
    else if (!solid(port.x, port.y)) role = 'missing-support';
    else {
      for (let dy = 1; dy <= PASSAGE_HEADROOM; dy++) if (solid(port.x, port.y - dy)) { role = 'blocked-standing'; break; }
      for (let offset = 1; role === 'opening-candidate' && offset <= PASSAGE_APPROACH_COLUMNS; offset++) {
        const x = port.x - port.direction * offset; inspectedColumns++;
        let fullWall = true, blocked = false, source = false;
        for (let dy = 0; dy <= PASSAGE_HEADROOM; dy++) {
          const filled = solid(x, port.y - dy);
          if (dy <= 7 && !filled) fullWall = false;
          if (dy > 0 && filled) { blocked = true; source ||= sourceSolid(x, port.y - dy); }
        }
        if (fullWall) role = source ? 'source-wall' : 'existing-wall';
        else if (blocked) role = 'step-candidate';
        else if (!solid(x, port.y)) role = 'unsupported-edge';
      }
    }
    return Object.freeze({ ...port, role, inspectedColumns, qualified: false });
  };
  const classified = Object.freeze(ports.slice(0, MAX_PASSAGE_PORTS).map(classify));
  const cavities = protectedVoids.slice(0, MAX_PASSAGE_VOIDS).map(bounds => {
    const left = classified.find(port => port.x === bounds.x1 && port.y === bounds.y2 && port.direction === 1);
    const right = classified.find(port => port.x === bounds.x2 - 1 && port.y === bounds.y2 && port.direction === -1);
    let supportedColumns = 0, clearColumns = 0;
    const valid = [bounds.x1, bounds.x2, bounds.y1, bounds.y2].every(Number.isInteger) && bounds.x2 > bounds.x1 && bounds.x2 - bounds.x1 <= 224 &&
      bounds.x1 >= 0 && bounds.y1 >= 0 && bounds.y2 >= PASSAGE_HEADROOM && bounds.y2 < height && bounds.y2 - bounds.y1 >= PASSAGE_HEADROOM;
    if (valid) for (let x = bounds.x1; x < bounds.x2; x++) {
      if (solid(x, bounds.y2)) supportedColumns++;
      let clear = true; for (let dy = 1; dy <= PASSAGE_HEADROOM; dy++) if (solid(x, bounds.y2 - dy)) { clear = false; break; }
      if (clear) clearColumns++;
    }
    const floor = valid && supportedColumns === bounds.x2 - bounds.x1 && clearColumns === supportedColumns;
    const openings = [left, right].filter(port => port?.role === 'opening-candidate'), walls = [left, right].filter(port => ['source-wall', 'existing-wall'].includes(port?.role));
    const purpose = floor && openings.length === 2 ? 'through-corridor-candidate' : floor && openings.length === 1 && walls.length === 1 ?
      'return-corridor-candidate' : 'unresolved-source-cavity';
    return Object.freeze({ bounds: Object.freeze({ ...bounds }), purpose, supportedColumns, clearColumns,
      ...(purpose === 'return-corridor-candidate' ? { entry: openings[0], returnPort: openings[0], wall: walls[0] } : {}), qualified: false });
  });
  return Object.freeze({ ports: classified, cavities: Object.freeze(cavities), headroom: PASSAGE_HEADROOM,
    approachColumns: PASSAGE_APPROACH_COLUMNS, crewStatus: 'unqualified' });
};
export { classifySourceRegionPassages, MAX_PASSAGE_PORTS, MAX_PASSAGE_VOIDS, PASSAGE_APPROACH_COLUMNS, PASSAGE_HEADROOM };
