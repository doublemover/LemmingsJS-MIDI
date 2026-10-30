export async function qualifyActualCavitySound({ createWorld, descriptor, sourceHash, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ createDiggingOcarinaScores }, { prepareCavityGeometryControl }, { compileCavitySoundMap }, checkpoint, { createCausalMusicEngine }, { LemmingStateType: State }] = await Promise.all([
    import(new URL('workstation/DiggingOcarinaScore.js', sourceRoot)), import(new URL('workstation/CavityGeometryControl.js', sourceRoot)), import(new URL('workstation/physical/CavitySoundMap.js', sourceRoot)), import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot)), import(new URL('workstation/CausalMusicEngine.js', sourceRoot)), import(new URL('../../lemmings/LemmingStateType.js', sourceRoot))]);
  const check = (value, message) => { if (!value) throw new Error('Actual cavity sound: ' + message); }, scores = await createDiggingOcarinaScores({ sourceHash, descriptor }), results = [];
  for (const score of scores) {
    const owner = await createWorld(score.recipe.initialTerrainLayout, { empty: true }), world = owner.world, region = score.scene.causalMappings.topologyRegions[0], map = score.recipe.initialCavityBody.map, engine = createCausalMusicEngine({ getGraph: () => score.scene.causalMappings }), intents = [], models = [], commands = []; let listener, failure, saved;
    const capture = async label => { const result = world.terrainTopology.regions.get(region.id)?.current, model = await compileCavitySoundMap(map, region, result); check(model.status === 'ready', label + ' unavailable: ' + model.reason); models.push({ label, model }); return model; };
    try {
      world.hasGroundAt(92, 80); world.configurePhysicalAuthoring(score.scene.causalMappings); listener = batch => { try { intents.push(...engine.processBatch(batch)); } catch (caught) { failure = caught; } }; world.soundEvents.onBatch.on(listener); world.step(); if (failure) throw failure; const initial = await capture('initial-8');
      for (const [controlId, value, label] of [['chamber-size', 16, 'expanded-16'], ['chamber-throat', 1, 'one-pixel-throat'], ['chamber-throat', 0, 'split-again']]) {
        const sourceRevision = world.terrainRevision;
        if (label === 'expanded-16') { world._collisionIndices.fill(-1); world._collisionSlots.fill(null); world._laneChunkIndex.fill(-1); world._laneChunk.fill(null); }
        const command = prepareCavityGeometryControl({ scene: score.scene, world, controlId, value, transactionId: 'actual-cavity:' + label }), queued = world.enqueueIntervention(command); check(world.terrainRevision === sourceRevision, 'explicit mask preparation changed collision source'); check(queued.status === 'queued', 'real geometry queue refused'); world.step(); if (failure) throw failure; const receipt = world.interventionState.receipts.findLast(row => row.commandId === command.id); check(receipt?.status === 'accepted', label + ' actual terrain commit refused: ' + receipt?.reason); commands.push(receipt); await capture(label); if (label === 'expanded-16') saved = checkpoint.captureProcgenCheckpoint(world);
      }
      const wide = models[1].model; if (map.bodyRecipe !== 'throat-duet') { check(initial.bindings[0].frequencyHz === 220 && wide.bindings[0].frequencyHz === 110 && wide.bindings[0].areaPixels2 === 256, 'actual8/16target mapping'); }
      else { check(initial.bindings.map(row => row.frequencyHz).join() === '220,330' && models[2].model.openingWidthPixels === 1, 'actual anchored duet mapping'); check(initial.bindings.every((row, index) => row.bodyId === models[2].model.bindings[index].bodyId), 'anchor body identity moved with component array order'); }
      check(!intents.length, 'geometry-only changes fabricated physical attacks'); checkpoint.restoreProcgenCheckpoint(world, JSON.parse(JSON.stringify(saved))); const restored = await capture('restored-expanded'); check(restored.bodyIdentityHash === wide.bodyIdentityHash, 'restored sound body differs from exact source geometry');
      results.push({ recipe: map.bodyRecipe, models, commands, geometryOnlyIntents: intents.length, restoredBodyEqual: true });
    } finally { if (listener) world.soundEvents.onBatch.off(listener); engine.dispose(); await owner.dispose(); }
  }
  const work = [];
  for (const steel of [false, true]) {
    const score = scores[0], layout = JSON.parse(JSON.stringify(score.recipe.initialTerrainLayout)); if (steel) { layout.id += '-steel'; for (const region of layout.lanes[0].regions) if (region.kind === 'solid') region.kind = 'steel'; }
    const owner = await createWorld(layout), world = owner.world, engine = createCausalMusicEngine({ getGraph: () => score.scene.causalMappings }), batches = [], intents = []; let listener, failure;
    try { const actor = world.actors[0]; check(!!actor, 'real initial actor unavailable'); actor.x = 92; actor.y = steel ? 80 : 81; actor.setAction(world.actions[State.DIGGING]); world.configurePhysicalAuthoring(score.scene.causalMappings); listener = batch => { try { batches.push(batch); intents.push(...engine.processBatch(batch)); } catch (caught) { failure = caught; } }; world.soundEvents.onBatch.on(listener); world.step(); if (failure) throw failure;
      const facts = batches.flatMap(batch => batch.facts).filter(fact => fact.kind === 'TerrainWorkCommitted'), strikes = intents.filter(intent => intent.kind === 'begin' && intent.physicalSourceKind === 'TerrainWorkCommitted');
      check(steel ? facts.some(fact => fact.outcome === 'protected') && !strikes.length : facts.some(fact => fact.physicalPayload.changedSolidCells > 0) && strikes.length > 0, steel ? 'steel produced a cavity strike' : 'actual successful cavity work lost all excitation');
      check(strikes.every(intent => intent.topologyBinding.boundTopologyRevision === batches.at(-1).snapshot.terrainRevision && intent.topologyBinding.sourceEditRevision <= intent.topologyBinding.boundTopologyRevision && intent.sourceEventIds.length), 'work/topology ancestry lost');
      work.push({ steel, facts, intents, selectedTopology: batches.at(-1).snapshot.topology });
    } finally { if (listener) world.soundEvents.onBatch.off(listener); engine.dispose(); await owner.dispose(); }
  }
  const wallContacts = [];
  for (const size of [8, 16]) {
    const score = scores[0], owner = await createWorld(score.recipe.initialTerrainLayout, { recipe: score.recipe, scene: score.scene }), world = owner.world, engine = createCausalMusicEngine({ getGraph: () => score.scene.causalMappings }), facts = [], intents = []; let listener, failure;
    try { world.hasGroundAt(92, 80); world.configurePhysicalAuthoring(score.scene.causalMappings); listener = batch => { try { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); } catch (caught) { failure = caught; } }; world.soundEvents.onBatch.on(listener);
      if (size === 16) world.enqueueIntervention(prepareCavityGeometryControl({ scene: score.scene, world, controlId: 'chamber-size', value: 16, transactionId: 'actual-cavity:entry16' }));
      for (let tick = 0; tick < 120; tick++) { world.step(); if (failure) throw failure; }
      const contacts = facts.filter(fact => fact.kind === 'ContactResolved' && fact.anchor?.x === (size === 8 ? 87 : 79)), attacks = intents.filter(intent => intent.kind === 'begin' && intent.physicalSourceKind === 'ContactResolved');
      check(contacts.length > 0 && attacks.length > 0, 'ordinary unposed actor lost its actual thin-wall excitation for ' + size + ': ' + JSON.stringify({ actors: world.actors.map(actor => ({ x: actor.x, y: actor.y, action: actor.action?.actionName })), births: facts.filter(fact => fact.kind === 'ActorBorn').length, contacts: facts.filter(fact => fact.kind === 'ContactResolved'), attacks: intents.filter(intent => intent.kind === 'begin') }).slice(0,2500)); wallContacts.push({ size, contacts, attacks, actorPoseOverridden: false, processorsOverridden: false });
    } finally { if (listener) world.soundEvents.onBatch.off(listener); engine.dispose(); await owner.dispose(); }
  }
  return { recipes: results, work, wallContacts, scope: 'Actual scored geometry and queued atomic edits; real production digging/steel action processors. Worker initial position/action is explicitly fixture-authored; ordinary wall-contact actors are never posed. Models use existing modal DSP; listening and hardware are separate.' };
}
