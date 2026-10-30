export async function surveyCausalContinuationCorpus(createTrial) {
  const scenario = { id: 'causal-continuation-corpus', environmentSeed: 42, horizonTicks: 128, checkpointEvery: 64,
    physicalLaneCount: 1, cohort: { size: 2, birthInterval: 0 }, goal: { x: 1000, y: 64, width: 16, height: 16 },
    geometry: { solid: [{ x: 8, y: 72, width: 2048, height: 24 }], steel: [] }, worldOptions: { assists: false } };
  const require = (condition, message) => { if (!condition) throw new Error(message); }, results = [];
  for (const kind of ['actor-order', 'causal-sequence', 'fact-capacity', 'frame-interval']) {
    const trials = [await createTrial(scenario), await createTrial(scenario)], batches = [[], []];
    try {
      for (const trial of trials) trial.step(16);
      const before = trials.map(trial => trial.snapshot().physicalStateHash); require(before[0] === before[1], 'Initial causal worlds differ');
      const changed = trials[1].world;
      if (kind === 'actor-order') changed.actors.reverse();
      if (kind === 'causal-sequence') changed.soundEvents._causalSequence += 100;
      if (kind === 'fact-capacity') changed.soundEvents._maxFacts = 0;
      if (kind === 'frame-interval') changed.timer.TIME_PER_FRAME_MS = 30;
      const after = trials.map(trial => trial.snapshot().physicalStateHash); require(after[0] !== after[1], 'Continuation omitted: ' + kind);
      for (const [index, trial] of trials.entries()) { trial.world.soundEvents.onBatch.on(batch => batches[index].push(batch)); trial.step(); }
      const facts = batches.map(rows => rows.flatMap(batch => batch.facts));
      if (kind === 'actor-order') {
        const order = facts.map(rows => rows.filter(row => row.kind === 'MotionCommitted').map(row => row.actorId));
        require(order[0].length >= 2 && order[1].length === order[0].length && order[0][0] !== order[1][0], 'Actual actor fact order did not change');
      }
      if (kind === 'causal-sequence') require(facts[0][0]?.eventId && facts[1][0]?.eventId && facts[0][0].eventId !== facts[1][0].eventId, 'Causal identity did not affect actual facts');
      if (kind === 'fact-capacity') require(batches[0][0].completeness.status === 'complete' && batches[1][0].completeness.status === 'incomplete' && batches[1][0].completeness.dropped > 0, 'Capacity did not affect actual completeness');
      if (kind === 'frame-interval') require(trials[0].world.simulationTimeMs - trials[1].world.simulationTimeMs === 30, 'Physical interval did not affect actual clock');
      results.push({ kind, before, after, firstEvents: facts.map(rows => rows[0]?.eventId ?? null),
        motionOrder: facts.map(rows => rows.filter(row => row.kind === 'MotionCommitted').map(row => row.actorId)), completeness: batches.map(rows => rows[0].completeness), simulationTimeMs: trials.map(trial => trial.world.simulationTimeMs) });
    } finally { for (const trial of trials) trial.dispose(); }
  }
  const trial = await createTrial(scenario); let getters = 0;
  try {
    trial.step(16); const world = trial.world, before = trial.snapshot().physicalStateHash, failures = [];
    const refuse = (kind, field, mutate, repair) => {
      mutate(); let error;
      try { trial.snapshot(); } catch (failure) { error = failure; } finally { repair(); }
      require(error?.code === 'invalid-physical-continuation' && error.field === field, 'Continuation corruption qualified: ' + kind);
      require(trial.snapshot().physicalStateHash === before, 'Continuation repair did not recover: ' + kind); failures.push({ kind, code: error.code, field: error.field });
    };
    const registry = world._authoritativeActors, actors = world.actors, work = world._stallWork, getter = () => { getters++; throw new Error('Unexpected continuation getter'); };
    refuse('empty-registry', 'actor-registry', () => { world._authoritativeActors = new WeakSet(); }, () => { world._authoritativeActors = registry; });
    refuse('registry-hook', 'actor-registry', () => Object.defineProperty(registry, 'has', { configurable: true, get: getter }), () => { delete registry.has; });
    refuse('duplicate-actor', 'actor-registry', () => actors.push(actors[0]), () => actors.pop());
    refuse('foreign-actor', 'actor-registry', () => actors.push({ id: 99 }), () => actors.pop());
    refuse('actor-accessor', 'actor-order', () => Object.defineProperty(actors, 0, { configurable: true, get: getter }), () => Object.defineProperty(actors, 0, { configurable: true, enumerable: true, writable: true, value: trial._records[0].actor }));
    refuse('detached-work', 'stall-work', () => { world._stallWork = { ...work, pendingTerrainWork: new Uint32Array(world.laneCount) }; }, () => { world._stallWork = work; });
    const workDescriptor = Object.getOwnPropertyDescriptor(work, 'pendingTerrainWork');
    refuse('work-accessor', 'stall-work', () => Object.defineProperty(work, 'pendingTerrainWork', { configurable: true, get: getter }), () => Object.defineProperty(work, 'pendingTerrainWork', workDescriptor));
    const bus = world.soundEvents, sequence = bus._causalSequence;
    refuse('invalid-sequence', '_causalSequence', () => { bus._causalSequence = NaN; }, () => { bus._causalSequence = sequence; });
    const interval = world.timer.TIME_PER_FRAME_MS;
    refuse('invalid-clock', 'physical-clock', () => { world.timer.TIME_PER_FRAME_MS = 0; }, () => { world.timer.TIME_PER_FRAME_MS = interval; });
    refuse('pending-fact', 'fact-boundary', () => bus.beginTick({ worldId: world.worldId, generation: world.generation, tick: world.tickIndex, terrainRevisionBefore: world.terrainRevision }), () => bus.abortTick());
    refuse('quarantined-owner', 'survey-observer', () => bus.onBatch.quarantined.add(trial._batchListener), () => bus.onBatch.quarantined.delete(trial._batchListener));
    refuse('detached-owner', 'survey-observer', () => bus.onBatch.off(trial._batchListener), () => bus.onBatch.on(trial._batchListener));
    const passive = () => {}; bus.onEvent.on(passive); bus.onBatch.on(passive); bus._queueLimit = 1; bus._queue.push({ diagnostic: true }); bus.deliveryErrors++;
    require(trial.snapshot().physicalStateHash === before, 'Delivery-only state changed physical identity');
    bus._queue.length = 0; bus.onEvent.off(passive); bus.onBatch.off(passive);
    require(getters === 0, 'Continuation getter was evaluated'); results.push({ kind: 'binding-refusals', failures, getters, deliveryStable: true });
  } finally { trial.dispose(); }
  return results;
}
