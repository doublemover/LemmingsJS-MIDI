const invalid = field => { throw Object.assign(new Error('Invalid survey physical continuation: ' + field), { name: 'SurveyStateProjectionError', code: 'invalid-physical-continuation', field }); };
const own = (value, key, field) => {
  const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid(field);
  return descriptor.value;
};
const captureSurveyContinuations = (world, actorRecords, observers, physicalOnly) => {
  const registry = world._authoritativeActors, actors = world.actors, order = [], seen = new Set();
  if (!registry || Object.getPrototypeOf(registry) !== WeakSet.prototype || Object.getOwnPropertyNames(registry).length) invalid('actor-registry');
  if (!Array.isArray(actors) || Object.getPrototypeOf(actors) !== Array.prototype || Object.hasOwn(actors, Symbol.iterator)) invalid('actor-order');
  for (let index = 0; index < actors.length; index++) {
    const actor = own(actors, index, 'actor-order'), record = WeakMap.prototype.get.call(actorRecords, actor);
    if (!record || record.generation !== world.generation || own(actor, 'id', 'actor-identity') !== record.actorId || seen.has(actor) || !WeakSet.prototype.has.call(registry, actor)) invalid('actor-registry');
    seen.add(actor); order.push({ identity: record.id, generation: record.generation });
  }
  const work = world._stallWork;
  if (own(work, 'terrainActivityTicks', 'stall-work') !== world.terrainActivityTicks || own(work, 'pendingTerrainWork', 'stall-work') !== world._effectiveTerrainWork) invalid('stall-work');
  const bus = world.soundEvents;
  const sealed = own(bus, '_sealed', 'fact-boundary');
  if (own(bus, '_tick', 'fact-boundary') !== null || !Array.isArray(sealed) || sealed.length) invalid('fact-boundary');
  for (const [key, observer] of Object.entries(observers)) {
    const handler = own(bus, key, 'survey-observer'), handlers = own(handler, 'handlers', 'survey-observer'), quarantined = own(handler, 'quarantined', 'survey-observer');
    if (!Set.prototype.has.call(handlers, observer) || Set.prototype.has.call(quarantined, observer) ||
        !own(handler, '_snapshotDirty', 'survey-observer') && !Array.prototype.includes.call(own(handler, '_snapshot', 'survey-observer'), observer)) invalid('survey-observer');
  }
  const facts = {};
  for (const key of ['_causalSequence', '_maxFacts', '_maxTerminalFacts', '_maxFactBytes', '_maxTerminalFactBytes']) {
    const value = own(bus, key, key);
    if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) invalid(key);
    facts[key] = value;
  }
  facts.coverage = own(bus, 'identityCoverage', 'fact-coverage');
  if (!['complete', 'legacy-unavailable'].includes(facts.coverage)) invalid('fact-coverage');
  const tickDurationMs = own(world.timer, 'TIME_PER_FRAME_MS', 'physical-clock');
  if (!Number.isFinite(tickDurationMs) || tickDurationMs <= 0) invalid('physical-clock');
  return { actorOrder: order, facts, tickDurationMs, ...(physicalOnly ? {} : { legacySequence: own(bus, '_sequence', 'legacy-sequence') }) };
};
export { captureSurveyContinuations };
