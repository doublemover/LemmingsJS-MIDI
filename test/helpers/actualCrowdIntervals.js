import { qualifyActualRouteAtlasJourneys } from './actualRouteAtlasJourneys.js';

export const crowdIntervalLayout = { schema: 'lemmings-scene-terrain/v1', id: 'actual-crowd-floor', revision: 1, width: 512, laneHeight: 96,
  lanes: [{ laneId: 0, regions: [{ kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff6c8294 }] }] };

export async function qualifyActualCrowdIntervals({ createWorld, createDisplay = null, onPause = async () => {}, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine }, { LemmingStateType: State }, checkpoint, { createProcgenPhysicalScoreClock }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot)), import(new URL('workstation/ProcgenPhysicalScoreClock.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual crowd: ' + message); }, clone = value => JSON.parse(JSON.stringify(value));
  const difference = (a, b, path = '') => { if (a === b) return null; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const value = difference(a[key], b[key], path + '/' + key); if (value) return value; } return null; } return { path, actual: a, expected: b }; };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(difference(a, b)).slice(0, 1800));
  const run = async ({ positions = [39, 33, 21], left = [], pickupX = 40, ticks = 64, remove = null, restore = false, coincident = false, blocker = false, display = false, paintHz = 15 } = {}) => {
    const layout = blocker ? { ...crowdIntervalLayout, id: 'actual-crowd-blocker', lanes: [{ laneId: 0, regions: [...crowdIntervalLayout.lanes[0].regions, { kind: 'solid', x1: 8, x2: 21, y1: 65, y2: 80, color: 0xff6c8294 }, { kind: 'solid', x1: 141, x2: 512, y1: 65, y2: 80, color: 0xff6c8294 }] }] } : crowdIntervalLayout;
    const owner = await createWorld(layout), world = owner.world, gateX = blocker ? 70 : pickupX;
    const patch = (id, response) => ({ id, sourceKind: 'CrowdArrival', response: { type: 'crowdInterval', pickupId: 'arrivals', intervalToGate: 0.5, ...response }, pitchCents: 6000, velocity01: 0.7, role: 'actual-crowd', route: 'local' });
    const graph = { version: 1, revision: 1, pickups: [{ id: 'arrivals', revision: 1, geometry: { kind: 'segment', points: [{ x: gateX, y: 70 }, { x: gateX, y: 90 }] } }], instruments: [patch('literal', {}), patch('delayed', { mode: 'delayed-response', delayTicks: 8 }), patch('folded', { mode: 'ratio-folded', delayTicks: 32, foldReferenceTicks: 6 }), patch('density', { minimumIntervalTicks: 10 }), patch('distance', { metric: 'euclidean' })] };
    const engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }), permutation = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 });
    const clocks = [30, 240].map(bpm => { const clock = createProcgenPhysicalScoreClock(); return { bpm, clock, engine: createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0, scoreTimeline: clock }) }; });
    const facts = [], intents = [], tempo = clocks.map(() => []), spread = [], futureFacts = [], futureIntents = []; let observer = null, failure = null, branch = null, branchEngine = null, branchObserver = null, midpoint = null, host = null, paints = 0;
    try {
      const all = [...positions.map(x => ({ x, right: true })), ...left.map(x => ({ x, right: false })), ...(blocker ? [{ x: 100, right: true, blocking: true }] : [])];
      while (world.actors.length < all.length) world._spawn(0, false);
      all.forEach((value, index) => { const actor = world.actors[index]; actor.x = value.x; actor.y = 80; actor.lookRight = value.right; actor.setAction(world.actions[value.blocking ? State.BLOCKING : State.WALKING]); }); world.configurePhysicalAuthoring(graph);
      observer = batch => { try {
        facts.push(...batch.facts); const output = engine.processBatch(batch); intents.push(...output.map(intent => ({ tick: batch.tick, intent })));
        equal(permutation.processBatch({ ...batch, snapshot: { ...batch.snapshot, actors: [...batch.snapshot.actors].reverse() } }), output, 'actor projection order changed crowd notes');
        for (let index = 0; index < clocks.length; index++) { const item = clocks[index]; item.clock.observe(batch, { bpm: item.bpm }); tempo[index].push(...item.engine.processBatch(batch).filter(intent => intent.kind === 'begin').map(intent => ({ actorId: intent.actorId, mappingId: intent.mappingId, simTick: intent.scoreTime.simTick, subTick: intent.scoreTime.subTick, gate: intent.responseGateTicks, descriptor: intent.responseDescriptor }))); }
      } catch (error) { failure = error; } }; world.soundEvents.onBatch.on(observer); if (display && createDisplay) host = await createDisplay(world);
      for (let tick = 1; tick <= ticks; tick++) {
        if (remove != null && tick === 5) world.actors.find(actor => actor.id === remove).remove();
        if (blocker && tick === 50) check(world.enqueueIntervention({ id: 'crowd:release', kind: 'release-blocker', origin: 'manual', target: { generation: world.generation, actorId: all.length - 1 }, parameters: {} }).status === 'queued', 'real blocker release command');
        world.step(); if (failure) throw failure; if (branch) { branch.world.step(); if (failure) throw failure; }
        const walkers = world.actors.filter(actor => actor.id < positions.length); if (walkers.length) spread.push({ tick, spanPixels: Math.max(...walkers.map(actor => actor.x)) - Math.min(...walkers.map(actor => actor.x)) });
        if (host) { const due = Math.floor(tick * world.timer.frameTime * paintHz / 1000 + 1e-9); while (paints < due) { check(host.render(), 'production crowd paint'); paints++; } }
        if (restore && tick === 10) {
          midpoint = { graph, world: checkpoint.captureProcgenCheckpoint(world), engine: engine.snapshot() }; const before = JSON.stringify(midpoint); await onPause({ world, render: () => host?.render() }); equal({ graph, world: checkpoint.captureProcgenCheckpoint(world), engine: engine.snapshot() }, JSON.parse(before), 'pause advanced the pending response queue');
          branch = await createWorld(layout); checkpoint.restoreProcgenCheckpoint(branch.world, clone(midpoint.world)); branchEngine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }); branchEngine.restore(clone(midpoint.engine));
          branchObserver = batch => { try { futureFacts.push(...batch.facts); futureIntents.push(...branchEngine.processBatch(batch).map(intent => ({ tick: batch.tick, intent }))); } catch (error) { failure = error; } }; branch.world.soundEvents.onBatch.on(branchObserver);
        }
      }
      equal(tempo[0], tempo[1], 'BPM changed physical arrival timing, presentation delay or gate descriptors');
      if (branch) { equal(futureFacts, facts.filter(fact => fact.simTick > 10), 'checkpoint future physical facts'); equal(futureIntents, intents.filter(row => row.tick > 10), 'checkpoint future crowd notes'); }
      const begins = id => intents.filter(row => row.intent.kind === 'begin' && row.intent.mappingId === id), source = new Map(facts.map(fact => [fact.eventId, fact]));
      check(intents.every(row => row.intent.sourceEventIds.every(id => source.get(id)?.kind === 'MotionCommitted')), 'crowd note lost its original physical crossing root');
      check(begins('literal').every(row => row.intent.responseDescriptor.literalArrivalTick === row.intent.scoreTime.simTick + row.intent.scoreTime.subTick), 'literal arrival was regularized');
      if (coincident) equal(begins('literal').map(row => row.intent.actorId), positions.map((_, index) => index), 'coincident arrivals require stable actor-ID ordering');
      return { graph, facts, intents, spread, paints, midpoint, actualPatternCells: 0, tempoAndPermutationEqual: true, restored: branch ? { fromTick: 10, futureFacts: futureFacts.length, futureIntents: futureIntents.length, equal: true, pendingAtCheckpoint: midpoint.engine.rhythmicResponses.pending.length } : null };
    } finally { if (observer) world.soundEvents.onBatch.off(observer); if (branchObserver) branch.world.soundEvents.onBatch.off(branchObserver); host?.dispose(); engine.dispose(); permutation.dispose(); clocks.forEach(item => item.engine.dispose()); branchEngine?.dispose(); if (branch) await branch.dispose(); await owner.dispose(); }
  };
  const first = (value, id, direction = 'positive') => value.intents.filter(row => row.intent.kind === 'begin' && row.intent.mappingId === id && row.intent.responseDescriptor && row.intent.observation.direction === direction);
  const reference = await run({ restore: true, display: true, paintHz: 0 }), arrivals = first(reference, 'literal'); equal(arrivals.map(row => row.tick), [1, 7, 19], 'actual six/twelve arrival intervals'); equal(arrivals.map(row => row.intent.responseDescriptor.intervalTicks), [null, 6, 12], 'literal interval units');
  equal(first(reference, 'delayed').map(row => row.tick), [9, 15, 27], 'explicit eight-tick source-rooted response delay'); equal(first(reference, 'folded').map(row => row.tick), [33, 39, 45], 'power-of-two ratio folding with bounded lookahead');
  check(reference.restored.pendingAtCheckpoint > 0, 'midpoint must contain actual pending musical ownership');
  const cadences = [{ hz: 0, paints: reference.paints }]; for (const hz of [15, 120]) { const rendered = await run({ display: true, paintHz: hz }); equal(rendered.facts, reference.facts, 'paint cadence changed authoritative facts'); equal(rendered.intents, reference.intents, 'paint cadence changed pending response timing'); cadences.push({ hz, paints: rendered.paints }); }
  const removed = await run({ remove: 1 }); equal(first(removed, 'literal').map(row => row.tick), [1, 19], 'removed middle actor must leave the real longer interval'); equal(first(removed, 'literal').at(-1).intent.responseDescriptor.intervalTicks, 18, 'removed arrival gap');
  const coincident = await run({ positions: [39, 39, 39], coincident: true }), opposing = await run({ left: [41, 47, 59] });
  for (const direction of ['positive', 'negative']) equal(first(opposing, 'literal', direction).slice(0, 3).map(row => row.intent.responseDescriptor.intervalTicks), [null, 6, 12], 'opposing streams retain independent interval history');
  const density = await run({ positions: Array.from({ length: 8 }, (_, index) => 79 - index * 6), pickupX: 80 }); equal(first(density, 'density').map(row => row.tick), [1, 13, 25, 37], 'density thinning preserves selected actual arrival times');
  const compression = await run({ positions: Array.from({ length: 8 }, (_, index) => 69 - index * 6), blocker: true, ticks: 220, display: true });
  const intervals = first(compression, 'literal', 'negative').map(row => row.intent.responseDescriptor.intervalTicks).filter(value => value != null);
  check(intervals.includes(6) && intervals.some(value => value > 6), 'actual blocker release must create pulse and a larger physical breath: ' + JSON.stringify(intervals));
  check(Math.min(...compression.spread.map(row => row.spanPixels)) < 42 && Math.max(...compression.spread.map(row => row.spanPixels)) > 42, 'eight-walker formation must physically compress and expand');
  const routeRuns = new Map();
  try {
    await qualifyActualRouteAtlasJourneys({ createWorld, sourceRoot, geometryOnly: true, onGeometryBatch({ layout, graph, batch }) {
      const key = layout.id + ':' + graph.routes.map(route => route.id).join(','); let run = routeRuns.get(key);
      if (!run) {
        const routeId = graph.routes[0].id, pickupId = graph.routes[0].markers[0].gateId;
        const mapped = { ...graph, instruments: ['route-distance', 'euclidean'].map(metric => ({ id: 'crowd-' + metric, sourceKind: 'CrowdArrival', response: { type: 'crowdInterval', pickupId, metric, routeId: metric === 'route-distance' ? routeId : null }, pitchCents: 6000, velocity01: 0.7, role: 'actual-route-crowd', route: 'local' })) };
        run = { id: layout.id, routeCount: graph.routes.length, engine: createCausalMusicEngine({ getGraph: () => mapped, traceLimit: 0 }), notes: [], descriptors: [] }; routeRuns.set(key, run);
      }
      run.notes.push(...run.engine.processBatch(batch).filter(intent => intent.kind === 'begin').map(intent => ({ tick: batch.tick, intent }))); run.descriptors.push(...run.engine.diagnostics().rhythmic.descriptors);
    } });
    const routeMetric = [...routeRuns.values()].map(({ id, routeCount, notes, descriptors }) => ({ id, routeCount, notes, descriptors })), u = routeMetric.find(run => run.id === 'actual-u-route'), ambiguous = routeMetric.find(run => run.routeCount === 2 && run.descriptors.some(row => row.metricStatus === 'unknown'));
    const routeGap = u.notes.find(row => row.intent.mappingId === 'crowd-route-distance' && row.intent.responseDescriptor.gapPixels != null), euclideanGap = u.notes.find(row => row.intent.mappingId === 'crowd-euclidean' && row.intent.responseDescriptor.gapPixels != null);
    check(routeGap && euclideanGap && routeGap.intent.responseDescriptor.metricStatus === 'complete' && Math.abs(routeGap.intent.responseDescriptor.gapPixels - euclideanGap.intent.responseDescriptor.gapPixels) > 1, 'crowd instrument substituted Euclidean distance for the qualified U route');
    check(ambiguous && ambiguous.notes.some(row => row.intent.mappingId === 'crowd-euclidean') && !ambiguous.notes.some(row => row.intent.mappingId === 'crowd-route-distance'), 'ambiguous route crowd must refuse while its explicit Euclidean control can respond');
    return { reference, removed, coincident, opposing, density, compression, cadences, routeMetric, scope: 'Original scored terrain and actual walkers/blocker, source-rooted semantic timing/duration; no enabled pattern, acoustic or device claim.' };
  } finally { for (const run of routeRuns.values()) run.engine.dispose(); }
}
