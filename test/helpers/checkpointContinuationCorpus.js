export async function checkpointContinuationCorpus(createWorld, sourceRoot = new URL('../../js/app/procgen/', import.meta.url)) {
  const [checkpoint, evidence, topology, geometry] = await Promise.all([import(new URL('workstation/ProcgenCheckpoint.js', sourceRoot)),
    import(new URL('workstation/ProcgenCheckpointProvenance.js', sourceRoot)), import(new URL('ProcgenTerrainTopology.js', sourceRoot)),
    import(new URL('workstation/physical/TopologyInstrumentRegion.js', sourceRoot))]);
  const require = (condition, message) => { if (!condition) throw new Error(message); }, owner = await createWorld(), world = owner.world || owner, results = [];
  const hashes = async () => { const saved = checkpoint.captureProcgenCheckpoint(world); return { simulation: await evidence.hashProcgenPhysicsCheckpoint(saved), continuation: await evidence.hashProcgenContinuationCheckpoint(saved) }; };
  try {
    const before = await hashes();
    for (const [owner, field] of [['physicalAuthoring', 'revision'], ['terrainTopology', 'epoch']]) {
      const value = world[owner][field]; world[owner][field]++;
      try { const after = await hashes(); require(after.simulation === before.simulation && after.continuation !== before.continuation, 'Continuation owner omitted: ' + owner); results.push({ kind: owner, before, after }); }
      finally { world[owner][field] = value; }
    }
    world.physicalCrewEvidence.generation = world.generation; world.physicalCrewEvidence.projects.set('continuation.crew', { roots: ['crew.root'], arrivals: new Map(), complete: true });
    const crewBefore = await hashes(); world.physicalCrewEvidence.projects.get('continuation.crew').complete = false;
    const crewAfter = await hashes(); require(crewBefore.simulation === crewAfter.simulation && crewBefore.continuation !== crewAfter.continuation, 'Crew prerequisites omitted');
    results.push({ kind: 'crew-prerequisite', before: crewBefore, after: crewAfter }); world.physicalCrewEvidence.projects.clear(); world.physicalCrewEvidence.generation = null;
    const stable = await hashes(), assisted = { ...world._assistedColumn };
    world._assistedColumn.x += 50; require((await hashes()).continuation === stable.continuation, 'Inactive assistance scratch changed continuation');
    world._assistedColumn.valid = true; require((await hashes()).continuation !== stable.continuation, 'Active assistance was omitted'); Object.assign(world._assistedColumn, assisted);
    world.terrainTopology.staleResults++; world.physicalCrewEvidence.censored++; world.soundEvents._sequence += 100; world.soundEvents._queue.push({ diagnostic: true });
    const passive = () => {}; world.soundEvents.onEvent.on(passive); world.soundEvents.onBatch.on(passive);
    require((await hashes()).continuation === stable.continuation, 'Passive presentation or legacy delivery changed continuation'); world.soundEvents.onEvent.off(passive); world.soundEvents.onBatch.off(passive); world.soundEvents._queue.length = 0;
    results.push({ kind: 'assistance-and-delivery', inactiveStable: true, activeDistinct: true, deliveryStable: true });
    const saved = checkpoint.captureProcgenCheckpoint(world), original = structuredClone(saved), props = saved.graph.owners.find(owner => owner.name === 'world').props;
    delete props.physicalAuthoring; let incomplete;
    try { await evidence.hashProcgenContinuationCheckpoint(saved); } catch (error) { incomplete = error.code; }
    require(incomplete === 'checkpoint-continuation-incomplete', 'Missing continuation owner qualified');
    const comparison = await evidence.compareProcgenContinuationCheckpoints(original, original);
    require(comparison.matched && comparison.schema === 'lemmings-continuation-comparison' && comparison.version === 1, 'Complete continuation comparison failed');
    results.push({ kind: 'comparison-scope', incomplete, schema: comparison.schema, version: comparison.version });
    const region = { id: 'continuation.room', revision: 1, bounds: { x1: 100, x2: 108, y1: 40, y2: 48 }, allowOpen: true,
      mapping: { revision: 1, bodyId: 'continuation.body', basePitchCents: 6000, referenceAreaPixels2: 64 } };
    world.configureTopologyRegions([region]); const input = topology.prepareTopologyAnalysis(world, world.terrainTopology.profiles[0]);
    let sync, cooperative;
    try { checkpoint.captureProcgenCheckpoint(world); } catch (error) { sync = error.code; }
    try { await checkpoint.captureProcgenCheckpointCooperative(world, { isCurrent: () => true }); } catch (error) { cooperative = error.code; }
    require(sync === 'pending-topology-evidence' && cooperative === sync, 'Pending topology work entered a checkpoint');
    require(topology.publishTopologyAnalysis(world, input, geometry.analyzeTopology(input)), 'Owned topology publication failed');
    checkpoint.captureProcgenCheckpoint(world); results.push({ kind: 'pending-topology', sync, cooperative, recovered: true });
    return results;
  } finally { owner.dispose(); }
}
