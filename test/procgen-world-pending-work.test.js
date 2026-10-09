import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const make = masks => {
  const world = new ProcgenLaneWorld({ masks, cohorts: true, assists: false, maxActors: 1, spawnSpreadTicks: 0,
    stallPolicy: { baseSpawnAllowance: 1, secondsWithoutProgress: 1, ticksPerSecond: 10, pendingWorkGraceSeconds: 2 } });
  world.baseGroundAt = (_x, y) => y >= 72 ? 1 : 0;
  const actor = world._spawn(0, false); Object.assign(actor, { x: 36, y: 72 }); actor.setAction(world.actions[State.BLOCKING]);
  world.tickIndex = 1000; return { world, actor };
};
describe('actual World late pending-work transition ownership', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('protects newly queued work from its late actual start, without renewing grace on count changes', () => {
    const { world, actor } = make(masks), lane = world.stall.lanes[0];
    world.setPendingTerrainWork(0, 1); world.step();
    expect(lane).to.include({ pendingTerrainWork: 1, pendingWorkStartedTick: 1001, activeWork: true });
    expect(world.stall.phase).to.equal('running'); expect(actor.action).to.equal(world.actions[State.BLOCKING]);
    world.tickIndex = 1010; world.setPendingTerrainWork(0, 7); world.step();
    expect(lane).to.include({ pendingTerrainWork: 7, pendingWorkStartedTick: 1001, activeWork: true });
    world.tickIndex = 1020; world.step(); expect(lane.activeWork).to.equal(true); expect(world.stall.phase).to.equal('running');
    world.step(); expect(lane.activeWork).to.equal(false); expect(world.stall.phase).to.equal('cascade');
    expect(actor.action).to.equal(world.actions[State.OHNO]); world.dispose();
  });
  it('observes completed queue release and a later fresh queue, and clears both owners on generation reset', () => {
    const { world } = make(masks), lane = world.stall.lanes[0]; world.stall.settings.secondsWithoutProgress = 1000;
    world.terrainGrowth = { pending: Uint32Array.of(2), update() {}, ensureLocal() {}, observe() {}, dispose() {} };
    world.step(); expect(lane).to.include({ pendingTerrainWork: 2, pendingWorkStartedTick: 1001 });
    world.terrainGrowth.pending[0] = 0; world.step(); expect(lane).to.include({ pendingTerrainWork: 0, pendingWorkStartedTick: null });
    world.tickIndex = 2000; world.setPendingTerrainWork(0, 3); world.terrainGrowth.pending[0] = 4; world.step();
    expect(lane).to.include({ pendingTerrainWork: 7, pendingWorkStartedTick: 2001, activeWork: true });
    world.terrainGrowth = null; world._restart([]); expect(world.pendingTerrainWork[0]).to.equal(0);
    expect(world.stall.lanes[0]).to.include({ pendingTerrainWork: 0, pendingWorkStartedTick: null }); world.dispose();
  });
});
