export const flightArcLayout = (floor = 48, spawn = false) => ({ schema: 'lemmings-scene-terrain/v1', id: 'actual-flight-' + (floor ?? 'void') + (spawn ? '-spawn' : ''), revision: 1, width: 512, laneHeight: 96,
  lanes: [{ laneId: 0, regions: [...(spawn ? [] : [{ kind: 'solid', x1: 8, x2: 64, y1: 12, y2: 16, color: 0xff6c8294 }]), ...(floor == null ? [] : [{ kind: 'solid', x1: spawn ? 8 : 64, x2: 512, y1: floor, y2: 96, color: 0xff6c8294 }])] }] });

export async function qualifyActualFlightArcs({ createWorld, createDisplay = null, onPause = async () => {}, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine }, { LemmingStateType: State }, { captureProcgenCheckpoint, restoreProcgenCheckpoint }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual flight arc: ' + message); };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a).slice(0, 512));
  const arcInstrument = (id, response) => ({ id, sourceKind: 'FlightArc', response: { type: 'flightArc', updateEveryTicks: 1, deadbandCents: 0, ...response }, pitchCents: 6000, velocity01: 0.8, role: 'actual-flight', route: 'local' });
  const graph = { version: 1, revision: 1, pickups: [{ id: 'air-gate', geometry: { kind: 'segment', points: [{ x: 40, y: 40 }, { x: 90, y: 40 }] } }], instruments: [
    arcInstrument('contour', { mode: 'vertical-contour', centsPerPixel: -12.125, landingStrike: false, terminalStrike: false }),
    arcInstrument('elapsed', { mode: 'time-of-flight', centsPerTick: 7.25, landingStrike: false, terminalStrike: false }),
    arcInstrument('impact', { mode: 'landing-height', sustain: false, landingStrike: true, terminalStrike: true, landingGesture: 'safe-landing', terminalGestures: { 'unsafe-fall': 'fatal-fall', 'out-of-world': 'lost-flight' } }),
    arcInstrument('spawn-only', { spawnPolicy: 'spawn-only', sustain: false }), arcInstrument('exclude-spawn', { spawnPolicy: 'exclude-spawn', sustain: false }),
    { id: 'crossing', sourceKind: 'PickupCrossing', pickupId: 'air-gate', pitchCents: 6100, velocity01: 0.4, role: 'flight-crossing', route: 'local' }
  ] };
  const run = async ({ name, floor, parachute = false, spawn = false, zero = false, restore = false }) => {
    const layout = flightArcLayout(floor, spawn), owner = await createWorld(layout), world = owner.world, engine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 });
    let host = null, branch = null, branchEngine = null, listenerFailure = null, pause = null, restoration = null; const facts = [], intents = [], continuationFacts = [], continuationIntents = [];
    const listen = (target, targetEngine, outputFacts, outputIntents) => { const listener = batch => { try { outputFacts.push(...batch.facts); outputIntents.push(...targetEngine.processBatch(batch).map(intent => ({ tick: batch.tick, intent }))); } catch (error) { listenerFailure = error; } }; target.soundEvents.onBatch.on(listener); return () => target.soundEvents.onBatch.off(listener); };
    let release = () => {}, releaseBranch = null;
    try {
      if (!spawn) { const actor = world.actors[0]; actor.setAction(world.actions[State.WALKING]); actor.x = zero ? 80 : 63; actor.y = zero ? floor : 12; actor.lookRight = true; actor.hasParachute = parachute; if (zero) actor.setAction(world.actions[State.FALLING]); }
      world.configurePhysicalAuthoring(graph); release = listen(world, engine, facts, intents); if (createDisplay) host = await createDisplay(world, name);
      for (let tick = 1; tick <= 56; tick++) {
        world.step(); if (listenerFailure) throw listenerFailure;
        if (host) check(host.render(), 'production flight render failed: ' + JSON.stringify(host.state()));
        if (branch) { branch.world.step(); if (listenerFailure) throw listenerFailure; }
        if (tick === 8 && restore) {
          const saved = captureProcgenCheckpoint(world), semantic = engine.snapshot(), before = JSON.stringify({ saved, semantic });
          await onPause({ name, world, engine, render: () => host?.render() });
          equal(JSON.stringify({ saved: captureProcgenCheckpoint(world), semantic: engine.snapshot() }), before, 'wall time or painting advanced paused physics/voice state');
          pause = { tick: world.tickIndex, unchanged: true, arcId: world.actors[0]._physicalFlightState?.arcId ?? null };
          branch = await createWorld(layout); restoreProcgenCheckpoint(branch.world, JSON.parse(JSON.stringify(saved)));
          branchEngine = createCausalMusicEngine({ getGraph: () => graph, traceLimit: 0 }); branchEngine.restore(JSON.parse(JSON.stringify(semantic)));
          releaseBranch = listen(branch.world, branchEngine, continuationFacts, continuationIntents);
        }
      }
      if (branch) {
        equal(continuationFacts, facts.filter(fact => fact.simTick > 8), 'restored future facts');
        equal(continuationIntents, intents.filter(row => row.tick > 8), 'restored future voice intents');
        restoration = { atTick: 8, throughTick: 56, facts: continuationFacts.length, intents: continuationIntents.length, equal: true };
      }
      const starts = facts.filter(fact => fact.kind === 'FlightArcStarted'), updates = facts.filter(fact => fact.kind === 'FlightArcUpdated'), ends = facts.filter(fact => fact.kind === 'FlightArcEnded');
      equal(starts.length, 1, name + ' starts one causal arc'); equal(ends.length, 1, name + ' ends once'); equal(starts[0].arcId, ends[0].arcId, name + ' continuous arc identity');
      const begin = id => intents.filter(row => row.intent.kind === 'begin' && row.intent.mappingId === id);
      for (const id of ['contour', 'elapsed']) {
        equal(begin(id).length, 1, name + ' has one held gesture'); const ending = intents.filter(row => row.intent.kind === 'end' && row.intent.mappingId === id);
        equal(ending.length, 1, name + ' releases its gesture'); equal(ending[0].intent.voiceId, begin(id)[0].intent.voiceId, name + ' stable voice through flight');
      }
      const ending = ends[0], expectedReason = name === 'fatal' ? 'unsafe-fall' : name === 'void' ? 'out-of-world' : 'safe-landing'; equal(ending.terminationReason, expectedReason, name + ' terminal outcome');
      equal(begin('impact').length, 1, name + ' one configured strike'); equal(begin('impact')[0].intent.sampleGesture, expectedReason === 'safe-landing' ? 'safe-landing' : expectedReason === 'unsafe-fall' ? 'fatal-fall' : 'lost-flight', name + ' explicit terminal articulation');
      equal(begin('impact')[0].intent.responseDescriptor.arcId, ending.arcId, name + ' strike shares arc ancestry');
      const land = facts.filter(fact => fact.type === 'lemming-land'); equal(land.length, expectedReason === 'safe-landing' && !zero ? 1 : 0, name + ' LAND truth');
      if (land.length) { equal(land[0].flightArc.arcId, ending.arcId, 'LAND provenance arc'); equal(land[0].flightArc.travelPixels, ending.travelPixels, 'LAND includes the final action displacement once'); equal(land[0].flightArc.verticalDisplacementPixels, ending.verticalDisplacementPixels, 'LAND displacement provenance'); }
      equal(begin('spawn-only').length, spawn ? 1 : 0, name + ' spawn-only source'); equal(begin('exclude-spawn').length, !spawn && expectedReason === 'safe-landing' ? 1 : 0, name + ' spawn exclusion');
      if (zero) check(intents.every(row => Number.isFinite(row.intent.velocity01) && (!row.intent.responseDescriptor || row.intent.velocity01 <= 0.8)) && begin('impact')[0].intent.velocity01 === 0, 'zero-height transition must not create maximum accents or non-finite values');
      if (parachute) {
        const opening = updates.find(fact => fact.fallState === 'floating' && fact.parachutePhase === 4); check(opening && opening.positionAfter.y === opening.positionBefore.y - 1, 'preserve real phase-four upward opening pixel');
        const expression = intents.find(row => row.intent.kind === 'update' && row.intent.mappingId === 'contour' && row.intent.sourceEventIds.includes(opening.eventId));
        check(expression && expression.intent.responseDescriptor.verticalDisplacementPixels === opening.verticalDisplacementPixels, 'opening direction reaches expression without a second onset');
      }
      if (!zero && !spawn) check(begin('crossing').length === 1, name + ' observes pickup during real airborne motion');
      return { name, facts, intents, pause, restoration, durationTicks: ending.startTick == null ? null : ending.simTick - ending.startTick, ended: ending, display: host?.state() ?? null, activeVoices: engine.diagnostics().activeVoices };
    } finally { release(); releaseBranch?.(); host?.dispose(); engine.dispose(); branchEngine?.dispose(); if (branch) await branch.dispose(); await owner.dispose(); }
  };
  const cases = [];
  for (const options of [{ name: 'short', floor: 48 }, { name: 'long', floor: 72 }, { name: 'parachute', floor: 90, parachute: true, restore: true }, { name: 'fatal', floor: 90 }, { name: 'void', floor: null }, { name: 'spawn', floor: 88, spawn: true }, { name: 'zero', floor: 48, zero: true }]) cases.push(await run(options));
  check(cases[1].durationTicks > cases[0].durationTicks, 'different real ledges determine different gesture durations');
  check(cases.every(value => value.activeVoices === 0), 'all flight and strike lifetimes must retire');
  return { cases, scope: 'Actual ledge, fall/float tables, pickup, source-relative timing, terminal and checkpoint continuity; no gravity/energy, acoustic or device measurement.' };
}
