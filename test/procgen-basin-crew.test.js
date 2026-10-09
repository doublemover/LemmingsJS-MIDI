import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenBasinCrewRoutes, MAX_BASIN_SECTIONS, BASIN_PROJECT_TICKS } from '../js/app/procgen/ProcgenBasinCrewRoutes.js';
import { loadProcgenTerrain, loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { applyProcgenGameEventMidiPreset } from '../js/midi/project/ProcgenMidiDefaults.js';
import { createMidiProject, projectToMidiConfig } from '../js/midi/project/MidiProject.js';
import { SoundEffectIds } from '../js/game/SoundEvents.js';
import { withFakeClockAndPerformance } from './support/timers.js';
import { makeOutput } from './support/midi-output.js';

const makeScene = async (masks, count = 8, { scout = false, lanes = 1 } = {}) => {
  const terrain = await loadProcgenTerrain('lemmings', 4);
  const world = new ProcgenLaneWorld({ terrain, masks, laneHeight: 144, laneCount: lanes, seed: 42, speed: 1,
    cohorts: true, assists: true, maxActors: count + 2, populationPolicy: { scoutsEvery: scout ? 8 : 0 },
    stallPolicy: { releaseIntervalTicks: 100000, secondsWithoutProgress: 10000 } });
  world.cohorts = false; world.laneSeeds[0] = 8;
  // Explicit controlled crew at the naturally selected source bank. This is
  // inspection preparation, not an unaided public run reaching the scene.
  world.frontiers.fill(2090); world.terrainGrowth.reset(world.generatedThrough, world.frontiers);
  const actors = [];
  for (let index = 0; index < count + (scout ? 1 : 0); index++) {
    if (scout && index === 6) world.setPopulationPolicy({ scoutsEvery: 0 });
    const actor = world._spawn(0); actors.push(actor);
  }
  const owner = actors[scout ? 5 : 0];
  for (const actor of actors) {
    actor.x = actor === owner ? 1939 : actor === actors[scout ? 0 : 1] ? scout ? 1929 : 1931 : 1923;
    actor.y = 124; actor.furthestX = actor.x; actor.setAction(world.actions[State.WALKING]); world.lanePolicy.projects.observe(actor);
  }
  const descriptor = terrain.describe(8, 15), object = descriptor.objects.find(entry => entry.basin), basin = object.basin;
  const events = [], contacts = [];
  world.soundEvents.onEvent.on(event => { if (event.type === 'procgen-route-complete') events.push(event); if (event.type === 'blocker-contact') contacts.push(event); });
  const footprint = []; let maxLedger = 0, maxLanes = 0; const perTick = new Map();
  const prove = world.basinRoutes.prove.bind(world.basinRoutes);
  world.basinRoutes.prove = (...args) => {
    const tick = world.tickIndex; let set = perTick.get(tick); if (!set) perTick.set(tick, set = new Set()); set.add(args[0].laneIndex); maxLanes = Math.max(maxLanes, set.size);
    const result = prove(...args); if (result.proposal) footprint.push(result.proposal.footprint); return result;
  };
  const step = () => { world.step(); for (const ledger of world.hazardPlanner.admission.lanes) maxLedger = Math.max(maxLedger, ledger.probes); };
  return { world, actors, owner, descriptor, object, basin, events, contacts, step, footprint, limits: () => ({ maxLedger, maxLanes }) };
};
const until = (scene, condition, max = 1200) => { while (scene.world.tickIndex < max && !condition()) scene.step(); expect(condition()).to.equal(true); };
const receipt = scene => ({ tick: scene.world.tickIndex, event: scene.events[0], stats: { builds: scene.world.stats.builds, bashes: scene.world.stats.bashes,
  removedPixels: scene.world.stats.removedPixels, failures: scene.world.stats.failures, digs: scene.world.stats.digs, mines: scene.world.stats.mines },
limits: scene.limits(), sections: scene.world.basinRoutes.stats.sections, privateWork: scene.world.basinRoutes.stats.maxWork });

describe('actual source open-bank staged ordinary crew route', function() {
  this.timeout(30000); let masks; before(async () => { masks = await loadProcgenMasks(); });
  for (const count of [8, 16]) it(`freshly carries ${count} ordinary recipients plus one naturally classified scout worker through the unchanged source pool`, async () => {
    const run = async () => {
      const scene = await makeScene(masks, count, { scout: true }), { world, owner, actors, events, basin } = scene;
      try {
        expect(owner).to.include({ scout: true, scoutAbilities: 1, spawnOrdinal: 5, canClimb: false, hasParachute: false });
        expect(actors.filter(actor => !actor.scout)).to.have.length(count);
        let previous = owner.action, shrugs = 0, endpoints = 0;
        while (!events.length && world.tickIndex < 1200) {
          scene.step();
          if (owner.action === world.actions[State.SHRUG] && previous !== owner.action) shrugs++;
          if (owner.action === world.actions[State.BLOCKING] && previous === world.actions[State.SHRUG]) endpoints++;
          previous = owner.action;
          expect(events.length).to.be.at.most(1); expect(world.stats.failures).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0);
          expect(world.actors.every(actor => !actor.failureReason && !actor.terminalReason)).to.equal(true);
        }
        expect(events).to.have.length(1); expect(shrugs).to.equal(4); expect(endpoints).to.equal(3);
        expect(events[0]).to.include({ admittedCrew: count + 1, ordinaryCrossings: count, recoveredBlockers: 2, connectionTick: 819, kind: 'builders', sfxId: 29 });
        expect(events[0].lemmingId).to.equal(owner.id); expect(events[0].crewProjectId).to.be.a('string');
        expect(world.stats).to.include({ builds: 4, bashes: 2, digs: 0, mines: 0, failures: 0, removedPixels: 0, laneTransfers: 0 });
        expect(scene.contacts.length).to.be.greaterThan(20);
        expect(actors.every(actor => actor.action === world.actions[State.WALKING] && actor.x > events[0].x && actor.y === 124 && !actor.canClimb && !actor.hasParachute && !actor.assistConstructionTask)).to.equal(true);
        expect(world.lanePolicy.lanes[0].knowledge.some(record => record.kind === 'scout-basin-encounter')).to.equal(true);
        for (let x = basin.floor.x1; x < basin.floor.x2; x++) expect(world.hasGroundAt(x, basin.floor.y)).to.equal(true);
        expect(world.hazards.peek(0, 15, scene.descriptor.objects.indexOf(scene.object)).enabled).to.equal(true);
        const data = receipt(scene); expect(data.limits.maxLedger).to.be.at.most(1024); expect(data.limits.maxLanes).to.be.at.most(8); expect(data.privateWork).to.be.at.most(1024);
        expect(scene.footprint.every(bounds => bounds.x2 - bounds.x1 === 28)).to.equal(true);
        scene.step(); expect(world.basinRoutes.stats.completed).to.equal(1); expect(world.basinRoutes.scenes[0]).to.equal(null);
        expect(world.triggerManager.byOwner.size).to.equal(0); expect(events).to.have.length(1);
        return data;
      } finally { world.dispose(); }
    };
    expect(await run()).to.deep.equal(await run());
  });
  it('does not resolve a worker-only scene, future births, or a same-tick queued lane nuke', async () => {
    const solo = await makeScene(masks, 1); const { world } = solo;
    try {
      until(solo, () => world.basinRoutes.scenes[0]?.phase === 'connected');
      for (let i = 0; i < 20; i++) solo.step();
      expect(solo.events).to.have.length(0); expect(world.lanePolicy.projects.signals(0).completed).to.equal(0);
    } finally { world.dispose(); }
    const scene = await makeScene(masks, 8);
    try {
      until(scene, () => scene.world.tickIndex === 500); const late = scene.world._spawn(0); late.x = 1923; late.y = 124; late.setAction(scene.world.actions[State.WALKING]);
      const active = scene.world.basinRoutes.scenes[0]; expect(active.project.members.has(late.id)).to.equal(false);
      until(scene, () => scene.world.tickIndex === 955); scene.world.nukeLane(0); scene.step();
      expect(scene.events).to.have.length(0); expect(scene.world.basinRoutes.stats.lastFailure.reason).to.equal('scene-cancelled');
      expect(scene.world.triggerManager.byOwner.size).to.equal(0);
      expect(scene.actors.every(actor => !actor.assistConstructionTask && !actor._basinSceneId && actor.action === scene.world.actions[State.OHNO])).to.equal(true);
    } finally { scene.world.dispose(); }
  });
  it('retires revised or lost connected crew through actual lane-local OHNO, preserving a different lane', async () => {
    for (const change of ['foreign-edit', 'crew-loss']) {
      const scene = await makeScene(masks, 8, { lanes: 2 }), { world } = scene;
      const other = world._spawn(1); other.x = 36; other.y = world.surfaceAt(1, 36); other.setAction(world.actions[State.WALKING]);
      try {
        until(scene, () => world.basinRoutes.scenes[0]?.phase === 'connected');
        if (change === 'foreign-edit') world.clearGroundAt(2000, 93); else scene.actors[2].removed = true;
        scene.step(); expect(scene.events).to.have.length(0); expect(world.basinRoutes.stats.failed).to.equal(1);
        expect(world.basinRoutes.scenes[0]).to.equal(null); expect(world.triggerManager.byOwner.size).to.equal(0);
        expect(scene.actors.every(actor => !actor.assistConstructionTask && !actor._basinSceneId)).to.equal(true);
        expect(other.action).not.to.equal(world.actions[State.OHNO]); expect(other.failureReason).to.equal(null);
      } finally { world.dispose(); }
    }
  });
  it('uses stable exact receipt identity through descriptor rebuild and ignores unrelated edits, then clears reset/dispose ownership', async () => {
    const scene = await makeScene(masks, 8), { world, basin } = scene;
    try {
      scene.step(); world.terrain.reset();
      const rebuilt = world.terrain.describe(8, 15).objects.find(object => object.basin).basin;
      expect(rebuilt).not.to.equal(basin); expect(rebuilt).to.deep.equal(basin);
      world.setGroundAt(1900, 20); scene.step(); expect(world.basinRoutes.stats.failed).to.equal(0);
      until(scene, () => scene.events.length === 1); expect(world.stats.failures).to.equal(0);
      world._restart([]); expect(world.basinRoutes.scenes.every(entry => entry === null)).to.equal(true); expect(world.triggerManager.byOwner.size).to.equal(0);
    } finally { world.dispose(); expect(world.basinRoutes.world).to.equal(null); }
  });
  it('rejects protected/head-blocked/changed-source proposals and defers insufficient shared work without live sounds or terrain mutation', async () => {
    const scene = await makeScene(masks, 8), { world, owner } = scene;
    try {
      const hazards = []; world.hazards.nearby(0, owner.x, { ahead: 40, behind: 4 }, hazards);
      const candidate = world.basinRoutes.candidate(owner, hazards, 1024), record = candidate.proposal.basinScene;
      const actorState = [owner.x, owner.y, owner.action, owner.state], edits = world.editChunks.size, revision = world.terrainRevision;
      const sounds = []; world.soundEvents.onEvent.on(event => sounds.push(event));
      expect(world.basinRoutes.prove(owner, record, 1)).to.include({ proposal: null, failure: 'budget' });
      expect(world.basinRoutes.prove(owner, record, 1024).proposal).not.to.equal(null);
      expect([owner.x, owner.y, owner.action, owner.state]).to.deep.equal(actorState); expect(world.editChunks.size).to.equal(edits); expect(world.terrainRevision).to.equal(revision); expect(sounds).to.have.length(0);
      const steel = world.hasSteelAt; world.hasSteelAt = (x, y) => x === owner.x && y === owner.y - 1 || steel.call(world, x, y);
      // Protected existing solid pixels, not an invented steel label in air.
      world.setGroundAt(owner.x, owner.y - 1);
      expect(world.basinRoutes.prove(owner, record, 1024).failure).to.equal('protected'); world.hasSteelAt = steel;
      world.clearGroundAt(owner.x, owner.y - 1); world.setGroundAt(owner.x + 4, owner.y - 10);
      expect(world.basinRoutes.prove(owner, record, 1024).proposal).to.equal(null);
      const changed = { ...scene.basin, object: { ...scene.basin.object, y: 123 } };
      expect(world.basinRoutes._enabled(0, 15, 0, changed)).to.equal(false);
    } finally { world.dispose(); }
  });
  it('rejects exhausted whole-cohort capacity before a live builder starts and keeps the existing lane service bounds', async () => {
    const scene = await makeScene(masks, 8), { world, owner } = scene;
    try {
      for (let i = 0; i < 4; i++) world.lanePolicy.projects.begin(owner, 'builders', {});
      scene.step(); expect(world.stats.builds).to.equal(0); expect(world.basinRoutes.scenes[0]).to.equal(null);
      expect(owner.action).to.equal(world.actions[State.WALKING]); expect(scene.events).to.have.length(0);
      expect(MAX_BASIN_SECTIONS).to.equal(4); expect(ProcgenBasinCrewRoutes).to.be.a('function');
    } finally { world.dispose(); }
  });
  it('denies cold pending source jobs before assignment and retires an expired waiting guard once, locally', async () => {
    const cold = await makeScene(masks, 8);
    try {
      cold.world.frontiers.fill(36); cold.world.terrainGrowth.reset(cold.world.generatedThrough, cold.world.frontiers);
      expect(cold.world.terrain.describe(8, 15).objects[0].basin).not.to.equal(undefined);
      expect(cold.world.basinRoutes._enabled(0, 15, 0, cold.basin)).to.equal(false);
      const before = cold.world.stats.builds;
      const result = cold.world.basinRoutes.candidate(cold.owner, [{ lane: 0, chunk: 15, objectIndex: 0, enabled: true }], 1024);
      expect(result.proposal).to.equal(null); expect(cold.world.stats.builds).to.equal(before);
    } finally { cold.world.dispose(); }
    const scene = await makeScene(masks, 8, { lanes: 2 }), { world } = scene;
    const other = world._spawn(1); other.x = 36; other.y = world.surfaceAt(1, 36); other.setAction(world.actions[State.WALKING]);
    try {
      until(scene, () => world.basinRoutes.scenes[0]?.phase === 'waiting');
      const active = world.basinRoutes.scenes[0], owner = scene.owner, ledger = world.hazardPlanner.admission.begin(0);
      ledger.probes = 1023; const builds = world.stats.builds; world.basinRoutes.assist(owner);
      expect(world.stats.builds).to.equal(builds); expect(owner.action).to.equal(world.actions[State.BLOCKING]); expect(world._manualNukeLanes[0]).to.equal(0);
      world.tickIndex = active.startTick + BASIN_PROJECT_TICKS + 1; scene.step();
      expect(world.basinRoutes.stats.failed).to.equal(1); expect(scene.events).to.have.length(0); expect(world.triggerManager.byOwner.size).to.equal(0);
      expect(scene.actors.every(actor => !actor.assistConstructionTask && !actor._basinSceneId)).to.equal(true);
      expect(other.failureReason).to.equal(null); expect(other.action).not.to.equal(world.actions[State.OHNO]);
      scene.step(); expect(world.basinRoutes.stats.failed).to.equal(1);
    } finally { world.dispose(); }
  });
  it('admits the same actual bank on an off-service approach in sixteen lanes without widening the shared ledger', async () => {
    const scene = await makeScene(masks, 8, { scout: true, lanes: 16 });
    try { until(scene, () => scene.events.length === 1); expect(scene.world.stats.failures).to.equal(0); expect(scene.world.stats.builds).to.equal(4);
      expect(scene.events[0]).to.include({ admittedCrew: 9, ordinaryCrossings: 8 }); expect(scene.limits().maxLedger).to.be.at.most(1024);
    } finally { scene.world.dispose(); }
  });
  const waitingScene = async () => {
    const scene = await makeScene(masks, 8, { scout: true });
    // Controlled delayed-arrival fixture; unaided birth-to-bank evidence is a
    // separate fixed public-run receipt. Preserve real birth metadata here.
    scene.waiting = scene.actors.filter(actor => actor !== scene.owner);
    scene.world.actors = [scene.owner]; scene.world.lanePolicy.projects.reset();
    scene.world.lanePolicy.projects.observe(scene.owner); scene.step();
    expect(scene.world.basinRoutes.scenes[0].arrival.phase).to.equal('open');
    return scene;
  };
  const admitAtBank = (scene, actors) => {
    for (const actor of actors) {
      actor.x = 1923; actor.y = 124; actor.lookRight = true; actor.setAction(scene.world.actions[State.WALKING]);
      if (!scene.world.actors.includes(actor)) scene.world.actors.push(actor);
    }
  };
  it('holds a scout-only final owner, freezes one actual supported bank tick and resolves only that delayed ordinary cohort', async () => {
    const scene = await waitingScene(), { world, owner } = scene;
    try {
      until(scene, () => world.basinRoutes.scenes[0]?.phase === 'connected');
      const active = world.basinRoutes.scenes[0], originalStart = active.startTick;
      for (let i = 0; i < 3; i++) scene.step();
      expect(owner.action).to.equal(world.actions[State.BLOCKING]); expect(active.release).to.equal(false); expect(scene.events).to.have.length(0);
      const first = scene.waiting.slice(0, 2); admitAtBank(scene, first); scene.step();
      const frozen = active.arrival.cohortTick;
      expect(active.arrival.cohort.map(record => record.id)).to.have.members(first.map(actor => actor.id));
      expect(active.project.members.size).to.equal(3); expect(active.startTick).to.equal(originalStart);
      for (let i = 0; i < 3; i++) world.lanePolicy.projects.observe(first[0]);
      admitAtBank(scene, [scene.waiting[2]]); scene.step();
      expect(active.arrival.cohortTick).to.equal(frozen); expect(active.project.members.has(scene.waiting[2].id)).to.equal(false);
      until(scene, () => scene.events.length === 1);
      expect(scene.events[0]).to.include({ admittedCrew: 3, ordinaryCrossings: 2, recoveredBlockers: 1, arrivalTick: frozen });
      expect(scene.events[0].arrivalCrewIds).to.have.members(first.map(actor => actor.id));
      expect(world.stats).to.include({ failures: 0, removedPixels: 0, builds: 4, bashes: 1 });
      expect(world.hazards.stats.contacts).to.equal(0); expect(world.triggerManager.byOwner.size).to.equal(0);
      expect(first.every(actor => actor.action === world.actions[State.WALKING] && actor.x > scene.events[0].x && !actor.canClimb && !actor.hasParachute)).to.equal(true);
    } finally { world.dispose(); }
  });
  it('admits a real pre-assist supported WALK converted to containment, while gating future births and every later held insertion', async () => {
    const scene = await waitingScene(), { world } = scene;
    try {
      const active = world.basinRoutes.scenes[0], eligible = scene.waiting[0], future = scene.waiting[1];
      eligible.spawnTick = active.startTick; eligible.x = 1931; future.x = 1931; future.spawnTick = active.startTick + 1;
      world.actors.push(eligible, future); scene.step();
      expect(eligible.action).to.equal(world.actions[State.BLOCKING]); expect(eligible.assistConstructionTask).not.to.equal(undefined);
      expect(active.project.members.get(eligible.id)).to.include({ ordinary: true, blocker: true });
      expect(active.arrival.cohort.map(record => record.id)).to.deep.equal([eligible.id]);
      expect(future.action).not.to.equal(world.actions[State.BLOCKING]); expect(future.assistConstructionTask).to.equal(undefined);
      future.assistConstructionTask = active.originalTask; world.lanePolicy.projects.observe(future);
      expect(active.project.members.has(future.id)).to.equal(false);
      expect(world.basinRoutes.canContain(scene.waiting[2], active.originalTask)).to.equal(false);
    } finally { world.dispose(); }
  });
  it('requires genuine landing and a living completed observation, not FALL geography or a later same-tick loss', async () => {
    const scene = await waitingScene(), { world } = scene;
    try {
      const active = world.basinRoutes.scenes[0], actor = scene.waiting[0];
      actor.x = 1923; actor.y = 116; actor.setAction(world.actions[State.FALLING]); world.actors.push(actor); scene.step();
      expect(active.arrival.phase).to.equal('open');
      let supportedTick = null;
      while (world.tickIndex < 20 && !supportedTick) { scene.step(); if (actor.action === world.actions[State.WALKING] && actor.y === 124) supportedTick = world.tickIndex; }
      expect(supportedTick).not.to.equal(null); expect(active.arrival.cohortTick).to.equal(supportedTick);
      const losing = await waitingScene();
      try {
        const gone = losing.waiting[0], pending = losing.world.basinRoutes.scenes[0];
        admitAtBank(losing, [gone]); losing.world.basinRoutes.observeApproach(gone); losing.world.lanePolicy.projects.observe(gone);
        gone.removed = true; losing.world.lanePolicy.projects.retire(gone); losing.world.basinRoutes.finish(0);
        expect(pending.arrival.phase).to.equal('open'); expect(pending.project.members.size).to.equal(1); expect(losing.events).to.have.length(0);
      } finally { losing.world.dispose(); }
    } finally { world.dispose(); }
  });
  it('accepts all 63 eligible current bank records plus their scout owner at the exact 64-member capacity without a cue', async () => {
    // Capacity evidence uses real supported bank coordinates but deliberately
    // controlled observations; it is not a 64-person passage qualification.
    const scene = await waitingScene(), { world } = scene;
    try {
      const active = world.basinRoutes.scenes[0];
      for (let id = 100; id < 163; id++) {
        const actor = { id, laneIndex: 0, spawnTick: active.startTick, x: 1923, y: 124, action: world.actions[State.WALKING] };
        world.basinRoutes.observeApproach(actor); world.lanePolicy.projects.observe(actor);
      }
      world.basinRoutes.finish(0);
      expect(active.arrival.phase).to.equal('closed'); expect(active.arrival.cohort).to.have.length(63);
      expect(active.project.members.size).to.equal(64); expect(active.project.members.has(scene.owner.id)).to.equal(true);
      expect(active.project.phase).to.equal('working'); expect(scene.events).to.have.length(0); expect(world._manualNukeLanes[0]).to.equal(0);
    } finally { world.dispose(); }
  });
  it('rejects whole snapshot overflow instead of truncating and retires an owner-only wait at its original deadline', async () => {
    for (const liveOverflow of [false, true]) {
      const scene = await waitingScene(), { world } = scene;
      try {
        const active = world.basinRoutes.scenes[0], state = world.lanePolicy.projects.lanes[0];
        for (let id = 100; id < (liveOverflow ? 101 : 164); id++) {
          const actor = { id, laneIndex: 0, spawnTick: active.startTick, x: 1923, y: 124, action: world.actions[State.WALKING] };
          world.basinRoutes.observeApproach(actor); world.lanePolicy.projects.observe(actor);
        }
        if (liveOverflow) state.overflowTick = world.tickIndex;
        world.basinRoutes.finish(0);
        expect(active.failure).to.equal('arrival-capacity'); expect(active.project.members.size).to.equal(1); expect(scene.events).to.have.length(0);
        expect(world._manualNukeLanes[0]).to.equal(1);
      } finally { world.dispose(); }
    }
    const scene = await waitingScene(), { world } = scene;
    try {
      until(scene, () => world.basinRoutes.scenes[0]?.phase === 'connected'); const active = world.basinRoutes.scenes[0];
      world.tickIndex = active.startTick + BASIN_PROJECT_TICKS; scene.step();
      expect(world.basinRoutes.scenes[0]).to.equal(null); expect(scene.events).to.have.length(0); expect(world.triggerManager.byOwner.size).to.equal(0);
      expect(scene.owner._basinSceneId).to.equal(null); expect(world.basinRoutes.stats.failed).to.equal(1);
    } finally { world.dispose(); }
  });
  it('maps actual completed source crew to four default queued musical cells, frozen while paused and released by owned offs/Panic', async () => {
    const scene = await makeScene(masks, 8, { scout: true }), { world } = scene;
    try {
      withFakeClockAndPerformance(clock => {
        const config = projectToMidiConfig(applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true }), 'game-major'));
        const cue = SoundEffectIds.PROCGEN_ROUTE_COMPLETE;
        config.sfx = Object.fromEntries(Object.values(SoundEffectIds).map(id => [id, id === cue ? config.sfx[id] : { disabled: true }])); config.triggers = {};
        const router = new MidiEventRouter(config), calls = [], accepted = [];
        router.setOutput(makeOutput(Array.from({ length: 16 }, (_, i) => i + 1), calls, 'fake-local'));
        const send = router.scheduler.sendNote.bind(router.scheduler);
        router.scheduler.sendNote = (spec, meta) => { const result = send(spec, meta); if (result && meta.sfxId === cue) accepted.push({ tick: world.tickIndex, note: spec.note, type: meta.eventType, actor: meta.lemmingId }); return result; };
        router.attach(world.soundEvents, { game: world });
        try {
          while (!scene.events.length && world.tickIndex < 1200) { scene.step(); clock.tick(60); }
          expect(scene.events).to.have.length(1); expect(accepted).to.have.length(1); const tick = world.tickIndex; clock.tick(1000); expect(accepted).to.have.length(1);
          for (let i = 0; i < 13; i++) { scene.step(); clock.tick(60); }
          expect(accepted.map(entry => entry.tick)).to.deep.equal([tick, tick + 3, tick + 6, tick + 9]);
          expect(accepted.every(entry => entry.type === 'procgen-route-complete' && entry.actor === scene.owner.id)).to.equal(true);
          expect(calls.filter(call => call.type === 'noteOn')).to.have.length(4); expect(calls.filter(call => call.type === 'noteOff')).to.have.length(4);
          router.scheduler.allNotesOff(); expect(router.scheduler.gamePhrases.voices.size).to.equal(0); expect(router.scheduler._activeNotes.size).to.equal(0);
        } finally { router.dispose(); }
      });
    } finally { world.dispose(); }
  });
});
