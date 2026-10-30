import { verifyGeneratedTerrainChunkBinding, verifyGeneratedTerrainGrowthBinding } from './ProcgenTerrainCacheEvidence.js';
import { ProcgenSurveyTerrain, verifyControlledSurveyChunkBinding } from './survey/ProcgenSurveyTerrain.js';

const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype), typeOf = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get,
  lengthOf = Object.getOwnPropertyDescriptor(typedPrototype, 'length').get;
const fail = (field, lane = null, index = null, sourceCode = null) => { throw Object.assign(new Error('Physical world cache binding is unverified: ' + field + '.'),
  { name: 'SurveyStateProjectionError', code: 'unverified-world-cache-binding', field, lane, index, sourceCode }); };
const own = (value, key) => {
  const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail('accessor:' + String(key)); return descriptor?.value;
};
const indices = (value, size, field) => { if (!ArrayBuffer.isView(value) || typeOf.call(value) !== 'Int32Array' || lengthOf.call(value) !== size) fail(field); return value; };
const array = (value, size, field) => { if (!Array.isArray(value) || value.length !== size) fail(field); return value; };
const width = (value, maximum, field) => { if (!Number.isInteger(value) || value < 1 || value > maximum || value & (value - 1)) fail(field); return value; };

export function verifyProcgenWorldCacheBindings(world) {
  const lanes = own(world, 'laneCount'), terrain = own(world, 'terrain'), seeds = own(world, 'laneSeeds');
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 1024 || !ArrayBuffer.isView(seeds) || typeOf.call(seeds) !== 'Uint32Array' || lengthOf.call(seeds) !== lanes) fail('lane-shape');
  const collisionWidth = width(own(world, '_chunkSlots'), 1024, 'collision-width'), editWidth = width(own(world, '_editSlots'), 4096, 'edit-width');
  const collision = array(own(world, '_collisionSlots'), lanes * collisionWidth, 'collision-slots'), collisionIndices = indices(own(world, '_collisionIndices'), collision.length, 'collision-indices');
  const lastChunks = array(own(world, '_laneChunk'), lanes, 'lane-chunks'), lastChunkIndices = indices(own(world, '_laneChunkIndex'), lanes, 'lane-chunk-indices');
  const edits = own(world, 'editChunks'), cold = own(edits, 'cold'), editSlots = array(own(world, '_editCache'), lanes * editWidth, 'edit-slots'), editIndices = indices(own(world, '_editIndices'), editSlots.length, 'edit-indices');
  const lastEdits = array(own(world, '_laneEdits'), lanes, 'lane-edits'), lastEditIndices = indices(own(world, '_laneEditIndex'), lanes, 'lane-edit-indices');
  if (!(edits instanceof Map) || !(cold instanceof Map)) fail('edit-owner');
  const checked = new WeakMap();
  const collisionBinding = (value, lane, index, field) => {
    if (!Number.isInteger(index) || index < -1) fail(field, lane, index); if (index === -1) return;
    if (!value || typeof value !== 'object') fail(field, lane, index);
    const key = seeds[lane] + ':' + index; if (checked.get(value) === key) return;
    try {
      if (terrain instanceof ProcgenSurveyTerrain) verifyControlledSurveyChunkBinding(terrain, seeds[lane], index, value);
      else verifyGeneratedTerrainChunkBinding(terrain, seeds[lane], index, value);
    } catch (error) { fail(field, lane, index, error.code); }
    checked.set(value, key);
  };
  const editBinding = (value, lane, index, field) => {
    if (!Number.isInteger(index) || index < -1 || index >= 0x2000000) fail(field, lane, index); if (index === -1) return;
    const key = lane * 0x2000000 + index, expected = Map.prototype.get.call(edits, key);
    if (value !== expected || !expected && Map.prototype.has.call(cold, key)) fail(field, lane, index);
  };
  const lastEditKey = own(edits, '_lastKey');
  if (Number.isSafeInteger(lastEditKey) && lastEditKey >= 0 && lastEditKey < lanes * 0x2000000) {
    editBinding(own(edits, '_lastChunk'), Math.floor(lastEditKey / 0x2000000), lastEditKey % 0x2000000, 'edit-owner-last');
  }
  for (let slot = 0; slot < collision.length; slot++) {
    const lane = Math.floor(slot / collisionWidth), index = collisionIndices[slot];
    if (index >= 0 && (index & (collisionWidth - 1)) !== slot % collisionWidth) fail('collision-slot-index', lane, index);
    collisionBinding(own(collision, slot), lane, index, 'collision-slot');
  }
  for (let slot = 0; slot < editSlots.length; slot++) {
    const lane = Math.floor(slot / editWidth), index = editIndices[slot];
    if (index >= 0 && (index & (editWidth - 1)) !== slot % editWidth) fail('edit-slot-index', lane, index);
    editBinding(own(editSlots, slot), lane, index, 'edit-slot');
  }
  for (let lane = 0; lane < lanes; lane++) {
    collisionBinding(own(lastChunks, lane), lane, lastChunkIndices[lane], 'lane-collision');
    editBinding(own(lastEdits, lane), lane, lastEditIndices[lane], 'lane-edit');
  }
  const assisted = own(world, '_assistedColumn'); if (!assisted || typeof own(assisted, 'valid') !== 'boolean') fail('assisted-column');
  const growth = own(world, 'terrainGrowth'), growthSources = [];
  if (growth) {
    const states = own(growth, 'states'), queues = array(own(growth, 'queues'), lanes, 'growth-queues');
    if (!(states instanceof Map)) fail('growth-states');
    for (const [key, state] of Map.prototype.entries.call(states)) {
      const lane = own(state, 'lane'), chunk = own(state, 'chunk'), plan = own(state, 'plan');
      if (!Number.isInteger(lane) || lane < 0 || lane >= lanes || !Number.isInteger(chunk) || chunk < 0 || key !== lane * 0x800000 + chunk) fail('growth-state-key', lane, chunk);
      try { growthSources.push({ key, planHash: verifyGeneratedTerrainGrowthBinding(terrain, seeds[lane], chunk, plan) }); }
      catch (error) { fail('growth-plan', lane, chunk, error.code); }
    }
    for (let lane = 0; lane < lanes; lane++) {
      const queue = own(queues, lane); if (!Array.isArray(queue)) fail('growth-queue', lane);
      for (let index = 0; index < queue.length; index++) { const state = own(queue, index); if (own(state, 'lane') !== lane || Map.prototype.get.call(states, lane * 0x800000 + own(state, 'chunk')) !== state) fail('growth-queue-binding', lane, index); }
    }
  }
  return { activeAssistedColumn: own(assisted, 'valid') ? assisted : null, growthSources };
}
