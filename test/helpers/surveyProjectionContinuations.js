export async function surveyProjectionContinuations(createTrial) {
  const scenario = { id: 'projection-continuation-corpus', environmentSeed: 42, horizonTicks: 128, checkpointEvery: 16, physicalLaneCount: 1,
    cohort: { size: 1, birthInterval: 0 }, goal: { x: 1000, y: 64, width: 16, height: 16 },
    geometry: { solid: [{ x: 8, y: 72, width: 2048, height: 24 }], steel: [] }, worldOptions: { assists: false } };
  const require = (condition, message) => { if (!condition) throw new Error(message); }, results = [];
  for (const kind of ['speed', 'intervention', 'contact']) {
    const baseline = await createTrial(scenario), changed = await createTrial(scenario), facts = [[], []], durations = [[], []];
    try {
      baseline.step(32); changed.step(32); require(baseline.snapshot().physicalStateHash === changed.snapshot().physicalStateHash, 'Initial worlds differ: ' + kind);
      for (const [index, trial] of [baseline, changed].entries()) trial.world.soundEvents.onBatch.on(batch => { facts[index].push(...batch.facts); durations[index].push(batch.tickDurationMs); });
      const actor = changed.world.actors[0]; require(actor, 'Missing continuation actor');
      if (kind === 'speed') changed.world.timer.speedFactor = 2;
      else if (kind === 'intervention') {
        const receipt = changed.world.enqueueIntervention({ id: 'projection.builder', kind: 'assign-worker', origin: 'manual', target: { generation: changed.world.generation, actorId: actor.id }, parameters: { workerKind: 'builders' } });
        require(receipt.status === 'queued', 'Intervention was not queued');
      } else { require(actor._physicalContactSpan, 'No actual contact continuation'); actor._physicalContactSpan = null; }
      const before = [baseline.snapshot().physicalStateHash, changed.snapshot().physicalStateHash]; require(before[0] !== before[1], 'Changed continuation was omitted: ' + kind);
      baseline.step(16); changed.step(16); const after = [baseline.snapshot(), changed.snapshot()]; require(after[0].physicalStateHash !== after[1].physicalStateHash, 'Continuation state falsely matched: ' + kind);
      if (kind === 'speed') require(durations[0].every(value => value > 0) && durations[1].every(value => value > 0) && durations[0][0] !== durations[1][0], 'Speed did not affect declared physical tick duration');
      if (kind === 'intervention') require(facts[1].some(fact => fact.kind === 'CommandApplied' && fact.commandId === 'projection.builder' && fact.status === 'accepted') && changed.world.stats.builds > baseline.world.stats.builds, 'The real worker command did not apply');
      if (kind === 'contact') require(facts[1].filter(fact => fact.kind === 'ContactSpanBegan').length > facts[0].filter(fact => fact.kind === 'ContactSpanBegan').length, 'Contact continuity did not affect future facts');
      results.push({ kind, tick: baseline.world.tickIndex, before, after: after.map(value => ({ physical: value.physicalStateHash, events: value.eventHash })), facts: facts.map(rows => rows.length), tickDurationsMs: durations.map(rows => rows[0]) });
    } finally { baseline.dispose(); changed.dispose(); }
  }
  const trial = await createTrial(scenario); let getters = 0;
  try {
    const before = trial.snapshot().physicalStateHash, typed = trial.world.frontiers, getter = () => { getters++; throw new Error('Unexpected state metadata access'); };
    for (const key of ['constructor', 'length', 'byteLength', 'byteOffset', 'buffer', Symbol.iterator]) Object.defineProperty(typed, key, { configurable: true, get: getter });
    try { require(trial.snapshot().physicalStateHash === before, 'Intrinsic view metadata changed identity'); }
    finally { for (const key of ['constructor', 'length', 'byteLength', 'byteOffset', 'buffer', Symbol.iterator]) delete typed[key]; }
    const state = trial.world.interventionState, pending = state.pending;
    pending.length = 1; const hole = trial.snapshot().physicalStateHash; pending[0] = undefined;
    const holesDistinct = trial.snapshot().physicalStateHash !== hole; pending.length = 0; require(holesDistinct, 'Sparse holes collapsed into explicit undefined');
    const prior = Object.getOwnPropertyDescriptor(pending, 0); let refusal = null;
    Object.defineProperty(pending, 0, { configurable: true, enumerable: true, get: getter });
    try { trial.snapshot(); } catch (error) { refusal = error.code; }
    finally { if (prior) Object.defineProperty(pending, 0, prior); else { delete pending[0]; pending.length = 0; } }
    require(refusal === 'accessor-state-data', 'Nested accessor was silently omitted'); require(getters === 0, 'State capture executed an accessor');
    results.push({ kind: 'intrinsic-and-accessor', getters, refusal, holesDistinct });
  } finally { trial.dispose(); }
  return results;
}
