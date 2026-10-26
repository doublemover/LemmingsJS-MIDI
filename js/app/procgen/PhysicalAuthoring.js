import { preparePhysicalGraphAdmission } from './PhysicalGraphAdmission.js';
import { validateCausalInstrumentGraph } from './workstation/CausalMusicEngine.js';
import { validateFragmentInstances } from './workstation/PhysicalScoreFragment.js';
import { validateProjectJunctions } from './workstation/PhysicalJunctionProject.js';
import { normalizeTerrainCommand, planTerrainCommand, prepareTerrainPublication, digestPlan } from './TerrainAuthoringAdapter.js';
import { prepareTerrainTopologyConfiguration } from './ProcgenTerrainTopology.js';
import { recordProcgenRecoveryAuthoring } from './workstation/ProcgenRecoveryJournal.js';
import { plain, integer, identity, freeze } from './workstation/physical/PhysicalSchema.js';
const MAX_BYTES = 524288;
const createPhysicalAuthoringState = () => ({ version: 1, revision: 0, graph: null, instances: [], lastApplied: null });
const preparePhysicalAuthoringConfiguration = (world, graph, instances = []) => {
  if (world._disposed || world._stepping) throw new Error('Physical authoring needs a quiescent boundary.');
  const state = world.physicalAuthoring, nextGraph = validateCausalInstrumentGraph(graph), nextInstances = validateFragmentInstances(instances);
  if (JSON.stringify({ graph: nextGraph, instances: nextInstances }).length * 2 > 4 * 1048576) throw new Error('Physical authoring owner capacity exceeded.');
  const oldGraph = state.graph, oldInstances = state.instances, changed = JSON.stringify(oldGraph) !== JSON.stringify(nextGraph) || JSON.stringify(oldInstances) !== JSON.stringify(nextInstances);
  if (oldGraph && JSON.stringify(oldGraph) !== JSON.stringify(nextGraph) && nextGraph.revision <= oldGraph.revision) throw new Error('Changed physical authoring graph requires a newer revision.');
  const topology = prepareTerrainTopologyConfiguration(world, nextGraph.topologyRegions || []); let committed = false, admission = null;
  const admit = () => admission ||= preparePhysicalGraphAdmission(world, nextGraph);
  return { admit, cancel: () => admission?.cancel(), commit() { if (committed) return changed; if (world._disposed || world._stepping || world.physicalAuthoring !== state || state.graph !== oldGraph || state.instances !== oldInstances) throw new Error('Physical authoring configuration is stale.');
    admit().commit(); topology.commit(); if (changed) { state.graph = nextGraph; state.instances = nextInstances; recordProcgenRecoveryAuthoring(world, { graph: nextGraph, instances: nextInstances }); } committed = true; return changed;
  } };
};
const normalizePhysicalAuthoringCommand = (world, input) => {
  if (!plain(input) || input.version !== 1 || !identity(input.transactionId) || !integer(input.expectedRevision) || !integer(input.expectedJunctionRevision) || !identity(input.expectedGraphDigest) || !['fragment-place', 'terrain-and-graph'].includes(input.operation) || input.instanceId != null && !identity(input.instanceId)) throw new Error('Invalid atomic physical authoring command.');
  const graph = validateCausalInstrumentGraph(input.graph), instances = validateFragmentInstances(input.instances), junctions = validateProjectJunctions(input.junctions), terrain = normalizeTerrainCommand(input.terrain);
  if (terrain.transactionId !== input.transactionId || terrain.generation !== world.generation) throw new Error('Physical authoring target identity or graph revision is stale.');
  if (input.operation === 'fragment-place' && (!input.instanceId || !instances.some(instance => instance.id === input.instanceId))) throw new Error('Fragment instance is missing or already placed.');
  const assets = input.requiredAssets || []; if (!Array.isArray(assets) || assets.length > 64 || assets.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid physical authoring source dependencies.');
  const result = { version: 1, operation: input.operation, transactionId: input.transactionId, expectedRevision: input.expectedRevision, expectedJunctionRevision: input.expectedJunctionRevision, expectedGraphDigest: input.expectedGraphDigest,
    graph, instances, junctions, terrain, instanceId: input.instanceId ?? null, requiredAssets: [...assets] };
  if (JSON.stringify(result).length * 2 > MAX_BYTES) throw new Error('Physical authoring transaction byte capacity exceeded.'); return freeze(result);
};
const preparePhysicalAuthoringCommand = (world, input) => {
  const command = normalizePhysicalAuthoringCommand(world, input), state = world.physicalAuthoring, junctionState = world.physicalJunctions;
  if (state.revision !== command.expectedRevision || junctionState.revision !== command.expectedJunctionRevision || digestPlan(state.graph) !== command.expectedGraphDigest) return { status: 'stale', reason: 'stale-authoring-owner' };
  if (command.graph.revision <= (state.graph?.revision ?? -1) || command.operation === 'fragment-place' && state.instances.some(instance => instance.id === command.instanceId)) return { status: 'stale', reason: 'stale-authoring-graph-or-instance' };
  const assets = (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain?.recipe?.assetSha256 ?? terrain?.sourceDescriptor?.sourceRevision);
  if (world.terrain?.sceneTerrainLayoutHash) assets.push(world.terrain.sceneTerrainLayoutHash);
  if (command.requiredAssets.some(hash => !assets.includes(hash))) return { status: 'rejected', reason: 'authoring-source-mismatch' };
  if (!Number.isSafeInteger(state.revision + 1) || !Number.isSafeInteger(junctionState.revision + 1)) throw new RangeError('Physical authoring revision exhausted.');
  for (const definition of command.junctions) { const prior = junctionState.definitions.find(value => value.id === definition.id); if (prior && JSON.stringify(prior) !== JSON.stringify(definition) && definition.revision <= prior.revision) throw new Error('Changed junction requires a newer revision.'); }
  const topology = prepareTerrainTopologyConfiguration(world, command.graph.topologyRegions || []), terrain = planTerrainCommand(command.terrain, world);
  if (terrain.status !== 'prepared') return { status: 'rejected', reason: terrain.reason, counts: terrain.counts };
  const nextActual = new Map([...junctionState.actual].filter(([id, actual]) => command.junctions.some(definition => definition.id === id && definition.revision === actual.authoringRevision)));
  const junctionsChanged = JSON.stringify(command.junctions) !== JSON.stringify(junctionState.definitions);
  const next = { version: 1, revision: state.revision + 1, graph: command.graph, instances: command.instances,
    lastApplied: freeze({ transactionId: command.transactionId, operation: command.operation, instanceId: command.instanceId, generation: world.generation, tick: world.tickIndex, revision: state.revision + 1, graphRevision: command.graph.revision }) };
  return { status: 'prepared', command, terrain, commit() {
    if (!world._stepping || !world.soundEvents._tick || world.physicalAuthoring !== state || world.physicalJunctions !== junctionState || state.revision !== command.expectedRevision || junctionState.revision !== command.expectedJunctionRevision || digestPlan(state.graph) !== command.expectedGraphDigest) throw new Error('Physical authoring publication is stale.');
    const publication = prepareTerrainPublication(terrain, world); if (publication.status !== 'prepared') return publication;
    // Admit all interpreter owners before the first authoritative terrain write.
    const admission = preparePhysicalGraphAdmission(world, command.graph);
    try { admission.commit(); } catch (error) { try { admission.cancel(); } catch (retirementError) { error.retirementError = retirementError; } throw error; }
    const result = publication.commit({ captureTopology: false }); topology.commit();
    if (junctionsChanged) { junctionState.definitions = command.junctions; junctionState.actual = nextActual; junctionState.revision++; }
    world.physicalAuthoring = next; world.captureTerrainTopology?.('postTransaction');
    return { ...result, authoring: next.lastApplied };
  } };
};
const applyPhysicalAuthoringCommand = (world, input) => { const proposal = preparePhysicalAuthoringCommand(world, input); return proposal.status === 'prepared' ? proposal.commit() : proposal; };
export { createPhysicalAuthoringState, preparePhysicalAuthoringConfiguration, normalizePhysicalAuthoringCommand, preparePhysicalAuthoringCommand, applyPhysicalAuthoringCommand };
