import { CHECKPOINT_COMPONENT_CODECS, validateCheckpointCodecs } from './ProcgenCheckpoint.js';
import { canonicalJournalText, cloneJournalData, hashJournalData, journalError } from './CausalJournalCanonical.js';

const PRESENTATION_WORLD_KEYS = new Set(['scenery', 'eventTimeMs', '_musicActorPositions', '_musicCompletedSlot', '_musicCompletedTick', '_assistedColumn']);
const equal = (left, right) => canonicalJournalText(left).text === canonicalJournalText(right).text;
const inspectProcgenCheckpoint = (saved, { assetRefs = null, generator = 'procgen-workstation-1' } = {}) => {
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

const projectProcgenPhysicsCheckpoint = saved => {
  if (inspectProcgenCheckpoint(saved).continuation === 'unsupported') throw journalError('checkpoint-incompatible', 'Cannot project an unsupported checkpoint.');
  const sourceNodes = saved.graph.nodes, projected = [], seen = new Map();
  const world = saved.graph.owners.find(owner => owner.name === 'world');
  const statsNode = world.props.stats?.ref;
  const slot = value => {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'ref')) return value;
    if (!Number.isSafeInteger(value.ref) || value.ref < 0 || value.ref >= sourceNodes.length) throw journalError('checkpoint-incompatible', 'Invalid physical checkpoint reference.');
    if (seen.has(value.ref)) return { ref: seen.get(value.ref) };
    const oldIndex = value.ref, nextIndex = projected.length;
    seen.set(oldIndex, nextIndex); projected.push(null);
    const source = sourceNodes[oldIndex], entry = {};
    for (const key of Object.keys(source).sort()) {
      if (key === 'props') entry.props = props(source.props, oldIndex === statsNode ? new Set(['groundQueries']) : null);
      else if (key === 'values') entry.values = source.values.map(slot);
      else if (key === 'entries') entry.entries = source.entries.map(pair => pair.map(slot));
      else if (key === 'image') entry.image = slot(source.image);
      else entry[key] = source[key];
    }
    projected[nextIndex] = entry; return { ref: nextIndex };
  };
  const props = (value, omit = null) => Object.fromEntries(Object.keys(value || {}).sort().filter(key => !omit?.has(key)).map(key => [key, slot(value[key])]));
  const owners = [...saved.graph.owners].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(owner => ({ name: owner.name, props: props(owner.props, owner.name === 'world' ? PRESENTATION_WORLD_KEYS : null),
      ...(owner.entries ? { entries: owner.entries.map(pair => pair.map(slot)) } : {}) }));
  return { schema: 'lemmings-procgen-physics-state', version: 1, numericEncoding: 'typed-f64-sentinels-v2',
    generator: saved.generator, seed: saved.seed, laneCount: saved.laneCount, laneHeight: saved.laneHeight, assets: saved.assets,
    graph: { nodes: projected, owners }, terrainAssignments: saved.terrainAssignments, terrainSettings: saved.terrainSettings,
    growth: saved.growth, physicalIdentity: saved.physicalIdentity,
    clock: { speedFactor: saved.clock.speedFactor, simulationTimeMs: saved.clock.simulationTimeMs } };
};
const hashProcgenPhysicsCheckpoint = saved => hashJournalData(projectProcgenPhysicsCheckpoint(saved), { maxBytes: 32 * 1048576, maxNodes: 4000000 });

const migrateProcgenCheckpoint = saved => {
  if (![1, 2].includes(saved?.version) || saved.generator !== 'procgen-workstation-1') throw journalError('checkpoint-incompatible', 'Unsupported checkpoint migration.');
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

export { inspectProcgenCheckpoint, projectProcgenPhysicsCheckpoint, hashProcgenPhysicsCheckpoint, migrateProcgenCheckpoint };
