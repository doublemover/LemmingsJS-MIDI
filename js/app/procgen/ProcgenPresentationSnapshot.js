const snapshots = new WeakMap();
const CELL_SIZE = 48;
const KIND_PRIORITY = Object.freeze({ actor: 0, contact: 1, gate: 2, object: 3, zone: 4 });
const finiteRect = rect => rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const validBounds = bounds => bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
const compareEntities = (a, b) => (KIND_PRIORITY[a.kind] ?? 5) - (KIND_PRIORITY[b.kind] ?? 5) ||
  (Number.isFinite(a.actorId) && Number.isFinite(b.actorId) ? a.actorId - b.actorId : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const readProcgenCanvasRect = (canvas, windowRef) => {
  if (canvas.hidden || canvas.isConnected === false || canvas.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return null;
  const raw = canvas.getBoundingClientRect?.();
  if (!finiteRect(raw)) return null;
  const style = windowRef.getComputedStyle?.(canvas), pixels = name => Math.max(0, parseFloat(style?.[name]) || 0);
  const left = pixels('borderLeftWidth') + pixels('paddingLeft'), right = pixels('borderRightWidth') + pixels('paddingRight');
  const top = pixels('borderTopWidth') + pixels('paddingTop'), bottom = pixels('borderBottomWidth') + pixels('paddingBottom');
  const width = canvas.offsetWidth || (canvas.clientWidth ? canvas.clientWidth + pixels('borderLeftWidth') + pixels('borderRightWidth') : raw.width);
  const height = canvas.offsetHeight || (canvas.clientHeight ? canvas.clientHeight + pixels('borderTopWidth') + pixels('borderBottomWidth') : raw.height);
  const rect = { left: raw.left + left * raw.width / width, top: raw.top + top * raw.height / height,
    width: raw.width - (left + right) * raw.width / width, height: raw.height - (top + bottom) * raw.height / height };
  return finiteRect(rect) ? rect : null;
};
const sameProcgenRect = (a, b) => !!a && !!b && ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 0.01);

const logicalPoint = (snapshot, clientX, clientY) => {
  if (!snapshot || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const x = (clientX - snapshot.rect.left) * snapshot.logicalSize.width / snapshot.rect.width;
  const y = (clientY - snapshot.rect.top) * snapshot.logicalSize.height / snapshot.rect.height;
  return x >= 0 && y >= 0 && x < snapshot.logicalSize.width && y < snapshot.logicalSize.height ? { x, y } : null;
};
const rowAt = (snapshot, y) => {
  let first = 0, last = snapshot.rows.length - 1;
  while (first <= last) {
    const middle = first + last >>> 1, row = snapshot.rows[middle];
    if (y < row.destinationY) last = middle - 1;
    else if (y >= row.destinationY + row.destinationHeight) first = middle + 1;
    else return row;
  }
  return null;
};
const procgenScreenToWorld = (snapshot, clientX, clientY) => {
  const point = logicalPoint(snapshot, clientX, clientY), row = point && rowAt(snapshot, point.y);
  if (!row) return null;
  return { x: snapshot.originX + point.x / snapshot.logicalSize.width * snapshot.viewWidth,
    y: row.sourceY + (point.y - row.destinationY) / row.destinationHeight * row.sourceHeight, lane: row.lane, projectionRevision: snapshot.projectionRevision };
};
const procgenWorldToScreen = (snapshot, x, y, lane = null) => {
  if (!snapshot || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const row = snapshots.get(snapshot)?.rowsByLane.get(lane ?? Math.floor(y / snapshot.laneHeight));
  if (!row || x < snapshot.originX || x > snapshot.originX + snapshot.viewWidth || y < row.sourceY || y > row.sourceY + row.sourceHeight) return null;
  const logicalX = (x - snapshot.originX) / snapshot.viewWidth * snapshot.logicalSize.width;
  const logicalY = row.destinationY + (y - row.sourceY) / row.sourceHeight * row.destinationHeight;
  return { x: snapshot.rect.left + logicalX / snapshot.logicalSize.width * snapshot.rect.width,
    y: snapshot.rect.top + logicalY / snapshot.logicalSize.height * snapshot.rect.height, lane: row.lane };
};

const createProcgenPresentationSnapshot = ({ worldId, generation, tick, terrainRevision, revision, projectionRevision = revision, rect, backingSize, logicalSize,
  originX, viewWidth, laneHeight, layoutKey, rows, entities = [], maxEntities = 16384 }) => {
  if (!finiteRect(rect) || !logicalSize || !backingSize || ![logicalSize.width, logicalSize.height, backingSize.width, backingSize.height, viewWidth, laneHeight].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(originX)) return null;
  const acceptedRows = (rows || []).filter(row => [row.lane, row.sourceY, row.sourceHeight, row.destinationY, row.destinationHeight].every(Number.isFinite) && Number.isInteger(row.lane) && row.lane >= 0 && row.sourceHeight > 0 && row.destinationHeight > 0 && row.destinationY >= 0 && row.destinationY + row.destinationHeight <= logicalSize.height + 1e-7)
    .map(row => Object.freeze({ ...row })).sort((a, b) => a.destinationY - b.destinationY);
  if (acceptedRows.some((row, index) => index > 0 && row.destinationY < acceptedRows[index - 1].destinationY + acceptedRows[index - 1].destinationHeight || acceptedRows.findIndex(other => other.lane === row.lane) !== index)) return null;
  const rowsByLane = new Map(acceptedRows.map(row => [row.lane, row])), bins = new Map(), wide = [], acceptedEntities = [], ids = new Set();
  for (const source of entities) {
    if (acceptedEntities.length >= maxEntities) break;
    if (typeof source.id !== 'string' || ids.has(source.id) || !validBounds(source.bounds)) continue;
    const bounds = source.bounds, regions = [];
    for (const row of acceptedRows) {
      const lane = row.lane;
      const left = Math.max(bounds.x, originX), right = Math.min(bounds.x + bounds.width, originX + viewWidth);
      const top = Math.max(bounds.y, row.sourceY), bottom = Math.min(bounds.y + bounds.height, row.sourceY + row.sourceHeight);
      if (left >= right || top >= bottom) continue;
      regions.push(Object.freeze({ x: (left - originX) / viewWidth * logicalSize.width, y: row.destinationY + (top - row.sourceY) / row.sourceHeight * row.destinationHeight,
        width: (right - left) / viewWidth * logicalSize.width, height: (bottom - top) / row.sourceHeight * row.destinationHeight, lane }));
    }
    if (!regions.length) continue;
    const entity = Object.freeze({ id: source.id, kind: source.kind || 'object', actorId: source.actorId ?? null, lane: source.lane ?? regions[0].lane,
      label: String(source.label || source.id).slice(0, 160), action: source.action == null ? null : String(source.action).slice(0, 80), cause: source.cause == null ? null : String(source.cause).slice(0, 160),
      bounds: Object.freeze({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }), regions: Object.freeze(regions) });
    ids.add(entity.id); acceptedEntities.push(entity);
    let cells = 0;
    for (const region of regions) cells += (Math.floor((region.x + region.width) / CELL_SIZE) - Math.floor(region.x / CELL_SIZE) + 1) * (Math.floor((region.y + region.height) / CELL_SIZE) - Math.floor(region.y / CELL_SIZE) + 1);
    if (cells > 64) { wide.push(entity); continue; }
    const seen = new Set();
    for (const region of regions) for (let y = Math.floor(region.y / CELL_SIZE); y <= Math.floor((region.y + region.height) / CELL_SIZE); y++) for (let x = Math.floor(region.x / CELL_SIZE); x <= Math.floor((region.x + region.width) / CELL_SIZE); x++) {
      const key = `${x}:${y}`; if (seen.has(key)) continue; seen.add(key);
      let bin = bins.get(key); if (!bin) { bin = []; bins.set(key, bin); } bin.push(entity);
    }
  }
  acceptedEntities.sort(compareEntities);
  const snapshot = Object.freeze({ worldId, generation, physicalTick: tick, terrainRevision, revision, projectionRevision, layoutKey, laneHeight, originX, viewWidth,
    rect: Object.freeze({ ...rect }), backingSize: Object.freeze({ ...backingSize }), logicalSize: Object.freeze({ ...logicalSize }),
    rows: Object.freeze(acceptedRows), entities: Object.freeze(acceptedEntities), truncated: entities.length > maxEntities,
    capabilities: Object.freeze({ inspect: true, edit: false }) });
  const memberships = [...bins.values()].reduce((sum, bin) => sum + bin.length, 0);
  const estimatedBytes = 512 + acceptedRows.length * 128 + bins.size * 96 + memberships * 16 + wide.length * 16 + acceptedEntities.reduce((sum, entity) =>
    sum + 384 + entity.regions.length * 96 + (entity.id.length + entity.label.length + (entity.action?.length || 0) + (entity.cause?.length || 0)) * 2, 0);
  snapshots.set(snapshot, { rowsByLane, bins, wide, memberships, estimatedBytes, entitiesById: new Map(acceptedEntities.map(entity => [entity.id, entity])), queryVisits: 0 }); return snapshot;
};
const hitProcgenPresentation = (snapshot, clientX, clientY) => {
  const point = logicalPoint(snapshot, clientX, clientY), index = snapshot && snapshots.get(snapshot);
  if (!point || !index || !rowAt(snapshot, point.y)) return [];
  const candidates = index.bins.get(`${Math.floor(point.x / CELL_SIZE)}:${Math.floor(point.y / CELL_SIZE)}`) || [], hits = [];
  for (const entity of [...candidates, ...index.wide]) {
    index.queryVisits++;
    if (entity.regions.some(region => point.x >= region.x && point.x < region.x + region.width && point.y >= region.y && point.y < region.y + region.height)) hits.push(entity);
  }
  return hits.sort(compareEntities);
};
const getProcgenPresentationEntity = (snapshot, id) => snapshots.get(snapshot)?.entitiesById.get(id) || null;
const overlapsProcgenPresentation = (snapshot, clientRect, kinds = ['actor', 'contact', 'gate']) => {
  const index = snapshot && snapshots.get(snapshot); if (!index || !finiteRect(clientRect)) return true;
  const left = (clientRect.left - snapshot.rect.left) / snapshot.rect.width * snapshot.logicalSize.width;
  const top = (clientRect.top - snapshot.rect.top) / snapshot.rect.height * snapshot.logicalSize.height;
  const right = left + clientRect.width / snapshot.rect.width * snapshot.logicalSize.width;
  const bottom = top + clientRect.height / snapshot.rect.height * snapshot.logicalSize.height;
  const x1 = Math.floor(left / CELL_SIZE), x2 = Math.floor(right / CELL_SIZE), y1 = Math.floor(top / CELL_SIZE), y2 = Math.floor(bottom / CELL_SIZE);
  if ((x2 - x1 + 1) * (y2 - y1 + 1) > 64) return true;
  const seen = new Set(), matches = entity => {
    if (seen.has(entity.id)) return false; seen.add(entity.id); index.queryVisits++;
    return kinds.includes(entity.kind) && entity.regions.some(region => left < region.x + region.width && right > region.x && top < region.y + region.height && bottom > region.y);
  };
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) for (const entity of index.bins.get(`${x}:${y}`) || []) if (matches(entity)) return true;
  for (const entity of index.wide) if (matches(entity)) return true;
  return false;
};
const procgenPresentationStats = snapshot => {
  const index = snapshot && snapshots.get(snapshot);
  return { entities: snapshot?.entities.length || 0, cells: index?.bins.size || 0, wideEntities: index?.wide.length || 0, memberships: index?.memberships || 0, estimatedBytes: index?.estimatedBytes || 0, queryVisits: index?.queryVisits || 0 };
};

export { createProcgenPresentationSnapshot, readProcgenCanvasRect, sameProcgenRect, procgenScreenToWorld, procgenWorldToScreen, hitProcgenPresentation, overlapsProcgenPresentation, getProcgenPresentationEntity, procgenPresentationStats };
