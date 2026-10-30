// Shared by native Node and the immutable browser application. Geometry is an
// explicit authored source; action tables, work facts and intent construction
// are the production implementations, with no processor or terrain overrides.
export const workCycleLayout = (kind = 'clock') => {
  const region = (material, y1 = 0) => ({ kind: material, x1: 8, x2: 512, y1, y2: 96, color: 0xff6c8294 });
  const lanes = kind === 'clock' ? [[region('solid', 80)], [region('solid')]] : [kind === 'empty' ? [] : [region(kind === 'steel' ? 'steel' : 'solid')]];
  return { schema: 'lemmings-scene-terrain/v1', id: 'actual-work-' + kind, revision: 1, width: 512, laneHeight: 96, lanes: lanes.map((regions, laneId) => ({ laneId, regions })) };
};

export async function qualifyActualWorkCycles({ createWorld, createDisplay = null, renderFps = 0, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine }, { LemmingStateType: State }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot))]);
  const check = (condition, message) => { if (!condition) throw new Error('Actual work cycle: ' + message); };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a));
  const instrument = (id, response) => ({ id, sourceKind: 'WorkResponse', response: { type: 'workCycle', ...response }, pitchCents: 6000, velocity01: 0.8, role: 'actual-work', route: 'local' });
  const run = async ({ geometry = 'clock', instruments, setup, ticks, beforeStep = () => {}, display = false }) => {
    const owner = await createWorld(workCycleLayout(geometry)), world = owner.world, graph = { version: 1, revision: 1, instruments }, facts = [], intents = [];
    const engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }); let failure = null, paints = 0, host = null;
    const listener = batch => { try { facts.push(...batch.facts); intents.push(...engine.processBatch(batch).map(intent => ({ tick: batch.tick, intent }))); } catch (error) { failure = error; } };
    world.soundEvents.onBatch.on(listener);
    try {
      setup(world); world.configurePhysicalAuthoring(graph);
      if (display && createDisplay) host = await createDisplay(world);
      for (let tick = 1; tick <= ticks; tick++) {
        beforeStep(world, tick); world.step(); if (failure) throw failure;
        // Explicit paint cadence per simulated source second, independent of
        // machine speed. This is determinism evidence, not a wall-FPS benchmark.
        const due = Math.floor(tick * world.timer.frameTime * renderFps / 1000 + 1e-9);
        if (host) while (paints < due) { check(host.render(), 'production renderer failed: ' + JSON.stringify(host.state())); paints++; }
      }
      return { facts, intents, paints, display: host?.state() ?? null,
        actors: world.actors.map(actor => ({ id: actor.id, x: actor.x, y: actor.y, frame: actor.frameIndex, action: actor.action?.actionName, instance: actor._physicalActionInstanceId })),
        terrainRevision: world.terrainRevision, diagnostics: engine.diagnostics() };
    } finally {
      world.soundEvents.onBatch.off(listener); host?.dispose(); engine.dispose(); await owner.dispose();
    }
  };
  const position = (actor, y = 80) => { actor.x = 80; actor.y = y; actor.lookRight = true; };
  const notes = (result, id) => result.intents.filter(row => row.intent.kind === 'begin' && row.intent.mappingId === id);
  const work = (result, kind) => result.facts.filter(fact => fact.kind === 'TerrainWorkCommitted' && fact.operationKind === kind);
  const clockInstruments = [instrument('strikes', { actionKinds: ['build', 'mine'], workChangePolicy: 'solid', materialResponse: { 'last-bricks': 'warning' } }), instrument('cycles', { mode: 'cycle-completion', actionKinds: ['build', 'mine'], cycleAccent: [1, 0.5] })];
  const setupClock = world => { position(world.actors[0]); position(world.actors[1], 176); world.actors[0].setAction(world.actions[State.BUILDING]); world.actors[1].setAction(world.actions[State.MINING]); };
  const clock = await run({ instruments: clockInstruments, setup: setupClock, ticks: 192, display: true });
  const build = work(clock, 'build'), mine = work(clock, 'mine'), cycles = clock.facts.filter(fact => fact.kind === 'ActionCycleCompleted');
  equal(build.map(fact => fact.phase), Array(12).fill(9), 'builder must work at phase 9 twelve times');
  equal(build.map(fact => fact.cycleOrdinal), Array.from({ length: 12 }, (_, index) => index), 'builder cycle ordinals');
  equal(mine.map(fact => fact.phase), Array.from({ length: 16 }, (_, index) => index % 2 + 1), 'miner two real masks per 24-frame cycle');
  equal(mine.map(fact => fact.cycleOrdinal), Array.from({ length: 16 }, (_, index) => Math.floor(index / 2)), 'miner cycle ordinals');
  equal(cycles.filter(fact => fact.action === 'building').map(fact => fact.cycleLengthFrames), Array(12).fill(16), 'twelve builder cycles');
  equal(cycles.filter(fact => fact.action === 'mining').map(fact => fact.cycleLengthFrames), Array(8).fill(24), 'eight miner cycles');
  equal(notes(clock, 'cycles').length, 20, 'cycle completion mapping follows 12:8 real cycles');
  const factIndex = new Map(clock.facts.map(fact => [fact.eventId, fact]));
  check(clock.intents.every(({ intent }) => intent.sourceEventIds.every(id => ['TerrainWorkCommitted', 'ActionCycleCompleted'].includes(factIndex.get(id)?.kind))), 'a global/cosmetic step became a trigger');
  const warnings = build.filter(fact => fact.warning === 'last-bricks'); equal(warnings.length, 3, 'last three bricks warn');
  for (const fact of warnings) { const attacks = notes(clock, 'strikes').filter(row => row.intent.sourceEventIds.includes(fact.eventId)); equal(attacks.length, 1, 'warning doubled a work attack'); equal(attacks[0].intent.sampleGesture, 'warning', 'warning articulation'); equal(attacks[0].intent.actionInstanceId, fact.actionInstanceId, 'warning ancestry'); }

  const solid = await run({ geometry: 'solid', ticks: 1, instruments: [instrument('attempt', { includeZeroWork: true, workChangePolicy: 'solid' }), instrument('addition', { mode: 'successful-mutation', workChangePolicy: 'solid' }), instrument('repaint', { mode: 'successful-mutation', workChangePolicy: 'appearance' })],
    setup(world) { const actor = world.actors[0]; position(actor); actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8; } });
  equal(work(solid, 'build').length, 1, 'solid builder operation'); const brick = work(solid, 'build')[0];
  equal(brick.physicalPayload.changedSolidCells, 0, 'already-solid brick adds no occupancy'); equal(brick.physicalPayload.attemptedCells, 6, 'six attempted brick pixels');
  equal(notes(solid, 'attempt').length, 1, 'enabled zero-work attempt'); equal(notes(solid, 'addition').length, 0, 'no false successful addition'); equal(notes(solid, 'repaint').length, 1, 'actual changed appearance remains separately selectable');

  const dig = await run({ geometry: 'solid', ticks: 1, instruments: [instrument('operations', { actionKinds: ['dig'], workChangePolicy: 'solid' }), instrument('phase', { actionKinds: ['dig'], mode: 'action-phase', workChangePolicy: 'solid' })],
    setup(world) { const actor = world.actors[0]; position(actor); actor.setAction(world.actions[State.DIGGING]); } });
  const rows = work(dig, 'dig'); equal(rows.map(fact => fact.operationOrdinal), [1, 2, 3], 'three ordered dig operations');
  equal(rows.map(fact => fact.physicalPayload.targetY), [78, 79, 80], 'three actual initial dig rows'); equal(rows.map(fact => fact.physicalPayload.changedSolidCells), [9, 9, 9], '27 actual removed pixels');
  equal(new Set(rows.map(fact => fact.workOperationId)).size, 3, 'unique row identities');
  check(rows.every((fact, index) => fact.phase === 0 && fact.cycleOrdinal === 0 && fact.physicalPayload.sourceEditRevisionAfter > fact.physicalPayload.sourceEditRevisionBefore && (!index || fact.causalSequence > rows[index - 1].causalSequence && fact.physicalPayload.sourceEditRevisionBefore === rows[index - 1].physicalPayload.sourceEditRevisionAfter)), 'row source-edit revisions must remain ordered and distinct from topology selection');
  equal(notes(dig, 'operations').length, 3, 'per-operation attacks'); const grouped = notes(dig, 'phase'); equal(grouped.length, 1, 'per-action-phase attack');
  equal(grouped[0].intent.sourceEventIds, rows.map(fact => fact.eventId), 'group keeps every operation source'); equal(grouped[0].intent.responseDescriptor.changedCells, 27, 'grouped work amount');
  equal(new Set(notes(dig, 'operations').map(row => JSON.stringify(row.intent.scoreTime))).size, 1, 'synchronous rows must not invent sub-tick timestamps');

  const bash = async geometry => run({ geometry, ticks: 16, instruments: [instrument('success', { actionKinds: ['bash'], mode: 'successful-mutation', workChangePolicy: 'solid' }), instrument('attempt', { actionKinds: ['bash'], includeZeroWork: true, includeObstruction: true, materialResponse: { steel: 'steel' } })],
    setup(world) { const actor = world.actors[0]; position(actor); actor.setAction(world.actions[State.BASHING]); } });
  const empty = await bash('empty'), steel = await bash('steel'); equal(notes(empty, 'success').length, 0, 'empty bashing has no removal strikes'); check(work(empty, 'bash').length > 0 && work(empty, 'bash').every(fact => !fact.physicalPayload.changedSolidCells), 'actual empty masks must be observed');
  const protectedWork = work(steel, 'bash').filter(fact => fact.outcome === 'protected'); equal(protectedWork.length, 1, 'one actual steel decision'); equal(protectedWork[0].phase, 3, 'steel decision phase');
  equal(notes(steel, 'success').length, 0, 'steel is not removal'); equal(notes(steel, 'attempt').filter(row => row.intent.sampleGesture === 'steel').length, 1, 'one separate steel articulation');

  let firstInstance, restartedInstance;
  const interruption = await run({ instruments: [...clockInstruments, instrument('scrape', { mode: 'scrape', actionKinds: ['mine'], includeZeroWork: true, expressionDeadband: 0.05 })], ticks: 96,
    setup(world) { setupClock(world); firstInstance = world.actors[1]._physicalActionInstanceId; },
    beforeStep(world, tick) { const actor = world.actors[1]; if (tick === 10) actor.setAction(world.actions[State.SHRUG]); if (tick === 30) { actor.setAction(world.actions[State.MINING]); restartedInstance = actor._physicalActionInstanceId; } } });
  check(firstInstance !== restartedInstance, 'restarted miner must own a new action instance');
  const interruptedNotes = interruption.intents.filter(row => row.intent.mappingId === 'scrape'), firstVoice = interruptedNotes.find(row => row.intent.kind === 'begin' && row.intent.actionInstanceId === firstInstance);
  check(firstVoice, 'original scrape begins'); const ends = interruptedNotes.filter(row => row.intent.kind === 'end' && row.intent.voiceId === firstVoice.intent.voiceId);
  equal(ends.length, 1, 'interruption releases the original scrape once'); equal(ends[0].tick, 10, 'release at actual interrupted boundary');
  check(!interruptedNotes.some(row => row.tick > 10 && row.intent.actionInstanceId === firstInstance), 'old instance leaked a ghost work voice');
  check(interruptedNotes.some(row => row.tick === 30 && row.intent.kind === 'begin' && row.intent.actionInstanceId === restartedInstance), 'restart begins a new independent scrape');
  equal(work(interruption, 'build').map(fact => fact.phase), Array(6).fill(9), 'other worker retains its own phase');
  equal(notes(interruption, 'strikes').filter(row => row.intent.actorId === build[0].actorId).map(row => row.tick), notes(clock, 'strikes').filter(row => row.intent.actorId === build[0].actorId && row.tick <= 96).map(row => row.tick), 'interruption must not reset another worker');
  return { renderFps, clock, solid, dig, empty, steel, interruption, measuredCycles: { builder: 12, miner: 8, ratio: '3:2' },
    scope: 'Actual action/operation facts, causal response intents and source-relative production canvas paint cadence; no acoustic, device or wall-FPS claim.' };
}
