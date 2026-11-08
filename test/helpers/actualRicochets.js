export const ricochetLayout = { schema: 'lemmings-scene-terrain/v1', id: 'actual-blocker-floor', revision: 1, width: 512, laneHeight: 96,
  lanes: [{ laneId: 0, regions: [{ kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff6c8294 }] }] };

export async function qualifyActualRicochets({ createWorld, createDisplay = null, onPause = async () => {}, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createCausalMusicEngine }, { LemmingStateType: State }, { captureProcgenCheckpoint, restoreProcgenCheckpoint }] = await Promise.all([
    import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual ricochet: ' + message); };
  const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a).slice(0, 512));
  const patch = (id, response) => ({ id, sourceKind: 'RicochetResponse', response: { type: 'ricochet', ...response }, pitchCents: 6000, velocity01: 0.8, role: 'actual-ricochet', route: 'local' });
  const hold = { id: 'blocker-hold', sourceKind: 'ActionEntered', action: 'blocking', pitchCents: 4800, velocity01: 0.3, role: 'blocker-resonance', route: 'local' };
  const graph = instruments => ({ version: 1, revision: 1, instruments });
  const position = (world, actor, x, right, blocking = false) => { actor.x = x; actor.y = 80; actor.lookRight = right; actor.setAction(world.actions[blocking ? State.BLOCKING : State.WALKING]); return actor; };
  const command = (world, kind, actorId, id) => { const receipt = world.enqueueIntervention({ id, kind, origin: 'manual', target: { generation: world.generation, actorId }, parameters: {} }); check(receipt.status === 'queued', 'explicit blocker command was not admitted'); };
  const observe = (world, engine, facts, intents, batches) => { let failure = null; const listener = batch => { try { facts.push(...batch.facts); batches.push({ tick: batch.tick, completeness: batch.completeness }); intents.push(...engine.processBatch(batch).map(intent => ({ tick: batch.tick, intent }))); } catch (error) { failure = error; } }; world.soundEvents.onBatch.on(listener); return { check: () => { if (failure) throw failure; }, dispose: () => world.soundEvents.onBatch.off(listener) }; };
  const begins = (result, id) => result.intents.filter(row => row.intent.kind === 'begin' && row.intent.mappingId === id);
  const contacts = result => result.facts.filter(fact => fact.kind === 'ContactResolved' && fact.causeKind === 'blocker');
  const validateContacts = (result, instruments) => {
    const pairs = contacts(result), ordinals = new Map(); check(pairs.length > 0, 'fixture produced no real blocker turns'); equal(new Set(pairs.map(fact => fact.contactId)).size, pairs.length, 'one physical root per actual turn');
    equal(result.facts.filter(fact => fact.type === 'blocker-turn' || fact.type === 'blocker-contact').length, pairs.length * 2, 'paired legacy SFX retain one shared physical contact');
    for (const fact of pairs) {
      check(fact.actionInstanceId && fact.otherActionInstanceId, 'both actual participant action instances must be captured');
      const counterKey = fact.otherActorId + ':' + fact.otherActionInstanceId, expectedOrdinal = ordinals.get(counterKey) || 0; ordinals.set(counterKey, expectedOrdinal + 1);
      for (const instrument of instruments) {
        const notes = begins(result, instrument.id).filter(row => row.intent.sourceEventIds.includes(fact.eventId));
        const roles = instrument.response.roles === 'walker' || instrument.response.blockerMuted ? ['walker'] : instrument.response.roles === 'blocker' || instrument.response.walkerMuted ? ['blocker'] : ['walker', 'blocker'];
        equal(notes.map(row => row.intent.responseDescriptor.role).sort(), roles.sort(), 'explicit independently muted participant roles');
        for (const { intent } of notes) { const response = intent.responseDescriptor, ordinal = response.ordinal, intervals = instrument.response.intervals || [0, 700], mode = instrument.response.mode || 'alternating';
          equal(ordinal, expectedOrdinal, 'counter follows independent actual encounters in its blocker action');
          const interval = mode === 'mirror' ? (fact.incomingDirection === 'left' ? -1 : 1) * intervals[ordinal % intervals.length] : intervals[(mode === 'alternating' || mode === 'call-answer' ? ordinal % 2 : ordinal) % intervals.length];
          equal(intent.actorId, response.role === 'walker' ? fact.actorId : fact.otherActorId, 'role actor ownership'); equal(intent.actionInstanceId, response.role === 'walker' ? fact.actionInstanceId : fact.otherActionInstanceId, 'role action ownership');
          equal(intent.pitch.cents, 6000 + (response.role === 'blocker' ? -interval : interval), 'declared blocker-local transform');
          equal(response.motifTag, instrument.id + ':' + ((mode === 'alternating' || mode === 'call-answer' ? ordinal % 2 : ordinal) % intervals.length), 'motif tag must name the interval actually played');
        }
      }
    }
    return pairs;
  };
  const opposite = async instruments => {
    const owner = await createWorld(ricochetLayout), world = owner.world, mapping = graph(instruments), facts = [], intents = [], batches = [], engine = createCausalMusicEngine({ getGraph: () => mapping, traceLimit: 0 }); let observation = null;
    try {
      position(world, world.actors[0], 70, true, true); position(world, world._spawn(0, false), 63, true); position(world, world._spawn(0, false), 78, false); world.configurePhysicalAuthoring(mapping);
      observation = observe(world, engine, facts, intents, batches); for (let tick = 0; tick < 3; tick++) { world.step(); observation.check(); }
      const result = { facts, intents }; const pairs = validateContacts(result, instruments); equal(pairs.length, 2, 'opposite walkers each turn once'); equal(pairs.map(fact => fact.incomingDirection).sort(), ['left', 'right'], 'opposite incoming directions'); return result;
    } finally { observation?.dispose(); engine.dispose(); await owner.dispose(); }
  };
  const dual = await opposite([patch('mirror', { mode: 'mirror', intervals: [700, 500] })]);
  const muted = await opposite([patch('walker-only', { mode: 'mirror', intervals: [700, 500], blockerMuted: true }), patch('blocker-only', { mode: 'mirror', intervals: [700, 500], walkerMuted: true })]);
  equal(muted.facts, dual.facts, 'musical role muting must not change physical motion/contact');

  const owner = await createWorld(ricochetLayout), world = owner.world, modes = ['alternating', 'modulo', 'mirror', 'call-answer'].map(mode => patch(mode, { mode, intervals: [100, 500, 900] })), mapping = graph([hold, ...modes]);
  const engine = createCausalMusicEngine({ getGraph: () => mapping, traceLimit: 0 }), facts = [], intents = [], batches = [], futureFacts = [], futureIntents = [], futureBatches = []; let observation = null, host = null, branch = null, branchEngine = null, branchObservation = null, pause = null, statesAfterRelease = null;
  const controls = (target, tick) => { if (tick === 140) command(target, 'release-blocker', 1, 'actual:release-right'); if (tick === 141) command(target, 'place-blocker', 1, 'actual:replace-right'); };
  let bounce;
  try {
    position(world, world.actors[0], 40, true, true); position(world, world._spawn(0, false), 100, true, true); position(world, world._spawn(0, false), 70, true); world.configurePhysicalAuthoring(mapping);
    observation = observe(world, engine, facts, intents, batches); if (createDisplay) host = await createDisplay(world);
    for (let tick = 1; tick <= 300; tick++) {
      controls(world, tick); world.step(); observation.check(); if (host) check(host.render(), 'production bounce display failed');
      if (branch) { controls(branch.world, tick); branch.world.step(); branchObservation.check(); }
      if (tick === 100) {
        const saved = captureProcgenCheckpoint(world), semantic = engine.snapshot(), paused = JSON.stringify({ saved, semantic }); await onPause({ world, engine, render: () => host?.render() });
        equal(JSON.stringify({ saved: captureProcgenCheckpoint(world), semantic: engine.snapshot() }), paused, 'paused movement must emit no contacts or progress musical counters'); pause = { tick: world.tickIndex, unchanged: true };
        branch = await createWorld(ricochetLayout); restoreProcgenCheckpoint(branch.world, JSON.parse(JSON.stringify(saved))); branchEngine = createCausalMusicEngine({ getGraph: () => mapping, traceLimit: 0 }); branchEngine.restore(JSON.parse(JSON.stringify(semantic)));
        branchObservation = observe(branch.world, branchEngine, futureFacts, futureIntents, futureBatches);
      }
      if (tick === 140) statesAfterRelease = engine.snapshot().rhythmicResponses.states;
    }
    const result = { facts, intents }, pairs = validateContacts(result, modes); check(pairs.length >= 5, 'actual two-blocker bounce must repeat its physical route');
    check(!statesAfterRelease.some(([, state]) => state.kind === 'ricochet' && state.actorId === 1), 'released blocker retained old ricochet state');
    const right = pairs.filter(fact => fact.otherActorId === 1), oldInstance = right[0].otherActionInstanceId, replaced = right.find(fact => fact.otherActionInstanceId !== oldInstance); check(replaced, 'replacement must receive a later real contact');
    for (const mode of modes) equal(begins(result, mode.id).find(row => row.intent.sourceEventIds.includes(replaced.eventId)).intent.responseDescriptor.ordinal, 0, 'new blocker action starts fresh local state');
    const ends = intents.filter(row => row.intent.kind === 'end' && row.intent.mappingId === 'blocker-hold' && row.intent.actorId === 1 && row.tick === 140); equal(ends.length, 1, 'explicit release ends old blocker resonance once');
    for (const target of [world, branch.world]) for (const actor of target.actors) actor.remove(); world.step(); observation.check(); branch.world.step(); branchObservation.check();
    equal(futureFacts, facts.filter(fact => fact.simTick > 100), 'restored bounce future facts'); equal(futureIntents, intents.filter(row => row.tick > 100), 'restored bounce future intents');
    equal(engine.diagnostics().activeVoices, 0, 'actor removal releases every resonance'); equal(engine.diagnostics().rhythmic.stateCount, 0, 'actor removal invalidates blocker histories');
    const replacement = position(world, world._spawn(0, false), 70, true, true), oldIds = facts.filter(fact => fact.kind === 'ActorTerminated').map(fact => fact.actorId); check(!oldIds.includes(replacement.id), 'new actor must not alias removed actor identity');
    position(world, world._spawn(0, false), 63, true); world.step(); observation.check(); const fresh = facts.filter(fact => fact.kind === 'ContactResolved' && fact.otherActorId === replacement.id); equal(fresh.length, 1, 'fresh blocker contact after removal');
    for (const mode of modes) equal(begins(result, mode.id).find(row => row.intent.sourceEventIds.includes(fresh[0].eventId)).intent.responseDescriptor.ordinal, 0, 'fresh actor inherits no stale counter');
    bounce = { facts: [...facts], intents: [...intents], contacts: pairs.length, pause, restored: { fromTick: 100, throughTick: 301, facts: futureFacts.length, intents: futureIntents.length, equal: true }, replacementId: replacement.id, display: host?.state() ?? null };
  } finally { observation?.dispose(); branchObservation?.dispose(); host?.dispose(); engine.dispose(); branchEngine?.dispose(); if (branch) await branch.dispose(); await owner.dispose(); }

  const denseRun = async () => {
    const owner = await createWorld(ricochetLayout), world = owner.world, instrument = patch('dense', { mode: 'alternating', intervals: [0, 700] }), mapping = graph([hold, instrument]), engine = createCausalMusicEngine({ getGraph: () => mapping, maxBeginsPerBatch: 32, maxVoices: 16, traceLimit: 0 }), facts = [], intents = [], batches = []; let observation = null;
    try {
      position(world, world.actors[0], 70, true, true); for (let actor = 0; actor < 100; actor++) position(world, world._spawn(0, false), 63, true); world.configurePhysicalAuthoring(mapping);
      observation = observe(world, engine, facts, intents, batches); world.step(); observation.check(); const admission = engine.diagnostics(), pairs = contacts({ facts }); equal(pairs.length, 100, '100 actual coincident walker turns'); check(batches[0].completeness.status === 'complete', 'physical contacts must remain complete');
      const accepted = begins({ intents }, 'dense').length; check(admission.rejectedBegins > 0 && accepted + admission.rejected.dense === 200, 'deterministic admission must account for every dual-role request');
      command(world, 'release-blocker', 0, 'actual:dense-release'); world.step(); observation.check();
      equal(intents.filter(row => row.intent.kind === 'end' && row.intent.mappingId === 'blocker-hold').length, 1, 'thinning must not lose held lifecycle end'); equal(engine.diagnostics().activeVoices, 0, 'dense release retires all ownership');
      return { facts, intents, contacts: pairs.length, accepted, rejected: admission.rejectedBegins, activeVoicesAfterRelease: 0, completePhysicalFacts: true };
    } finally { observation?.dispose(); engine.dispose(); await owner.dispose(); }
  };
  const dense = await denseRun(), repeated = await denseRun(); equal(repeated.facts, dense.facts, 'repeated coincident physical facts'); equal(repeated.intents, dense.intents, 'repeated coincident admission and intent order');
  return { dual, muted, bounce, dense, scope: 'Actual blocker trigger decisions, semantic paired roles, physical bounce, source-state continuity and bounded admission; no acoustic/device claim.' };
}
