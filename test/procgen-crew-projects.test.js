import { expect } from 'chai';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { applyProcgenGameEventMidiPreset } from '../js/midi/project/ProcgenMidiDefaults.js';
import { createMidiProject, projectToMidiConfig } from '../js/midi/project/MidiProject.js';
import { makeOutput } from './support/midi-output.js';
import { withFakeClockAndPerformance } from './support/timers.js';
import { SoundEffectIds } from '../js/game/SoundEvents.js';
import { ProcgenCrewProjects, MAX_CREW_PROJECTS, MAX_PROJECT_CREW, PROJECT_LIFETIME_TICKS } from '../js/app/procgen/ProcgenCrewProjects.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const model = () => {
  const events = [], credits = [], world = { generation: 1, tickIndex: 1, laneCount: 1, terrainTileRevisions: new Map(),
    soundEvents: { emit: event => events.push(event) }, actions: { [State.WALKING]: {}, [State.BLOCKING]: {} } };
  const projects = new ProcgenCrewProjects(world, (...credit) => credits.push(credit));
  const actors = Array.from({ length: 3 }, (_, id) => ({ id, laneIndex: 0, x: 40 - id * 2, y: 120, lookRight: true, action: world.actions[State.WALKING] }));
  for (const actor of actors) projects.observe(actor);
  const task = {}; projects.begin(actors[0], 'builders', task);
  return { events, credits, world, projects, actors, task };
};

describe('bounded admitted crew project passage and completion', () => {
  it('credits passage then the complete admitted cohort, including real temporary containment recovery, once', () => {
    const { projects, world, actors, task, credits, events } = model();
    actors[2].assistConstructionTask = task; actors[2].action = world.actions[State.BLOCKING]; projects.observe(actors[2]);
    projects.connect(0, task.crewProjectId, 64, 108, [[0, 0]]);
    actors[0].x = actors[1].x = 73; actors[0].y = actors[1].y = 108;
    projects.observe(actors[0]); projects.observe(actors[1]);
    expect(credits).to.deep.equal([[0, 'builders', 'passage']]); expect(events).to.have.length(0);
    actors[2].action = world.actions[State.WALKING]; actors[2].x = 73; actors[2].y = 108;
    for (let repeat = 0; repeat < 8; repeat++) { projects.observe(actors[2]); projects.finish(0); }
    expect(credits).to.deep.equal([[0, 'builders', 'passage'], [0, 'builders', 'crew-complete']]);
    expect(events).to.have.length(1); expect(events[0]).to.include({ type: 'procgen-route-complete', admittedCrew: 3, ordinaryCrossings: 2, recoveredBlockers: 1 });
    expect(projects.signals(0)).to.include({ completed: 1, active: 0 }); projects.dispose(); expect(projects.world).to.equal(null);
  });
  it('does not reward a hero-only route, future birth, crew loss or a changed local support', () => {
    const fixture = model(), { projects, actors, task, world, events, credits } = fixture;
    projects.connect(0, task.crewProjectId, 64, 108, [[0, 0]]);
    actors[0].x = 80; actors[0].y = 108; projects.observe(actors[0]);
    projects.observe({ ...actors[0], id: 99 }); expect(credits).to.have.length(0);
    actors[1].terminalReason = 'drowned'; projects.observe(actors[1]);
    actors[2].x = 80; projects.observe(actors[2]); expect(events).to.have.length(0); expect(projects.signals(0).failed).to.equal(1);
    const changed = model(); changed.projects.connect(0, changed.task.crewProjectId, 64, 108, [[0, 0]]);
    changed.world.terrainTileRevisions.set(0, 1); changed.world.tickIndex++;
    changed.actors[1].x = 80; changed.projects.observe(changed.actors[1]);
    expect(changed.credits).to.have.length(0); expect(changed.projects.signals(0).failed).to.equal(1); expect(world.generation).to.equal(1);
  });
  it('rejects actor removal or stripe transfer while waiting for another admitted actor, and reverses passage credit on real loss', () => {
    const { projects, actors, task, world, credits, events } = model();
    projects.connect(0, task.crewProjectId, 64, 108, [[0, 0]]);
    actors[1].x = 80; actors[1].y = 108; projects.observe(actors[1]);
    actors[0].removed = true; projects.retire(actors[0]);
    expect(credits).to.deep.equal([[0, 'builders', 'passage'], [0, 'builders', 'crew-failure']]);
    actors[2].x = 80; projects.observe(actors[2]); expect(events).to.have.length(0);
    const moved = model(); moved.actors[1].laneIndex = 1; moved.projects.observe(moved.actors[1]);
    expect(moved.projects.signals(0).failed).to.equal(1); expect(moved.projects.lanes[0].live.has(1)).to.equal(false);
    world.generation++; world.tickIndex++; projects.observe(actors[2]);
    expect(projects.signals(0).active).to.equal(0);
  });
  it('publishes only after completed current-tick observations, never before a later same-tick member loss', () => {
    const { projects, actors, task, world, events } = model();
    projects.connect(0, task.crewProjectId, 64, 108, [[0, 0]]);
    world.tickIndex++;
    for (const actor of actors) { actor.x = 80; actor.y = 108; projects.observe(actor); }
    expect(events).to.have.length(0);
    actors[0].removed = true; projects.retire(actors[0]); projects.finish(0);
    expect(events).to.have.length(0); expect(projects.signals(0).failed).to.equal(1);
    const changed = model(); changed.actors[1].canClimb = true; changed.projects.observe(changed.actors[1]);
    expect(changed.projects.signals(0).failed).to.equal(1);
  });
  it('qualifies all claimed start/exit tiles and rejects oversized or invalid claimed revision footprints', () => {
    const { projects, actors, world, task } = model(); world.terrain = { chunkWidth: 128 }; world.laneHeight = 144;
    const project = projects.lanes[0].projects[0]; project.bounds = { x1: 120, x2: 160, y1: 90, y2: 120 };
    projects.connect(0, task.crewProjectId, 152, 108, [[1, 0]]);
    expect(project.tiles.map(tile => tile[0])).to.have.members([0, 1]);
    world.terrainTileRevisions.set(0, 1); projects.finish(0); expect(projects.signals(0).failed).to.equal(1);
    const invalid = model(); invalid.projects.lanes[0].projects[0].bounds.x2 = 1000;
    invalid.projects.connect(0, invalid.task.crewProjectId, 64, 108, []);
    expect(invalid.projects.signals(0).failed).to.equal(1); expect(actors).to.have.length(3);
  });
  it('bounds retained numeric cohorts, active projects and deadlines without a timer or historical actor references', () => {
    const { projects, actors, world } = model();
    for (let id = 10; id < 300; id++) projects.observe({ ...actors[0], id });
    expect(projects.signals(0).observedCrew).to.equal(MAX_PROJECT_CREW);
    projects.begin(actors[0], 'miners', {}); expect(projects.signals(0).deferred).to.equal(1);
    const capacity = model(); for (let id = 0; id < MAX_CREW_PROJECTS + 2; id++) capacity.projects.begin(capacity.actors[0], 'miners', {});
    expect(capacity.projects.signals(0)).to.include({ active: MAX_CREW_PROJECTS, deferred: 3 });
    expect([...projects.lanes[0].live.values()].every(record => !('actor' in record))).to.equal(true);
    world.tickIndex += PROJECT_LIFETIME_TICKS + 1; projects.observe(actors[0]);
    expect(projects.signals(0)).to.include({ active: 0, observedCrew: 1, failed: 1 });
    projects.reset(); expect(projects.signals(0).completed).to.equal(0);
  });
});

const finiteTerrain = () => {
  const chunks = new Map(), solidAt = (x, y) => (x === 12 || x === 243) && y >= 72 || y >= (x >= 80 && x < 86 ? 288 : 120);
  return { chunkWidth: 128, configure() {}, describe: () => ({ objects: [] }),
    solidSample: (_seed, chunk, x, y) => solidAt(chunk * 128 + x, y),
    getChunk(seed, chunk) {
      if (!chunks.has(chunk)) {
        const solid = new Uint32Array(128 * 144 / 32), steel = new Uint32Array(solid.length), topProfile = new Int16Array(128); topProfile.fill(-1);
        for (let y = 0; y < 144; y++) for (let x = 0; x < 128; x++) if (solidAt(chunk * 128 + x, y)) {
          const at = y * 128 + x; solid[at >>> 5] |= 1 << (at & 31);
          if (chunk * 128 + x === 243) steel[at >>> 5] |= 1 << (at & 31);
          if (topProfile[x] < 0) topProfile[x] = y;
        }
        chunks.set(chunk, { solid, steel, topProfile, objects: [] });
      }
      return chunks.get(chunk);
    }, reset() { chunks.clear(); }
  };
};
const replay = (masks, count, observer = null) => {
  const world = new ProcgenLaneWorld({ masks, terrain: finiteTerrain(), laneHeight: 144, seed: 42, assists: false,
    laneCount: 2, cohorts: true, maxActors: count, populationPolicy: { scoutsEvery: 0 }, stallPolicy: { releaseIntervalTicks: 100000 } });
  world.generatedThrough.fill(512); world.cohorts = false; world.hazardPlanner.plan = () => null;
  const actors = Array.from({ length: count }, (_, index) => {
    const actor = world._spawn(0); const x = index ? index === 1 ? 40 : 32 : 64;
    Object.assign(actor, { x, y: 120, furthestX: x }); actor.setAction(world.actions[State.WALKING]);
    world.lanePolicy.projects.observe(actor); return actor;
  });
  const events = []; world.soundEvents.onEvent.on(event => { if (event.type === 'procgen-route-complete') events.push(event); });
  observer?.attach?.(world);
  const leader = actors[0]; expect(world.assignWorker(leader, 'builders', 92)).to.equal(true); world.lanePolicy.begin(leader, { kind: 'builders' }); world.assists = true;
  let started = true;
  while (world.tickIndex < 1200 && events.length === 0) {
    world.step(); observer?.step?.(world); if (world.spawnedTotal === count) world.cohorts = false;

    expect(world.stats.failures).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0);
  }

  expect(started).to.equal(true); expect(events).to.have.length(1);
  expect(events[0]).to.include({ admittedCrew: count, ordinaryCrossings: count - 1, recoveredBlockers: 1, kind: 'builders', sfxId: SoundEffectIds.PROCGEN_ROUTE_COMPLETE, lemmingId: leader.id, routeRevisionsUnchanged: true });
  expect(events[0].crewProjectId).to.be.a('string'); expect('projectId' in events[0]).to.equal(false);
  expect(world.actors.every(actor => actor.x > events[0].x && !actor.scout && !actor.canClimb && !actor.hasParachute && !actor.assistConstructionTask)).to.equal(true);
  expect(world.stats.removedPixels + world.stats.mines + world.stats.digs).to.equal(0); expect(world.stats.blockers).to.equal(1);
  expect(world.hasSteelAt(243, 120)).to.equal(true); const receipt = { tick: world.tickIndex, event: events[0], builds: world.stats.builds, bashes: world.stats.bashes };
  observer?.complete?.(world, events[0]); world.dispose(); return receipt;
};
describe('actual controlled ordinary crew project completion', function() {
  this.timeout(30000); let masks; before(async () => { masks = await loadProcgenMasks(); });
  for (const count of [8, 16]) it(`replays all ${count} explicitly admitted ordinary actors, actual bridge and recovered blocker without loss before completion`, () => {
    const receipt = replay(masks, count); expect(replay(masks, count)).to.deep.equal(receipt);
  });  it('routes the genuine completed cohort cue through the editable default queued phrase, with pause and owned releases', () => {
    withFakeClockAndPerformance(clock => {
      const project = applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true }), 'game-major');
      const config = projectToMidiConfig(project), cue = SoundEffectIds.PROCGEN_ROUTE_COMPLETE;
      // Isolate the actual default completion mapping from unrelated scene notes.
      config.sfx = Object.fromEntries(Object.values(SoundEffectIds).map(id => [id, id === cue ? config.sfx[id] : { disabled: true }])); config.triggers = {};
      const router = new MidiEventRouter(config), calls = [], accepted = []; let world = null;
      router.setOutput(makeOutput(Array.from({ length: 16 }, (_, index) => index + 1), calls, 'fake-local'));
      const send = router.scheduler.sendNote.bind(router.scheduler);
      router.scheduler.sendNote = (spec, meta) => {
        const result = send(spec, meta);
        if (result && meta.sfxId === cue) accepted.push({ tick: world.tickIndex, note: spec.note, type: meta.eventType, actor: meta.lemmingId });
        return result;
      };
      try {
        const receipt = replay(masks, 8, {
          attach: value => { world = value; router.attach(world.soundEvents, { game: world }); },
          step: () => clock.tick(world.timer.frameTime),
          complete: (value, event) => {
            expect(accepted).to.have.length(1); const stoppedAt = value.tickIndex; clock.tick(1000);
            expect(value.tickIndex).to.equal(stoppedAt); expect(accepted).to.have.length(1);
            for (let tick = 0; tick < 13; tick++) { value.step(); clock.tick(value.timer.frameTime); }
            expect(accepted.map(note => note.tick)).to.deep.equal([0, 3, 6, 9].map(offset => event.tick + offset));
            expect(accepted.every(note => note.type === 'procgen-route-complete' && note.actor === event.lemmingId)).to.equal(true);
            expect(accepted.slice(1).every((note, index) => note.note > accepted[index].note)).to.equal(true);
            expect(calls.filter(call => call.type === 'noteOn')).to.have.length(4); expect(calls.filter(call => call.type === 'noteOff')).to.have.length(4);
            router.scheduler.allNotesOff(); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
            expect(router.scheduler._activeNotes.size).to.equal(0); expect(value.stats.failures).to.equal(0);
          }
        });
        expect(receipt.event.admittedCrew).to.equal(8);
      } finally { router.dispose(); }
    });
  });

});
