export async function authoredCausalTape({ createWorld, journal, ticks = 128, sourceRoot = new URL('../../js/app/procgen/', import.meta.url), onProgress = () => {} } = {}) {
  if (!Number.isSafeInteger(ticks) || ticks < 128 || ticks > 10000 || ticks % 2) throw new Error('Unsupported authored tape window.');
  const [take, music, score, checkpoints, evidence, replay, branching, performanceState, identity, actors] = await Promise.all([
    import(new URL('workstation/CausalTake.js', sourceRoot)), import(new URL('workstation/CausalMusicEngine.js', sourceRoot)),
    import(new URL('workstation/ProcgenPhysicalScoreClock.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot)),
    import(new URL('workstation/ProcgenCheckpointProvenance.js', sourceRoot)), import(new URL('workstation/CausalReperformance.js', sourceRoot)),
    import(new URL('workstation/CausalPhysicalBranch.js', sourceRoot)), import(new URL('workstation/CausalPerformanceState.js', sourceRoot)),
    import(new URL('workstation/CausalRuntimeIdentity.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot))]);
  const require = (value, message) => { if (!value) throw new Error(message); }, owner = await createWorld(), world = owner.world || owner, takeId = 'take:authored:' + ticks;
  const graph = revision => ({ version: 1, revision, instruments: [
    { id: 'brick', sourceKind: 'TerrainWorkCommitted', pitchCents: 6000 + revision, velocity01: 1, role: 'builder', route: 'local' },
    { id: 'crossing', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6200 + revision, velocity01: 0.5, role: 'travel', route: 'local' }
  ] });
  let mapping = graph(1), bpm = 120, playing = true, service = null, branch = null, callbackFailure = null;
  const scoreClock = score.createProcgenPhysicalScoreClock(), performance = performanceState.createCausalPerformanceState(performanceState.captureCausalPerformanceState([{ id: 'lane-a', instrumentControls: { macros: { hardness: 0.2 } } }, { id: 'lane-b' }]));
  const engine = music.createCausalMusicEngine({ getGraph: () => world.physicalAuthoring?.graph || mapping, scoreTimeline: scoreClock, traceLimit: 0,
    getPerformanceState: () => performance.snapshot(), getOnsetControls: source => performance.getControls(source) });
  const sourceVersions = identity.causalRuntimeSourceVersions(world, mapping.revision), counts = {}, controls = [], started = globalThis.performance.now();
  const snapshot = () => ({ world: checkpoints.captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: scoreClock.snapshot(), replay: { version: 2, bpm, scoreTimeline: true, playing } });
  let recorder = null, listener = null, midpoint = null, midpointHash = null;
  try {
    const walking = world.actors.find(actor => actor.laneIndex === 1), falling = world.actors.find(actor => actor.laneIndex === 0);
    require(walking && falling, 'Authored tape needs two initial real actors.');
    walking.y = world.surfaceAt(1, walking.x); walking.setAction(world.actions[actors.LemmingStateType.WALKING]);
    falling.y = world.laneHeight - 1; falling.setAction(world.actions[actors.LemmingStateType.FALLING]);
    const initial = snapshot(), assetRefs = initial.world.assets;
    recorder = await take.createCausalTakeRecorder({ journal, takeId, takeName: 'Authored causal tape ' + ticks, documentId: 'doc:authored-tape', sourceVersions,
      assetRefs, mapping, initialCheckpoint: initial, boundaryState: { voices: [], timeline: scoreClock.snapshot() } });
    const boundary = () => ({ tick: world.tickIndex, generation: world.generation });
    const admit = result => { require(result?.status === 'accepted', 'Authored input was not admitted: ' + JSON.stringify(result)); return result; };
    const observe = input => { admit(recorder.recordInput(input, boundary())); controls.push({ ...boundary(), input }); };
    const command = value => { const outcome = world.enqueueIntervention(value); require(outcome.status === 'queued', 'Authored command did not queue.'); admit(recorder.recordIntervention(value, outcome, boundary())); return outcome; };
    command({ id: 'authored:builder', kind: 'assign-worker', origin: 'manual', target: { generation: world.generation, actorId: walking.id }, parameters: { workerKind: 'builders' } });
    listener = batch => {
      try {
        for (const fact of batch.facts) counts[fact.kind] = (counts[fact.kind] || 0) + 1;
        scoreClock.observe(batch, { bpm });
        admit(recorder.recordCommittedBatch({ batch, intents: playing ? engine.processBatch(batch) : [] }));
      } catch (error) { callbackFailure = error; }
    };
    world.soundEvents.onBatch.on(listener);
    for (let completed = 1; completed <= ticks; completed++) {
      if (completed === 64) { playing = false; observe({ version: 2, kind: 'transport-state', playing: false, speedFactor: 0 }); world.timer.speedFactor = 0;
        observe({ version: 2, kind: 'transport-state', playing: false, speedFactor: 6 }); world.timer.speedFactor = 6; }
      world.step(); if (callbackFailure) throw callbackFailure;
      if (completed === 10) { bpm = 90; admit(recorder.recordTimeline({ version: 1, kind: 'tempo', bpm }, boundary())); controls.push({ ...boundary(), input: { kind: 'tempo', bpm } }); }
      if (completed === 12) { observe({ version: 1, kind: 'world-speed', speedFactor: 6 }); world.timer.speedFactor = 6; }
      if (completed === 14) observe({ version: 1, kind: 'external-observation', sourceId: 'captured:external-port', effect: 'observation-only', timestamp: 1234.567, bytes: [0x90, 60, 1] });
      if (completed === 16) { mapping = graph(2); world.configurePhysicalAuthoring(mapping); admit(recorder.recordMapping(mapping, boundary())); controls.push({ ...boundary(), input: { kind: 'mapping', revision: mapping.revision } }); }
      if (completed === 20) {
        const next = performanceState.captureCausalPerformanceState([{ id: 'lane-a', instrumentControls: { macros: { hardness: 0.8 }, variationSeed: 19 } }, { id: 'lane-b' }]);
        const change = performanceState.diffCausalPerformanceState(performance.snapshot(), next); admit(recorder.recordPerformance(change, boundary())); performance.apply(change); controls.push({ ...boundary(), input: { kind: 'instrument-performance' } });
      }
      if (completed === 24) command({ id: 'authored:release-policy', kind: 'set-release-policy', origin: 'manual', target: { generation: world.generation }, parameters: { spawnBeatTicks: 8 } });
      if (completed === 30) {
        command({ id: 'authored:cancelled-policy', kind: 'set-release-policy', origin: 'manual', target: { generation: world.generation }, applyAtTick: world.tickIndex + 10, parameters: { spawnBeatTicks: 12 } });
        observe({ version: 1, kind: 'intervention-cancel', commandId: 'authored:cancelled-policy' }); require(world.cancelIntervention('authored:cancelled-policy'), 'Source cancellation failed.');
      }
      if (completed === 64) { observe({ version: 2, kind: 'transport-state', playing: true, speedFactor: 6 }); playing = true; world.timer.speedFactor = 6; }
      if (completed === ticks / 2) {
        const marker = admit(recorder.mark({ label: 'Authored midpoint' }, boundary())); midpoint = marker.lastSequence;
        await recorder.checkpoint({ value: snapshot(), ...boundary() }); midpointHash = await evidence.hashProcgenContinuationCheckpoint(checkpoints.captureProcgenCheckpoint(world));
      }
      if (completed % 32 === 0) await recorder.flush();
      if (completed % 1000 === 0) onProgress({ phase: 'recording', ticks: completed });
    }
    observe({ version: 2, kind: 'transport-state', playing: false, speedFactor: 0 }); playing = false; world.timer.speedFactor = 0;
    const final = snapshot(), expectedHash = await evidence.hashProcgenContinuationCheckpoint(final.world), stopped = await recorder.stop({ finalCheckpoint: final });
    require(stopped.complete, 'Authored tape did not finalize its full prefix.');
    for (const kind of ['ActorBorn', 'ActorLaneTransferred', 'TerrainWorkCommitted', 'CommandApplied']) require(counts[kind] > 0, 'Authored tape lacks required actual fact: ' + kind);
    const parent = await journal.openTake(takeId), original = JSON.stringify(parent), recordingMs = globalThis.performance.now() - started;
    service = replay.createCausalReperformance({ journal, createWorld, sourceVersions, assetRefs, liveWorld: world, maxTicks: ticks, pageRecords: 512 });
    const progress = value => onProgress({ phase: value.phase, ticks: value.ticks, sequence: value.sequence });
    onProgress({ phase: 'replay', ticks }); const replayStarted = globalThis.performance.now();
    const full = await service.reperform({ takeId, executionEpoch: 'authored:full', onProgress: progress });
    require(full.receipt.compatibilityMatch && full.receipt.ticksExecuted === ticks && full.receipt.actualContinuationHash === expectedHash && full.receipt.finalWorldParity === 'matched-at-captured-component-checkpoint', 'Authored replay diverged: ' + JSON.stringify(full.receipt));
    const replayMs = globalThis.performance.now() - replayStarted;
    const repeated = await service.reperform({ takeId, executionEpoch: 'authored:repeated' });
    require(repeated.receipt.compatibilityMatch && repeated.receipt.ticksExecuted === 0, 'Authored final checkpoint was not reused.');
    const seek = await service.reperform({ takeId, throughSequence: midpoint, executionEpoch: 'authored:seek' });
    require(seek.receipt.compatibilityMatch && seek.receipt.ticksExecuted === 0 && seek.receipt.actualContinuationHash === midpointHash, 'Authored midpoint seek diverged.');
    onProgress({ phase: 'branch', ticks: ticks / 2 });
    const opened = await branching.createCausalPhysicalBranch({ journal, reperformance: service, parentTakeId: takeId, throughSequence: midpoint,
      takeId: takeId + ':child', takeName: 'Authored alternate', executionEpoch: 'authored:branch' });
    branch = opened.branch; require(branch, 'Authored branch could not prepare.'); await branch.advance({ ticks: 32 });
    const child = await branch.stop(); await branch.dispose(); branch = null; require(child.complete, 'Authored branch prefix did not finalize.');
    await journal.verify(child.takeId);
    require(JSON.stringify(await journal.openTake(takeId)) === original && world.tickIndex === ticks && await evidence.hashProcgenContinuationCheckpoint(checkpoints.captureProcgenCheckpoint(world)) === expectedHash, 'Branch or replay changed its source.');
    return { ticks, takeId, parentCanonicalHash: parent.canonicalHash, parentDurableSequence: parent.durableSequence, counts, controls, midpoint, midpointHash, expectedHash,
      recordingMs, replayMs, full: full.receipt, repeated: repeated.receipt, seek: seek.receipt, branch: opened.receipt, childTakeId: child.takeId,
      cache: service.cacheState(), sourceUnchanged: true, sourceVersions, scope: 'Actual authored physical/semantic tape and silent current-runtime continuation; source and external observations are retained data, not a device/archived/acoustic qualification.' };
  } finally {
    if (listener) world.soundEvents.onBatch.off(listener);
    if (branch) await branch.dispose();
    if (service) { const receipt = service.dispose(); await receipt.completion; require(receipt.outcome === 'complete', 'Authored replay resources did not retire.'); }
    engine.dispose(); const retired = owner.dispose(); if (retired?.completion) await retired.completion;
  }
}
