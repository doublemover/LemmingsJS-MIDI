import { validateActorBirthAbilities, sameActorBirthAbilities } from '../ActorBirthAbilities.js';
import { validateCausalProbabilityPolicy } from './CausalProbabilityPolicy.js';
import { validatePhysicalFeedbackState } from './physical/PhysicalFeedback.js';
import { validatePopulationReleaseState } from '../ReleaseGesture.js';
import { validatePhysicalCrewEvidence } from '../PhysicalCrewEvidence.js';
import { assertTopologyEvidenceBoundary, retireTerrainTopologyAnalysis, validateTerrainTopologyState } from '../ProcgenTerrainTopology.js';
import { Lemming } from '../../../lemmings/Lemming.js';
import { Trigger } from '../../../level/Trigger.js';
import { Animation } from '../../../render/Animation.js';
import { MapObject } from '../../../level/MapObject.js';
import { validatePhysicalEventIdentity } from '../ProcgenSoundEventBus.js';
import { PROCGEN_TRIGGER_INDEX_FIELDS } from '../ProcgenTriggerManager.js';
import { COUNTER_LIMIT } from '../../../core/constants.js';

const VERSION = 2;
const CHECKPOINT_COMPONENT_CODECS = Object.freeze({ worldGraph: 2, physicalIdentity: 1, clock: 1,
  terrainAssignments: 1, terrainGrowth: 1, presentationScenery: 1, causalRandom: 1 });
const validateCheckpointCodecs = saved => {
  if (saved.schema != null && saved.schema !== 'lemmings-procgen-checkpoint' || saved.numericEncoding != null && saved.numericEncoding !== 'typed-f64-sentinels-v2') throw new Error('Unsupported checkpoint schema or numeric encoding.');
  if (saved.physicsAlgorithms?.causalRandom !== 'fnv1a32-avalanche-v1' || saved.physicsAlgorithms?.populationRandom !== 1 || saved.physicsAlgorithms?.terrainChallenge !== 3) throw new Error('Checkpoint random/terrain source version requires its original runtime; no implicit reseed migration.');
  if (saved.physicsAlgorithms != null && ![1, 2].includes(saved.physicsAlgorithms.stallCascade)) throw new Error('Unsupported checkpoint physical policy.');
  if (saved.componentCodecs != null && (Object.keys(saved.componentCodecs).length !== Object.keys(CHECKPOINT_COMPONENT_CODECS).length ||
      Object.entries(CHECKPOINT_COMPONENT_CODECS).some(([key, version]) => saved.componentCodecs[key] !== version && !(key === 'terrainAssignments' && saved.componentCodecs[key] === 2)))) throw new Error('Unsupported checkpoint component codec.');
};
const OMIT = new Set(['_physicalWorkBounds', 'log', 'gameResources', 'render', 'characterParticles', '_collisionSlots', '_collisionIndices', '_laneChunk', '_laneChunkIndex', '_laneEdits', '_laneEditIndex', '_editCache', '_editIndices', '_edgeWallCache', 'challengeCache']);
const TYPES = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
const NODE_PROTOTYPES = { Object: Object.prototype, Array: Array.prototype, Map: Map.prototype, Set: Set.prototype,
  Lemming: Lemming.prototype, Trigger: Trigger.prototype, Animation: Animation.prototype, MapObject: MapObject.prototype };
const INTEGER_VIEW_RANGES = { Uint8Array: [0, 255], Uint8ClampedArray: [0, 255], Int8Array: [-128, 127],
  Uint16Array: [0, 65535], Int16Array: [-32768, 32767], Uint32Array: [0, 4294967295], Int32Array: [-2147483648, 2147483647] };
const encodeNumber = value => Object.is(value, -0) ? { special: '-0' } : Number.isFinite(value) ? value : { special: String(value) };
const finiteEncodedNumber = value => Number.isFinite(value) || value?.special === '-0';
const decodeNumber = value => {
  if (typeof value === 'number') return value;
  if (value.special === '-0') return -0;
  if (value.special === 'Infinity') return Infinity;
  if (value.special === '-Infinity') return -Infinity;
  if (value.special === 'NaN') return NaN;
  throw new Error('Invalid checkpoint typed-array number.');
};
const forbidden = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const MAX_GRAPH_BYTES = 128 * 1048576, MAX_GRAPH_SLOTS = 4000000, MAX_GRAPH_STRING_UNITS = 16 * 1048576;
const LAZY_OWNER_KEYS = new Map([
  ['world', new Set(['_processingActorId', '_constructionClaim', 'checkpointHazardFixture'])],
  ['hazardPlanner', new Set(['top', 'through', 'probes', 'exhausted', 'unrevealed'])]
]);
const safeProperty = (target, key) => {
  if (forbidden(key) || OMIT.has(key)) throw new Error('Invalid checkpoint property.');
  for (let owner = target; owner; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor && (typeof descriptor.value === 'function' || descriptor.get || descriptor.set)) throw new Error('Checkpoint property would shadow a runtime method.');
  }
};
const assetIdentity = world => (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ styleName, family, terrain }) => ({
  family: family || styleName || terrain?.recipe?.family || null, id: terrain?.recipe?.id || null,
  revision: terrain?.recipe?.assetSha256 || terrain?.sourceDescriptor?.sourceRevision || null
}));

function* bindingSteps(world) {
  const objects = new Map(), names = new Map(), owners = new Map();
  const add = function*(name, value, recursive = false) {
    if (!value || typeof value !== 'object' || objects.has(value)) return;
    objects.set(value, name); names.set(name, value); yield;
    if (recursive && !ArrayBuffer.isView(value)) for (const [key, child] of Object.entries(value)) if (!forbidden(key)) yield* add(name + '/' + key, child, true);
  };
  for (const key of ['runtime', 'soundEvents', 'timer', 'sprites', 'terrain', 'characterParticles']) yield* add(key, world[key]);
  for (const [key, action] of Object.entries(world.actions)) {
    yield* add('action/' + key, action);
    for (const field of ['masks', 'sprites']) yield* add(`action/${key}/${field}`, action[field], true);
  }
  yield* add('actions', world.actions);
  const themes = world.terrain?.themes || [{ terrain: world.terrain }];
  for (const [index, { terrain }] of themes.entries()) {
    if (!terrain) continue;
    yield* add('theme/' + index, terrain);
    for (const field of ['pieces', 'objects', 'recipe', 'sourceDescriptor', 'assemblyCatalog', 'compiledAssemblies', 'assemblySources', 'sourceGroups', 'wideSourceGroups']) {
      const value = terrain[field];
      if (value instanceof Map) for (const [key, item] of value) yield* add(`asset/${index}/${field}/${key}`, item, true);
      else yield* add(`asset/${index}/${field}`, value, true);
    }
  }
  const owner = function*(name, value) {
    if (!value || typeof value !== 'object' || objects.has(value)) return;
    yield* add(name, value); owners.set(name, value);
    for (const key of ['actions', 'runtime', 'masks', 'sprites']) yield* add(name + '/' + key, value[key], true);
    if (!(value instanceof Map)) for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object' && !objects.has(child) && !Array.isArray(child) && !ArrayBuffer.isView(child) && !(child instanceof Map) && !(child instanceof Set) && Object.getPrototypeOf(child) !== Object.prototype) yield* owner(name + '/' + key, child);
    }
  };
  yield* add('world', world); owners.set('world', world);
  for (const key of ['population', 'stall', 'editChunks', 'terrainTileRevisions', 'hazards', 'triggerManager', 'hazardPlanner', 'basinRoutes', 'tunnelRoutes', 'lanePolicy']) yield* owner(key, world[key]);
  yield* add('terrainGrowth', world.terrainGrowth); yield* add('scenery', world.scenery);
  return { objects, names, owners };
}
const exhaust = iterator => { let result; do { result = iterator.next(); } while (!result.done); return result.value; };
const bindings = world => exhaust(bindingSteps(world));
function* graphSteps(world, { maxBytes = MAX_GRAPH_BYTES } = {}) {
  const bound = yield* bindingSteps(world), nodes = [], seen = new Map(); let estimatedBytes = 1024;
  const props = function*(value, extra = new Set(), array = false) {
    const output = {};
    for (const key of Object.keys(value)) if (!forbidden(key) && !OMIT.has(key) && !extra.has(key) && !(array && /^\d+$/.test(key)) && typeof value[key] !== 'function') output[key] = yield encode(value[key]);
    return output;
  };
  const encode = function*(value) {
    estimatedBytes += typeof value === 'string' ? value.length * 4 + 32 : 32;
    if (estimatedBytes > maxBytes) throw new Error('Checkpoint capture graph exceeds its byte bound.');
    yield;
    if (value === undefined) return { special: 'undefined' };
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return encodeNumber(value);
    if (value === null || typeof value !== 'object') return value;
    if (bound.objects.has(value)) return { external: bound.objects.get(value) };
    if (seen.has(value)) return { ref: seen.get(value) };
    const index = nodes.length; seen.set(value, index); nodes.push(null); let entry;
    if (ArrayBuffer.isView(value)) {
      if (!Object.hasOwn(TYPES, value.constructor.name)) throw new Error('Unsupported checkpoint view: ' + value.constructor.name);
      const values = []; for (const number of value) { values.push(encodeNumber(number)); estimatedBytes += 32; if (estimatedBytes > maxBytes) throw new Error('Checkpoint capture graph exceeds its byte bound.'); yield; }
      entry = { type: value.constructor.name, values };
    } else if (value instanceof Map) {
      const entries = []; for (const [key, child] of Map.prototype.entries.call(value)) entries.push([yield encode(key), yield encode(child)]);
      entry = { type: 'Map', entries };
    } else if (value instanceof Set) {
      const values = []; for (const child of value) values.push(yield encode(child)); entry = { type: 'Set', values };
    } else if (value instanceof MapObject) entry = { type: 'MapObject', props: yield* props(value), image: yield encode(value.animation.objectImg) };
    else if (value instanceof Animation) entry = { type: 'Animation', props: yield* props(value, new Set(['frames', '_lastFrame', 'frameCount'])), lastFrameIndex: value.frames.indexOf(value._lastFrame) };
    else if (value instanceof Trigger) entry = { type: 'Trigger', props: yield* props(value), disabledUntilTick: value.disabledUntilTick };
    else if (value instanceof Lemming) entry = { type: 'Lemming', props: yield* props(value) };
    else if (Array.isArray(value)) {
      const values = []; for (const child of value) values.push(yield encode(child)); entry = { type: 'Array', values, props: yield* props(value, new Set(), true) };
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Unsupported checkpoint state: ' + value.constructor?.name);
      entry = { type: 'Object', props: yield* props(value) };
    }
    nodes[index] = entry; return { ref: index };
  };
  const owners = [];
  const captureOwners = function*() {
    for (const [name, value] of bound.owners) {
      const entry = { name, props: yield* props(value, new Set(name === 'triggerManager' ? PROCGEN_TRIGGER_INDEX_FIELDS : [])) };
      if (value instanceof Map) { entry.entries = []; for (const [key, child] of Map.prototype.entries.call(value)) entry.entries.push([yield encode(key), yield encode(child)]); }
      owners.push(entry);
    }
  };
  // Preserve depth-first wire order without nesting child generator call stacks.
  const pending = [captureOwners()]; let result;
  while (pending.length) {
    const step = pending[pending.length - 1].next(result); result = undefined;
    if (step.done) { pending.pop(); result = step.value; }
    else if (step.value) pending.push(step.value);
    else yield;
  }
  return { nodes, owners, estimatedBytes };
}
const checkpointEnvelope = (world, graph) => {
  if (world._stepping || world._failedTick) throw new Error('Cannot checkpoint an incomplete physical boundary.');
  assertTopologyEvidenceBoundary(world);
  return { schema: 'lemmings-procgen-checkpoint', version: VERSION, generator: 'procgen-workstation-2',
    componentCodecs: { ...CHECKPOINT_COMPONENT_CODECS, ...(world.terrain?.sceneTerrainLayout ? { terrainAssignments: 2 } : {}) }, numericEncoding: 'typed-f64-sentinels-v2', laneCount: world.laneCount, laneHeight: world.laneHeight,
    seed: world.seed, assets: assetIdentity(world), graph,
    ...(world.actorBirthAbilities ? { actorBirthAbilities: world.actorBirthAbilities } : {}),
    physicsAlgorithms: { ...(world.actorBirthAbilities ? { actorBirthAbilities: 1 } : {}), stallCascade: world.stall.settings.cascadeDecisionVersion ?? 1, causalRandom: 'fnv1a32-avalanche-v1', populationRandom: 1, terrainChallenge: 3 },
    terrainAssignments: world.terrain?.exportAssignments?.() || null,
    terrainSettings: (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain ? { workstation: terrain.workstation, hazardSpacing: terrain.hazardSpacing, laneHeight: terrain.height, sharedSpanBudget: terrain.sharedSpanBudget } : null),
    growth: world.terrainGrowth?.exportState?.() || null, scenery: world.scenery?.snapshot?.() || null,
    physicalIdentity: world.soundEvents.snapshotIdentity(),
    clock: { speedFactor: world.timer.speedFactor, eventTimeMs: world.eventTimeMs, simulationTimeMs: world.simulationTimeMs } };
};

const captureProcgenCheckpoint = world => {
  if (world._stepping || world._failedTick) throw new Error('Cannot checkpoint an incomplete physical boundary.');
  assertTopologyEvidenceBoundary(world);
  return checkpointEnvelope(world, exhaust(graphSteps(world)));
};
async function captureProcgenCheckpointCooperative(world, { signal, isCurrent, now = () => performance.now(), yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), sliceMs = 3, maxGraphBytes = MAX_GRAPH_BYTES, onSlice = () => {} } = {}) {
  if (!Number.isSafeInteger(maxGraphBytes) || maxGraphBytes < 4096 || maxGraphBytes > MAX_GRAPH_BYTES || typeof isCurrent !== 'function' || !Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 16) throw new Error('Cooperative checkpoints require an exclusive paused owner.');
  const boundary = [world.tickIndex, world.generation, world.terrainRevision, world.interventionState?.sequence, world.timer.speedFactor];
  const check = () => {
    signal?.throwIfAborted();
    assertTopologyEvidenceBoundary(world);
    if (!isCurrent() || world._stepping || world._failedTick || [world.tickIndex, world.generation, world.terrainRevision, world.interventionState?.sequence, world.timer.speedFactor].some((value, index) => value !== boundary[index])) throw new Error('Checkpoint source changed while its quiescent lease was held.');
  };
  check(); const iterator = graphSteps(world, { maxBytes: maxGraphBytes }); let result, started = now(), units = 0;
  try {
    do {
      result = iterator.next();
      if (++units % 64 === 0 && now() - started >= sliceMs) { onSlice({ durationMs: now() - started, units }); await yieldTask(); check(); started = now(); }
    } while (!result.done);
    check(); const checkpoint = checkpointEnvelope(world, result.value); onSlice({ durationMs: now() - started, units }); return checkpoint;
  } finally { iterator.return(); }
}

function validateCheckpointGraph(graph, bound, version) {
  const { nodes, owners } = graph || {};
  if (!Array.isArray(nodes) || nodes.length > 2000000 || !Array.isArray(owners) || owners.length > bound.owners.size) throw new Error('Invalid checkpoint graph.');
  let bytes = nodes.length * 96, slots = 0, stringUnits = 0;
  const text = value => { stringUnits += value.length; if (stringUnits > MAX_GRAPH_STRING_UNITS) throw new Error('Checkpoint string budget exceeded.'); };
  const slot = value => {
    if (++slots > MAX_GRAPH_SLOTS) throw new Error('Checkpoint reference budget exceeded.');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new Error('Invalid checkpoint number.'); }
    if (typeof value === 'string') { text(value); return; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw new Error('Invalid checkpoint value.');
    if (Object.hasOwn(value, 'ref')) { if (!Number.isSafeInteger(value.ref) || value.ref < 0 || value.ref >= nodes.length) throw new Error('Invalid checkpoint reference.'); return; }
    if (Object.hasOwn(value, 'external')) { if (typeof value.external !== 'string' || !bound.names.has(value.external)) throw new Error('Missing checkpoint resource.'); text(value.external); return; }
    if (Object.hasOwn(value, 'special') && ['undefined', '-0', 'Infinity', '-Infinity', 'NaN'].includes(value.special)) return;
    throw new Error('Invalid checkpoint value.');
  };
  const props = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid checkpoint properties.');
    for (const [key, entry] of Object.entries(value)) {
      if (forbidden(key) || OMIT.has(key)) throw new Error('Invalid checkpoint property.');
      text(key); slot(entry);
    }
  };
  for (const entry of nodes) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid checkpoint node.');
    const type = entry.type;
    if (Object.hasOwn(TYPES, type)) {
      if (!Array.isArray(entry.values)) throw new Error('Invalid checkpoint typed-array payload.');
      bytes += entry.values.length * TYPES[type].BYTES_PER_ELEMENT;
      if (bytes > MAX_GRAPH_BYTES) throw new Error('Checkpoint memory budget exceeded.');
      for (let index = 0; index < entry.values.length; index++) {
        if (!Object.hasOwn(entry.values, index)) throw new Error('Invalid checkpoint typed-array value.');
        const value = entry.values[index], floating = type === 'Float32Array' || type === 'Float64Array';
        if (value === null) throw new Error('Legacy checkpoint typed array lost numeric state.');
        if (typeof value === 'number') {
          if (!Number.isFinite(value) && (version !== 1 || !floating)) throw new Error('Invalid checkpoint typed-array value.');
          const range = INTEGER_VIEW_RANGES[type];
          if (range && (!Number.isInteger(value) || value < range[0] || value > range[1]) ||
              type === 'Float32Array' && Number.isFinite(value) && !Object.is(Math.fround(value), value)) throw new Error('Checkpoint typed-array value would lose precision.');
        } else if (version !== 2 || !floating || !value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).length !== 1 || !['-0', 'Infinity', '-Infinity', 'NaN'].includes(value.special)) throw new Error('Invalid checkpoint typed-array value.');
      }
    } else if (type === 'Map') {
      if (!Array.isArray(entry.entries)) throw new Error('Invalid checkpoint map.');
      for (const pair of entry.entries) { if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid checkpoint map entry.'); slot(pair[0]); slot(pair[1]); }
    } else if (type === 'Set' || type === 'Array') {
      if (!Array.isArray(entry.values)) throw new Error('Invalid checkpoint collection.');
      for (const value of entry.values) slot(value);
    } else if (!['Object', 'Lemming', 'Trigger', 'Animation', 'MapObject'].includes(type)) throw new Error('Unknown checkpoint node type.');
    if (entry.props != null) {
      props(entry.props);
      if (Object.hasOwn(TYPES, type)) throw new Error('Checkpoint typed arrays cannot redefine properties.');
      for (const key of Object.keys(entry.props)) {
        safeProperty(NODE_PROTOTYPES[type], key);
        if (type === 'Array' && (key === 'length' || /^(0|[1-9][0-9]*)$/.test(key))) throw new Error('Checkpoint array properties cannot replace its elements or length.');
        if (type === 'Animation' && ['frames', '_lastFrame', 'frameCount'].includes(key)) throw new Error('Checkpoint animation frames must use their original resource binding.');
      }
      if (['Lemming', 'Trigger'].includes(type) && Object.hasOwn(entry.props, 'runtime') && entry.props.runtime !== null &&
          (entry.props.runtime?.external !== 'runtime' || !bound.names.has('runtime'))) throw new Error('Checkpoint runtime must use its original resource binding.');
      if (type === 'Lemming') for (const key of ['action', 'countdownAction']) {
        const action = entry.props[key];
        if (action != null && action !== 0 && (typeof action?.external !== 'string' || !action.external.startsWith('action/'))) throw new Error('Checkpoint actor action must use its original resource binding.');
      }
    }
    if (type === 'MapObject') slot(entry.image);
    if (type === 'Animation' && (!Number.isSafeInteger(entry.lastFrameIndex) || entry.lastFrameIndex < -1)) throw new Error('Invalid checkpoint animation.');
    if (type === 'Trigger' && (!Number.isSafeInteger(entry.disabledUntilTick) || entry.disabledUntilTick < 0 || entry.disabledUntilTick > COUNTER_LIMIT)) throw new Error('Invalid checkpoint trigger cooldown.');
    if (bytes + slots * 24 + stringUnits * 2 > MAX_GRAPH_BYTES) throw new Error('Checkpoint memory budget exceeded.');
  }
  const names = new Set();
  for (const owner of owners) {
    if (!owner || typeof owner.name !== 'string' || !bound.owners.has(owner.name) || names.has(owner.name)) throw new Error('Invalid checkpoint owner.');
    names.add(owner.name); text(owner.name); props(owner.props);
    const target = bound.owners.get(owner.name);
    for (const key of Object.keys(owner.props)) {
      safeProperty(target, key);
      if (!Object.hasOwn(target, key) && !LAZY_OWNER_KEYS.get(owner.name)?.has(key)) throw new Error('Checkpoint owner property is not part of this runtime: ' + owner.name.slice(0, 80) + '/' + key.slice(0, 80));
      const binding = bound.objects.get(target[key]);
      if (binding && owner.props[key]?.external !== binding) throw new Error('Checkpoint owner resource binding changed: ' + owner.name.slice(0, 80) + '/' + key.slice(0, 80));
    }
    if (owner.entries != null) {
      if (!(bound.owners.get(owner.name) instanceof Map) || !Array.isArray(owner.entries)) throw new Error('Invalid checkpoint owner collection.');
      for (const pair of owner.entries) { if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid checkpoint owner entry.'); slot(pair[0]); slot(pair[1]); }
    }
  }
  if (names.size !== bound.owners.size || bytes + slots * 24 + stringUnits * 2 > MAX_GRAPH_BYTES) throw new Error('Checkpoint owner or memory budget mismatch.');
}

function restoreProcgenCheckpoint(world, saved) {
  if (world._stepping || world.soundEvents._tick) throw new Error('Cannot restore a checkpoint inside a physical tick.');
  if (![1, VERSION].includes(saved?.version) || saved.generator !== 'procgen-workstation-2' || saved.laneCount !== world.laneCount || saved.laneHeight !== world.laneHeight || saved.seed !== world.seed) throw new Error('Incompatible world checkpoint.');
  validateCheckpointCodecs(saved);
  if (saved.actorBirthAbilities != null && saved.physicsAlgorithms?.actorBirthAbilities !== 1 || saved.actorBirthAbilities == null && saved.physicsAlgorithms?.actorBirthAbilities != null || !sameActorBirthAbilities(saved.actorBirthAbilities, world.actorBirthAbilities, world.laneCount)) throw new Error('The checkpoint requires its original authored actor birth ability policy.');
  const scoredSource = saved.componentCodecs?.terrainAssignments === 2;
  if (scoredSource !== !!saved.terrainAssignments?.sceneTerrain || scoredSource !== !!world.terrain?.sceneTerrainLayout || scoredSource && (typeof world.terrain.validateScoredAssignments !== 'function' || !Array.isArray(saved.terrainSettings) || saved.growth != null)) throw new Error('The checkpoint requires its original authored terrain source profile.');
  if (JSON.stringify(saved.assets) !== JSON.stringify(assetIdentity(world))) throw new Error('Checkpoint terrain assets do not match the installed collection.');
  if (!saved.clock || !Number.isFinite(saved.clock.speedFactor) || saved.clock.speedFactor < 0 ||
      saved.clock.eventTimeMs != null && (!Number.isFinite(saved.clock.eventTimeMs) || saved.clock.eventTimeMs < 0) ||
      saved.clock.simulationTimeMs != null && (!Number.isFinite(saved.clock.simulationTimeMs) || saved.clock.simulationTimeMs < 0)) throw new Error('Invalid checkpoint clock.');
  if (saved.physicalIdentity != null) validatePhysicalEventIdentity(saved.physicalIdentity);
  const { nodes, owners } = saved.graph || {};
  const bound = bindings(world);
  validateCheckpointGraph(saved.graph, bound, saved.version);
  const worldProps = owners.find(entry => entry.name === 'world').props;
  if (worldProps.seed !== saved.seed || worldProps.laneCount !== saved.laneCount || worldProps.laneHeight !== saved.laneHeight ||
      !Number.isSafeInteger(worldProps.tickIndex) || worldProps.tickIndex < 0 || worldProps.tickIndex >= Number.MAX_SAFE_INTEGER) throw new Error('Checkpoint world envelope does not match its graph.');
  for (const field of ['laneSeeds', 'frontiers', 'generatedThrough', 'terrainActivityTicks', 'pendingTerrainWork', '_effectiveTerrainWork',
    '_manualNukeLanes', '_spawnPhaseRanks', '_spawnPhases', '_laneAdmissionCohorts', '_edgeWallRevisions']) {
    if (!Object.hasOwn(world, field)) continue;
    const entry = nodes[worldProps[field]?.ref];
    if (entry?.type !== world[field]?.constructor?.name || !Array.isArray(entry.values) || entry.values.length !== saved.laneCount ||
        ['frontiers', 'generatedThrough'].includes(field) && entry.values.some(value => !finiteEncodedNumber(value))) throw new Error('Invalid checkpoint lane array: ' + field);
  }
  if (!Number.isSafeInteger(worldProps.nextActorId) || worldProps.nextActorId < 0 || worldProps.nextActorId >= Number.MAX_SAFE_INTEGER ||
      nodes.some(entry => entry.type === 'Lemming' && (!Number.isSafeInteger(entry.props?.id) || entry.props.id < 0 || entry.props.id >= worldProps.nextActorId)))
    throw new Error('Checkpoint actor identity frontier is invalid or exhausted.');
  const actorIds = new Set();
  for (const entry of nodes) if (entry.type === 'Lemming') {
    if (actorIds.has(entry.props.id)) throw new Error('Checkpoint actor identities must be unique.');
    actorIds.add(entry.props.id);
    if (!finiteEncodedNumber(entry.props.x) || !finiteEncodedNumber(entry.props.y) || entry.props.laneIndex != null &&
        (!Number.isInteger(entry.props.laneIndex) || entry.props.laneIndex < 0 || entry.props.laneIndex >= saved.laneCount)) throw new Error('Invalid checkpoint actor position or lane.');
  }
  const actorList = nodes[worldProps.actors?.ref], activeActorIds = new Set();
  if (actorList?.type !== 'Array') throw new Error('Checkpoint active actors must be an actor array.');
  for (const value of actorList.values) {
    const actor = nodes[value?.ref];
    if (actor?.type !== 'Lemming' || activeActorIds.has(actor.props.id)) throw new Error('Checkpoint active actors contain invalid or repeated identities.');
    if (bound.names.has('runtime') && actor.props.runtime?.external !== 'runtime') throw new Error('Checkpoint active actor runtime binding changed.');
    activeActorIds.add(actor.props.id);
  }
  const values = nodes.map(entry => {
    if (Object.hasOwn(TYPES, entry.type)) {
      const result = new TYPES[entry.type](entry.values.length);
      for (let index = 0; index < result.length; index++) result[index] = decodeNumber(entry.values[index]);
      return result;
    }
    if (entry.type === 'Map') return new Map();
    if (entry.type === 'Set') return new Set();
    if (entry.type === 'Array') return [];
    if (entry.type === 'Object') return {};
    if (entry.type === 'Lemming') return new Lemming(0, 0, 0, world.runtime);
    if (entry.type === 'Trigger') return new Trigger();
    if (entry.type === 'Animation') return new Animation();
    if (entry.type === 'MapObject') return Object.create(MapObject.prototype);
    throw new Error('Unknown checkpoint node type.');
  });
  const decode = value => {
    if (!value || typeof value !== 'object') return value;
    if (value.special) {
      if (value.special === 'undefined') return undefined;
      if (value.special === '-0') return -0;
      if (value.special === 'Infinity') return Infinity;
      if (value.special === '-Infinity') return -Infinity;
      if (value.special === 'NaN') return NaN;
      throw new Error('Invalid checkpoint number.');
    }
    if (value.external) return bound.names.get(value.external);
    return values[value.ref];
  };
  const assign = (target, props) => { for (const [key, value] of Object.entries(props)) { safeProperty(target, key); target[key] = decode(value); } };
  for (let index = 0; index < nodes.length; index++) {
    const entry = nodes[index], out = values[index];
    if (entry.type === 'Map') for (const [key, value] of entry.entries) out.set(decode(key), decode(value));
    if (entry.type === 'Set') for (const value of entry.values) out.add(decode(value));
    if (entry.type === 'Array') for (const value of entry.values) out.push(decode(value));
    if (entry.props) assign(out, entry.props);
    if (entry.type === 'Trigger') out.disabledUntilTick = entry.disabledUntilTick;
  }
  // Decode before replacing live owners; callers restore into a temporary world.
  const prepared = owners.map(entry => {
    const target = bound.owners.get(entry.name);
    return { entry, props: Object.fromEntries(Object.entries(entry.props).map(([key, value]) => {
      safeProperty(target, key);
      return [key, decode(value)];
    })), entries: entry.entries?.map(([k, v]) => [decode(k), decode(v)]) };
  });
  const preparedWorld = prepared.find(item => item.entry.name === 'world'); preparedWorld.props.physicalCrewEvidence = validatePhysicalCrewEvidence(preparedWorld.props.physicalCrewEvidence, preparedWorld.props.generation);
  if (world.terrainTopology || preparedWorld.props.terrainTopology) validateTerrainTopologyState(preparedWorld.props);
  if (!sameActorBirthAbilities(preparedWorld.props.actorBirthAbilities, saved.actorBirthAbilities, world.laneCount)) throw new Error('Checkpoint actor birth source differs from its graph state.');
  preparedWorld.props.actorBirthAbilities = validateActorBirthAbilities(saved.actorBirthAbilities, world.laneCount);
  for (const command of preparedWorld.props.interventionState?.pending || []) if (command.probability && JSON.stringify(validateCausalProbabilityPolicy(command.probability)) !== JSON.stringify(command.probability)) throw new Error('Invalid checkpoint physical probability policy.');
  if (preparedWorld.props.physicalFeedback != null) preparedWorld.props.physicalFeedback = validatePhysicalFeedbackState(preparedWorld.props.physicalFeedback);
  if (scoredSource) world.terrain.validateScoredAssignments(saved.terrainAssignments, preparedWorld.props.laneSeeds, saved.terrainSettings);
  const preparedPopulation = prepared.find(item => item.entry.name === 'population'); if (preparedPopulation) validatePopulationReleaseState(preparedPopulation.props, saved.laneCount);
  const activityTicks = prepared.find(item => item.entry.name === 'world')?.props.terrainActivityTicks;
  const cascadeVersion = prepared.find(item => item.entry.name === 'stall')?.props.settings?.cascadeDecisionVersion ?? 1;
  if (![1, 2].includes(cascadeVersion) || cascadeVersion !== (saved.physicsAlgorithms?.stallCascade ?? 1))
    throw new Error('Checkpoint physical policy identity does not match its state.');
  if (!(activityTicks instanceof Float64Array) || activityTicks.length !== saved.laneCount ||
      Array.from(activityTicks).some(value => value !== -Infinity && (!Number.isSafeInteger(value) || value < 0 || value > worldProps.tickIndex)))
    throw new Error('Invalid terrain activity tick in checkpoint.');
  for (let index = 0; index < nodes.length; index++) if (nodes[index].type === 'MapObject' && values[index]) {
    const item = values[index], animation = item.animation, rebuilt = new MapObject(item.ob, decode(nodes[index].image), new Animation(), item.triggerType, world.runtime);
    animation.frames = rebuilt.animation.frames;
    const animationIndex = nodes[index].props.animation?.ref;
    animation._lastFrame = animation.frames[nodes[animationIndex]?.lastFrameIndex] || null;
  }
  for (const { entry, props, entries } of prepared) {
    const target = bound.owners.get(entry.name);
    Object.assign(target, props);
    if (entries) { Map.prototype.clear.call(target); for (const [key, value] of entries) Map.prototype.set.call(target, key, value); }
  }
  world._authoritativeActors = new WeakSet(world.actors);
  retireTerrainTopologyAnalysis(world);
  world.triggerManager.rebuildIndex();
  world.soundEvents.restoreIdentity(saved.physicalIdentity ?? null);
  world._completedPhysicalSnapshot = null;
  world.timer.speedFactor = saved.clock.speedFactor; world.eventTimeMs = saved.clock.eventTimeMs;
  world.simulationTimeMs = saved.clock.simulationTimeMs ?? world.tickIndex * world.timer.TIME_PER_FRAME_MS;
  const themes = world.terrain?.themes || [{ terrain: world.terrain }];
  for (let index = 0; index < themes.length; index++) if (saved.terrainSettings?.[index]) themes[index].terrain?.configure?.(world.laneCount, world.maxActors, saved.terrainSettings[index]);
  if (saved.terrainAssignments && world.terrain?.restoreAssignments) world.terrain.restoreAssignments(saved.terrainAssignments);
  else world.terrain?.registerLanes?.(world.laneSeeds, world.seed, world.generation);
  world.terrainGrowth?.restoreState?.(saved.growth, world._prepareGrowthChunk);
  if (world.scenery) world.scenery.laneSeeds = world.laneSeeds;
  world.scenery?.restore?.(saved.scenery);
  for (const key of ['_laneChunk', '_laneEdits', '_editCache', '_collisionSlots', '_edgeWallCache']) world[key]?.fill(null);
  for (const key of ['_laneChunkIndex', '_laneEditIndex', '_editIndices', '_collisionIndices']) world[key]?.fill(-1);
  world.challengeCache?.clear(); world.characterParticles?.clear();
  return world;
}

export { captureProcgenCheckpoint, captureProcgenCheckpointCooperative, restoreProcgenCheckpoint, assetIdentity, CHECKPOINT_COMPONENT_CODECS, validateCheckpointCodecs };
