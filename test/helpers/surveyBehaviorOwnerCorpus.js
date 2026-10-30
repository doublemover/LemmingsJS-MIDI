export async function surveyBehaviorOwnerCorpus(createTrial, sourceRoot = new URL('../../js/app/procgen/', import.meta.url)) {
  const [{ preparePhysicalAuthoringCommand }, { digestPlan }, crew, topology, { analyzeTopology }] = await Promise.all([
    import(new URL('PhysicalAuthoring.js', sourceRoot)), import(new URL('TerrainAuthoringAdapter.js', sourceRoot)),
    import(new URL('PhysicalCrewEvidence.js', sourceRoot)), import(new URL('ProcgenTerrainTopology.js', sourceRoot)),
    import(new URL('workstation/physical/TopologyInstrumentRegion.js', sourceRoot))
  ]);
  const scenario = { id: 'behavior-owner-corpus', environmentSeed: 42, horizonTicks: 128, checkpointEvery: 64,
    physicalLaneCount: 1, cohort: { size: 1, birthInterval: 0 }, goal: { x: 1000, y: 64, width: 16, height: 16 },
    geometry: { solid: [{ x: 8, y: 72, width: 2048, height: 24 }], steel: [] }, worldOptions: { assists: false } };
  const require = (condition, message) => { if (!condition) throw new Error(message); }, results = [];
  const pair = async run => {
    const trials = [await createTrial(scenario), await createTrial(scenario)];
    try { for (const trial of trials) trial.step(16); await run(trials); }
    finally { for (const trial of trials) trial.dispose(); }
  };
  const hashes = trials => trials.map(trial => trial.snapshot().physicalStateHash);
  await pair(trials => {
    const graph = { version: 1, revision: 1, instruments: [] };
    for (const trial of trials) trial.world.configurePhysicalAuthoring(graph);
    const before = hashes(trials); require(before[0] === before[1], 'Authoring worlds did not initially agree');
    trials[1].world.physicalAuthoring.revision++;
    const after = hashes(trials); require(after[0] !== after[1], 'Authoring command revision was omitted');
    const command = { version: 1, operation: 'terrain-and-graph', transactionId: 'owner.authoring', expectedRevision: 0,
      expectedJunctionRevision: 0, expectedGraphDigest: digestPlan(trials[0].world.physicalAuthoring.graph),
      graph: { ...graph, revision: 2 }, instances: [], junctions: [],
      terrain: { operation: 'addSolid', transactionId: 'owner.authoring', generation: trials[0].world.generation, spans: [{ x1: 120, x2: 128, y: 20 }] } };
    const outcomes = trials.map(trial => preparePhysicalAuthoringCommand(trial.world, command).status);
    require(outcomes[0] === 'prepared' && outcomes[1] === 'stale', 'Authoring revision did not change actual command acceptance');
    results.push({ kind: 'authoring-revision', before, after, outcomes });
  });
  await pair(trials => {
    const projects = [];
    for (const trial of trials) {
      const world = trial.world, actorId = world.actors[0].id, project = { id: 'owner.crew', generation: world.generation,
        ownerId: actorId, lane: 0, kind: 'tunnel', startTick: world.tickIndex, startX: 100, startY: 60, members: new Map([[actorId, {}]]) };
      projects.push(project); world.soundEvents.beginTick({ worldId: world.worldId, generation: world.generation, tick: world.tickIndex, terrainRevisionBefore: world.terrainRevision });
      try {
        for (const kind of ['CrewRouteOpened', 'CrewRouteConnected', 'CrewMemberArrived']) require(crew.recordPhysicalCrewFact(world, project, kind)?.eventId, 'Real crew prerequisite was not admitted');
      } finally { world.soundEvents.abortTick(); }
    }
    const before = hashes(trials); require(before[0] === before[1], 'Crew worlds did not initially agree');
    trials[1].world.physicalCrewEvidence.projects.get('owner.crew').complete = false;
    const after = hashes(trials); require(after[0] !== after[1], 'Crew prerequisite completeness was omitted');
    const outcomes = trials.map((trial, index) => {
      const world = trial.world; world.soundEvents.beginTick({ worldId: world.worldId, generation: world.generation, tick: world.tickIndex, terrainRevisionBefore: world.terrainRevision });
      try { return crew.finishPhysicalCrewEvidence(world, projects[index]).completionCoverage; }
      finally { world.soundEvents.abortTick(); }
    });
    require(outcomes[0] === 'complete' && outcomes[1] === 'incomplete', 'Crew prerequisite did not change completion evidence');
    results.push({ kind: 'crew-prerequisite', before, after, outcomes });
  });
  const region = { id: 'owner.room', revision: 1, bounds: { x1: 100, x2: 108, y1: 40, y2: 48 }, allowOpen: true,
    mapping: { revision: 1, bodyId: 'owner.body', basePitchCents: 6000, referenceAreaPixels2: 64 } };
  await pair(trials => {
    for (const trial of trials) trial.world.configureTopologyRegions([region]);
    const before = hashes(trials); require(before[0] === before[1], 'Topology worlds did not initially agree');
    trials[1].world.terrainTopology.regions.set(region.id, { nextSerial: 40, history: [] });
    const after = hashes(trials); require(after[0] !== after[1], 'Topology identity continuation was omitted');
    for (const trial of trials) topology.captureTerrainTopology(trial.world);
    const outcomes = trials.map(trial => trial.world.terrainTopology.regions.get(region.id).current.components[0].id);
    require(outcomes[0] !== outcomes[1], 'Topology identity continuation did not affect actual analysis');
    results.push({ kind: 'topology-lineage', before, after, outcomes });
  });
  const trial = await createTrial(scenario); let getters = 0;
  try {
    const world = trial.world; world.configureTopologyRegions([region]); topology.captureTerrainTopology(world);
    const before = trial.snapshot().physicalStateHash, profile = world.terrainTopology.profiles[0], input = topology.prepareTopologyAnalysis(world, profile);
    let pending = null; try { trial.snapshot(); } catch (error) { pending = error.code; }
    require(pending === 'pending-topology-evidence', 'Outstanding topology publication was qualified');
    require(topology.publishTopologyAnalysis(world, input, analyzeTopology(input, world.terrainTopology.regions.get(region.id).history.at(-1))), 'Owned topology publication refused');
    const settled = trial.snapshot().physicalStateHash;
    require(!topology.publishTopologyAnalysis(world, input, analyzeTopology(input)), 'Duplicate topology publication was accepted');
    require(trial.snapshot().physicalStateHash === settled, 'Rejected topology diagnostic changed physical identity');
    world.physicalCrewEvidence.censored++;
    require(trial.snapshot().physicalStateHash === settled, 'Crew diagnostic count changed physical identity');
    const original = world.physicalAuthoring.graph, failures = [];
    const getter = () => { getters++; throw new Error('Unexpected metadata getter'); };
    for (const field of ['objects', 'descriptor', 'groups', 'world', 'runtime', 'image', 'piece', 'composite']) {
      const graph = { version: 1, revision: 1, instruments: [] };
      Object.defineProperty(graph, field, { configurable: true, get: getter }); world.physicalAuthoring.graph = graph;
      let code; try { trial.snapshot(); } catch (error) { code = error.code; } finally { world.physicalAuthoring.graph = original; }
      require(code === 'accessor-state-data', 'Ignored source/route accessor qualified: ' + field); failures.push({ field, code });
    }
    for (const value of [new Date(0), /empty/, new WeakMap(), () => {}, Symbol('unsupported')]) {
      world.physicalAuthoring.graph = { version: 1, revision: 1, instruments: [], descriptor: value };
      let code; try { trial.snapshot(); } catch (error) { code = error.code; } finally { world.physicalAuthoring.graph = original; }
      require(code === 'unsupported-state-data', 'Unsupported metadata qualified'); failures.push({ field: 'unsupported-value', code });
    }
    require(getters === 0, 'Metadata getter was evaluated'); require(trial.snapshot().physicalStateHash === settled, 'Metadata refusal changed owner state');
    results.push({ kind: 'pending-and-metadata', before, settled, pending, getters, failures });
  } finally { trial.dispose(); }
  return results;
}
