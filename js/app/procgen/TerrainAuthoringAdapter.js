import { commitTerrainScore, terrainScoreAt } from './TerrainScoreLayer.js';
import { invalidateTerrainTopology } from './TerrainTopologyInvalidation.js';
const MAX_CELLS = 8192, MAX_CHUNKS = 128;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const inside = (x, y, b, halo = 0) => b && x >= b.x1 - halo && x < b.x2 + halo && y >= b.y1 - halo && y < b.y2 + halo;
const readonlyRevision = (world, key) => Map.prototype.has.call(world.terrainTileRevisions, key) ? Map.prototype.get.call(world.terrainTileRevisions, key) : -(world.terrainTileRevisions.epochs?.[Math.floor(key / 0x800000)] || 0);
const readPatchCell = (edits, key, index) => {
  const resident = Map.prototype.get.call(edits, key); if (resident) return resident[index];
  const cold = edits.cold?.get(key); if (!cold) return 0; if (cold.raw) return cold.raw[index];
  let low = 0, high = cold.values.length - 1;
  while (low <= high) { const at = (low + high) >>> 1, start = cold.runs[at * 2], end = start + cold.runs[at * 2 + 1]; if (index < start) high = at - 1; else if (index >= end) low = at + 1; else return cold.values[at]; }
  return 0;
};
const readTerrainCell = (world, x, y) => {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < world.leftEdgeX || x >= world.width || y < 0 || y >= world.height) return { status: 'unknown', reason: 'source-boundary' };
  const lane = Math.floor(y / world.laneHeight), localY = y % world.laneHeight, width = world.terrain?.chunkWidth || 256, chunk = Math.floor(x / width), tile = lane * 0x800000 + chunk;
  if (world.terrainGrowth && (!world.terrainGrowth.columnReady(lane, x) || x >= world.generatedThrough[lane])) return { status: 'unknown', reason: 'unrevealed-terrain' };
  let base = 0, steel = false, source = null;
  if (!world.terrain) base = world.baseGroundAt(x, y);
  else {
    const slot = lane * world._chunkSlots + (chunk & (world._chunkSlots - 1));
    if (world._collisionIndices[slot] !== chunk || world.terrainGrowth?.stateFor(lane, chunk)) return { status: 'unknown', reason: 'unmaterialized-terrain' };
    source = world._collisionSlots[slot]; if (!source?.solid || !source.steel) return { status: 'unknown', reason: 'source-mask-unavailable' };
    const index = localY * width + x % width; base = source.solid[index >>> 5] & (1 << (index & 31)) ? 1 : 0; steel = !!(source.steel[index >>> 5] & (1 << (index & 31)));
  }
  const edit = readPatchCell(world.editChunks, world._editKey(x, y), localY * 32 + x % 32);
  return { status: 'complete', color: edit ? edit - 1 : base, steel, tile, revision: readonlyRevision(world, tile), source };
};
const normalizeTerrainCommand = input => {
  if (!input || !['addSolid', 'removeSolid', 'annotate', 'replaceSolid'].includes(input.operation) || !identity(input.transactionId) || !Number.isSafeInteger(input.generation) ||
      input.annotationPolicy != null && input.annotationPolicy !== 'replace' || input.annotationPolicy === 'replace' && input.operation !== 'replaceSolid' || input.occupancyPolicy != null && input.occupancyPolicy !== 'reject-occupied' || input.materialId != null && !identity(input.materialId) || input.tag != null && !identity(input.tag) ||
      input.operation === 'annotate' && !identity(input.tag) || input.expectedScoreRevision != null && (!Number.isSafeInteger(input.expectedScoreRevision) || input.expectedScoreRevision < 0) || input.expiresAtTick != null && (!Number.isSafeInteger(input.expiresAtTick) || input.expiresAtTick < 0) ||
      !Array.isArray(input.spans) || !input.spans.length || input.spans.length > 128) throw new Error('Invalid bounded terrain command.');
  const rows = new Map(); let count = 0;
  for (const span of input.spans) {
    if (![span.x1, span.x2, span.y].every(Number.isSafeInteger) || span.x1 < 0 || span.y < 0 || span.x2 <= span.x1 || span.x2 - span.x1 > MAX_CELLS || input.operation === 'replaceSolid' && typeof span.solid !== 'boolean' || input.annotationPolicy === 'replace' && (span.tag != null && !identity(span.tag) || span.materialId != null && !identity(span.materialId))) throw new Error('Invalid integer terrain span.');
    const row = rows.get(span.y) || []; row.push([span.x1, span.x2, input.operation === 'replaceSolid' ? span.solid : null, span.tag ?? null, span.materialId ?? null]); rows.set(span.y, row);
  }
  const spans = [];
  for (const [y, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a[0] - b[0]); let current = null;
    for (const range of row) { if (current && range[0] < current.x2 && input.operation === 'replaceSolid' && (current.solid !== range[2] || input.annotationPolicy === 'replace' && (current.tag !== range[3] || current.materialId !== range[4]))) throw new Error('Conflicting collision patch spans.'); if (current && range[0] <= current.x2 && (input.operation !== 'replaceSolid' || current.solid === range[2]) && (input.annotationPolicy !== 'replace' || current.tag === range[3] && current.materialId === range[4])) current.x2 = Math.max(current.x2, range[1]); else { current = { y, x1: range[0], x2: range[1], ...(input.operation === 'replaceSolid' ? { solid: range[2] } : {}), ...(input.annotationPolicy === 'replace' ? { tag: range[3], materialId: range[4] } : {}) }; spans.push(current); } }
  }
  for (const span of spans) count += span.x2 - span.x1;
  const maxCells = input.maxCells ?? MAX_CELLS, maxChunks = input.maxChunks ?? MAX_CHUNKS;
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > MAX_CELLS || count > maxCells || !Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > MAX_CHUNKS) throw new Error('Terrain command exceeds its work bound.');
  const expected = input.expectedRegionRevisionSet ?? [];
  if (!Array.isArray(expected) || expected.length > MAX_CHUNKS || expected.some(value => !Array.isArray(value) || value.length !== 2 || !value.every(Number.isSafeInteger)) || new Set(expected.map(value => value[0])).size !== expected.length) throw new Error('Invalid terrain revision set.');
  return { version: 1, operation: input.operation, generation: input.generation, transactionId: input.transactionId, spans, maxCells, maxChunks,
    occupancyPolicy: 'reject-occupied', ...(input.annotationPolicy === 'replace' ? { annotationPolicy: 'replace' } : {}), materialId: input.materialId ?? null, tag: input.tag ?? null, expiresAtTick: input.expiresAtTick ?? null,
    expectedScoreRevision: input.expectedScoreRevision ?? null, expectedRegionRevisionSet: expected.map(value => [...value]).sort((a, b) => a[0] - b[0]) };
};
const protectionBounds = world => {
  const bounds = [];
  for (const actor of world.actors) if (!actor.removed && !actor.failureReason && !actor.terminalReason) bounds.push({ x1: actor.x - 16, x2: actor.x + 17, y1: actor.y - 24, y2: actor.y + 17, reason: 'occupied-footprint', actorId: actor.id, actionName: actor.action?.actionName });
  for (let lane = 0; lane < world.laneCount; lane++) {
    for (const task of world.accessTasks?.[lane] || []) for (const b of [task.footprint, task.buildAttempt?.bounds]) if (b) bounds.push({ ...b, reason: 'claimed-work' });
    for (const project of world.lanePolicy?.projects.lanes[lane]?.projects || []) if (project.phase === 'working' || project.phase === 'connected') for (const b of [project.bounds, project.chain?.bounds]) if (b) bounds.push({ ...b, reason: 'claimed-work' });
    for (const scene of [world.basinRoutes?.scenes[lane], world.tunnelRoutes?.scenes[lane]]) for (const b of [scene?.bounds, scene?.task?.footprint, scene?.recoveryExit?.bounds]) if (b) bounds.push({ ...b, reason: 'claimed-route' });
    for (const trigger of world.triggerManager?.byLane[lane] || []) bounds.push({ ...trigger, reason: 'protected-trigger' });
  }
  for (const record of world.hazards?.chunks.values() || []) for (const entry of record.entries) if (entry?.trigger) bounds.push({ ...entry.trigger, reason: 'protected-trigger' });
  return bounds;
};
const inspectTerrainInfluence = (world, bounds) => {
  if (!bounds || ![bounds.x1, bounds.x2, bounds.y1, bounds.y2].every(Number.isSafeInteger) || bounds.x1 < 0 || bounds.y1 < 0 || bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1 || (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1) > 65536) throw new Error('Invalid bounded influence region.');
  const protections = protectionBounds(world), revisions = new Map(), conflicts = [], inspectedSources = new Set();
  const supported = new Set(['walk', 'falling', 'floating', 'blocking', 'building', 'bashing', 'digging', 'mining', 'climbing', 'hoist', 'jump', 'shrug', 'ohno', 'exploding', 'drowning', 'frying', 'splatter', 'exiting']);
  for (const b of protections) if (bounds.x1 < b.x2 && bounds.x2 > b.x1 && bounds.y1 < b.y2 && bounds.y2 > b.y1) { conflicts.push({ reason: b.actorId != null && !supported.has(b.actionName) ? 'unknown-actor-footprint' : b.reason, actorId: b.actorId ?? null }); if (conflicts.length >= 64) break; }
  for (let y = bounds.y1; y < bounds.y2; y++) for (let x = bounds.x1; x < bounds.x2; x++) {
    const cell = readTerrainCell(world, x, y); if (cell.status !== 'complete') return { status: 'unsupported', reason: cell.reason, revisions: [], conflicts };
    if (cell.source && !inspectedSources.has(cell.tile)) { inspectedSources.add(cell.tile);
      for (const object of cell.source.objects || []) { const image = object.piece?.image, top = Math.floor(y / world.laneHeight) * world.laneHeight; if (image && bounds.x1 < object.x + image.width + 2 && bounds.x2 > object.x - 2 && bounds.y1 < top + object.y + image.height + 2 && bounds.y2 > top + object.y - 2) return { status: 'unsupported', reason: 'protected-source-object', revisions: [], conflicts }; }
    }
    revisions.set(cell.tile, cell.revision); if (revisions.size > MAX_CHUNKS) return { status: 'unsupported', reason: 'influence-chunk-capacity', revisions: [], conflicts };
  }
  return { status: conflicts.length ? 'busy' : 'safe', reason: conflicts[0]?.reason ?? null, conflicts, revisions: [...revisions].sort((a, b) => a[0] - b[0]) };
};
const protectionIndex = bounds => {
  const grid = new Map(); let memberships = 0;
  for (const b of bounds) {
    if (![b.x1, b.x2, b.y1, b.y2].every(Number.isFinite)) return null;
    const halo = b.reason === 'protected-trigger' ? 2 : 0;
    const x1 = Math.floor((b.x1 - halo) / 64), x2 = Math.floor((b.x2 + halo - 1) / 64), y1 = Math.floor((b.y1 - halo) / 64), y2 = Math.floor((b.y2 + halo - 1) / 64);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > 4096 || memberships + (x2 - x1 + 1) * (y2 - y1 + 1) > 131072) return null;
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) { const key = `${x}:${y}`, row = grid.get(key) || []; row.push(b); grid.set(key, row); memberships++; }
  }
  return grid;
};
const stagePatchPublication = (edits, patches) => {
  const resident = new Map(Map.prototype.entries.call(edits));
  for (const [key, patch] of patches) { resident.delete(key); resident.set(key, patch); }
  const packed = new Map();
  while (resident.size > edits.maxResidentChunks) {
    const [key, patch] = resident.entries().next().value, runs = [], values = [];
    for (let start = 0; start < patch.length;) { const value = patch[start]; if (!value) { start++; continue; } let end = start + 1; while (end < patch.length && patch[end] === value) end++; runs.push(start, end - start); values.push(value); start = end; }
    packed.set(key, values.length * 5 < patch.byteLength ? { runs: Uint16Array.from(runs), values: Uint8Array.from(values), bytes: values.length * 5 } : { raw: patch, bytes: patch.byteLength }); resident.delete(key);
  }
  return { resident, packed };
};
const digestPlan = value => { let hash = 2166136261; for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); };
const planTerrainCommand = (input, world) => {
  const command = normalizeTerrainCommand(input), revisions = new Map(), patches = new Set(), cells = [], rejected = [], protections = protectionIndex(protectionBounds(world)); let queryWork = 0;
  const counts = { solidAdded: 0, solidRemoved: 0, appearanceChanged: 0, annotationChanged: 0, protected: 0, occupied: 0, unknown: 0 };
  if (!protections) return { status: 'rejected', reason: 'protection-index-capacity', command, counts, cells: [] };
  if (command.generation !== world.generation) return { status: 'stale', reason: 'stale-generation', command, counts, cells: [] };
  for (const span of command.spans) for (let x = span.x1; x < span.x2; x++) {
    const y = span.y, value = readTerrainCell(world, x, y); let reason = null;
    if (value.status !== 'complete') { reason = value.reason; counts.unknown++; }
    else {
      revisions.set(value.tile, value.revision); patches.add(world._editKey(x, y));
      const candidates = protections.get(`${Math.floor(x / 64)}:${Math.floor(y / 64)}`) || [];
      queryWork += candidates.length + (value.source?.objects?.length || 0);
      if (queryWork > 262144) return { status: 'rejected', reason: 'protection-query-capacity', command, counts, cells: [] };
      const protection = candidates.find(b => inside(x, y, b, b.reason === 'protected-trigger' ? 2 : 0));
      const object = value.source?.objects?.find(item => { const image = item.piece?.image; return image && inside(x, y, { x1: item.x, x2: item.x + image.width, y1: Math.floor(y / world.laneHeight) * world.laneHeight + item.y, y2: Math.floor(y / world.laneHeight) * world.laneHeight + item.y + image.height }, 2); });
      if (value.steel || x < world.leftEdgeX + 16 || protection || object) { reason = value.steel ? 'protected-steel' : protection?.reason ?? 'protected-source'; if (reason === 'occupied-footprint') counts.occupied++; else counts.protected++; }
      else {
        const after = command.operation === 'replaceSolid' ? span.solid ? value.color || 3 : 0 : command.operation === 'addSolid' ? value.color || 3 : command.operation === 'removeSolid' ? 0 : value.color;
        const annotation = command.annotationPolicy === 'replace' ? terrainScoreAt(world, x, y) : null;
        const annotationChanged = !!annotation && ((annotation.tag ?? null) !== span.tag || (annotation.materialId ?? null) !== span.materialId);
        if (annotation && annotation.status !== 'complete') { reason = 'unknown-annotation-provenance'; counts.unknown++; }
        else if (after !== value.color || command.operation === 'annotate' || annotationChanged) { cells.push({ x, y, before: value.color, after, ...(annotation ? { tag: span.tag, materialId: span.materialId, annotationChanged } : {}) }); if (command.operation === 'annotate' || annotationChanged) counts.annotationChanged++; if (!value.color && after) counts.solidAdded++; else if (value.color && !after) counts.solidRemoved++; else if (after !== value.color) counts.appearanceChanged++; }
      }
    }
    if (reason && rejected.length < 64) rejected.push({ x, y, reason });
  }
  const expectedRegionRevisionSet = [...revisions].sort((a, b) => a[0] - b[0]);
  const stale = command.expectedScoreRevision != null && command.expectedScoreRevision !== world.terrainScoreState.serial || command.expectedRegionRevisionSet.length && JSON.stringify(command.expectedRegionRevisionSet) !== JSON.stringify(expectedRegionRevisionSet);
  const reason = stale ? 'stale-region-revision' : patches.size > command.maxChunks ? 'chunk-capacity' : rejected.length ? 'protected-or-unknown-region' : null;
  const plan = { version: 1, status: reason ? 'rejected' : 'prepared', reason, command: { ...command, expectedScoreRevision: world.terrainScoreState.serial, expectedRegionRevisionSet }, counts, rejected, cells,
    generation: world.generation, terrainRevision: world.terrainRevision, tick: world.tickIndex, expectedRegionRevisionSet, patchCount: patches.size };
  return { ...plan, digest: digestPlan(plan) };
};
// No user callbacks or source materialization occur between the staged patch
// allocation and publication. Crew/route readers observe the changed tile IDs.
const prepareTerrainPublication = (plan, world) => {
  if (plan?.status !== 'prepared') return { status: 'rejected', reason: plan?.reason ?? 'invalid-terrain-plan' };
  if (!world._stepping || !world.soundEvents._tick) return { status: 'rejected', reason: 'terrain-boundary-required' };
  const current = planTerrainCommand(plan.command, world);
  if (current.status !== 'prepared') return { status: 'rejected', reason: current.reason, counts: current.counts };
  if (JSON.stringify(current.cells) !== JSON.stringify(plan.cells)) return { status: 'rejected', reason: 'stale-terrain-plan' };
  if (!current.cells.length) { const result = { status: 'accepted', reason: 'no-change', counts: current.counts, edit: null }; return { status: 'prepared', result, commit: () => result }; }
  if (!Number.isSafeInteger(world.terrainRevision + current.cells.length) || !Number.isSafeInteger(world.terrainScoreState.serial + 1)) throw new RangeError('Terrain identity exhausted.');
  const patches = new Map(), changedTiles = new Map(), laneChanges = new Set();
  for (const cell of current.cells) {
    const key = world._editKey(cell.x, cell.y); let patch = patches.get(key);
    if (!patch) { patch = new Uint8Array(world.editChunks.chunkLength); for (let index = 0; index < patch.length; index++) patch[index] = readPatchCell(world.editChunks, key, index); patches.set(key, patch); }
    if (plan.command.operation !== 'annotate') patch[(cell.y % world.laneHeight) * 32 + cell.x % 32] = cell.after + 1;
    const lane = Math.floor(cell.y / world.laneHeight); if (cell.before !== cell.after) { laneChanges.add(lane); changedTiles.set(lane * 0x800000 + Math.floor(cell.x / (world.terrain?.chunkWidth || 256)), world.terrainRevision + current.cells.length); }
  }
  // Prepare provenance against a detached bounded state; allocation failure has
  // not touched collision, versions, occupancy, or semantic history.
  const original = world.terrainScoreState, stagedScore = { ...original, transactions: [...original.transactions], chunks: new Map(original.chunks) };
  for (const cell of current.cells) { const key = `${Math.floor(cell.x / 16)}:${Math.floor(cell.y / 16)}`; if (stagedScore.chunks.get(key) === original.chunks.get(key) && original.chunks.has(key)) stagedScore.chunks.set(key, new Map([...original.chunks.get(key)].map(([index, versions]) => [index, [...versions]]))); }
  const publication = stagePatchPublication(world.editChunks, patches);
  const revisionBefore = world.terrainRevision, nextRevision = revisionBefore + current.cells.length;
  const edit = commitTerrainScore({ ...world, terrainScoreState: stagedScore, terrainRevision: nextRevision }, { ...plan.command, revisionBefore, causeKind: 'authoring-command' }, current.cells);
  const generation = world.generation, tick = world.tickIndex, chunks = world.editChunks; let committed = false;
  const result = { status: 'accepted', reason: 'applied', counts: current.counts, edit, planDigest: plan.digest };
  return { status: 'prepared', result, commit({ captureTopology = true } = {}) {
    if (committed) return result;
    if (!world._stepping || !world.soundEvents._tick || world.generation !== generation || world.tickIndex !== tick || world.terrainRevision !== revisionBefore || world.terrainScoreState !== original || world.editChunks !== chunks) throw new Error('Terrain publication proposal is stale.');
    const final = planTerrainCommand(plan.command, world); if (final.status !== 'prepared' || JSON.stringify(final.cells) !== JSON.stringify(current.cells)) throw new Error('Terrain occupancy changed before publication.');
    for (const [key, patch] of patches) {
      const cold = world.editChunks.cold?.get(key); if (cold) { world.editChunks.cold.delete(key); world.editChunks.coldBytes -= cold.bytes; }
      world._invalidateEditChunk(key);
    }
    for (const [key, packed] of publication.packed) { const prior = world.editChunks.cold.get(key); if (prior) world.editChunks.coldBytes -= prior.bytes; world.editChunks.cold.set(key, packed); world.editChunks.coldBytes += packed.bytes; world._invalidateEditChunk(key); }
    Map.prototype.clear.call(world.editChunks); for (const [key, patch] of publication.resident) Map.prototype.set.call(world.editChunks, key, patch);
    world.editChunks._lastKey = undefined; world.editChunks._lastChunk = undefined;
    world.terrainRevision = nextRevision; world.terrainScoreState = stagedScore;
    if (world.terrainTopology?.profiles.length) {
      invalidateTerrainTopology(world, null, revisionBefore, { collisionChanged: false });
      for (const span of edit.spans) invalidateTerrainTopology(world, { x1: span.x1, x2: span.x2, y1: span.y, y2: span.y + 1 }, nextRevision, { collisionChanged: !!span.before !== !!span.after });
    }
    if (plan.command.operation !== 'annotate') {
      for (const [key, revision] of changedTiles) Map.prototype.set.call(world.terrainTileRevisions, key, revision);
      for (const lane of laneChanges) world.terrainActivityTicks[lane] = world.tickIndex;
    }
    world._assistedColumn.valid = false;
    committed = true; if (captureTopology) world.captureTerrainTopology?.('postTransaction');
    return result; } };
};
const applyTerrainPlan = (plan, world) => { const proposal = prepareTerrainPublication(plan, world); return proposal.status === 'prepared' ? proposal.commit() : proposal; };
export { inspectTerrainInfluence, normalizeTerrainCommand, readTerrainCell, readonlyRevision, planTerrainCommand, prepareTerrainPublication, applyTerrainPlan, digestPlan };
