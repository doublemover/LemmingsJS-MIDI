import { Lemming } from '../../../lemmings/Lemming.js';
import { Trigger } from '../../../level/Trigger.js';
import { Animation } from '../../../render/Animation.js';
import { MapObject } from '../../../level/MapObject.js';

const VERSION = 1;
const OMIT = new Set(['log', 'gameResources', 'render', 'characterParticles', '_collisionSlots', '_collisionIndices', '_laneChunk', '_laneChunkIndex', '_laneEdits', '_laneEditIndex', '_editCache', '_editIndices', '_edgeWallCache', 'challengeCache']);
const TYPES = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
const forbidden = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const assetIdentity = world => (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ styleName, family, terrain }) => ({
  family: family || styleName || terrain?.recipe?.family || null, id: terrain?.recipe?.id || null,
  revision: terrain?.recipe?.assetSha256 || terrain?.sourceDescriptor?.sourceRevision || null
}));

function bindings(world) {
  const objects = new Map(), names = new Map(), owners = new Map();
  const add = (name, value, recursive = false) => {
    if (!value || typeof value !== 'object' || objects.has(value)) return;
    objects.set(value, name); names.set(name, value);
    if (recursive && !ArrayBuffer.isView(value)) for (const [key, child] of Object.entries(value)) if (!forbidden(key)) add(name + '/' + key, child, true);
  };
  for (const key of ['runtime', 'soundEvents', 'timer', 'sprites', 'terrain', 'characterParticles']) add(key, world[key]);
  for (const [key, action] of Object.entries(world.actions)) {
    add('action/' + key, action);
    // Predictor actions acquire these lazily; always name shared assets by the live action.
    for (const field of ['masks', 'sprites']) add(`action/${key}/${field}`, action[field], true);
  }
  add('actions', world.actions);
  const themes = world.terrain?.themes || [{ terrain: world.terrain }];
  themes.forEach(({ terrain }, index) => {
    if (!terrain) return;
    add('theme/' + index, terrain);
    for (const field of ['pieces', 'objects', 'recipe', 'sourceDescriptor', 'assemblyCatalog', 'compiledAssemblies', 'assemblySources', 'sourceGroups', 'wideSourceGroups']) {
      const value = terrain[field];
      if (value instanceof Map) for (const [key, item] of value) add(`asset/${index}/${field}/${key}`, item, true);
      else add(`asset/${index}/${field}`, value, true);
    }
  });
  const owner = (name, value) => {
    if (!value || typeof value !== 'object' || objects.has(value)) return;
    add(name, value); owners.set(name, value);
    for (const key of ['actions', 'runtime', 'masks', 'sprites']) add(name + '/' + key, value[key], true);
    if (!(value instanceof Map)) for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object' && !objects.has(child) && !Array.isArray(child) && !ArrayBuffer.isView(child) && !(child instanceof Map) && !(child instanceof Set) && Object.getPrototypeOf(child) !== Object.prototype) owner(name + '/' + key, child);
    }
  };
  add('world', world); owners.set('world', world);
  for (const key of ['population', 'stall', 'editChunks', 'terrainTileRevisions', 'hazards', 'triggerManager', 'hazardPlanner', 'basinRoutes', 'tunnelRoutes', 'lanePolicy']) owner(key, world[key]);
  add('terrainGrowth', world.terrainGrowth); add('scenery', world.scenery);
  return { objects, names, owners };
}

function createGraph(world) {
  const bound = bindings(world), nodes = [], seen = new Map();
  const encode = value => {
    if (value === undefined) return { special: 'undefined' };
    if (typeof value === 'number' && !Number.isFinite(value)) return { special: String(value) };
    if (value === null || typeof value !== 'object') return value;
    if (bound.objects.has(value)) return { external: bound.objects.get(value) };
    if (seen.has(value)) return { ref: seen.get(value) };
    const index = nodes.length; seen.set(value, index); nodes.push(null);
    let entry;
    if (ArrayBuffer.isView(value)) entry = { type: value.constructor.name, values: Array.from(value) };
    else if (value instanceof Map) entry = { type: 'Map', entries: [...Map.prototype.entries.call(value)].map(([k, v]) => [encode(k), encode(v)]) };
    else if (value instanceof Set) entry = { type: 'Set', values: [...value].map(encode) };
    else if (value instanceof MapObject) entry = { type: 'MapObject', props: props(value), image: encode(value.animation.objectImg) };
    else if (value instanceof Animation) entry = { type: 'Animation', props: props(value, new Set(['frames', '_lastFrame', 'frameCount'])), lastFrameIndex: value.frames.indexOf(value._lastFrame) };
    else if (value instanceof Trigger) entry = { type: 'Trigger', props: props(value), disabledUntilTick: value.disabledUntilTick };
    else if (value instanceof Lemming) entry = { type: 'Lemming', props: props(value) };
    else if (Array.isArray(value)) entry = { type: 'Array', values: value.map(encode), props: props(value, new Set(Object.keys(value).filter(k => /^\d+$/.test(k)))) };
    else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Unsupported checkpoint state: ' + value.constructor?.name);
      entry = { type: 'Object', props: props(value) };
    }
    nodes[index] = entry; return { ref: index };
  };
  const props = (value, extra = new Set()) => Object.fromEntries(Object.entries(value).filter(([key, v]) => !forbidden(key) && !OMIT.has(key) && !extra.has(key) && typeof v !== 'function').map(([key, v]) => [key, encode(v)]));
  const owners = [...bound.owners].map(([name, value]) => ({ name, props: props(value),
    ...(value instanceof Map ? { entries: [...Map.prototype.entries.call(value)].map(([k, v]) => [encode(k), encode(v)]) } : {}) }));
  return { nodes, owners };
}

const captureProcgenCheckpoint = world => ({ version: VERSION, generator: 'procgen-workstation-1', laneCount: world.laneCount, laneHeight: world.laneHeight,
  seed: world.seed, assets: assetIdentity(world), graph: createGraph(world),
  terrainAssignments: world.terrain?.exportAssignments?.() || null,
  terrainSettings: (world.terrain?.themes || [{ terrain: world.terrain }]).map(({ terrain }) => terrain ? { workstation: terrain.workstation, hazardSpacing: terrain.hazardSpacing, laneHeight: terrain.height, sharedSpanBudget: terrain.sharedSpanBudget } : null),
  growth: world.terrainGrowth?.exportState?.() || null, scenery: world.scenery?.snapshot?.() || null,
  clock: { speedFactor: world.timer.speedFactor, eventTimeMs: world.eventTimeMs } });

function restoreProcgenCheckpoint(world, saved) {
  if (saved?.version !== VERSION || saved.generator !== 'procgen-workstation-1' || saved.laneCount !== world.laneCount || saved.laneHeight !== world.laneHeight) throw new Error('Incompatible world checkpoint.');
  if (JSON.stringify(saved.assets) !== JSON.stringify(assetIdentity(world))) throw new Error('Checkpoint terrain assets do not match the installed collection.');
  const { nodes, owners } = saved.graph || {};
  if (!Array.isArray(nodes) || nodes.length > 2000000 || !Array.isArray(owners)) throw new Error('Invalid checkpoint graph.');
  const bound = bindings(world), values = new Array(nodes.length), pending = new Set();
  const decode = value => {
    if (!value || typeof value !== 'object') return value;
    if (value.special) {
      if (value.special === 'undefined') return undefined;
      if (value.special === 'Infinity') return Infinity;
      if (value.special === '-Infinity') return -Infinity;
      if (value.special === 'NaN') return NaN;
      throw new Error('Invalid checkpoint number.');
    }
    if (value.external) { if (!bound.names.has(value.external)) throw new Error('Missing checkpoint resource: ' + value.external); return bound.names.get(value.external); }
    const index = value.ref;
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new Error('Invalid checkpoint reference.');
    if (values[index]) return values[index];
    const entry = nodes[index]; let out;
    if (Object.hasOwn(TYPES, entry.type)) out = new TYPES[entry.type](entry.values);
    else if (entry.type === 'Map') out = new Map();
    else if (entry.type === 'Set') out = new Set();
    else if (entry.type === 'Array') out = [];
    else if (entry.type === 'Object') out = {};
    else if (entry.type === 'Lemming') out = new Lemming(0, 0, 0, world.runtime);
    else if (entry.type === 'Trigger') out = new Trigger();
    else if (entry.type === 'Animation') out = new Animation();
    else if (entry.type === 'MapObject') out = Object.create(MapObject.prototype);
    else throw new Error('Unknown checkpoint node type.');
    values[index] = out; pending.add(index);
    if (entry.type === 'Map') for (const [k, v] of entry.entries) out.set(decode(k), decode(v));
    if (entry.type === 'Set') for (const v of entry.values) out.add(decode(v));
    if (entry.type === 'Array') for (const value of entry.values) out.push(decode(value));
    if (entry.props) assign(out, entry.props);
    if (entry.type === 'Trigger') out.disabledUntilTick = entry.disabledUntilTick;
    pending.delete(index); return out;
  };
  const assign = (target, props) => { for (const [key, value] of Object.entries(props)) { if (forbidden(key) || OMIT.has(key)) throw new Error('Invalid checkpoint property.'); target[key] = decode(value); } };
  // Decode before replacing live owners; callers restore into a temporary world.
  const prepared = owners.map(entry => {
    if (!bound.owners.has(entry.name)) throw new Error('Unknown checkpoint owner.');
    return { entry, props: Object.fromEntries(Object.entries(entry.props).map(([key, value]) => { if (forbidden(key) || OMIT.has(key)) throw new Error('Invalid checkpoint property.'); return [key, decode(value)]; })), entries: entry.entries?.map(([k, v]) => [decode(k), decode(v)]) };
  });
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
  world.timer.speedFactor = saved.clock.speedFactor; world.eventTimeMs = saved.clock.eventTimeMs;
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

export { captureProcgenCheckpoint, restoreProcgenCheckpoint, assetIdentity };
