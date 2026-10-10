import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

// Actual planner admission on the fixed public source geometry. Actors are
// positioned only for this causal owner/ledger test, not natural arrival.
describe('fatal-climb relief actual lane admission', function() {
  this.timeout(15000); let masks, themes;
  before(async () => {
    masks = await loadProcgenMasks(); themes = [];
    for (const [ground, styleName] of ['dirt', 'fire', 'squasher', 'pillar', 'crystal'].entries()) themes.push({ styleName, terrain: await loadProcgenTerrain('lemmings', ground) });
  });
  const fixture = () => {
    const world = new ProcgenLaneWorld({ terrain: new ProcgenPackTerrain(themes), masks, seed: 4274680063, laneCount: 16, laneHeight: 144,
      cohorts: true, workerLimits: { bashers: 4, builders: 8, diggers: 4 }, populationPolicy: { scoutsEvery: 0 } });
    world.cohorts = false; world.admissionPaused = true; world.tickIndex = 1;
    const actor = world._spawn(9, false); Object.assign(actor, { x: 1612, y: 1380 }); actor.setAction(world.actions[State.WALKING]); world._prepareActorTerrain(actor);
    return { world, actor };
  };
  const admitGuard = (world, actor) => {
    expect(world.hazardPlanner.plan(actor)).to.equal(null);
    expect(world.tunnelRoutes.scenes[9]?.port).to.include({ guardX: 1580, guardY: 1403, exitX: 1652, exitY: 1410 });
    const guard = world._spawn(9, false); Object.assign(guard, { x: 1580, y: 1403 }); guard.setAction(world.actions[State.WALKING]); world._prepareActorTerrain(guard);
    world.tickIndex = 3; expect(world.tunnelRoutes.assist(guard)).to.equal(true); guard.process(world);
    world.tickIndex = 5; return guard;
  };
  it('requests only a measured recovery-qualified port, then proposes the real guarded short cut before broad alternatives', () => {
    const { world, actor } = fixture();
    try {
      const guard = admitGuard(world, actor), before = world.stats.removedPixels;
      const proposal = world.hazardPlanner.plan(actor);
      expect(proposal).to.include({ kind: 'bashers', reason: 'observed-guarded-relief', startX: 1612, continuationY: 1410 });
      expect(proposal.routeEvidence).to.include({ rearBlockerId: guard.id, exitX: 1652, naturalWalkingTick: 14, removedPixels: 35 });
      const ledger = world.hazardPlanner.admission.lanes[9]; expect(ledger.probes).to.be.at.most(1024); expect(ledger.consumed).to.equal(true);
      expect(world.stats.removedPixels).to.equal(before); expect(world.stats.bashes).to.equal(0);
      expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true); world.lanePolicy.begin(actor, proposal);
      const scene = world.tunnelRoutes.scenes[9]; expect(scene.phase).to.equal('working'); expect(scene.worker).to.equal(actor);
      const project = world.lanePolicy.projects.lanes[9].projects.find(entry => entry.id === scene.task.crewProjectId);
      expect(project.exitX).to.equal(1644); expect(scene.exitX).to.equal(1652);
    } finally { world.dispose(); }
  });
  it('defers a real guarded reproof when the existing shared lane ledger has insufficient work and does not start fallback excavation', () => {
    const { world, actor } = fixture();
    try {
      admitGuard(world, actor); const ledger = world.hazardPlanner.admission.begin(9); ledger.probes = 200;
      expect(world.hazardPlanner.plan(actor)).to.equal(null);
      expect(ledger.probes).to.be.at.most(1024); expect(world.stats.bashes + world.stats.mines + world.stats.digs + world.stats.builds).to.equal(0);
      expect(world.tunnelRoutes.scenes[9].phase).to.equal('guarded'); expect(actor.action).to.equal(world.actions[State.WALKING]);
    } finally { world.dispose(); }
  });
  it('retains the actual managed BASH to FALL to WALK lifecycle until its declared exit rather than failing or replacing its natural continuation', () => {
    const { world, actor } = fixture();
    try {
      admitGuard(world, actor); const proposal = world.hazardPlanner.plan(actor);
      expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true); world.lanePolicy.begin(actor, proposal);
      const scene = world.tunnelRoutes.scenes[9], project = world.lanePolicy.projects.lanes[9].projects.find(entry => entry.id === scene.task.crewProjectId);
      let sawFall = false, sawWalkingBeforeExit = false;
      for (let tick = 0; tick < 100 && scene.phase === 'working'; tick++) {
        world.step();
        if (actor.action === world.actions[State.FALLING]) { sawFall = true; expect(project.phase).to.equal('working'); expect(actor._laneRouteAttempt).to.exist; }
        if (actor.action === world.actions[State.WALKING] && actor.x < scene.exitX) sawWalkingBeforeExit = true;
        expect(world.stats.builds + world.stats.mines + world.stats.digs).to.equal(0);
      }
      expect(sawFall && sawWalkingBeforeExit).to.equal(true); expect(scene.phase).to.equal('connected'); expect(project.phase).to.equal('connected');
      expect(project.goalX).to.equal(1652); expect(actor).to.include({ x: 1652, y: 1410, lookRight: true, failureReason: null });
      expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor._laneRouteAttempt).to.equal(null);
      expect(world.lanePolicy.lanes[9]).to.include({ failures: 0, successes: 1 }); expect(world.stats).to.include({ bashes: 1, removedPixels: 35, failures: 0 });
      expect(world.hazards.stats.contacts).to.equal(0);
    } finally { world.dispose(); }
  });
});