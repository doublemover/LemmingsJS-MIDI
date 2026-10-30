import { CHECKPOINT_COMPONENT_CODECS, validateCheckpointCodecs } from './ProcgenCheckpoint.js';
import { canonicalJournalText, cloneJournalData, hashJournalData, journalError } from './CausalJournalCanonical.js';

const PRESENTATION_WORLD_KEYS = new Set(['physicalCrewEvidence', 'physicalAuthoring', 'terrainTopology', '_physicalWorkBounds', 'scenery', 'eventTimeMs', '_musicActorPositions', '_musicCompletedSlot', '_musicCompletedTick', '_assistedColumn']);
const CONTINUATION_WORLD_KEYS = new Set([...PRESENTATION_WORLD_KEYS].filter(key => !['physicalCrewEvidence', 'physicalAuthoring', 'terrainTopology', '_assistedColumn'].includes(key)));
const ZONE_KEYS = new Set(['id', 'index', 'start', 'end', 'width', 'maximumAuthoredWidth', 'descriptorId', 'sourceRevision', 'pack', 'groundSet', 'themeId', 'anchorPair', 'groups']);
const sourceAsset = value => value && Object.keys(value).length === 1 && typeof value.external === 'string' && /^asset\/\d+\/(sourceDescriptor|sourceGroups|wideSourceGroups)\//.test(value.external);
const terrainZoneKey = (node, nodes) => {
  const props = node?.props;
  if (node?.type !== 'Object' || Object.keys(node).length !== 2 || !props?.descriptorId || !props.sourceRevision || Object.keys(props).length !== ZONE_KEYS.size ||
      Object.keys(props).some(key => !ZONE_KEYS.has(key)) || typeof props.id !== 'string' || !/^[a-f0-9]{64}$/.test(props.sourceRevision) ||
      !Number.isSafeInteger(props.index) || props.index < 0 || !Number.isSafeInteger(props.width) || props.width < 1 ||
      props.start !== props.index * props.width || props.end !== props.start + props.width || !Number.isSafeInteger(props.maximumAuthoredWidth) || props.maximumAuthoredWidth < props.width ||
      props.anchorPair !== null && !sourceAsset(props.anchorPair)) return null;
  if (!props.groups || Object.keys(props.groups).length !== 1 || !Number.isSafeInteger(props.groups.ref) || props.groups.ref < 0 || props.groups.ref >= nodes.length) return null;
  const groups = nodes[props.groups?.ref];
  if (groups?.type !== 'Array' || Object.keys(groups).length !== 3 || Object.keys(groups.props || {}).length || !Array.isArray(groups.values) || groups.values.length > 4 || !groups.values.every(sourceAsset)) return null;
  for (const [key, value] of Object.entries(props)) if (!['groups', 'anchorPair'].includes(key) && value !== null && !['number', 'string'].includes(typeof value)) return null;
  return canonicalJournalText({ ...props, groups: groups.values }).text;
};
const equal = (left, right) => canonicalJournalText(left).text === canonicalJournalText(right).text;
const inspectProcgenCheckpoint = (saved, { assetRefs = null, generator = 'procgen-workstation-2' } = {}) => {
  const reasons = [];
  if (saved?.generator !== generator || ![1, 2].includes(saved?.version)) reasons.push('unsupported-generator-or-version');
  if (!Array.isArray(saved?.assets)) reasons.push('missing-asset-identities');
  else if (assetRefs && !equal(saved.assets, assetRefs)) reasons.push('asset-identity-mismatch');
  if (!saved?.graph || !Array.isArray(saved.graph.nodes) || !Array.isArray(saved.graph.owners) || !saved.graph.owners.some(owner => owner.name === 'world')) reasons.push('missing-world-component');
  try { if (saved) validateCheckpointCodecs(saved); } catch { reasons.push('unsupported-component-codec'); }
  const legacy = saved?.schema !== 'lemmings-procgen-checkpoint' || saved?.version !== 2 || !saved?.componentCodecs ||
    saved?.numericEncoding !== 'typed-f64-sentinels-v2' || saved?.physicalIdentity?.coverage !== 'complete';
  if (legacy) reasons.push('legacy-or-unqualified-component-identities');
  return cloneJournalData({ schema: 'lemmings-checkpoint-inspection', version: 1,
    continuation: reasons.some(reason => reason !== 'legacy-or-unqualified-component-identities') ? 'unsupported' : legacy ? 'legacy-continuation' : 'current-codec-continuation',
    exactQualified: false, reasons, executionIdentity: { status: 'unbound', reason: 'active-module-graph-not-proven' },
    numericEncoding: saved?.numericEncoding || 'legacy-or-unknown', actorOrder: 'serialized-array-order',
    presentation: { scenery: 'separate-restore-component', eventClock: 'legacy-presentation-time' } });
};

const projectProcgenCheckpoint = (saved, continuation) => {
  if (inspectProcgenCheckpoint(saved).continuation === 'unsupported') throw journalError('checkpoint-incompatible', 'Cannot project an unsupported checkpoint.');
  const sourceNodes = saved.graph.nodes, projected = [], seen = new Map(), zones = new Map();
  const world = saved.graph.owners.find(owner => owner.name === 'world');
  const statsNode = world.props.stats?.ref;
  const topologyNode = world.props.terrainTopology?.ref, crewNode = world.props.physicalCrewEvidence?.ref;
  const omitted = new Set(continuation ? CONTINUATION_WORLD_KEYS : PRESENTATION_WORLD_KEYS);
  if (continuation) {
    for (const key of ['physicalAuthoring', 'physicalCrewEvidence', 'terrainTopology']) if (!Number.isSafeInteger(world.props[key]?.ref) || sourceNodes[world.props[key].ref]?.type !== 'Object') throw journalError('checkpoint-continuation-incomplete', 'Checkpoint lacks the required continuation owner: ' + key);
    if (sourceNodes[world.props._assistedColumn?.ref]?.props?.valid !== true) omitted.add('_assistedColumn');
  }
  const terrainEdits = owner => {
    const array = (value, type) => {
      const node = sourceNodes[value?.ref];
      if (node?.type !== type || !Array.isArray(node.values)) throw journalError('checkpoint-incompatible', 'Invalid terrain edit component encoding.');
      return node.values;
    };
    const runs = values => {
      const result = [];
      for (let start = 0; start < values.length;) {
        const value = values[start]; if (!value) { start++; continue; }
        let end = start + 1; while (end < values.length && values[end] === value) end++;
        result.push([start, end - start, value]); start = end;
      }
      return result;
    };
    const patches = owner.entries.map(([key, value]) => ({ key, runs: runs(array(value, 'Uint8Array')) }));
    const cold = sourceNodes[owner.props.cold?.ref];
    if (cold?.type !== 'Map') throw journalError('checkpoint-incompatible', 'Missing cold terrain edit component.');
    for (const [key, ref] of cold.entries) {
      const record = sourceNodes[ref?.ref]?.props;
      if (!record) throw journalError('checkpoint-incompatible', 'Invalid cold terrain patch.');
      if (record.raw) patches.push({ key, runs: runs(array(record.raw, 'Uint8Array')) });
      else {
        const spans = array(record.runs, 'Uint16Array'), values = array(record.values, 'Uint8Array');
        if (spans.length !== values.length * 2) throw journalError('checkpoint-incompatible', 'Invalid cold terrain run lengths.');
        patches.push({ key, runs: values.map((value, index) => [spans[index * 2], spans[index * 2 + 1], value]) });
      }
    }
    return { name: owner.name, codec: 'logical-edit-runs-v1', chunkLength: owner.props.chunkLength,
      patches: patches.filter(patch => patch.runs.length).sort((left, right) => left.key - right.key) };
  };
  const slot = value => {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'ref')) return value;
    if (!Number.isSafeInteger(value.ref) || value.ref < 0 || value.ref >= sourceNodes.length) throw journalError('checkpoint-incompatible', 'Invalid physical checkpoint reference.');
    if (seen.has(value.ref)) return { ref: seen.get(value.ref) };
    const oldIndex = value.ref, source = sourceNodes[oldIndex], zoneKey = terrainZoneKey(source, sourceNodes);
    // Source-bound zones are immutable values; cache eviction or restore may split their JS identity.
    if (zoneKey && zones.has(zoneKey)) { const index = zones.get(zoneKey); seen.set(oldIndex, index); return { ref: index }; }
    const nextIndex = projected.length;
    if (zoneKey) zones.set(zoneKey, nextIndex);
    seen.set(oldIndex, nextIndex); projected.push(null);
    const entry = {};
    for (const key of Object.keys(source).sort()) {
      if (key === 'props') entry.props = props(source.props, oldIndex === statsNode ? new Set(['groundQueries']) : continuation && oldIndex === topologyNode ? new Set(['staleResults']) : continuation && oldIndex === crewNode ? new Set(['censored']) : null);
      else if (key === 'values') entry.values = source.values.map(slot);
      else if (key === 'entries') entry.entries = source.entries.map(pair => pair.map(slot));
      else if (key === 'image') entry.image = slot(source.image);
      else entry[key] = source[key];
    }
    projected[nextIndex] = entry; return { ref: nextIndex };
  };
  const props = (value, omit = null) => Object.fromEntries(Object.keys(value || {}).sort().filter(key => !omit?.has(key)).map(key => [key, slot(value[key])]));
  const owners = [...saved.graph.owners].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(owner => owner.name === 'editChunks' ? terrainEdits(owner) : ({ name: owner.name, props: props(owner.props, owner.name === 'world' ? omitted : null),
      ...(owner.entries ? { entries: owner.entries.map(pair => pair.map(slot)) } : {}) }));
  return { schema: continuation ? 'lemmings-procgen-continuation-state' : 'lemmings-procgen-physics-state', version: continuation ? 1 : 2, numericEncoding: 'typed-f64-sentinels-v2',
    generator: saved.generator, seed: saved.seed, laneCount: saved.laneCount, laneHeight: saved.laneHeight, assets: saved.assets,
    physicsAlgorithms: saved.physicsAlgorithms ?? { stallCascade: 1 },
    graph: { nodes: projected, owners }, terrainAssignments: saved.terrainAssignments, terrainSettings: saved.terrainSettings,
    growth: saved.growth, physicalIdentity: saved.physicalIdentity ? { version: saved.physicalIdentity.version, causalSequence: saved.physicalIdentity.causalSequence, coverage: saved.physicalIdentity.coverage } : null,
    clock: { speedFactor: saved.clock.speedFactor, simulationTimeMs: saved.clock.simulationTimeMs } };
};
const projectProcgenPhysicsCheckpoint = saved => projectProcgenCheckpoint(saved, false);
const projectProcgenContinuationCheckpoint = saved => projectProcgenCheckpoint(saved, true);
const hashProcgenPhysicsCheckpoint = saved => hashJournalData(projectProcgenPhysicsCheckpoint(saved), { maxBytes: 32 * 1048576, maxNodes: 4000000 });
const hashProcgenContinuationCheckpoint = saved => hashJournalData(projectProcgenContinuationCheckpoint(saved), { maxBytes: 32 * 1048576, maxNodes: 4000000 });
const compareCheckpointProjection = async (expected, actual, project, continuation) => {
  const left = project(expected), right = project(actual);
  const expectedHash = await hashJournalData(left, { maxBytes: 32 * 1048576, maxNodes: 4000000 }),
    actualHash = await hashJournalData(right, { maxBytes: 32 * 1048576, maxNodes: 4000000 });
  const describe = value => value === undefined ? 'missing' : value === null ? null : typeof value === 'object'
    ? { type: Array.isArray(value) ? 'array' : 'object', size: Object.keys(value).length }
    : typeof value === 'string' ? value.slice(0, 128) : value;
  const difference = (a, b, path) => {
    if (Object.is(a, b)) return null;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const found = difference(a[key], b[key], path + '/' + key); if (found) return found;
      }
      return null;
    }
    return { path, expected: describe(a), actual: describe(b) };
  };
  const firstDifference = expectedHash === actualHash ? null : difference(left, right, '');
  const ownerIndex = firstDifference?.path.match(/^\/graph\/owners\/(\d+)\//)?.[1];
  if (firstDifference && ownerIndex != null) firstDifference.component = left.graph.owners[ownerIndex]?.name || right.graph.owners[ownerIndex]?.name || null;
  return cloneJournalData({ schema: continuation ? 'lemmings-continuation-comparison' : 'lemmings-physics-comparison', version: continuation ? 1 : 2, matched: expectedHash === actualHash, expectedHash, actualHash, firstDifference });
};
const compareProcgenPhysicsCheckpoints = (expected, actual) => compareCheckpointProjection(expected, actual, projectProcgenPhysicsCheckpoint, false);
const compareProcgenContinuationCheckpoints = (expected, actual) => compareCheckpointProjection(expected, actual, projectProcgenContinuationCheckpoint, true);

const migrateProcgenCheckpoint = saved => {
  if (![1, 2].includes(saved?.version) || saved.generator !== 'procgen-workstation-2') throw journalError('checkpoint-incompatible', 'Unsupported checkpoint migration.');
  const candidate = structuredClone(saved);
  if (candidate.version === 1) for (const node of candidate.graph?.nodes || []) if (node.type === 'Float32Array' || node.type === 'Float64Array') {
    node.values = node.values.map(value => {
      if (value === null) throw journalError('ambiguous-numeric-state', 'Legacy JSON lost a floating sentinel; exact migration is unavailable.');
      if (typeof value !== 'number') return value;
      return Object.is(value, -0) ? { special: '-0' } : Number.isFinite(value) ? value : { special: String(value) };
    });
  }
  candidate.schema = 'lemmings-procgen-checkpoint'; candidate.version = 2;
  candidate.componentCodecs = { ...CHECKPOINT_COMPONENT_CODECS }; candidate.numericEncoding = 'typed-f64-sentinels-v2';
  const inspection = inspectProcgenCheckpoint(candidate);
  if (inspection.continuation === 'unsupported') throw journalError('checkpoint-incompatible', 'Checkpoint migration cannot repair incompatible source components.');
  return { checkpoint: candidate, provenance: cloneJournalData({ schema: 'lemmings-checkpoint-migration', version: 1,
    fromVersion: saved.version, toVersion: 2, originalPreserved: true, guarantee: 'typed-state-preserved; active execution remains unbound', inspection }) };
};

export { inspectProcgenCheckpoint, projectProcgenPhysicsCheckpoint, hashProcgenPhysicsCheckpoint, compareProcgenPhysicsCheckpoints,
  projectProcgenContinuationCheckpoint, hashProcgenContinuationCheckpoint, compareProcgenContinuationCheckpoints, migrateProcgenCheckpoint };
