import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';
import { validatePhysicalJunction } from '../PhysicalJunctions.js';
import { validatePhysicalPorts, alignPhysicalPorts } from './physical/PhysicalPorts.js';
import { plain, identity, integer, freeze, copy } from './physical/PhysicalSchema.js';
import { readTerrainCell, inspectTerrainInfluence, planTerrainCommand, digestPlan } from '../TerrainAuthoringAdapter.js';
import { terrainScoreAt } from '../TerrainScoreLayer.js';
const GROUPS = ['pickups', 'ensembles', 'routes', 'harmonicFields', 'formations', 'topologyRegions', 'encounters', 'activityWindows', 'motifs', 'cargoStations', 'instruments'];
const LIMITS = Object.freeze({ cells: 8192, spans: 128, objects: 256, bytes: 524288, fragments: 32, libraryBytes: 8388608, instances: 128, nestedDepth: 0 });
const rectangle = value => { if (!plain(value) || ![value.x1, value.x2, value.y1, value.y2].every(Number.isSafeInteger) || value.x1 < 0 || value.y1 < 0 || value.x2 <= value.x1 || value.y2 <= value.y1 || value.x2 > 1e9 || value.y2 > 1e9 || (value.x2 - value.x1) * (value.y2 - value.y1) > LIMITS.cells) throw new Error('Fragment bounds exceed finite integer geometry.'); return { x1: value.x1, x2: value.x2, y1: value.y1, y2: value.y2 }; };
const within = (point, b, edge = false) => point.x >= b.x1 && point.y >= b.y1 && (edge ? point.x <= b.x2 && point.y <= b.y2 : point.x < b.x2 && point.y < b.y2);
const withinBounds = (inner, outer) => inner.x1 >= outer.x1 && inner.x2 <= outer.x2 && inner.y1 >= outer.y1 && inner.y2 <= outer.y2;
const flipDirection = direction => ({ left: 'right', right: 'left', positive: 'negative', negative: 'positive' }[direction] || direction);
const keyFor = (kind, id) => `${kind}:${id}`;
const selectorWalk = (selector, visit) => { visit(selector); for (const child of selector.selectors || []) selectorWalk(child, visit); };
const numericBindings = {
  pickups: { hysteresis: 'pixels', 'pitchMap.baseCents': 'cents', 'pitchMap.spanCents': 'cents' },
  harmonicFields: { priority: 'integer', width: 'pixels', 'coordinateMap.pixelsPerDegree': 'pixels/degree', 'coordinateMap.centsPerPixel': 'cents/pixel', slewSeconds: 'seconds' },
  formations: { spacingPixels: 'pixels', degreeStep: 'integer', hysteresisPixels: 'pixels', slewSeconds: 'seconds', 'register.minCents': 'cents', 'register.maxCents': 'cents' },
  encounters: { enterRadius: 'pixels', exitRadius: 'pixels', groupingToleranceTicks: 'ticks', 'response.gateTicks': 'ticks' },
  instruments: { pitchCents: 'cents', velocity01: 'ratio', probability01: 'ratio', 'articulation.spacingPixels': 'pixels' },
  topologyRegions: { 'mapping.basePitchCents': 'cents', 'mapping.referenceAreaPixels2': 'pixels2', 'mapping.areaCentsPerOctave': 'cents', 'mapping.boundaryDampingScale': 'ratio', 'mapping.openDamping01': 'ratio' }
};
const referencesFor = (graph, junctions) => {
  const refs = new Map(), add = (kind, id, required = true) => { if (id != null) refs.set(keyFor(kind, String(id)), { kind, id: String(id), required }); };
  for (const object of [...(graph.pickups || []), ...(graph.harmonicFields || [])]) { for (const lane of object.laneScope || []) add('lane', lane); if (object.materialTag) add('materialTag', object.materialTag); }
  for (const ensemble of graph.ensembles || []) {
    if (ensemble.captureBoundary.mode !== 'first-complete') throw new Error('Fragments cannot capture historical ensemble admission boundaries.');
    selectorWalk(ensemble.selector, selector => { if (selector.kind === 'actors') throw new Error('Fragments never copy live actor identities.'); if (['birthCohort', 'crewProject'].includes(selector.kind)) add(selector.kind, selector.id); if (selector.kind === 'lane') add('lane', selector.laneId); });
  }
  for (const activity of graph.activityWindows || []) { for (const lane of activity.scope.laneIds) add('lane', lane); if (activity.completionPolicy.crewProjectId) add('crewProject', activity.completionPolicy.crewProjectId); }
  for (const motif of graph.motifs || []) for (const clause of motif.clauses) if (clause.predicate.crewProjectId) add('crewProject', clause.predicate.crewProjectId);
  for (const rule of [...(graph.feedback?.conductors || []), ...(graph.feedback?.layers || []).flatMap(layer => layer.rules)]) { if (rule.target.kind === 'stable-actor') throw new Error('Fragments never copy a stable live feedback actor.'); if (rule.target.cohortId) add('birthCohort', rule.target.cohortId); for (const phase of rule.command.parameters.gesture?.lanePhase || []) add('lane', phase.laneId); if (rule.command.kind === 'junction-request' && !junctions.some(value => value.id === rule.command.parameters.request.junctionId)) { add('junction', rule.command.parameters.request.junctionId); add('junctionConfiguration', rule.command.parameters.request.configurationId); } }
  for (const layer of graph.feedback?.layers || []) for (const ref of layer.baseReferences) if (ref.kind === 'fragment') add('fragment', ref.id);
  for (const instrument of graph.instruments) { add('route', instrument.route, false); add('sampleKit', instrument.sampleKitId, false); }
  for (const region of graph.topologyRegions || []) { add('instrumentBody', region.mapping.bodyId, false); add('macro', region.mapping.dampingMacroId, false); }
  for (const junction of junctions) for (const config of junction.configurations) { add('material', config.materialId); add('materialTag', config.tag); }
  return [...refs.values()].sort((a, b) => keyFor(a.kind, a.id).localeCompare(keyFor(b.kind, b.id)));
};
const checkGraphBounds = (graph, junctions, ports, b) => {
  const points = points => { if (points.some(point => !within(point, b, true))) throw new Error('Fragment dependency geometry leaves its local bounds.'); };
  const bound = value => { if (!withinBounds(value, b)) throw new Error('Fragment dependency bounds are incomplete.'); };
  for (const object of [...(graph.pickups || []), ...(graph.harmonicFields || [])]) { if (object.geometry.kind === 'band') bound(object.geometry.bounds); else points(object.geometry.points); }
  for (const ensemble of graph.ensembles || []) selectorWalk(ensemble.selector, selector => { if (selector.kind === 'region') bound(selector.bounds); });
  for (const route of graph.routes || []) for (const segment of route.segments) { points(segment.path); segment.dependencies.forEach(dependency => bound(dependency.bounds)); }
  for (const activity of graph.activityWindows || []) if (activity.scope.region) bound(activity.scope.region);
  for (const motif of graph.motifs || []) for (const clause of motif.clauses) if (clause.predicate.region) bound(clause.predicate.region);
  for (const rule of [...(graph.feedback?.conductors || []), ...(graph.feedback?.layers || []).flatMap(layer => layer.rules)]) if (rule.source.region) bound(rule.source.region);
  for (const station of graph.cargoStations || []) if (station.source.region) bound(station.source.region);
  for (const encounter of graph.encounters || []) bound(encounter.region);
  for (const region of graph.topologyRegions || []) { bound(region.bounds); points(region.anchors); }
  for (const instrument of graph.instruments) if (instrument.sourceKind === 'MotionCommitted' && !instrument.articulation && (instrument.gateX < b.x1 || instrument.gateX > b.x2)) throw new Error('Fragment motion gate leaves local bounds.');
  for (const junction of junctions) { bound(junction.influence); bound(junction.control); points(junction.ports.map(port => port.position)); }
  points(ports.map(port => port.position));
};
export function validatePhysicalScoreFragment(input) {
  if (!plain(input) || input.version !== 1 || !identity(input.id) || input.id.length > 96 || !integer(input.revision) || !plain(input.source) || !identity(input.source.revision) || input.children?.length) throw new Error('Invalid fragment version/source, or unsupported nested containment.');
  const b = rectangle(input.bounds); if (b.x1 || b.y1 || !plain(input.pixelOrigin) || ![input.pixelOrigin.x, input.pixelOrigin.y].every(Number.isSafeInteger)) throw new Error('Fragment geometry must use a local integer origin.');
  const graph = validateCausalInstrumentGraph(input.graph), junctions = (input.junctions || []).map(validatePhysicalJunction), ports = validatePhysicalPorts(input.ports);
  if (junctions.length > 32 || new Set(junctions.map(value => value.id)).size !== junctions.length || GROUPS.reduce((sum, group) => sum + (graph[group]?.length || 0), junctions.length + (graph.feedback?.conductors.length || 0) + (graph.feedback?.layers || []).reduce((sum, layer) => sum + 1 + layer.rules.length, 0)) > LIMITS.objects) throw new Error('Fragment object capacity exceeded.');
  if (graph.swarm || graph.randomSeeds) throw new Error('Swarm reduction and namespace seeds are project-scoped and cannot be transplanted by a physical fragment.');
  checkGraphBounds(graph, junctions, ports, b);
  const spans = input.collision?.spans;
  if (!Array.isArray(spans) || !spans.length || spans.length > LIMITS.spans) throw new Error('Fragment collision span capacity exceeded.');
  let cells = 0; const rows = new Map();
  const collision = { spans: spans.map(span => {
    if (!plain(span) || ![span.x1, span.x2, span.y].every(Number.isSafeInteger) || span.x2 <= span.x1 || !within({ x: span.x1, y: span.y }, b) || !within({ x: span.x2 - 1, y: span.y }, b) || typeof span.solid !== 'boolean' || span.tag != null && !identity(span.tag) || span.materialId != null && !identity(span.materialId)) throw new Error('Invalid fragment collision or annotation span.');
    const row = rows.get(span.y) || []; if (row.some(prior => span.x1 < prior.x2 && span.x2 > prior.x1)) throw new Error('Overlapping fragment collision spans.'); row.push(span); rows.set(span.y, row); cells += span.x2 - span.x1;
    return { y: span.y, x1: span.x1, x2: span.x2, solid: span.solid, tag: span.tag ?? null, materialId: span.materialId ?? null };
  }) };
  if (cells > LIMITS.cells) throw new Error('Fragment cell capacity exceeded.');
  const assets = input.requiredAssets || [];
  if (!Array.isArray(assets) || assets.length > 64 || new Set(assets).size !== assets.length || assets.some(hash => !/^[a-f0-9]{64}$/.test(hash)) || junctions.some(junction => junction.requiredAssets.some(hash => !assets.includes(hash)))) throw new Error('Fragment source asset closure is incomplete.');
  const references = referencesFor(graph, junctions); for (const span of collision.spans) for (const [kind, id] of [['materialTag', span.tag], ['material', span.materialId]]) if (id && !references.some(ref => ref.kind === kind && ref.id === id)) references.push({ kind, id, required: true });
  const declared = input.externalReferences || [];
  if (!Array.isArray(declared) || declared.length > 512 || references.some(ref => !declared.some(value => value.kind === ref.kind && value.id === ref.id && value.policy === 'explicit-binding'))) throw new Error('Every external selector, material and sound reference needs an explicit binding declaration.');
  const parameters = input.parameters || [];
  if (!Array.isArray(parameters) || parameters.length > 64 || new Set(parameters.map(value => value.name)).size !== parameters.length) throw new Error('Invalid fragment parameter capacity.');
  const bindings = parameters.map(parameter => {
    const expected = numericBindings[parameter.group]?.[parameter.path], target = graph[parameter.group]?.find(value => value.id === parameter.objectId);
    if (!identity(parameter.name) || !expected || expected !== parameter.unit || !target || !Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || parameter.max < parameter.min || Math.abs(parameter.min) > 1e9 || Math.abs(parameter.max) > 1e9) throw new Error('Invalid typed fragment parameter binding.');
    const parts = parameter.path.split('.'); let value = target; for (const part of parts) value = value?.[part]; if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) throw new Error('Fragment parameter default is unavailable or outside bounds.');
    return { name: parameter.name, group: parameter.group, objectId: parameter.objectId, path: parameter.path, unit: expected, min: parameter.min, max: parameter.max, default: value };
  });
  const allowed = input.allowedInterventions || [];
  if (!Array.isArray(allowed) || allowed.length > 8 || new Set(allowed).size !== allowed.length || allowed.some(kind => !['assign-worker', 'place-blocker', 'release-blocker', 'junction-request', 'set-release-policy', 'set-release-gesture'].includes(kind))) throw new Error('Unsupported fragment intervention capability.');
  if ([...(graph.feedback?.conductors || []), ...(graph.feedback?.layers || []).flatMap(layer => layer.rules)].some(rule => !allowed.includes(rule.command.kind))) throw new Error('Fragment feedback exceeds explicitly authored intervention capabilities.');
  const result = { version: 1, id: input.id, revision: input.revision, source: { revision: input.source.revision, projectId: identity(input.source.projectId) ? input.source.projectId : null },
    bounds: b, pixelOrigin: { x: input.pixelOrigin.x, y: input.pixelOrigin.y }, requiredAssets: [...assets], collision, graph, junctions, ports,
    externalReferences: references.map(ref => ({ ...ref, policy: 'explicit-binding' })), parameters: bindings, allowedInterventions: [...allowed], children: [], runtimeState: 'not-captured' };
  if (JSON.stringify(result).length * 2 > LIMITS.bytes) throw new Error('Fragment byte capacity exceeded.'); return freeze(result);
}
const transformContent = (input, { dx, dy, reflect = false, width = 0, preservePortEvidence = false }, rename = (_kind, id) => id, external = (_kind, id) => id) => {
  const graph = copy(input.graph), junctions = copy(input.junctions || []), ports = copy(input.ports || []);
  const point = value => ({ ...value, x: dx + (reflect ? width - 1 - value.x : value.x), y: dy + value.y });
  const bound = value => ({ x1: dx + (reflect ? width - value.x2 : value.x1), x2: dx + (reflect ? width - value.x1 : value.x2), y1: dy + value.y1, y2: dy + value.y2 });
  const span = value => ({ ...value, ...bound({ x1: value.x1, x2: value.x2, y1: value.y, y2: value.y + 1 }), y: dy + value.y });
  const port = value => ({ ...value, id: rename('port', value.id), position: point(value.position), direction: reflect ? flipDirection(value.direction) : value.direction, support: value.support.map(cell => ({ ...cell, dx: reflect ? -cell.dx : cell.dx })), traversalEnvelope: preservePortEvidence ? value.traversalEnvelope : null });
  const remapSelector = selector => { if (selector.selectors) selector.selectors.forEach(remapSelector); if (selector.kind === 'region') selector.bounds = bound(selector.bounds); if (selector.kind === 'route') { selector.routeId = rename('routes', selector.routeId); if (selector.branchId) selector.branchId = rename('branch', selector.branchId); } if (selector.kind === 'lane') selector.laneId = Number(external('lane', String(selector.laneId))); if (['birthCohort', 'crewProject'].includes(selector.kind)) selector.id = external(selector.kind, selector.id); };
  for (const group of GROUPS) for (const object of graph[group] || []) {
    object.id = rename(group, object.id);
    for (const [key, kind] of [['ensembleId', 'ensembles'], ['routeId', 'routes'], ['pickupId', 'pickups'], ['formationId', 'formations'], ['topologyRegionId', 'topologyRegions'], ['encounterId', 'encounters'], ['motifId', 'motifs'], ['activityWindowId', 'activityWindows'], ['cargoStationId', 'cargoStations']]) if (object[key]) object[key] = rename(kind, object[key]);
    if (group === 'instruments' && object.topologyAnchorId) object.topologyAnchorId = rename('anchor', object.topologyAnchorId);
    if (object.response) for (const [key, kind] of [['ensembleId', 'ensembles'], ['routeId', 'routes'], ['pickupId', 'pickups']]) if (object.response[key]) object.response[key] = rename(kind, object.response[key]);
    if (object.geometry) { if (object.geometry.kind === 'band') object.geometry.bounds = bound(object.geometry.bounds); else object.geometry.points = object.geometry.points.map(point); }
    if (object.laneScope) object.laneScope = object.laneScope.map(id => Number(external('lane', String(id))));
    if (object.materialTag) object.materialTag = external('materialTag', object.materialTag);
    if (group === 'cargoStations') { if (object.source.kind !== 'contact') object.source.id = rename(object.source.kind === 'pickup' ? 'pickups' : 'encounters', object.source.id); if (object.source.region) object.source.region = bound(object.source.region); if (reflect) object.source.direction = flipDirection(object.source.direction); }
    if (group === 'activityWindows') { const scope = object.scope; scope.laneIds = scope.laneIds.map(id => Number(external('lane', String(id)))); if (scope.region) scope.region = bound(scope.region); for (const [key, kind] of [['ensembleId', 'ensembles'], ['routeId', 'routes'], ['topologyRegionId', 'topologyRegions']]) if (scope[key]) scope[key] = rename(kind, scope[key]); if (object.completionPolicy.crewProjectId) object.completionPolicy.crewProjectId = external('crewProject', object.completionPolicy.crewProjectId); }
    if (group === 'motifs') { for (const role of object.roles) if (role.ensembleId) role.ensembleId = rename('ensembles', role.ensembleId); for (const clause of object.clauses) { const predicate = clause.predicate; for (const [key, kind] of [['pickupId', 'pickups'], ['routeId', 'routes'], ['encounterId', 'encounters'], ['activityWindowId', 'activityWindows'], ['cargoStationId', 'cargoStations']]) if (predicate[key]) predicate[key] = rename(kind, predicate[key]); if (predicate.crewProjectId) predicate.crewProjectId = external('crewProject', predicate.crewProjectId); if (predicate.region) predicate.region = bound(predicate.region); if (reflect && predicate.direction) predicate.direction = flipDirection(predicate.direction); } }
    if (group === 'encounters') { object.region = bound(object.region); for (const key of ['leftEnsembleId', 'rightEnsembleId']) if (object.participants[key]) object.participants[key] = rename('ensembles', object.participants[key]); }
    if (group === 'ensembles') remapSelector(object.selector);
    if (group === 'pickups' && reflect) object.directionPolicy = flipDirection(object.directionPolicy);
    if (group === 'routes') { object.branchId = rename('branch', object.branchId); object.markers = object.markers.map(marker => ({ gateId: rename('pickups', marker.gateId), direction: reflect ? flipDirection(marker.direction) : marker.direction })); for (const segment of object.segments) { segment.id = rename('segment', segment.id); segment.path = segment.path.map(point); segment.dependencies = segment.dependencies.map(dependency => ({ ...dependency, bounds: bound(dependency.bounds), terrainRevision: 0 })); } }
    if (group === 'harmonicFields') { const map = object.coordinateMap; if (map.mode.startsWith('x-')) { map.origin = point({ x: map.origin, y: 0 }).x; if (reflect) { if (map.mode === 'x-degrees') throw new Error('Reflected discrete coordinate tuning requires a separately authored mapping.'); map.centsPerPixel *= -1; } } else if (map.mode.startsWith('y-')) map.origin += dy; }
    if (group === 'topologyRegions') { object.bounds = bound(object.bounds); object.anchors = object.anchors.map(anchor => ({ ...point(anchor), id: rename('anchor', anchor.id) })); object.mapping.bodyId = external('instrumentBody', object.mapping.bodyId); if (object.mapping.dampingMacroId) object.mapping.dampingMacroId = external('macro', object.mapping.dampingMacroId); }
    if (group === 'instruments') { object.route = external('route', object.route); if (object.sampleKitId) object.sampleKitId = external('sampleKit', object.sampleKitId); if (object.gateX != null) object.gateX = point({ x: object.gateX, y: 0 }).x; if (reflect) object.crossingDirection = flipDirection(object.crossingDirection); if (reflect && object.articulation?.orientation === 'signedX') throw new Error('Signed-X articulation reflection needs a separately authored orientation policy.'); }
  }
  if (graph.feedback) {
    for (const layer of graph.feedback.layers) { layer.id = rename('feedback-layer', layer.id); layer.enabled = false; for (const ref of layer.baseReferences) ref.id = ref.kind === 'route' ? rename('routes', ref.id) : external('fragment', ref.id); }
    for (const rule of [...graph.feedback.conductors, ...graph.feedback.layers.flatMap(layer => layer.rules)]) { rule.id = rename('feedback-rule', rule.id); rule.enabled = false; for (const [key, kind] of [['pickupId', 'pickups'], ['motifId', 'motifs'], ['cargoStationId', 'cargoStations'], ['ensembleId', 'ensembles'], ['routeId', 'routes']]) if (rule.source[key]) rule.source[key] = rename(kind, rule.source[key]); if (rule.source.region) rule.source.region = bound(rule.source.region); if (reflect) rule.source.direction = flipDirection(rule.source.direction); if (rule.target.cohortId) rule.target.cohortId = external('birthCohort', rule.target.cohortId); if (rule.command.parameters.targetX != null) rule.command.parameters.targetX = point({ x: rule.command.parameters.targetX, y: 0 }).x; for (const phase of rule.command.parameters.gesture?.lanePhase || []) phase.laneId = Number(external('lane', String(phase.laneId))); if (rule.command.kind === 'junction-request') { const request = rule.command.parameters.request; const internal = junctions.some(value => value.id === request.junctionId); request.junctionId = internal ? rename('junction', request.junctionId) : external('junction', request.junctionId); request.configurationId = internal ? rename('configuration', request.configurationId) : external('junctionConfiguration', request.configurationId); delete request.expectedRegionRevisionSet; } }
  }
  for (const junction of junctions) { junction.id = rename('junction', junction.id); junction.control = bound(junction.control); junction.influence = bound(junction.influence); junction.ports = junction.ports.map(port); junction.configurations = junction.configurations.map(config => ({ ...config, id: rename('configuration', config.id), spans: config.spans.map(span), outletIds: config.outletIds.map(id => rename('port', id)), materialId: config.materialId ? external('material', config.materialId) : null, tag: config.tag ? external('materialTag', config.tag) : null })); }
  return { graph, junctions, ports: ports.map(port), spans: input.collision.spans.map(value => ({ ...span(value), tag: value.tag ? external('materialTag', value.tag) : null, materialId: value.materialId ? external('material', value.materialId) : null })) };
};
export function capturePhysicalScoreFragment(world, { id, revision = 1, source, bounds, graph, junctions = [], ports = [], parameters = [], allowedInterventions = [] }) {
  if (world._stepping || world._disposed) throw new Error('Fragment capture needs a quiescent world.');
  const b = rectangle(bounds), spans = [], influence = inspectTerrainInfluence(world, b);
  if (influence.status === 'unsupported') throw new Error('Fragment capture excludes unknown or protected source objects: ' + influence.reason);
  for (let y = b.y1; y < b.y2; y++) for (let x = b.x1; x < b.x2; x++) {
    const cell = readTerrainCell(world, x, y), annotation = terrainScoreAt(world, x, y);
    if (cell.status !== 'complete' || annotation.status !== 'complete' || cell.steel) throw new Error('Fragment capture source is unknown, expired or protected.');
    const previous = spans.at(-1), solid = !!cell.color, tag = annotation.tag ?? null, materialId = annotation.materialId ?? null;
    if (previous && previous.y === y && previous.x2 === x && previous.solid === solid && previous.tag === tag && previous.materialId === materialId) previous.x2++;
    else spans.push({ y, x1: x, x2: x + 1, solid, tag, materialId });
    if (spans.length > LIMITS.spans) throw new Error('Fragment collision span capacity exceeded.');
  }
  const canonicalGraph = validateCausalInstrumentGraph(graph), canonicalJunctions = junctions.map(validatePhysicalJunction), canonicalPorts = validatePhysicalPorts(ports);
  checkGraphBounds(canonicalGraph, canonicalJunctions, canonicalPorts, b);
  const transformed = transformContent({ graph: canonicalGraph, junctions: canonicalJunctions, ports: canonicalPorts, collision: { spans } }, { dx: -b.x1, dy: -b.y1, preservePortEvidence: true });
  const requiredAssets = (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain?.recipe?.assetSha256 ?? terrain?.sourceDescriptor?.sourceRevision).filter(Boolean);
  const externalReferences = referencesFor(transformed.graph, transformed.junctions); for (const span of spans) for (const [kind, value] of [['materialTag', span.tag], ['material', span.materialId]]) if (value && !externalReferences.some(ref => ref.kind === kind && ref.id === value)) externalReferences.push({ kind, id: value });
  return validatePhysicalScoreFragment({ version: 1, id, revision, source, bounds: { x1: 0, y1: 0, x2: b.x2 - b.x1, y2: b.y2 - b.y1 }, pixelOrigin: { x: b.x1, y: b.y1 }, requiredAssets: [...new Set(requiredAssets)], collision: { spans: transformed.spans }, ...transformed,
    externalReferences: externalReferences.map(ref => ({ ...ref, policy: 'explicit-binding' })), parameters, allowedInterventions });
}
export const fragmentSignature = fragment => digestPlan(validatePhysicalScoreFragment(fragment));
function realizePhysicalScoreFragment(input, { namespace, x, y, transform = 'translate', bindings = {}, parameters = {}, reflectionEvidence = null } = {}, qualificationOnly = false) {
  const fragment = validatePhysicalScoreFragment(input);
  if (!identity(namespace) || namespace.length > 48 || ![x, y].every(value => integer(value, 1e9)) || !['translate', 'reflect-x'].includes(transform) || !plain(bindings) || !plain(parameters)) throw new Error('Invalid fragment instance identity or transform.');
  const signature = fragmentSignature(fragment);
  if (!qualificationOnly && transform === 'reflect-x' && (reflectionEvidence?.schema !== 'physical-fragment-transform-qualification/v1' || reflectionEvidence.fragmentSignature !== signature || reflectionEvidence.transform !== 'reflect-x' || reflectionEvidence.status !== 'qualified-tested-cases' || reflectionEvidence.sourceRevision !== fragment.source.revision || reflectionEvidence.placement?.x !== x || reflectionEvidence.placement?.y !== y || !Array.isArray(reflectionEvidence.results) || !reflectionEvidence.results.length || reflectionEvidence.results.length > 64 || reflectionEvidence.results.some(result => [result.baseline, result.realized].some(run => run?.qualification?.status !== 'engine-qualified' || run.actualReplay?.replaySummary?.verified !== true)) || JSON.stringify(reflectionEvidence).length * 2 > 1048576)) throw new Error('Horizontal reflection requires pinned real-runtime transform qualification.');
  const graph = copy(fragment.graph), appliedParameters = {};
  for (const [name, value] of Object.entries(parameters)) { const binding = fragment.parameters.find(parameter => parameter.name === name); if (!binding || !Number.isFinite(value) || value < binding.min || value > binding.max || binding.unit === 'integer' && !Number.isInteger(value)) throw new Error('Invalid fragment parameter value.'); const target = graph[binding.group].find(object => object.id === binding.objectId), parts = binding.path.split('.'); let parent = target; for (const key of parts.slice(0, -1)) parent = parent[key]; parent[parts.at(-1)] = value; appliedParameters[name] = value; }
  if (!qualificationOnly && transform === 'reflect-x' && Object.keys(parameters).length) throw new Error('Parameterized reflection needs new realized-instance qualification.');
  const unresolved = [], remapping = new Map();
  const rename = (kind, id) => { const key = keyFor(kind, id); if (!remapping.has(key)) { const value = `${namespace}/${kind}/${id}`; if (!identity(value) || value.length > (kind === 'junction' ? 96 : kind === 'configuration' ? 64 : 128)) throw new Error('Fragment namespace expansion exceeds target identity capacity.'); remapping.set(key, value); } return remapping.get(key); };
  const external = (kind, id) => { const key = keyFor(kind, String(id)), declared = fragment.externalReferences.find(ref => ref.kind === kind && ref.id === String(id)); if (!declared) throw new Error('Undeclared fragment external dependency.'); const value = bindings[key]; if (value == null) { if (!unresolved.some(ref => ref.kind === kind && ref.id === String(id))) unresolved.push(declared); return kind === 'lane' ? 0 : `unresolved:${namespace}:${kind}`; } if (kind === 'lane' ? !integer(value, 1023) : !identity(value) || value.length > 128) throw new Error('Invalid explicit fragment binding.'); return value; };
  for (const key of Object.keys(bindings)) if (!fragment.externalReferences.some(ref => keyFor(ref.kind, ref.id) === key)) throw new Error('Unknown fragment external binding.');
  const transformed = transformContent({ ...fragment, graph }, { dx: x, dy: y, reflect: transform === 'reflect-x', width: fragment.bounds.x2 }, rename, external);
  for (const instrument of transformed.graph.instruments) if (unresolved.some(ref => !ref.required)) instrument.mute = true;
  const instance = { version: 1, id: namespace, fragmentId: fragment.id, fragmentRevision: fragment.revision, fragmentSignature: signature,
    source: fragment.source, transform: { kind: transform, x, y }, parameters: appliedParameters, bindings: { ...bindings }, objectIds: { ...Object.fromEntries(GROUPS.map(group => [group, (transformed.graph[group] || []).map(object => object.id)])), feedbackLayers: (transformed.graph.feedback?.layers || []).map(layer => layer.id), feedbackRules: [...(transformed.graph.feedback?.conductors || []), ...(transformed.graph.feedback?.layers || []).flatMap(layer => layer.rules)].map(rule => rule.id) }, junctionIds: transformed.junctions.map(junction => junction.id),
    ancestry: { fragmentId: fragment.id, revision: fragment.revision, sourceRevision: fragment.source.revision }, detached: false, timing: 'requires-realized-route-replay' };
  return freeze({ status: qualificationOnly ? 'qualification-only' : unresolved.some(ref => ref.required) ? 'unresolved' : 'prepared', fragment, instance, graph: validateCausalInstrumentGraph(transformed.graph), junctions: transformed.junctions.map(validatePhysicalJunction), ports: validatePhysicalPorts(transformed.ports), collision: { spans: transformed.spans }, unresolved, remapping: [...remapping], reflectionEvidence: reflectionEvidence ? copy(reflectionEvidence) : null });
}
export const instantiatePhysicalScoreFragment = (fragment, options) => realizePhysicalScoreFragment(fragment, options);
export const createFragmentQualificationCandidate = (fragment, options) => realizePhysicalScoreFragment(fragment, options, true);
export function planPhysicalScoreFragment(world, project, fragment, options = {}) {
  const prepared = instantiatePhysicalScoreFragment(fragment, options), issues = [];
  const assets = new Set((world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain?.recipe?.assetSha256 ?? terrain?.sourceDescriptor?.sourceRevision));
  for (const hash of prepared.fragment.requiredAssets) if (!assets.has(hash)) issues.push({ kind: 'source-asset', hash });
  for (const ref of prepared.unresolved) if (ref.required) issues.push({ kind: 'unresolved-reference', reference: ref });
  if ((project.procgen.fragmentInstances || []).some(instance => instance.id === prepared.instance.id)) issues.push({ kind: 'instance-identity-collision' });
  for (const group of GROUPS) for (const object of prepared.graph[group] || []) if (project.procgen.physicalGraph[group]?.some(value => value.id === object.id)) issues.push({ kind: 'object-identity-collision', group, id: object.id });
  for (const junction of prepared.junctions) if (project.procgen.junctions?.some(value => value.id === junction.id)) issues.push({ kind: 'junction-identity-collision', id: junction.id });
  const terrain = planTerrainCommand({ operation: 'replaceSolid', transactionId: `fragment:${prepared.instance.id}`, generation: world.generation, annotationPolicy: 'replace', spans: prepared.collision.spans }, world);
  if (terrain.status !== 'prepared') issues.push({ kind: 'terrain-conflict', reason: terrain.reason, conflicts: terrain.rejected });
  if (options.connections != null && (!Array.isArray(options.connections) || options.connections.length > 16)) throw new Error('Fragment connection capacity exceeded.');
  const alignments = (options.connections || []).map(connection => { const port = prepared.ports.find(value => value.id === connection.instancePortId); if (!port) throw new Error('Unknown fragment connection port.'); const result = port.role === 'inlet' ? alignPhysicalPorts(connection.externalPort, port) : alignPhysicalPorts(port, connection.externalPort); if (result.status !== 'compatible-declaration') issues.push({ kind: 'port-incompatible', portId: port.id, reasons: result.reasons }); return { portId: port.id, ...result }; });
  const graph = { ...project.procgen.physicalGraph, revision: project.procgen.physicalGraph.revision + 1, editCommandId: `fragment:${prepared.instance.id}` };
  for (const group of GROUPS) if (prepared.graph[group]?.length) graph[group] = [...(graph[group] || []), ...prepared.graph[group]];
  if (prepared.graph.feedback) graph.feedback = { version: 1, conductors: [...(graph.feedback?.conductors || []), ...prepared.graph.feedback.conductors], layers: [...(graph.feedback?.layers || []), ...prepared.graph.feedback.layers] };
  const merged = validateCausalInstrumentGraph(graph);
  return freeze({ ...prepared, status: issues.length ? 'blocked' : 'prepared', issues, terrain, mergedGraph: merged, alignments, generation: world.generation, tick: world.tickIndex, projectGraphRevision: project.procgen.physicalGraph.revision, previewHardwareNotes: false });
}

export function fragmentPlacementCommand(world, project, plan, commandId) {
  if (plan?.status !== 'prepared' || !identity(commandId) || commandId.length > 128 || world._disposed || world.generation !== plan.generation || world.tickIndex !== plan.tick || project.procgen.physicalGraph.revision !== plan.projectGraphRevision || JSON.stringify(world.physicalAuthoring.graph) !== JSON.stringify(project.procgen.physicalGraph)) throw new Error('Fragment placement plan is stale or blocked.');
  const transactionId = plan.terrain.command.transactionId;
  return freeze({ id: commandId, transactionId, kind: 'physical-authoring', origin: 'manual', target: { generation: world.generation }, parameters: { authoring: {
    version: 1, operation: 'fragment-place', transactionId, expectedRevision: world.physicalAuthoring.revision, expectedJunctionRevision: world.physicalJunctions.revision, expectedGraphDigest: digestPlan(world.physicalAuthoring.graph),
    graph: plan.mergedGraph, instances: [...(project.procgen.fragmentInstances || []), plan.instance], junctions: [...(project.procgen.junctions || []), ...plan.junctions], terrain: plan.terrain.command, instanceId: plan.instance.id, requiredAssets: plan.fragment.requiredAssets
  } } });
}
export function validateFragmentLibrary(values = []) {
  if (!Array.isArray(values) || values.length > LIMITS.fragments) throw new Error('Fragment library capacity exceeded.'); const fragments = values.map(validatePhysicalScoreFragment);
  if (new Set(fragments.map(value => value.id)).size !== fragments.length || JSON.stringify(fragments).length * 2 > LIMITS.libraryBytes) throw new Error('Fragment library identity or byte capacity exceeded.'); return freeze(fragments);
}
export function validateFragmentInstances(values = []) {
  if (!Array.isArray(values) || values.length > LIMITS.instances || new Set(values.map(value => value.id)).size !== values.length) throw new Error('Fragment instance capacity or identity exceeded.');
  return freeze(values.map(value => {
    if (!plain(value) || value.version !== 1 || !identity(value.id) || value.id.length > 48 || !identity(value.fragmentId) || !integer(value.fragmentRevision) || !/^[a-f0-9]{8}$/.test(value.fragmentSignature) || !plain(value.transform) || !['translate', 'reflect-x'].includes(value.transform.kind) || ![value.transform.x, value.transform.y].every(n => integer(n, 1e9)) || !plain(value.objectIds) || !Array.isArray(value.junctionIds) || !plain(value.source) || !identity(value.source.revision) || !plain(value.parameters) || !plain(value.bindings)) throw new Error('Invalid pinned fragment instance.');
    const objectIds = {}; for (const group of [...GROUPS, 'feedbackLayers', 'feedbackRules']) { const ids = value.objectIds[group] || []; if (!Array.isArray(ids) || ids.length > LIMITS.objects || ids.some(id => !identity(id) || id.length > 128)) throw new Error('Invalid fragment object ancestry.'); objectIds[group] = [...ids]; }
    if (value.junctionIds.length > 32 || value.junctionIds.some(id => !identity(id) || id.length > 96) || Object.keys(value.parameters).length > 64 || Object.entries(value.parameters).some(([key, val]) => !identity(key) || !Number.isFinite(val)) || Object.keys(value.bindings).length > 512 || Object.entries(value.bindings).some(([key, val]) => key.length > 512 || !(typeof val === 'string' && identity(val) || integer(val, 1023)))) throw new Error('Invalid fragment bindings or junction ancestry.');
    return { version: 1, id: value.id, fragmentId: value.fragmentId, fragmentRevision: value.fragmentRevision, fragmentSignature: value.fragmentSignature, source: { revision: value.source.revision, projectId: value.source.projectId ?? null }, transform: { kind: value.transform.kind, x: value.transform.x, y: value.transform.y }, parameters: { ...value.parameters }, bindings: { ...value.bindings }, objectIds, junctionIds: [...value.junctionIds], ancestry: { fragmentId: value.fragmentId, revision: value.fragmentRevision, sourceRevision: value.source.revision }, detached: value.detached === true, timing: 'requires-realized-route-replay' };
  }));
}
export { GROUPS as FRAGMENT_GRAPH_GROUPS, LIMITS as PHYSICAL_FRAGMENT_LIMITS };

export function selectSpatialFragmentGraph(input, bounds) {
  const graph = validateCausalInstrumentGraph(input), b = rectangle(bounds), selected = { version: 1, revision: graph.revision, seed: graph.seed, instruments: [] };
  const shapeInside = shape => shape.kind === 'band' ? withinBounds(shape.bounds, b) : shape.points.every(point => within(point, b, true));
  selected.ensembles = (graph.ensembles || []).filter(ensemble => {
    let eligible = ensemble.captureBoundary.mode === 'first-complete'; selectorWalk(ensemble.selector, selector => { if (['actors', 'route', 'birthCohort', 'crewProject'].includes(selector.kind) || selector.kind === 'region' && !withinBounds(selector.bounds, b)) eligible = false; }); return eligible;
  });
  const ensembleAvailable = id => !id || selected.ensembles.some(value => value.id === id);
  selected.pickups = (graph.pickups || []).filter(pickup => shapeInside(pickup.geometry) && ensembleAvailable(pickup.ensembleId));
  selected.harmonicFields = (graph.harmonicFields || []).filter(field => shapeInside(field.geometry) && ensembleAvailable(field.ensembleId));
  selected.routes = (graph.routes || []).filter(route => route.markers.every(marker => selected.pickups.some(pickup => pickup.id === marker.gateId)) && route.segments.every(segment => segment.path.every(point => within(point, b, true)) && segment.dependencies.every(dependency => withinBounds(dependency.bounds, b))));
  selected.formations = (graph.formations || []).filter(formation => ensembleAvailable(formation.ensembleId) && (!formation.routeId || selected.routes.some(route => route.id === formation.routeId)));
  selected.topologyRegions = (graph.topologyRegions || []).filter(region => withinBounds(region.bounds, b));
  selected.encounters = (graph.encounters || []).filter(value => withinBounds(value.region, b) && ensembleAvailable(value.participants.leftEnsembleId) && ensembleAvailable(value.participants.rightEnsembleId) && (!value.routeId || selected.routes.some(route => route.id === value.routeId)) && (!value.pickupId || selected.pickups.some(pickup => pickup.id === value.pickupId)));
  selected.activityWindows = (graph.activityWindows || []).filter(value => (!value.scope.region || withinBounds(value.scope.region, b)) && ensembleAvailable(value.scope.ensembleId) && (!value.scope.routeId || selected.routes.some(route => route.id === value.scope.routeId)) && (!value.scope.topologyRegionId || selected.topologyRegions.some(region => region.id === value.scope.topologyRegionId)) && (value.scope.region || value.scope.ensembleId || value.scope.routeId || value.scope.topologyRegionId));
  selected.motifs = (graph.motifs || []).filter(value => value.roles.every(role => ensembleAvailable(role.ensembleId)) && value.clauses.every(clause => { const predicate = clause.predicate; return (predicate.region && withinBounds(predicate.region, b) || predicate.pickupId || predicate.routeId || predicate.encounterId || predicate.activityWindowId) && (!predicate.pickupId || selected.pickups.some(value => value.id === predicate.pickupId)) && (!predicate.routeId || selected.routes.some(value => value.id === predicate.routeId)) && (!predicate.encounterId || selected.encounters.some(value => value.id === predicate.encounterId)) && (!predicate.activityWindowId || selected.activityWindows.some(value => value.id === predicate.activityWindowId)); }));
  selected.instruments = graph.instruments.filter(instrument => {
    const pickup = instrument.pickupId || instrument.response?.pickupId, route = instrument.routeId || instrument.response?.routeId;
    const positioned = instrument.activityWindowId || instrument.motifId || instrument.encounterId || pickup || route || instrument.topologyRegionId || instrument.harmonicFields && instrument.ensembleId && selected.harmonicFields.length;
    return positioned && (!instrument.activityWindowId || selected.activityWindows.some(value => value.id === instrument.activityWindowId)) && (!instrument.motifId || selected.motifs.some(value => value.id === instrument.motifId)) && (!instrument.encounterId || selected.encounters.some(value => value.id === instrument.encounterId)) && (!pickup || selected.pickups.some(value => value.id === pickup)) && (!route || selected.routes.some(value => value.id === route)) && ensembleAvailable(instrument.ensembleId) && ensembleAvailable(instrument.response?.ensembleId) && (!instrument.formationId || selected.formations.some(value => value.id === instrument.formationId)) && (!instrument.topologyRegionId || selected.topologyRegions.some(value => value.id === instrument.topologyRegionId));
  });
  return validateCausalInstrumentGraph(selected);
}
