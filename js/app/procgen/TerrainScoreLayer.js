const CHUNK = 16, MAX_CHUNKS = 512, MAX_CELLS = 16384, MAX_VERSIONS = 4, MAX_TRANSACTIONS = 256, MAX_OPERATION_CELLS = 8192;
const keyFor = (x, y) => `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`;
const indexFor = (x, y) => (y % CHUNK) * CHUNK + x % CHUNK;
const createTerrainScoreState = () => ({ version: 1, serial: 0, chunks: new Map(), transactions: [], spans: 0, cells: 0, retiredChunks: 0, coverageRevision: 0 });
const canonicalTerrainSpans = cells => {
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x), spans = [];
  for (const cell of sorted) {
    const previous = spans.at(-1);
    if (previous && previous.y === cell.y && previous.x2 === cell.x && previous.before === cell.before && previous.after === cell.after && previous.tag === cell.tag && previous.materialId === cell.materialId) previous.x2++;
    else spans.push({ y: cell.y, x1: cell.x, x2: cell.x + 1, before: cell.before, after: cell.after, ...(Object.hasOwn(cell, 'tag') ? { tag: cell.tag, materialId: cell.materialId } : {}) });
  }
  return spans;
};
const rememberTerrainCell = (world, x, y, before, after, revisionBefore) => {
  const pending = world.terrainScorePending;
  if (!pending.cells.length && !pending.overflow) pending.revisionBefore = revisionBefore;
  if (pending.cells.length < MAX_OPERATION_CELLS) pending.cells.push({ x, y, before, after });
  else pending.overflow = true;
};
const commitTerrainScore = (world, metadata = {}, suppliedCells = null) => {
  const pending = world.terrainScorePending, cells = suppliedCells ?? pending.cells;
  if (!cells.length && !pending.overflow) return null;
  const state = world.terrainScoreState;
  if (!Number.isSafeInteger(state.serial + 1)) throw new RangeError('Terrain score identity exhausted.');
  const unique = new Map();
  for (const cell of cells) { const key = `${cell.x}:${cell.y}`, previous = unique.get(key); unique.set(key, previous ? { ...cell, before: previous.before } : cell); }
  const actual = [...unique.values()].filter(cell => cell.before !== cell.after || cell.annotationChanged || metadata.operation === 'annotate');
  const revisionBefore = metadata.revisionBefore ?? pending.revisionBefore, revisionAfter = world.terrainRevision;
  const incomplete = !suppliedCells && pending.overflow;
  world.terrainScorePending = { cells: [], overflow: false, revisionBefore: revisionAfter };
  if (!actual.length && !incomplete) return null;
  const editId = `${world.worldId}:${world.generation}:terrain:${++state.serial}`;
  const tag = metadata.tag ?? (metadata.operation === 'build' ? 'bridge-contour' : ['dig', 'mine', 'bash', 'explode'].includes(metadata.operation) ? 'excavated-surface' : null);
  const record = { version: 1, editId, transactionId: metadata.transactionId ?? editId,
    causeKind: metadata.causeKind ?? 'physical-work', actorId: metadata.actorId ?? null,
    actionInstanceId: metadata.actionInstanceId ?? null, workOperationId: metadata.workOperationId ?? null,
    operation: metadata.operation ?? 'mutation', materialId: metadata.materialId ?? null, tag,
    worldId: world.worldId, generation: world.generation, tick: world.tickIndex, revisionBefore, revisionAfter,
    expiresAtTick: metadata.expiresAtTick ?? null, completeness: incomplete ? 'unknown' : 'complete',
    solidAdded: actual.filter(cell => !cell.before && cell.after).length,
    solidRemoved: actual.filter(cell => cell.before && !cell.after).length,
    appearanceChanged: actual.filter(cell => !!cell.before === !!cell.after && cell.before !== cell.after).length,
    annotationChanged: metadata.operation === 'annotate' ? actual.length : actual.filter(cell => cell.annotationChanged).length, spans: canonicalTerrainSpans(actual) };
  if (incomplete) { state.chunks.clear(); state.cells = 0; state.retiredChunks++; state.coverageRevision = revisionAfter; }
  for (const cell of actual) {
    const key = keyFor(cell.x, cell.y), index = indexFor(cell.x, cell.y); let chunk = state.chunks.get(key);
    if (!chunk) { chunk = new Map(); state.chunks.set(key, chunk); }
    let versions = chunk.get(index); if (!versions) { versions = []; chunk.set(index, versions); state.cells++; }
    versions.push({ revision: revisionAfter, beforeRevision: revisionBefore, editId, tag: Object.hasOwn(cell, 'tag') ? cell.tag : tag, materialId: Object.hasOwn(cell, 'materialId') ? cell.materialId : record.materialId,
      causeKind: record.causeKind, operation: record.operation, solid: !!cell.after, tick: world.tickIndex, expiresAtTick: record.expiresAtTick });
    if (versions.length > MAX_VERSIONS) versions.shift();
  }
  while (state.chunks.size > MAX_CHUNKS || state.cells > MAX_CELLS) {
    const key = state.chunks.keys().next().value; state.cells -= state.chunks.get(key).size; state.chunks.delete(key); state.retiredChunks++;
  }
  state.transactions.push(record); state.spans += record.spans.length;
  while (state.transactions.length > MAX_TRANSACTIONS || state.spans > 16384) state.spans -= state.transactions.shift().spans.length;
  world.captureTerrainTopology?.('postTransaction');
  return record;
};
const terrainScoreAt = (world, x, y, revision = world.terrainRevision, tick = world.tickIndex) => {
  const state = world.terrainScoreState;
  if (!state || ![x, y, revision, tick].every(Number.isSafeInteger) || x < 0 || y < 0 || x >= world.width || y >= world.height || revision > world.terrainRevision || revision < state.coverageRevision) return { status: 'unknown', reason: 'terrain-coverage' };
  const versions = state.chunks.get(keyFor(x, y))?.get(indexFor(x, y));
  if (!versions) return state.retiredChunks ? { status: 'unknown', reason: 'provenance-retired' } : { status: 'complete', tag: null, materialId: null, editId: null, revision };
  const record = versions.findLast(value => value.revision <= revision);
  if (!record) return { status: 'unknown', reason: 'historical-provenance-unavailable' };
  if (record.expiresAtTick != null && tick >= record.expiresAtTick) return { status: 'expired', editId: record.editId, revision };
  return { status: 'complete', ...record, sourceRevision: revision };
};
const terrainContactProvenance = (world, x, y, revision = world.terrainRevision) => {
  const direct = terrainScoreAt(world, x, y, revision);
  if (direct.status !== 'complete' || direct.tag) return direct;
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
    const adjacent = terrainScoreAt(world, x + dx, y + dy, revision);
    if (adjacent.status === 'complete' && adjacent.solid === false && adjacent.tag === 'excavated-surface') return { ...adjacent, contactRole: 'exposed-neighbor', sourceCell: { x: x + dx, y: y + dy } };
  }
  return direct;
};
export { createTerrainScoreState, rememberTerrainCell, commitTerrainScore, terrainScoreAt, terrainContactProvenance, canonicalTerrainSpans };
