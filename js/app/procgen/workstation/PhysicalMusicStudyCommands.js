import { validateReleaseGesture } from '../ReleaseGesture.js';
import { canonicalDataText, hashDataText } from '../../../core/CanonicalData.js';
import { digestPlan, normalizeTerrainCommand, readTerrainCell } from '../TerrainAuthoringAdapter.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'physical-study-domain' }); };
const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
export async function buildPhysicalMusicStudyInputs(world, goal, candidate, { baseTick = world.tickIndex, requestedAt = world.simulationTimeMs } = {}) {
  const graph = JSON.parse(canonicalDataText(world.physicalAuthoring.graph, { maxBytes: 1048576, maxNodes: 65536 }).text), spans = [], skills = [], rectangles = [], releaseEdits = [], junctionEdits = [], layerEdits = [];
  let changedGraph = false, cells = 0, editCost = 0;
  for (const edit of candidate.edits) {
    if (edit.kind === 'junction-configuration') { junctionEdits.push(edit); editCost++; continue; }
    if (edit.kind === 'layer-muted') { layerEdits.push(edit); editCost++; continue; }
    if (edit.kind === 'release-spread-ticks' || edit.kind === 'release-clock-mode') { releaseEdits.push(edit); editCost++; continue; }
    if (edit.kind === 'worker-tick') {
      if (!world.actors.some(actor => actor.id === edit.actorId)) fail('A skill handle names an absent source actor.');
      skills.push(edit); editCost++; continue;
    }
    if (edit.kind === 'pickup-x') {
      const pickup = graph.pickups?.find(value => value.id === edit.pickupId);
      if (!pickup || pickup.geometry.kind !== 'segment' || pickup.geometry.points.some(point => point.x !== pickup.geometry.points[0].x)) fail('This pickup handle requires an authored vertical segment.');
      if (graph.routes?.some(route => route.markers.some(marker => marker.gateId === edit.pickupId))) fail('Moving a route marker also needs an explicit route-path edit; this finite pickup-only domain cannot infer one.');
      if (edit.value < world.leftEdgeX || edit.value >= world.width) fail('A pickup leaves the source world.');
      editCost += Math.abs(edit.value - pickup.geometry.points[0].x); pickup.revision++; for (const point of pickup.geometry.points) point.x = edit.value; changedGraph = true; continue;
    }
    const b = edit.bounds;
    if (edit.laneId >= world.laneCount || b.y1 < edit.laneId * world.laneHeight || b.y2 > (edit.laneId + 1) * world.laneHeight || b.x1 <= world.leftEdgeX || b.x2 >= world.width ||
        rectangles.some(other => overlaps(b, other)) || goal.crewConstraints.protectedRegions.some(other => overlaps(b, other))) fail('Wall handles must be disjoint, inside their physical lane and outside protected terrain.');
    rectangles.push(b); let originalX = null;
    cells += (b.x2 - b.x1) * (b.y2 - b.y1); if (cells > 8192 || (b.y2 - b.y1) * 2 + spans.length > 128) fail('The complete wall patch exceeds the admitted terrain transaction.');
    for (let y = b.y1; y < b.y2; y++) {
      let transition = null, solid = false;
      for (let x = b.x1 - 1; x <= b.x2; x++) {
        const cell = readTerrainCell(world, x, y); if (cell.status !== 'complete' || cell.steel) fail('A wall handle requires fully materialized editable collision cells.');
        if (cell.color) { if (!solid) transition = x; solid = true; } else if (solid) fail('A right-wall rectangle contains another cavity.');
      }
      if (transition == null || transition < b.x1 || transition > b.x2 || originalX != null && transition !== originalX) fail('The source rectangle is not one uniform right wall with open space on its left.');
      originalX = transition;
      if (edit.value > b.x1) spans.push({ x1: b.x1, x2: edit.value, y, solid: false });
      if (edit.value < b.x2) spans.push({ x1: edit.value, x2: b.x2, y, solid: true });
    }
    editCost += Math.abs(edit.value - originalX);
  }
  const inventory = {};
  for (const edit of skills) { inventory[edit.skillType] = (inventory[edit.skillType] || 0) + 1; if (inventory[edit.skillType] > (goal.skillInventory[edit.skillType] || 0)) fail('The candidate exceeds its joint skill inventory.'); }
  const inputs = [], prefix = 'study:' + (await hashDataText(canonicalDataText(candidate.edits.filter(edit => edit.kind !== 'worker-tick')).text)).slice(0, 32);
  if (spans.length || changedGraph) {
    graph.revision++; graph.editCommandId = prefix;
    inputs.push({ tick: baseTick, command: { id: prefix, transactionId: prefix, kind: 'physical-authoring', origin: 'manual', target: { generation: world.generation }, requestedAt, applyAtTick: baseTick + 1,
      parameters: { authoring: { version: 1, operation: spans.length ? 'terrain-and-graph' : 'graph-only', transactionId: prefix, expectedRevision: world.physicalAuthoring.revision,
        expectedJunctionRevision: world.physicalJunctions.revision, expectedGraphDigest: digestPlan(world.physicalAuthoring.graph), graph: validateCausalInstrumentGraph(graph),
        instances: world.physicalAuthoring.instances, junctions: world.physicalJunctions.definitions,
        terrain: spans.length ? normalizeTerrainCommand({ version: 1, operation: 'replaceSolid', transactionId: prefix, generation: world.generation, spans, maxCells: 8192, maxChunks: 128 }) : null } } } });
  }
  if (new Set(junctionEdits.map(edit => edit.junctionId)).size !== junctionEdits.length || new Set(layerEdits.map(edit => edit.layerId)).size !== layerEdits.length) fail('Use one finite handle per junction or layer property.');
  for (const edit of junctionEdits) {
    const definition = world.physicalJunctions.definitions.find(value => value.id === edit.junctionId), configuration = definition?.configurations[edit.value];
    if (!configuration) fail('The sampled junction configuration is unavailable in the exact source.');
    const request = { version: 1, junctionId: definition.id, configurationId: configuration.id, authoringRevision: definition.revision, policy: edit.junctionPolicy || 'waitForSafeBoundary', expiryTick: baseTick + 2 + (edit.eligibilityTicks || 0), coalesce: false },
      id = 'study-junction:' + (await hashDataText(canonicalDataText(request).text)).slice(0, 40);
    inputs.push({ tick: baseTick, command: { id, kind: 'junction-request', origin: 'manual', requestedAt, applyAtTick: baseTick + 1, target: { generation: world.generation }, parameters: { request } } });
  }
  for (const edit of layerEdits) {
    if (!world.physicalAuthoring.graph.feedback?.layers.some(layer => layer.id === edit.layerId)) fail('The sampled physical intervention layer is unavailable in the exact source.');
    inputs.push({ tick: baseTick, feedbackControl: { id: 'study-layer:' + edit.id, layerId: edit.layerId, muted: edit.value === 1 } });
  }
  if (releaseEdits.length) {
    const population = world.population, current = population.releaseGesture;
    if (!world.cohorts || !current || population.pendingReleaseGesture || new Set(releaseEdits.map(edit => edit.kind)).size !== releaseEdits.length) fail('A release study needs one current authored cohort policy, no pending replacement and distinct property handles.');
    const next = JSON.parse(canonicalDataText(current).text); next.revision++;
    for (const edit of releaseEdits) if (edit.kind === 'release-spread-ticks') next.spreadTicks = edit.value; else next.clockMode = edit.value ? 'adaptive' : 'locked';
    const gesture = validateReleaseGesture(next, world.laneCount), id = 'study-release:' + (await hashDataText(canonicalDataText(gesture).text)).slice(0, 40);
    inputs.push({ tick: baseTick, command: { id, kind: 'set-release-gesture', origin: 'manual', requestedAt, applyAtTick: baseTick + 1, target: { generation: world.generation }, parameters: { gesture } } });
  }
  for (const edit of skills) inputs.push({ tick: baseTick + edit.value - 1, command: { id: 'study-skill:' + (await hashDataText(canonicalDataText(edit).text)).slice(0, 40), kind: 'assign-worker', origin: 'manual',
    requestedAt, applyAtTick: baseTick + edit.value, target: { generation: world.generation, actorId: edit.actorId }, parameters: { workerKind: { builder: 'builders', basher: 'bashers', digger: 'diggers', miner: 'miners' }[edit.skillType] } } });
  // The atomic terrain edit precedes skills at the same boundary in every execution mode.
  const order = input => input.command?.kind === 'physical-authoring' ? 0 : input.feedbackControl ? 1 : 2, key = input => input.command?.id || input.feedbackControl.id;
  inputs.sort((a, b) => a.tick - b.tick || order(a) - order(b) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { inputs, editCost, patchHash: await hashDataText(canonicalDataText(inputs, { maxBytes: 2 * 1048576, maxNodes: 262144 }).text), scope: 'explicit-rectangles-pickups-and-shared-worker-actions;other-source-state-preserved' };
}
