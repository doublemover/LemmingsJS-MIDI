import { routeCircuitLayout, routeCircuitGraph } from './actualRouteCircuits.js';
import { qualifyRouteMarkerBindings } from './routeMarkerCorpus.js';

export async function qualifyActualRouteAtlasJourneys({ createWorld, journal, reopenJournal = async () => journal, createDisplay = null, onPause = async () => {}, geometryOnly = false, onGeometryBatch = () => {}, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine, validateCausalInstrumentGraph }, { createPhysicalMusicDomain }, { createRouteCoordinateAtlas }, { LemmingStateType: State }, checkpoints, takes, identity, evidence] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('workstation/physical/PhysicalMusicDomain.js', sourceRoot)), import(new URL('workstation/physical/RouteCoordinateAtlas.js', sourceRoot)),
    import(new URL('../../lemmings/LemmingStateType.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot)), import(new URL('workstation/CausalTake.js', sourceRoot)),
    import(new URL('workstation/CausalRuntimeIdentity.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpointProvenance.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual route atlas: ' + message); }, clone = value => JSON.parse(JSON.stringify(value));
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const equal = (a, b, message) => check(JSON.stringify(stable(a)) === JSON.stringify(stable(b)), message + ': ' + JSON.stringify(a).slice(0, 1200));
  const actorSetup = (world, actor, x, y, right = true, state = State.WALKING) => { actor.x = x; actor.y = y; actor.lookRight = right; actor.setAction(world.actions[state]); };
  const geometry = async ({ layout, graph, ticks, setup, beforeStep = () => {}, inspect }) => {
    const owner = await createWorld(layout), world = owner.world, domain = createPhysicalMusicDomain(), permuted = createPhysicalMusicDomain(), facts = []; let host = null, listener = null, failure = null, result = null;
    try {
      while (world.actors.length < 2) check(world._spawn(0, false), 'second real actor admission');
      setup(world); world.configurePhysicalAuthoring(graph); const valid = validateCausalInstrumentGraph(graph); domain.configure(valid); permuted.configure(valid);
      listener = batch => { try {
        facts.push(...batch.facts); domain.observe(batch); permuted.observe({ ...batch, snapshot: { ...batch.snapshot, actors: [...batch.snapshot.actors].reverse() } });
        equal(domain.snapshot().routes, permuted.snapshot().routes, 'complete actor projection permutation changed route history');
        onGeometryBatch({ layout, graph, batch });
      } catch (error) { failure = error; } }; world.soundEvents.onBatch.on(listener); if (createDisplay) host = await createDisplay(world);
      for (let tick = 1; tick <= ticks; tick++) { beforeStep(world, tick); world.step(); if (failure) throw failure; if (tick % 4 === 0) check(host?.render() ?? true, 'native geometry paint failed'); if (inspect) result = inspect({ world, domain, result }); }
      return { result, facts, coordinates: world.actors.map(actor => ({ actorId: actor.id, position: { x: actor.x, y: actor.y }, routes: graph.routes.map(route => domain.routeCoordinate(actor.id, route.id)) })), permutationEqual: true, sourceUnchanged: true };
    } finally { if (listener) world.soundEvents.onBatch.off(listener); host?.dispose(); await owner.dispose(); }
  };
  const uLayout = { schema: 'lemmings-scene-terrain/v1', id: 'actual-u-route', revision: 1, width: 512, laneHeight: 96, lanes: [{ laneId: 0, regions: [
    { kind: 'solid', x1: 8, x2: 100, y1: 40, y2: 45, color: 0xff6c8294 }, { kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff6c8294 }, { kind: 'solid', x1: 108, x2: 110, y1: 64, y2: 80, color: 0xff6c8294 }] }] };
  const vertical = (id, x, y, directionPolicy = 'positive') => ({ id, revision: 1, laneScope: [0], directionPolicy, geometry: { kind: 'segment', points: [{ x, y: y - 5 }, { x, y: y + 5 }] } });
  const uGraph = { version: 1, revision: 1, instruments: [], pickups: [vertical('upper', 40, 40), vertical('edge', 100, 44), { id: 'land', revision: 1, laneScope: [0], geometry: { kind: 'segment', points: [{ x: 105, y: 80 }, { x: 95, y: 80 }] } }, vertical('turn', 107, 80), vertical('return', 40, 80, 'negative')],
    routes: [{ id: 'u', revision: 1, branchId: 'u-directed', entryAction: 'walk', tolerancePixels: 0, markers: ['upper', 'edge', 'land', 'turn', 'return'].map(gateId => ({ gateId })),
      segments: [[{ x: 40, y: 40 }, { x: 99, y: 40 }, { x: 100, y: 44 }], [{ x: 100, y: 44 }, { x: 100, y: 80 }], [{ x: 100, y: 80 }, { x: 107, y: 80 }], [{ x: 107, y: 80 }, { x: 40, y: 80 }]].map((path, index) => ({ id: 'u-' + index, path })) }] };
  const u = await geometry({ layout: uLayout, graph: uGraph, ticks: 110, setup(world) { actorSetup(world, world.actors[0], 39, 40); actorSetup(world, world.actors[1], 39, 40, true, State.BLOCKING); },
    beforeStep(world, tick) { if (tick === 80) check(world.enqueueIntervention({ id: 'u:release', kind: 'release-blocker', origin: 'manual', target: { generation: world.generation, actorId: 1 }, parameters: {} }).status === 'queued', 'upper actor release'); },
    inspect({ world, domain }) { if (world.tickIndex !== 110) return null; const atlas = createRouteCoordinateAtlas(); atlas.configure(validateCausalInstrumentGraph(uGraph).routes); atlas.restore(clone(domain.snapshot().routes));
      const [a, b] = world.actors, ca = domain.routeCoordinate(a.id, 'u'), cb = domain.routeCoordinate(b.id, 'u'); check(ca?.status === 'qualified' && cb?.status === 'qualified', 'U-route actors must be physically qualified: ' + JSON.stringify([ca, cb]));
      const gap = Math.abs(ca.sPixels - cb.sPixels), euclidean = Math.hypot(a.x - b.x, a.y - b.y), neighbors = atlas.neighbors('u', { maxGapPixels: 48 });
      check(euclidean < 48 && gap > 96 && neighbors.every(group => group.members.every(member => member.previousActorId == null)), 'opposite U arms were paired as nearby route voices');
      return { tick: world.tickIndex, euclideanPixels: euclidean, routeGapPixels: gap, neighborRadiusPixels: 48, neighbors, coordinates: [ca, cb] }; } });
  const flat = { ...uLayout, id: 'actual-directed-crossing', lanes: [{ laneId: 0, regions: [uLayout.lanes[0].regions[1]] }] };
  const crossingGraph = { version: 1, revision: 1, instruments: [], pickups: [vertical('east-in', 40, 80), vertical('east-out', 120, 80), vertical('west-in', 120, 80, 'negative'), vertical('west-out', 40, 80, 'negative')],
    routes: [['east', 40, 120], ['west', 120, 40]].map(([id, from, to]) => ({ id, revision: 1, branchId: id, entryAction: 'walk', tolerancePixels: 0, markers: [{ gateId: id + '-in' }, { gateId: id + '-out' }], segments: [{ id: id + '-segment', path: [{ x: from, y: 80 }, { x: to, y: 80 }] }] })) };
  const crossing = await geometry({ layout: flat, graph: crossingGraph, ticks: 41, setup(world) { actorSetup(world, world.actors[0], 39, 80); actorSetup(world, world.actors[1], 121, 80, false); } });
  equal(crossing.coordinates.map(row => row.position), [{ x: 80, y: 80 }, { x: 80, y: 80 }], 'real opposing actors share one crossing pose');
  check(crossing.coordinates[0].routes[0]?.status === 'qualified' && crossing.coordinates[0].routes[1] === null && crossing.coordinates[1].routes[1]?.status === 'qualified' && crossing.coordinates[1].routes[0] === null, 'crossing direction or marker history was guessed');
  const ambiguousGraph = clone(crossingGraph); ambiguousGraph.routes = [ambiguousGraph.routes[0], { ...clone(ambiguousGraph.routes[0]), id: 'ambiguous-east', branchId: 'ambiguous-east' }];
  const ambiguous = await geometry({ layout: flat, graph: ambiguousGraph, ticks: 41, setup(world) { actorSetup(world, world.actors[0], 39, 80); actorSetup(world, world.actors[1], 121, 80, false); } });
  check(ambiguous.coordinates[0].routes.every(route => route?.status === 'ambiguous'), 'two compatible entry branches must remain ambiguous');
  if (geometryOnly) return { u, crossing, ambiguous };

  const owner = await createWorld(routeCircuitLayout()), world = owner.world, graph = routeCircuitGraph(), noRouteGraph = { ...graph, routes: [] }, engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }), noRoutes = createCausalMusicEngine({ getGraph: () => noRouteGraph, traceLimit: 0 });
  let listener = null, recorder = null, noRouteRecorder = null, failure = null, branch = null, branchEngine = null, branchListener = null, midpoint = null, midpointSequence = null, source = null;
  const physical = [], musical = [], futurePhysical = [], futureMusical = [], snapshot = () => ({ world: checkpoints.captureProcgenCheckpoint(world), engine: engine.snapshot() });
  try {
    for (const actor of world.actors) actorSetup(world, actor, 39, actor.laneIndex * 96 + 80); world.configurePhysicalAuthoring(graph);
    const initial = snapshot(), sourceVersions = identity.causalRuntimeSourceVersions(world, graph.revision), assetRefs = initial.world.assets;
    recorder = await takes.createCausalTakeRecorder({ journal, takeId: 'take:actual-route-history', takeName: 'Actual marker-bound route history', documentId: 'doc:actual-route-history', sourceVersions, assetRefs, mapping: graph, initialCheckpoint: initial, boundaryState: { 'physical-domain': initial.engine.physicalDomain, voices: [] } });
    noRouteRecorder = await takes.createCausalTakeRecorder({ journal, takeId: 'take:unrequested-route-history', takeName: 'No route interpretation requested', documentId: 'doc:actual-route-history', sourceVersions, assetRefs, mapping: noRouteGraph, initialCheckpoint: { ...initial, engine: noRoutes.snapshot() }, boundaryState: { 'physical-domain': noRoutes.snapshot().physicalDomain, voices: [] } });
    listener = batch => { try { physical.push(...batch.facts); const intents = engine.processBatch(batch), withoutRoute = noRoutes.processBatch(batch); musical.push(...intents.map(intent => ({ tick: batch.tick, intent }))); check(recorder.recordCommittedBatch({ batch, intents }).status === 'accepted' && noRouteRecorder.recordCommittedBatch({ batch, intents: withoutRoute }).status === 'accepted', 'route take admission'); } catch (error) { failure = error; } }; world.soundEvents.onBatch.on(listener);
    for (let tick = 1; tick <= 401; tick++) { world.step(); if (failure) throw failure; if (tick === 200) { midpoint = snapshot(); source = midpoint.engine.physicalDomain.routes; const before = JSON.stringify(midpoint); await onPause({ world }); equal(snapshot(), JSON.parse(before), 'paused route source moved');
      const mark = recorder.mark({ label: 'Route loop midpoint' }, { tick, generation: world.generation }); check(mark.status === 'accepted', 'mid-loop marker'); midpointSequence = mark.lastSequence; await recorder.checkpoint({ value: midpoint, tick, generation: world.generation }); }
    if (tick % 32 === 0) { await recorder.flush(); await noRouteRecorder.flush(); } }
    const stopped = await recorder.stop({ finalCheckpoint: snapshot() }), noRouteStopped = await noRouteRecorder.stop({ finalCheckpoint: { world: snapshot().world, engine: noRoutes.snapshot() } }); check(stopped.complete && noRouteStopped.complete, 'both route takes must finalize');
    const original = JSON.stringify(await journal.openTake(stopped.takeId)), opened = await reopenJournal(), manifest = await opened.openTake(stopped.takeId); equal(JSON.parse(original), manifest, 'native reopen changed manifest');
    const seek = await opened.seek({ takeId: stopped.takeId, sequence: midpointSequence, sourceVersions, assetRefs }); equal(seek.checkpoint, midpoint, 'native mid-loop checkpoint'); check(seek.checkpointSequence === midpointSequence && seek.records.length === 0, 'seek did not choose captured midpoint');
    branch = await createWorld(routeCircuitLayout()); checkpoints.restoreProcgenCheckpoint(branch.world, clone(seek.checkpoint.world)); branchEngine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }); branchEngine.restore(clone(seek.checkpoint.engine));
    branchListener = batch => { try { futurePhysical.push(...batch.facts); futureMusical.push(...branchEngine.processBatch(batch).map(intent => ({ tick: batch.tick, intent }))); } catch (error) { failure = error; } }; branch.world.soundEvents.onBatch.on(branchListener);
    while (branch.world.tickIndex < 401) { branch.world.step(); if (failure) throw failure; }
    equal(futurePhysical, physical.filter(fact => fact.simTick > 200), 'native route continuation facts'); equal(futureMusical, musical.filter(row => row.tick > 200), 'native route continuation intents'); equal(branchEngine.snapshot(), engine.snapshot(), 'native route continuation observer state');
    const plan = takes.planCausalReinterpretation({ manifest, graph }); check(plan.supported, 'captured route plan unsupported: ' + JSON.stringify(plan));
    const neverRequestedPlan = takes.planCausalReinterpretation({ manifest: await opened.openTake(noRouteStopped.takeId), graph }); check(!neverRequestedPlan.supported && neverRequestedPlan.requirements.some(row => row.reason === 'route-definition-history-not-captured'), 'unrequested route take was accepted for reinterpretation');
    const moved = clone(graph); moved.pickups[0].geometry.points.forEach(point => point.x++); const movedPlan = takes.planCausalReinterpretation({ manifest, graph: moved }); check(!movedPlan.supported && movedPlan.requirements.some(row => row.reason === 'route-definition-history-not-captured'), 'changed marker history was accepted for reinterpretation');
    const missingManifest = clone(manifest); missingManifest.coverage.routeDefinitions = []; const missingPlan = takes.planCausalReinterpretation({ manifest: missingManifest, graph }); check(!missingPlan.supported, 'endpoint-only take was accepted for route reinterpretation');
    const before = JSON.stringify(branchEngine.snapshot()), absent = clone(branchEngine.snapshot()); delete absent.physicalDomain; let missingStateRefused = false; try { branchEngine.restore(absent); } catch { missingStateRefused = true; }
    check(missingStateRefused && JSON.stringify(branchEngine.snapshot()) === before, 'missing history restore was not transactional');
    let neverRequestedRefused = false; try { branchEngine.restore(clone(noRoutes.snapshot())); } catch { neverRequestedRefused = true; } check(neverRequestedRefused && JSON.stringify(branchEngine.snapshot()) === before, 'unrequested route history became qualified');
    equal(JSON.stringify(await opened.openTake(stopped.takeId)), original, 'interpretation changed source take');
    const markers = await qualifyRouteMarkerBindings({ graph, source, sourceRoot });
    return { u, crossing, ambiguous, markers, nativeTake: { takeId: stopped.takeId, unrequestedTakeId: noRouteStopped.takeId, midpointTick: 200, midpointSequence, throughTick: 401, futureFacts: futurePhysical.length, futureIntents: futureMusical.length, equal: true, checkpointHash: await evidence.hashProcgenContinuationCheckpoint(midpoint.world), finalHash: await evidence.hashProcgenContinuationCheckpoint(snapshot().world), routePlanSupported: true, changedMarkerPlanRefused: true, endpointOnlyPlanRefused: true, neverRequestedPlanRefused: true, missingStateRefused, neverRequestedRefused, sourceTakeUnchanged: true }, scope: 'Real original scored geometry and actors; native durable checkpoint/reinterpretation preflight; no nearest-branch reconstruction, acoustic or device claim.' };
  } finally { if (listener) world.soundEvents.onBatch.off(listener); if (branchListener) branch.world.soundEvents.onBatch.off(branchListener); branchEngine?.dispose(); engine.dispose(); noRoutes.dispose(); if (branch) await branch.dispose(); await owner.dispose(); }
}
