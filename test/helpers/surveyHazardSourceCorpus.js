export async function surveyHazardSourceCorpus(trial) {
  const require = (condition, message) => { if (!condition) throw new Error(message); }, world = trial.world, terrain = world.terrain, seed = world.laneSeeds[0];
  world.generatedThrough[0] = 5000; let record;
  for (let chunk = 0; chunk < 32; chunk++) {
    const value = world.hazards._chunk(0, chunk, world.tickIndex);
    if (value?.entries.some(Boolean)) { record = value; break; }
  }
  require(record, 'No real generated hazard source found');
  const hash = () => trial.snapshot().physicalStateHash, before = hash(), descriptor = record.descriptor, entries = record.entries, index = entries.findIndex(Boolean), entry = entries[index], object = entry.object, key = world.hazards._key(record.lane, record.chunk), failures = [];
  let getters = 0;
  const refuse = (kind, codes, mutate, repair) => {
    mutate(); let error;
    try { hash(); } catch (failure) { error = failure; } finally { repair(); }
    require(codes.includes(error?.code), 'Hazard source corruption qualified: ' + kind); require(hash() === before, 'Hazard source repair failed: ' + kind);
    failures.push({ kind, code: error.code, field: error.field ?? error.cacheKind });
  };
  refuse('wrong-descriptor', ['unverified-hazard-source'], () => { record.descriptor = terrain.describe(seed, record.chunk + 2); }, () => { record.descriptor = descriptor; });
  refuse('unproved-record', ['unverified-hazard-source'], () => world.hazards.chunks.set(key, { ...record }), () => world.hazards.chunks.set(key, record));
  refuse('cross-key-record', ['unverified-hazard-source'], () => world.hazards.chunks.set(key + 100, record), () => world.hazards.chunks.delete(key + 100));
  refuse('cloned-object', ['unverified-hazard-source'], () => { entry.object = { ...object }; }, () => { entry.object = object; });
  const field = Object.getOwnPropertyDescriptor(record, 'descriptor');
  refuse('descriptor-accessor', ['unverified-hazard-source'], () => Object.defineProperty(record, 'descriptor', { configurable: true, get() { getters++; throw new Error('Unexpected descriptor read'); } }), () => Object.defineProperty(record, 'descriptor', field));
  const source = terrain.forSeed ? terrain.forSeed(seed) : terrain, descriptionKey = seed + ':' + record.chunk;
  const resident = source.descriptions.get(descriptionKey); source.descriptions.delete(descriptionKey);
  require(hash() === before, 'Pristine retained descriptor eviction changed identity');
  descriptor.left++;
  try { let failure; try { hash(); } catch (error) { failure = error; } require(failure?.code === 'changed-generated-terrain-cache', 'Changed evicted descriptor qualified'); failures.push({ kind: 'changed-evicted-descriptor', code: failure.code, field: failure.cacheKind }); }
  finally { descriptor.left--; if (resident) source.descriptions.set(descriptionKey, resident); }
  require(hash() === before, 'Evicted descriptor repair failed');
  const image = object.piece.image, original = image.trigger_width; image.trigger_width = original + 1;
  let metadataDistinct;
  try { metadataDistinct = hash() !== before; require(metadataDistinct, 'Hazard trigger metadata was omitted'); }
  finally { image.trigger_width = original; }
  require(hash() === before && getters === 0, 'Hazard metadata recovery failed or invoked a getter');
  const recovered = hash(), growth = world.terrainGrowth, growthState = growth._prepare(0, 40, world._prepareGrowthChunk), plan = growthState.plan, growthKey = seed + ':40', growthBefore = hash(), growthFailures = [];
  const heldPlan = source.growthPlans.get(growthKey), heldDescriptor = source.descriptions.get(growthKey);
  source.growthPlans.delete(growthKey); source.descriptions.delete(growthKey);
  require(hash() === growthBefore, 'Pristine retained growth eviction changed identity');
  const refuseGrowth = (kind, mutate, repair) => {
    mutate(); let error; try { hash(); } catch (failure) { error = failure; } finally { repair(); }
    require(error?.code === 'unverified-world-cache-binding', 'Unproved retained growth qualified: ' + kind); require(hash() === growthBefore, 'Growth repair did not recover: ' + kind);
    growthFailures.push({ kind, code: error.code, field: error.field, sourceCode: error.sourceCode });
  };
  refuseGrowth('changed-evicted-growth-descriptor', () => { plan.descriptor.left++; }, () => { plan.descriptor.left--; });
  refuseGrowth('unproved-plan', () => { growthState.plan = { ...plan }; }, () => { growthState.plan = plan; });
  const queue = growth.queues[0], queueIndex = queue.indexOf(growthState);
  refuseGrowth('detached-queue-state', () => { queue[queueIndex] = { ...growthState }; }, () => { queue[queueIndex] = growthState; });
  if (heldPlan) source.growthPlans.set(growthKey, heldPlan); if (heldDescriptor) source.descriptions.set(growthKey, heldDescriptor);
  require(hash() === growthBefore, 'Growth residency repair changed identity');
  return { lane: record.lane, chunk: record.chunk, objectIndex: index, before, recovered, failures, getters, metadataDistinct,
    growth: { before: growthBefore, recovered: hash(), failures: growthFailures, pristineEvictionStable: true },
    scope: 'Fresh independently loaded real source and hazard owner; descriptor/object bindings and local trigger metadata, with no live world or output mutation.' };
}
