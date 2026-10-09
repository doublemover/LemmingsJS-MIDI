import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

// Controlled source poses and actor-pass ordering from the known Crystal
// failure. This proves claim admission, not unaided public-run arrival.
describe('bounded active crew project claim protection', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const fixture = async () => {
    const world = new ProcgenLaneWorld({ terrain: await loadProcgenTerrain('lemmings', 4), masks, seed: 1322764708, laneHeight: 144,
      assists: false, populationPolicy: { scoutsEvery: 0 } });
    world.admissionPaused = true;
    const worker = world.actors[0], member = world._spawn(0, false), waiting = world._spawn(0, false);
    for (const [actor, x, y] of [[worker, 1813, 90], [member, 1814, 90], [waiting, 1806, 96]]) {
      Object.assign(actor, { x, y, scout: false, canClimb: false, hasParachute: false, lookRight: true }); actor.setAction(world.actions[State.WALKING]);
      world._prepareActorTerrain(actor); world.lanePolicy.projects.observe(actor);
    }
    world._prepareActorTerrain({ x: 1881, y: 87 });
    const footprint = { x1: 1797, x2: 1882, y1: 74, y2: 123 };
    expect(world.assignWorker(worker, 'bashers', 1881, footprint)).to.equal(true);
    const task = world.accessTasks[0].find(t => t.owner === worker);
    const id = world.lanePolicy.projects.begin(worker, 'bashers', task), project = world.lanePolicy.projects.lanes[0].projects.find(p => p.id === id);
    expect(project.members.has(member.id)).to.equal(true); return { world, worker, member, task, project };
  };
  const snapshot = (world, actor) => ({ x: actor.x, y: actor.y, action: actor.action, state: actor.state, frameIndex: actor.frameIndex, assists: actor.assists,
    stats: Object.fromEntries(Object.entries(world.stats).filter(([key]) => key !== 'groundQueries')), revision: world.terrainRevision, tasks: world.accessTasks[0].map(task => ({ owner: task.owner, action: task.action, retryAt: task.retryAt })),
    pixels: Array.from({ length: 12 }, (_, dy) => Array.from({ length: 16 }, (_, dx) => world.basePixelAt(1870 + dx, 72 + dy))) });
  it('refuses a later promised member MINING in the same actor pass after the real worker naturally finishes and its task owner is released', async () => {
    const { world, worker, member, task, project } = await fixture();
    try {
      let steps = 0;
      while (worker.action === world.actions[State.BASHING] && steps++ < 384) {
        const next = worker.process(world); if (next !== State.NO_STATE_TYPE) worker.setAction(world.actions[next]);
      }
      expect(worker.action).to.equal(world.actions[State.WALKING]);
      world.lanePolicy.projects.observe(worker); world.lanePolicy.projects.connect(0, project.id, worker.x, worker.y, []);
      world._accessTaskRecords(0); expect(task.owner).to.equal(null); expect(project.phase).to.equal('connected');
      Object.assign(member, { x: 1876, y: 90 }); world.lanePolicy.projects.observe(member);
      expect(world.hasGroundAt(member.x, member.y)).to.equal(true); expect(world.hasGroundAt(member.x, member.y + 1)).to.equal(true);
      const firstMask = world.actions[State.MINING].masks.get(member.getDirection()).GetMask(0);
      expect(!!firstMask.at(1875 - member.x - firstMask.offsetX, 79 - member.y - firstMask.offsetY)).to.equal(false);
      expect(world.hasGroundAt(1875, 79)).to.equal(true);
      const before = snapshot(world, member), claim = { x1: 1874, x2: 1885, y1: 67, y2: 92 };
      expect(world.assignWorker(member, 'miners', 1883, claim)).to.equal(false);
      expect(snapshot(world, member)).to.deep.equal(before); expect(project.phase).to.equal('connected'); expect(project.members.has(member.id)).to.equal(true);
      expect(world._manualNukeLanes[0]).to.equal(0);
      // The original owner also needs a manager-authorized continuation.
      Object.assign(worker, { x: 1876, y: 90 }); expect(world.assignWorker(worker, 'miners', 1883, claim)).to.equal(false);
    } finally { world.dispose(); }
  });
  it('protects working promises and initial real masks even with no footprint, a misleading footprint, or fabricated continuation', async () => {
    const { world, member, project } = await fixture();
    try {
      Object.assign(member, { x: 1875, y: 79 }); world.lanePolicy.projects.observe(member);
      const before = snapshot(world, member), unrelated = { x1: 1905, x2: 1906, y1: 79, y2: 80 };
      for (const kind of ['miners', 'bashers', 'diggers', 'builders']) {
        expect(world.assignWorker(member, kind)).to.equal(false); expect(world.assignWorker(member, kind, 1905, unrelated)).to.equal(false);
      }
      for (const manager of [world, world.basinRoutes, world.tunnelRoutes, { allowsProjectClaim: () => true }])
        expect(world.assignWorker(member, 'miners', member.x, null, { manager, project, actor: member })).to.equal(false);
      expect(snapshot(world, member)).to.deep.equal(before); expect(project.phase).to.equal('working');
    } finally { world.dispose(); }
  });
  it('clears a failed real basin-section context, rejects its stale reuse, then continues all four original sections and empty blocker recovery', async () => {
    const world = new ProcgenLaneWorld({ terrain: await loadProcgenTerrain('lemmings', 4), masks, seed: 1322764708, laneHeight: 144,
      populationPolicy: { scoutsEvery: 0 } });
    world.admissionPaused = true; world.frontiers.fill(2090); world.terrainGrowth.reset(world.generatedThrough, world.frontiers);
    const owner = world.actors[0], recipient = world._spawn(0, false), events = [];
    for (const [actor, x] of [[owner, 1939], [recipient, 1923]]) {
      Object.assign(actor, { x, y: 124, scout: false, canClimb: false, hasParachute: false }); actor.setAction(world.actions[State.WALKING]); world.lanePolicy.projects.observe(actor);
    }
    world.soundEvents.onEvent.on(event => { if (event.type === 'procgen-route-complete') events.push(event); });
    const originalAssign = world.assignWorker; let captured = null;
    try {
      while (world.tickIndex < 230 && world.basinRoutes.scenes[0]?.phase !== 'waiting') world.step();
      const scene = world.basinRoutes.scenes[0]; expect(scene?.phase).to.equal('waiting'); expect(world.stats.builds).to.equal(1);
      world.assignWorker = function(...args) {
        if (args[4]?.manager === world.basinRoutes) { captured = args; throw new Error('controlled assignment failure'); }
        return originalAssign.apply(this, args);
      };
      expect(() => world.basinRoutes.assist(owner)).to.throw('controlled assignment failure');
      expect(world.basinRoutes._claim).to.equal(null); expect(scene.phase).to.equal('waiting'); expect(owner.action).to.equal(world.actions[State.BLOCKING]);
      expect(originalAssign.apply(world, captured)).to.equal(false); expect(world.stats.builds).to.equal(1);
      world.assignWorker = originalAssign;
      while (world.tickIndex < 1200 && !world.basinRoutes.stats.completed) world.step();
      expect(world.basinRoutes.stats).to.include({ sections: 4, completed: 1, failed: 0 });
      expect(world.stats).to.include({ builds: 4, failures: 0, removedPixels: 0 }); expect(events).to.have.length(1);
      expect(owner.action).to.equal(world.actions[State.WALKING]); expect(recipient.action).to.equal(world.actions[State.WALKING]);
      expect(world.triggerManager.byOwner.size).to.equal(0);
    } finally { world.assignWorker = originalAssign; world.dispose(); }
  });
  it('allows independent jobs and already terminal projects without changing promised membership or hiding real revision failure', async () => {
    for (const phase of ['working', 'failed', 'complete', 'retired']) {
      const { world, member, project } = await fixture();
      try {
        if (phase === 'working') Object.assign(member, { x: 1939, y: 124 });
        else { world.lanePolicy.projects.fail(0, project.id, 'changed-route'); project.phase = phase; Object.assign(member, { x: 1875, y: 79 }); }
        world._prepareActorTerrain(member);
        expect(world.assignWorker(member, 'miners')).to.equal(true);
        expect(project.members.has(member.id)).to.equal(true); expect(project.phase).to.equal(phase);
        if (phase === 'failed') expect(project.failure).to.equal('changed-route');
      } finally { world.dispose(); }
    }
  });
});
