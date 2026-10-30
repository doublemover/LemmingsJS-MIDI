import { crowdIntervalLayout } from './actualCrowdIntervals.js';
import { qualifyActualRouteAtlasJourneys } from './actualRouteAtlasJourneys.js';

export async function qualifyActualFormationHarmony({ createWorld, createDisplay = null, onPause = async () => {}, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine }, { LemmingStateType: State }, checkpoint] = await Promise.all([import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual formation: ' + message); }, clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a).slice(0, 1200));
  const tuning = { version: 1, id: 'actual-just', kind: 'ratios', values: [[1, 1], [5, 4], [3, 2]], referenceCents: 6000, referenceHz: 440 };
  const formation = (id, ensembleId, overrides = {}) => ({ id, revision: 1, ensembleId, metric: 'laneX', tuning, maximumVoices: 4, spacingPixels: 16, hysteresisPixels: 2, register: { minCents: 2400, maxCents: 14400 }, ...overrides });
  const note = (id, formationId, action, overrides = {}) => ({ id, sourceKind: 'ActionEntered', action, formationId, pitchCents: 6000, velocity01: 0.5, role: 'actual-formation', route: 'local', ...overrides });
  const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map(rest => [value, ...rest])) : [[]];
  const run = async ({ positions = [180, 184, 188, 192], blocking = false, remove = null, restore = false, display = false, selector = { kind: 'lane', laneId: 0 } } = {}) => {
    const owner = await createWorld(crowdIntervalLayout), world = owner.world, action = blocking ? 'blocking' : 'walk';
    const graph = { version: 1, revision: 1, ensembles: [{ id: 'dynamic', selector, membershipMode: 'dynamic', maximumMembers: 64 }, { id: 'historical', selector, membershipMode: 'fixedAtAdmission', maximumMembers: 64 }],
      pickups: [{ id: 'attack', revision: 1, geometry: { kind: 'segment', points: [{ x: 220, y: 70 }, { x: 220, y: 90 }] } }],
      formations: [formation('follow', 'dynamic'), formation('freeze', 'dynamic', { policy: 'freeze-voicing' }), formation('cluster', 'dynamic', { mapping: 'clustered-chord' }), formation('fixed', 'historical'), formation('bounded', 'dynamic', { maximumVoices: 2 }), formation('neighborhood', 'dynamic', { metric: '2DNeighborhood' })],
      instruments: ['follow', 'freeze', 'cluster', 'fixed', 'bounded'].map(id => note('voice-' + id, id, action)).concat(note('attack', 'follow', null, { sourceKind: 'PickupCrossing', pickupId: 'attack' })) };
    const engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }), permuted = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 });
    const facts = [], intents = [], views = [], futureFacts = [], futureIntents = []; let listener = null, branch = null, branchEngine = null, branchListener = null, failure = null, host = null, paints = 0, initial = null, priorRemoval = null, removal = null, restored = null;
    const observe = (target, interpreter, outFacts, outIntents, compare = false) => {
      const callback = batch => { try { outFacts.push(...batch.facts); const output = interpreter.processBatch(batch); outIntents.push(...output.map(intent => ({ tick: batch.tick, intent })));
        if (compare) { equal(output, permuted.processBatch({ ...batch, snapshot: { ...batch.snapshot, actors: [...batch.snapshot.actors].reverse() } }), 'projection permutation changed pitches or assignments');
          equal(engine.diagnostics().tonal.formations.views, permuted.diagnostics().tonal.formations.views, 'projection permutation changed formation geometry or nearest-neighbor ties');
          const diagnostics = engine.diagnostics(); views.push({ tick: batch.tick, formations: diagnostics.tonal.formations.views, ensembles: diagnostics.physical.last?.ensembles || [] }); }
      } catch (error) { failure = error; } }; target.soundEvents.onBatch.on(callback); return () => target.soundEvents.onBatch.off(callback);
    };
    try {
      while (world.actors.length < positions.length) world._spawn(0, false);
      positions.forEach((x, index) => { const actor = world.actors[index]; actor.x = x; actor.y = 80; actor.lookRight = index >= 2; actor.setAction(world.actions[blocking ? State.BLOCKING : State.WALKING]); });
      world.configurePhysicalAuthoring(graph); listener = observe(world, engine, facts, intents, true); if (display && createDisplay) host = await createDisplay(world);
      for (let tick = 1; tick <= 64; tick++) {
        if (remove != null && tick === 30) { priorRemoval = views.at(-1); world.actors.find(actor => actor.id === remove).remove(); branch?.world.actors.find(actor => actor.id === remove)?.remove(); }
        world.step(); if (failure) throw failure; if (branch) { branch.world.step(); if (failure) throw failure; }
        if (tick === 1) initial = views.at(-1); if (remove != null && tick === 30) removal = views.at(-1);
        if (host && tick % 4 === 0) { check(host.render(), 'native formation paint'); paints++; }
        if (restore && tick === 16) {
          const source = checkpoint.captureProcgenCheckpoint(world), music = engine.snapshot(), before = JSON.stringify({ source, music }); await onPause({ world, render: () => host?.render() }); equal({ source: checkpoint.captureProcgenCheckpoint(world), music: engine.snapshot() }, JSON.parse(before), 'paused complete formation state changed');
          branch = await createWorld(crowdIntervalLayout); checkpoint.restoreProcgenCheckpoint(branch.world, clone(source)); branchEngine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }); branchEngine.restore(clone(music)); branchListener = observe(branch.world, branchEngine, futureFacts, futureIntents);
        }
      }
      if (branch) { equal(futureFacts, facts.filter(fact => fact.simTick > 16), 'restored formation facts'); equal(futureIntents, intents.filter(row => row.tick > 16), 'restored formation intents'); restored = { fromTick: 16, throughTick: 64, facts: futureFacts.length, intents: futureIntents.length, equal: true }; }
      const begins = intents.filter(row => row.intent.kind === 'begin'), follow = begins.filter(row => row.intent.mappingId === 'voice-follow'), bySource = new Map(facts.map(fact => [fact.eventId, fact]));
      check(begins.every(row => row.intent.sourceEventIds.every(id => ['ActionEntered', 'MotionCommitted'].includes(bySource.get(id)?.kind))), 'formation attack needs its real action or pickup source');
      check(intents.filter(row => row.intent.kind === 'update').every(row => row.intent.sourceEventIds.every(id => bySource.has(id))), 'formation changes lost their physical root');
      check(follow.every(row => row.intent.pitch.referenceHz === 440 && row.intent.pitch.tuningId === tuning.id && Array.isArray(row.intent.pitch.ratio)), 'microtonal reference/ratio identity was lost');
      const minimumMotion = [];
      if (removal) {
        for (const id of ['follow', 'cluster', 'fixed']) {
          const previous = new Map(priorRemoval.formations.find(view => view.id === id).assignments.map(value => [value.actorId, value.pitch.cents])), assigned = removal.formations.find(view => view.id === id).assignments;
          const actual = assigned.reduce((sum, value) => sum + Math.abs(previous.get(value.actorId) - value.pitch.cents), 0), minimum = Math.min(...permutations(assigned.map(value => value.pitch.cents)).map(pitches => assigned.reduce((sum, value, index) => sum + Math.abs(previous.get(value.actorId) - pitches[index]), 0)));
          check(Math.abs(actual - minimum) < 1e-8, 'actual surviving assignment did not minimize voice motion'); minimumMotion.push({ formationId: id, totalCents: actual, independentMinimumCents: minimum });
        }
        const roster = removal.ensembles.find(view => view.id === 'historical'); check(roster.members.length === positions.length && roster.memberIds.length === positions.length - 1 && roster.members.find(member => member.actorId === remove)?.active === false, 'fixed historical crew forgot the missing member or voiced it as live');
        for (const onset of begins.filter(row => row.intent.actorId === remove && row.intent.mappingId !== 'attack')) check(intents.filter(row => row.intent.kind === 'end' && row.intent.voiceId === onset.intent.voiceId).length === 1, 'removed actor voice is orphaned or ended twice');
        for (const onset of follow.filter(row => row.intent.actorId !== remove)) check(!intents.some(row => row.tick > 1 && row.intent.kind === 'begin' && row.intent.actorId === onset.intent.actorId && row.intent.mappingId === 'voice-follow'), 'surviving voice was stolen or retriggered');
      }
      return { graph, observerCheckpoint: engine.snapshot(), facts, intents, initial, final: views.at(-1), views, minimumMotion, removal, restored, paints, patternCells: 0, permutationEqual: true };
    } finally { listener?.(); branchListener?.(); host?.dispose(); engine.dispose(); permuted.dispose(); branchEngine?.dispose(); if (branch) await branch.dispose(); await owner.dispose(); }
  };
  const reference = await run({ restore: true, display: true }), removed = await run({ remove: 1, restore: true }), staticHeld = await run({ blocking: true }), coincident = await run({ positions: [180, 180, 180, 180], blocking: true }), alternate = await run({ positions: [100, 140, 180, 192] });
  const span = (value, id) => { const pitches = value.formations.find(view => view.id === id).assignments.map(value => value.pitch.cents); return Math.max(...pitches) - Math.min(...pitches); };
  check(span(reference.final, 'follow') > span(reference.initial, 'follow'), 'symmetric actual spreading did not open the chord');
  equal(reference.initial.formations.find(view => view.id === 'freeze').assignments.map(value => value.pitch), reference.final.formations.find(view => view.id === 'freeze').assignments.map(value => value.pitch), 'explicit frozen voicing drifted');
  check(JSON.stringify(reference.final.formations.find(view => view.id === 'cluster').assignments.map(value => value.pitch)) !== JSON.stringify(reference.final.formations.find(view => view.id === 'follow').assignments.map(value => value.pitch)), 'ordered and clustered mappings became identical');
  check(reference.intents.some(row => row.intent.kind === 'begin' && row.intent.pitch.cents % 1 !== 0), 'actual ratio tuning was quantized to integer cents');
  equal(staticHeld.intents.filter(row => row.intent.kind === 'begin').map(row => row.tick), Array(18).fill(1), 'static held crowd retriggered'); check(!staticHeld.intents.some(row => row.intent.mappingId === 'attack'), 'static silent pickup crowd manufactured a note');
  equal(staticHeld.final.formations.find(view => view.id === 'neighborhood').neighborRelations, [{ beforeActorId: 0, afterActorId: 1, distance: 4 }, { beforeActorId: 1, afterActorId: 2, distance: 4 }, { beforeActorId: 2, afterActorId: 3, distance: 4 }], 'actual four-actor nearest edges or equal-distance tie ordering');
  check(reference.initial.formations.find(view => view.id === 'bounded').aggregated === 2, 'bounded representative aggregation was undisclosed');
  check(JSON.stringify(reference.initial.formations.find(view => view.id === 'follow').assignments.map(value => value.pitch)) !== JSON.stringify(alternate.initial.formations.find(view => view.id === 'follow').assignments.map(value => value.pitch)), 'same leader position hid different follower spacing');
  const leader = value => value.facts.find(fact => fact.kind === 'MotionCommitted' && fact.actorId === 3 && fact.simTick === 1).positionAfter; equal(leader(reference), leader(alternate), 'follower comparison changed the leader control pose');
  const empty = await run({ blocking: true, selector: { kind: 'actors', identities: [] } }), single = await run({ blocking: true, selector: { kind: 'actors', identities: [{ worldId: 'procgen:42', generation: 1, actorId: 0 }] } });
  check(empty.intents.length === 0 && empty.final.formations.every(view => view.memberCount === 0 && view.assignments.length === 0), 'empty crowd invented notes or a missing coordinate'); check(single.final.formations.every(view => view.memberCount === 1 && view.dispersion === 0), 'single actor behavior is not explicit');
  const restoredObserver = createCausalMusicEngine({ getGraph: () => reference.graph, traceLimit: 0 }), refusals = [];
  try {
    restoredObserver.restore(clone(reference.observerCheckpoint)); const before = JSON.stringify(restoredObserver.snapshot());
    for (const [name, mutate] of [
      ['unbound-legacy', value => { value.version = 1; delete value.signatures; }], ['changed-definition', value => { value.signatures[0][1] += 'foreign'; }],
      ['duplicate-formation', value => { value.states.push(value.states[0]); }], ['foreign-formation', value => { value.states[0].id = 'foreign'; }],
      ['oversized-spread', value => { value.states[0].spreadTier = 33; }], ['duplicate-actor', value => { value.states[0].assignments[1].actorId = value.states[0].assignments[0].actorId; }],
      ['nonfinite-coordinate', value => { value.states[0].assignments[0].coordinate = Infinity; }], ['unrecognized-reason', value => { value.states[0].assignments[0].reason = 'guessed'; }],
      ['changed-degree', value => { value.states[0].assignments[0].pitch.degree++; }], ['changed-period', value => { value.states[0].assignments[0].pitch.period++; }],
      ['changed-reference', value => { value.states[0].assignments[0].pitch.referenceHz++; }], ['changed-tuning', value => { value.states[0].assignments[0].pitch.tuningId = 'foreign'; }],
      ['changed-ratio', value => { value.states[0].assignments[0].pitch.ratio = [9, 8]; }]
    ]) {
      const changed = JSON.parse(before); mutate(changed.tonalInterpretation.formations); let reason = null; try { restoredObserver.restore(changed); } catch (error) { reason = error.message; }
      check(reason && JSON.stringify(restoredObserver.snapshot()) === before, 'saved formation refusal was not transactional: ' + name); refusals.push({ name, reason, unchanged: true });
    }
  } finally { restoredObserver.dispose(); }
  const routeRuns = new Map();
  try {
    const geometry = await qualifyActualRouteAtlasJourneys({ createWorld, sourceRoot, geometryOnly: true, onGeometryBatch({ layout, graph, batch }) {
      const key = layout.id + ':' + graph.routes.map(route => route.id).join(','); let run = routeRuns.get(key);
      if (!run) {
        const routeId = graph.routes[0].id, pickupId = graph.routes[0].markers[0].gateId, mapped = { ...graph, ensembles: [{ id: 'crew', selector: { kind: 'lane', laneId: 0 }, membershipMode: 'dynamic', maximumMembers: 16 }],
          formations: [formation('route', 'crew', { metric: 'routeDistance', routeId }), formation('neighborhood', 'crew', { metric: '2DNeighborhood' })],
          instruments: ['route', 'neighborhood'].map(id => note('route-' + id, id, null, { sourceKind: 'PickupCrossing', pickupId })) };
        run = { id: layout.id, routeIds: graph.routes.map(route => route.id), engine: createCausalMusicEngine({ getGraph: () => mapped, traceLimit: 0 }), notes: [], views: [] }; routeRuns.set(key, run);
      }
      run.notes.push(...run.engine.processBatch(batch).filter(intent => intent.kind === 'begin').map(intent => ({ tick: batch.tick, intent }))); if (batch.tick === 1 || batch.tick === 80 || batch.tick === 110 || batch.tick === 41) run.views.push({ tick: batch.tick, values: run.engine.diagnostics().tonal.formations.views });
    } });
    const routes = [...routeRuns.values()].map(({ id, routeIds, notes, views }) => ({ id, routeIds, notes, views })), u = routes.find(run => run.id === 'actual-u-route'), ambiguous = routes.find(run => run.routeIds.includes('ambiguous-east'));
    const at110 = u.views.find(view => view.tick === 110).values, along = at110.find(view => view.id === 'route'), local = at110.find(view => view.id === 'neighborhood');
    check(along.status === 'complete' && local.status === 'complete' && along.dispersion > local.dispersion && along.neighborRelations[0].distance > 96, 'formation silently paired opposite U arms by screen distance');
    check(local.neighborMetric === 'euclidean-pixels' && Math.abs(local.neighborRelations[0].distance - geometry.u.result.euclideanPixels) < 1e-9 && local.dispersion > 0, '2D formation confused equal centroid radii with zero physical separation');
    check(ambiguous.notes.some(row => row.intent.mappingId === 'route-neighborhood') && !ambiguous.notes.some(row => row.intent.mappingId === 'route-route') && ambiguous.views.some(row => row.values.some(view => view.id === 'route' && view.status === 'unknown')), 'ambiguous route formation did not refuse explicitly');
    return { reference, removed, staticHeld, coincident, alternate, empty, single, routes, refusals, sameLeaderPose: leader(reference), span: { initial: span(reference.initial, 'follow'), final: span(reference.final, 'follow') }, scope: 'Actual scored-world formation, sustained source voices and pickup attacks; no pattern, acoustic or device qualification.' };
  } finally { for (const run of routeRuns.values()) run.engine.dispose(); }
}
