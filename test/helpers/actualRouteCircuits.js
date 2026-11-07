export const routeCircuitLayout = (walls = [81, 101]) => ({ schema: 'lemmings-scene-terrain/v1', id: 'actual-route-circuits', revision: 1, width: 512, laneHeight: 96,
  lanes: walls.map((right, laneId) => ({ laneId, regions: [{ kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff6c8294 }, { kind: 'solid', x1: 8, x2: 21, y1: 65, y2: 80, color: 0xff6c8294 }, { kind: 'solid', x1: right, x2: 512, y1: 65, y2: 80, color: 0xff6c8294 }] })) });

export const routeCircuitGraph = (walls = [81, 101], { revision = 1, requested = walls.map(wall => 2 * (wall - 21)) } = {}) => {
  const pickups = [], routes = [], instruments = [];
  for (let lane = 0; lane < walls.length; lane++) {
    const y = lane * 96 + 80, positions = [40, walls[lane] - 1, 21], ids = ['entry', 'right', 'left'].map(role => role + lane);
    for (let index = 0; index < ids.length; index++) pickups.push({ id: ids[index], revision, laneScope: [lane], directionPolicy: index === 2 ? 'negative' : 'positive', geometry: { kind: 'segment', points: [{ x: positions[index], y: y - 10 }, { x: positions[index], y: y + 4 }] } });
    routes.push({ id: 'circuit' + lane, revision, branchId: 'lane' + lane, loop: true, entryAction: 'walk', tolerancePixels: 0, requestedPeriodTicks: requested[lane],
      markers: [...ids, ids[0]].map(gateId => ({ gateId, direction: gateId.startsWith('left') ? 'negative' : 'positive' })),
      segments: positions.map((x, index) => ({ id: 'segment' + lane + '-' + index, path: [{ x, y }, { x: positions[(index + 1) % 3], y }], dependencies: [{ bounds: { x1: Math.min(x, positions[(index + 1) % 3]) - 1, x2: Math.max(x, positions[(index + 1) % 3]) + 2, y1: y - 15, y2: y + 1 }, terrainRevision: 0 }] })) });
    instruments.push({ id: 'voice' + lane, sourceKind: 'PickupCrossing', pickupId: ids[0], pitchCents: 6000 + lane * 700, velocity01: 0.8, role: 'actual-route', route: 'local' });
  }
  return { version: 1, revision, pickups, routes, instruments };
};

export async function qualifyActualRouteCircuits({ createWorld, createDisplay = null, onPause = async () => {}, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine, validateCausalInstrumentGraph }, { LemmingStateType: State }, { createPhysicalMusicDomain }, { captureProcgenCheckpoint, restoreProcgenCheckpoint }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot)), import(new URL('workstation/physical/PhysicalMusicDomain.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual route circuits: ' + message); };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a).slice(0, 512));
  const run = async ({ walls = [81, 101], requested, geometry = walls, ticks = 961, restore = false, edit = false, stall = false, display = false } = {}) => {
    const layout = routeCircuitLayout(geometry), owner = await createWorld(layout), world = owner.world, facts = [], intents = [], laps = [], coordinates = [], futureFacts = [], futureIntents = [];
    let graph = routeCircuitGraph(walls, { requested }), domain = createPhysicalMusicDomain(), engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }), branch = null, branchEngine = null, host = null, failure = null, observer = null, branchObserver = null, initialSnapshot = null, invalidated = null, pause = null, paints = 0, stalledS = null;
    const listen = (target, interpreter, physical, targetFacts, targetIntents) => {
      const listener = batch => { try { targetFacts.push(...batch.facts); if (physical) { const observation = physical.observe(batch); laps.push(...observation.facts.filter(fact => fact.kind === 'RouteLap')); coordinates.push({ tick: batch.tick, values: walls.map((_, lane) => physical.routeCoordinate(lane, 'circuit' + lane)) }); } targetIntents.push(...interpreter.processBatch(batch).map(intent => ({ tick: batch.tick, intent }))); } catch (error) { failure = error; } };
      target.soundEvents.onBatch.on(listener); return () => target.soundEvents.onBatch.off(listener);
    };
    const editCommand = target => { const terrain = { version: 1, operation: 'removeSolid', generation: target.generation, transactionId: 'route:wall-shift', maxCells: 64, maxChunks: 4, spans: Array.from({ length: 15 }, (_, index) => ({ x1: 81, x2: 82, y: 65 + index })) };
      const receipt = target.enqueueIntervention({ id: 'route:wall-shift', kind: 'terrain-edit', origin: 'manual', transactionId: terrain.transactionId, target: { generation: target.generation }, parameters: { terrain } }); check(receipt.status === 'queued', 'paused terrain edit must queue atomically'); };
    try {
      for (const actor of world.actors) { actor.x = 39; actor.y = actor.laneIndex * 96 + 80; actor.lookRight = true; actor.setAction(world.actions[State.WALKING]); }
      world.configurePhysicalAuthoring(graph); domain.configure(validateCausalInstrumentGraph(graph)); observer = listen(world, engine, domain, facts, intents); if (display && createDisplay) host = await createDisplay(world);
      for (let tick = 1; tick <= ticks; tick++) {
        if (edit && tick === 201) editCommand(world);
        if (stall && tick === 301) { const receipt = world.enqueueIntervention({ id: 'route:stop-actor', kind: 'place-blocker', origin: 'manual', target: { generation: world.generation, actorId: 0 }, parameters: {} }); check(receipt.status === 'queued', 'explicit stalled-actor command'); }
        world.step(); if (failure) throw failure;
        if (branch) { branch.world.step(); if (failure) throw failure; }
        if (host) { const due = Math.floor(tick * world.timer.frameTime * 15 / 1000 + 1e-9); while (paints < due) { check(host.render(), 'production route renderer failed'); paints++; } }
        if (tick === 200) initialSnapshot = { graph, world: captureProcgenCheckpoint(world), engine: engine.snapshot(), domain: domain.snapshot() };
        if (edit && tick === 201) {
          invalidated = walls.map((_, lane) => domain.routeCoordinate(lane, 'circuit' + lane)); check(invalidated[0].status === 'terrain-invalidated' && invalidated[1].status === 'qualified', 'terrain edit invalidates only affected route segments');
          equal(domain.diagnostics().routes.invalidated, [{ id: 'circuit0', segments: ['segment0-0', 'segment0-1'] }], 'unaffected left-return segment and other lane retain their source coverage');
          graph = routeCircuitGraph([82, 101], { revision: 2, requested: [120, 160] }); world.configurePhysicalAuthoring(graph); domain.configure(validateCausalInstrumentGraph(graph));
        }
        if (stall && tick === 301) stalledS = domain.routeCoordinate(0, 'circuit0').sPixels;
        if (restore && tick === 480) {
          const saved = captureProcgenCheckpoint(world), semantic = engine.snapshot(), physical = domain.snapshot(), before = JSON.stringify({ saved, semantic, physical }); await onPause({ world, engine, render: () => host?.render() });
          equal(JSON.stringify({ saved: captureProcgenCheckpoint(world), semantic: engine.snapshot(), physical: domain.snapshot() }), before, 'paused paints changed complete route state'); pause = { tick: 480, unchanged: true };
          branch = await createWorld(layout); restoreProcgenCheckpoint(branch.world, JSON.parse(JSON.stringify(saved))); branchEngine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }); branchEngine.restore(JSON.parse(JSON.stringify(semantic))); branchObserver = listen(branch.world, branchEngine, null, futureFacts, futureIntents);
        }
      }
      if (branch) { equal(futureFacts, facts.filter(fact => fact.simTick > 480), 'restored route future physical facts'); equal(futureIntents, intents.filter(row => row.tick > 480), 'restored route future intents'); }
      const crossings = walls.map((_, lane) => intents.filter(row => row.intent.kind === 'begin' && row.intent.mappingId === 'voice' + lane).map(row => row.tick));
      for (const lane of walls.keys()) {
        const values = coordinates.map(row => row.values[lane]).filter(value => value?.status === 'qualified');
        if (!edit && geometry[lane] === walls[lane]) { const drop = values.findIndex((value, index) => index && value.sPixels < values[index - 1].sPixels); check(drop < 0, 'loop seam must preserve cumulative arc distance: ' + JSON.stringify({ lane, before: values[drop - 1], after: values[drop] }).slice(0, 4096)); check(values.every(value => value.entryTick === 1), 'route entry time must match actual pickup source time'); }
      }
      const index = new Map(facts.map(fact => [fact.eventId, fact])); check(intents.filter(row => row.intent.kind === 'begin').every(({ intent }) => intent.sourceEventIds.every(id => index.get(id)?.kind === 'MotionCommitted')), 'route notes require actual crossing motion');
      if (stall) { equal(domain.routeCoordinate(0, 'circuit0').sPixels, stalledS, 'stalled actor cannot advance arc coordinate'); check(!intents.some(row => row.tick > 301 && row.intent.kind === 'begin' && row.intent.actorId === 0), 'stalled actor generated a route onset'); }
      return { crossings, laps, periodView: engine.routePeriods(), coordinates, facts, intents, paints, pause, restored: branch ? { fromTick: 480, throughTick: ticks, facts: futureFacts.length, intents: futureIntents.length, equal: true } : null, invalidated, initialSnapshot, sourceUnchanged: true };
    } finally { observer?.(); branchObserver?.(); host?.dispose(); engine.dispose(); branchEngine?.dispose(); if (branch) await branch.dispose(); await owner.dispose(); }
  };
  const reference = await run({ restore: true, display: true });
  equal(reference.crossings, [[1, 121, 241, 361, 481, 601, 721, 841, 961], [1, 161, 321, 481, 641, 801, 961]], 'exact measured 120/160 circuits');
  equal(reference.periodView.comparisons[0].periodRatio.reduced, [3, 4], 'period ratio'); equal(reference.periodView.comparisons[0].frequencyRatio.reduced, [4, 3], 'inverse cycle-frequency ratio'); equal(reference.periodView.comparisons[0].periodLcmTicks, 480, 'period coincidence window');
  const travel = [0, 1].map(lane => reference.facts.filter(fact => fact.kind === 'MotionCommitted' && fact.laneId === lane && fact.simTick > 1 && fact.simTick <= (lane ? 161 : 121)).reduce((sum, fact) => sum + fact.physicalPayload.displacementPixels, 0)); equal(travel, [118, 158], 'zero-displacement turns contribute time and no arc length');
  const fiveSeven = await run({ walls: [71, 91], ticks: 701 }); equal(fiveSeven.periodView.comparisons[0].periodRatio.reduced, [5, 7], 'observed 5:7 periods'); check(fiveSeven.crossings.every(values => values.includes(701)), 'actual 5:7 source coincidence');
  const changed = await run({ edit: true }); equal(changed.crossings[0].slice(0, 6), [1, 121, 241, 363, 485, 607], 'physical wall edit changes the route period continuously'); equal(changed.periodView.rows[0].periodTicks, 122, 'observed edited period'); equal(changed.periodView.rows[0].periodErrorTicks, 2, 'requested versus realized period error');
  const shortcut = await run({ geometry: [61, 101], ticks: 481 }); equal(shortcut.laps.filter(fact => fact.routeId === 'circuit0').length, 0, 'shortcut cannot award a lap without the required marker'); check(shortcut.coordinates.find(row => row.tick === 81).values[0].status === 'qualified', 'actual re-entry must discard old discontinuity and timing evidence');
  const stalled = await run({ stall: true, ticks: 481 });
  const odd = await run({ requested: [121, 160], ticks: 481 }); equal(odd.periodView.rows[0].periodTicks, 120, 'request cannot retime real movement'); equal(odd.periodView.rows[0].periodErrorTicks, -1, 'unrealized odd request error');
  return { reference, fiveSeven, changed, shortcut, stalled, odd, travel, oddRequest: { status: 'unsupported-under-fixture-constraints', requested: 121, realized: 120, errorTicks: -1, constraints: 'Unmodified one-pixel walker and two stationary vertical walls; period 2*(rightWall-leftWall-1), including both zero-displacement turns.' },
    scope: 'Actual physical circuits, source-time periods, ordered markers, terrain invalidation/requalification and source-preserving continuation; no sequencer rate, teleport or acoustic/device claim.' };
}
