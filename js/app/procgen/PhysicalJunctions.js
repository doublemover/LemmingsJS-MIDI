import { plain, identity, integer, freeze, copy } from './workstation/physical/PhysicalSchema.js';
import { validatePhysicalPorts } from './workstation/physical/PhysicalPorts.js';
import { normalizeTerrainCommand, inspectTerrainInfluence, planTerrainCommand, applyTerrainPlan, readTerrainCell, readonlyRevision } from './TerrainAuthoringAdapter.js';
const createPhysicalJunctionState = () => ({ version: 1, revision: 0, definitions: [], actual: new Map() });
const rectangle = value => { if (!plain(value) || ![value.x1, value.x2, value.y1, value.y2].every(Number.isSafeInteger) || value.x1 < 0 || value.y1 < 0 || value.x2 > 1e9 || value.y2 > 1e9 || value.x2 <= value.x1 || value.y2 <= value.y1 || (value.x2 - value.x1) * (value.y2 - value.y1) > 65536) throw new Error('Invalid junction rectangle.'); return { x1: value.x1, x2: value.x2, y1: value.y1, y2: value.y2 }; };
const contains = (outer, inner) => inner.x1 >= outer.x1 && inner.x2 <= outer.x2 && inner.y1 >= outer.y1 && inner.y2 <= outer.y2;
const validatePhysicalJunction = value => {
  if (!plain(value) || !identity(value.id) || value.id.length > 96 || !integer(value.revision) || value.safetyVersion !== 1 || !Array.isArray(value.configurations) || value.configurations.length < 2 || value.configurations.length > 3) throw new Error('Invalid physical junction.');
  const control = rectangle(value.control), influence = rectangle(value.influence), ports = validatePhysicalPorts(value.ports);
  if (!contains(influence, control) || !ports.some(port => port.role === 'inlet') || !ports.some(port => port.role === 'outlet')) throw new Error('Junction needs controlled geometry and real inlet/outlet contracts.');
  for (const port of ports) if (!contains(influence, { x1: port.position.x, x2: port.position.x + 1, y1: port.position.y, y2: port.position.y + 1 })) throw new Error('Junction port lies outside its safety influence.');
  const configurations = value.configurations.map(config => {
    if (!identity(config?.id) || config.id.length > 64 || !Array.isArray(config.outletIds) || !config.outletIds.length || config.outletIds.length > 8 || new Set(config.outletIds).size !== config.outletIds.length || config.outletIds.some(id => !ports.some(port => port.id === id && port.role === 'outlet'))) throw new Error('Invalid junction configuration ports.');
    const terrain = normalizeTerrainCommand({ operation: 'replaceSolid', generation: 0, transactionId: 'definition', spans: config.spans, materialId: config.materialId ?? null, tag: config.tag ?? null });
    if (terrain.spans.some(span => !contains(control, { x1: span.x1, x2: span.x2, y1: span.y, y2: span.y + 1 }))) throw new Error('Junction edits leave the declared control region.');
    return { id: config.id, spans: terrain.spans, materialId: terrain.materialId, tag: terrain.tag, outletIds: [...config.outletIds] };
  });
  if (new Set(configurations.map(config => config.id)).size !== configurations.length) throw new Error('Duplicate junction configuration.');
  // Every state owns the same finite cells, including its explicit openings.
  const cells = spans => spans.flatMap(span => Array.from({ length: span.x2 - span.x1 }, (_, offset) => `${span.y}:${span.x1 + offset}`)).sort();
  const footprint = JSON.stringify(cells(configurations[0].spans)); if (configurations.some(config => JSON.stringify(cells(config.spans)) !== footprint)) throw new Error('Junction configurations need identical explicit cell footprints.');
  const requiredAssets = value.requiredAssets ?? [];
  if (!Array.isArray(requiredAssets) || requiredAssets.length > 16 || requiredAssets.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid junction source dependencies.');
  return freeze({ version: 1, id: value.id, revision: value.revision, safetyVersion: 1, control, influence, ports, configurations, requiredAssets: [...requiredAssets], qualification: 'requires-real-route-replay' });
};
const configurePhysicalJunctions = (world, input, revision) => {
  if (world._stepping || world._disposed || !Array.isArray(input) || input.length > 64 || !integer(revision) || revision < world.physicalJunctions.revision) throw new Error('Invalid junction authoring boundary.');
  const definitions = input.map(validatePhysicalJunction); if (new Set(definitions.map(value => value.id)).size !== definitions.length) throw new Error('Duplicate junction identity.');
  if (JSON.stringify(definitions) === JSON.stringify(world.physicalJunctions.definitions)) return false;
  if (revision <= world.physicalJunctions.revision) throw new Error('Junction authoring requires a newer revision.');
  for (const definition of definitions) { const prior = world.physicalJunctions.definitions.find(value => value.id === definition.id); if (prior && JSON.stringify(prior) !== JSON.stringify(definition) && definition.revision <= prior.revision) throw new Error('Changed junction definitions require a newer revision.'); }
  world.physicalJunctions.definitions = definitions; world.physicalJunctions.revision = revision;
  for (const [id, actual] of world.physicalJunctions.actual) if (!definitions.some(value => value.id === id && value.revision === actual.authoringRevision)) world.physicalJunctions.actual.delete(id);
  return true;
};
const sourceAssets = world => [...(world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain?.recipe?.assetSha256 ?? terrain?.sourceDescriptor?.sourceRevision).filter(Boolean), ...(world.terrain?.sceneTerrainLayoutHash ? [world.terrain.sceneTerrainLayoutHash] : [])];
const normalizeJunctionRequest = (world, input) => {
  if (!plain(input) || !identity(input.junctionId) || !identity(input.configurationId) || !integer(input.authoringRevision) || !integer(input.expiryTick) || input.expiryTick <= world.tickIndex || input.expiryTick > world.tickIndex + 3600 || !['rejectIfBusy', 'waitForSafeBoundary'].includes(input.policy ?? 'rejectIfBusy')) throw new Error('Invalid bounded junction request.');
  const definition = world.physicalJunctions.definitions.find(value => value.id === input.junctionId);
  if (!definition || definition.revision !== input.authoringRevision || !definition.configurations.some(value => value.id === input.configurationId)) throw new Error('Junction definition or configuration is unavailable.');
  if (definition.requiredAssets.some(hash => !sourceAssets(world).includes(hash))) throw new Error('Junction source asset mismatch.');
  const inspected = inspectTerrainInfluence(world, definition.influence);
  if (inspected.status === 'unsupported') throw new Error('Junction influence is not fully materialized: ' + inspected.reason);
  const expected = input.expectedRegionRevisionSet ?? inspected.revisions;
  if (!Array.isArray(expected) || expected.length > 128 || expected.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger)) || JSON.stringify(expected) !== JSON.stringify(inspected.revisions)) throw new Error('Junction region revision is stale.');
  return freeze({ version: 1, junctionId: input.junctionId, configurationId: input.configurationId, authoringRevision: input.authoringRevision,
    expiryTick: input.expiryTick, policy: input.policy ?? 'rejectIfBusy', expectedRegionRevisionSet: expected.map(pair => [...pair]), coalesce: input.coalesce === true });
};
const applyJunctionRequest = (world, request, command) => {
  const definition = world.physicalJunctions.definitions.find(value => value.id === request.junctionId), config = definition?.configurations.find(value => value.id === request.configurationId);
  if (!definition || definition.revision !== request.authoringRevision || !config) return { status: 'rejected', reason: 'stale-junction-authoring' };
  if (world.tickIndex >= request.expiryTick) return { status: 'expired', reason: 'junction-request-expired' };
  if (definition.requiredAssets.some(hash => !sourceAssets(world).includes(hash))) return { status: 'rejected', reason: 'junction-source-asset-mismatch' };
  const inspected = inspectTerrainInfluence(world, definition.influence);
  if (inspected.status === 'unsupported') return { status: 'rejected', reason: inspected.reason };
  if (JSON.stringify(inspected.revisions) !== JSON.stringify(request.expectedRegionRevisionSet)) return { status: 'stale', reason: 'stale-junction-region' };
  if (inspected.status === 'busy') return { status: request.policy === 'waitForSafeBoundary' && world.tickIndex < request.expiryTick ? 'waiting' : 'rejected', reason: inspected.reason, conflicts: inspected.conflicts };
  for (const port of definition.ports) for (const support of port.support) {
    const cell = readTerrainCell(world, port.position.x + support.dx, port.position.y + support.dy);
    // Support cells controlled by this transaction are checked against its candidate.
    const span = config.spans.find(span => span.y === port.position.y + support.dy && port.position.x + support.dx >= span.x1 && port.position.x + support.dx < span.x2);
    if (cell.status !== 'complete' || (span ? span.solid : !!cell.color) !== support.solid) return { status: 'rejected', reason: 'junction-port-support-mismatch' };
  }
  const plan = planTerrainCommand({ ...config, operation: 'replaceSolid', generation: world.generation, transactionId: command.transactionId || command.id }, world);
  if (plan.status !== 'prepared') return { status: 'rejected', reason: plan.reason };
  const nextActual = new Map(world.physicalJunctions.actual), actual = { junctionId: definition.id, configurationId: config.id, authoringRevision: definition.revision,
    generation: world.generation, commandId: command.id, appliedTick: world.tickIndex, routeQualification: 'not-inferred-from-switch' };
  nextActual.set(definition.id, actual);
  const result = plan.cells.length ? applyTerrainPlan(plan, world) : { status: 'accepted', reason: 'already-configured', counts: plan.counts, edit: null };
  if (result.status !== 'accepted') return result;
  actual.terrainRevision = world.terrainRevision; actual.regionRevisions = request.expectedRegionRevisionSet.map(([key]) => [key, readonlyRevision(world, key)]); world.physicalJunctions.actual = nextActual;
  return { ...result, junction: freeze({ ...actual, outletIds: config.outletIds, passageGuaranteed: false }) };
};
const queryPhysicalJunction = (world, junctionId, { includeDefinition = true } = {}) => {
  const definition = world.physicalJunctions.definitions.find(value => value.id === junctionId); if (!definition) return null;
  const pending = world.interventionState.pending.filter(command => command.kind === 'junction-request' && command.parameters.request.junctionId === junctionId).map(command => ({ requestId: command.id, desiredConfiguration: command.parameters.request.configurationId, state: command.lastWaitReason ? 'waiting' : 'requested', reason: command.lastWaitReason ?? null, expiryTick: command.parameters.request.expiryTick }));
  const receipts = world.interventionState.receipts.filter(receipt => receipt.junctionId === junctionId).slice(-16);
  const actual = world.physicalJunctions.actual.get(junctionId);
  return freeze({ authoringRevision: definition.revision, ...(includeDefinition ? { definition: copy(definition) } : {}), actual: actual ? { ...copy(actual), status: actual.generation === world.generation && actual.regionRevisions.every(([key, revision]) => readonlyRevision(world, key) === revision) ? 'observed-at-application' : 'stale-geometry' } : null, pending, receipts: copy(receipts) });
};
export { createPhysicalJunctionState, validatePhysicalJunction, configurePhysicalJunctions, normalizeJunctionRequest, applyJunctionRequest, queryPhysicalJunction };

const normalizeJunctionDefinitionCommand = input => {
  if (!plain(input) || !['upsert', 'remove'].includes(input.operation) || !identity(input.junctionId) || input.expectedRevision != null && !integer(input.expectedRevision)) throw new Error('Invalid junction authoring command.');
  const definition = input.operation === 'upsert' ? validatePhysicalJunction(input.definition) : null;
  if (definition && definition.id !== input.junctionId || JSON.stringify(definition).length * 2 > 24576) throw new Error('Junction definition identity or byte capacity mismatch.');
  return freeze({ operation: input.operation, junctionId: input.junctionId, expectedRevision: input.expectedRevision ?? null, definition, replacePending: input.replacePending === true });
};
const applyJunctionDefinition = (world, input) => {
  const command = normalizeJunctionDefinitionCommand(input), state = world.physicalJunctions, current = state.definitions.find(value => value.id === command.junctionId);
  if ((current?.revision ?? null) !== command.expectedRevision) return { status: 'stale', reason: 'stale-junction-authoring' };
  if (command.definition && current && JSON.stringify(command.definition) === JSON.stringify(current)) return { status: 'accepted', reason: 'junction-definition-unchanged', junctionId: command.junctionId, definitionRevision: current.revision };
  if (command.definition && current && command.definition.revision <= current.revision) return { status: 'rejected', reason: 'junction-revision-not-newer' };
  if (!current && command.definition && state.definitions.length >= 64 || !Number.isSafeInteger(state.revision + 1)) return { status: 'rejected', reason: 'junction-authoring-capacity' };
  const next = state.definitions.filter(value => value.id !== command.junctionId); if (command.definition) next.push(command.definition); next.sort((a, b) => a.id.localeCompare(b.id));
  state.definitions = Object.freeze(next); state.actual.delete(command.junctionId); state.revision++;
  return { status: 'accepted', reason: 'junction-definition-applied', junctionId: command.junctionId, definitionRevision: command.definition?.revision ?? null };
};
export { normalizeJunctionDefinitionCommand, applyJunctionDefinition };
