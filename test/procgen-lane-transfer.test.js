import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenTerrainGrowth } from '../js/app/procgen/ProcgenTerrainGrowth.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

// Controlled geometry uses the ordinary shared actions; no actor teleports
// are needed for the fall/climb crossings under test.
describe('procgen physical lane transfers', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const fixture = lane => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, cohorts: true, assists: false });
    world._spawnCohort = () => {};
    return { world, actor: world._spawn(lane, false) };
  };
  it('continues a safe fall into the adjacent lane with current music and summary ownership', () => {
    const { world, actor } = fixture(0), events = [], transfers = [];
    actor.y = 94; world.hasGroundAt = (_x, y) => y >= 110 && y <= 120;
    world.soundEvents.onEvent.on(event => events.push(event));
    world.onLaneTransfer = (...args) => transfers.push(args);
    const id = actor.id, birth = actor.spawnLaneIndex;
    for (let tick = 0; tick < 8; tick++) world.step();
    expect(actor.failureReason).to.equal(null); expect(actor.laneIndex).to.equal(1);
    expect(actor.spawnLaneIndex).to.equal(birth); expect(actor.id).to.equal(id);
    expect(actor.action).to.equal(world.actions[State.WALKING]); expect(world.spawnedTotal).to.equal(1);
    expect(world.getLaneMusicSignals(0).alive).to.equal(0); expect(world.getLaneMusicSignals(1).alive).to.equal(1);
    expect(world.getLaneMusicSignals(0).admitted).to.equal(0); expect(world.getLaneMusicSignals(1).admitted).to.equal(1);
    expect(world.getLaneMusicActorPosition(id, 0)).to.equal(null);
    expect(world.getLaneMusicActorPosition(id, 1)).to.include({ x: actor.x, y: actor.y, tick: world.tickIndex });
    expect(transfers).to.deep.equal([[id, 0, 1, 2]]);
    expect(events.find(event => event.type === 'lemming-land').laneIndex).to.equal(1);
    expect(events.some(event => event.type === 'lemming-fell-off')).to.equal(false); world.dispose();
  });
  it('continues an ordinary climb upward across the stripe boundary', () => {
    const { world, actor } = fixture(1);
    actor.y = 96; actor.frameIndex = 3; actor.canClimb = true; actor.setAction(world.actions[State.CLIMBING]); actor.frameIndex = 3;
    world.hasGroundAt = (x, y) => x === actor.x && y >= 60 && y <= 100;
    world.step();
    expect(actor.y).to.equal(95); expect(actor.laneIndex).to.equal(0);
    expect(actor.action).to.equal(world.actions[State.CLIMBING]); expect(actor.canClimb).to.equal(true);
    expect(actor.failureReason).to.equal(null); world.dispose();
  });
  it('migrates a working claim without cancelling its shared action or bypassing the destination cap', () => {
    const { world, actor } = fixture(0), other = world._spawn(1, false);
    actor.y = 95; actor.setAction(world.actions[State.DIGGING]);
    const task = { owner: actor, action: actor.action, targetX: actor.x, targetY: actor.y };
    world.accessTasks[0] = [task]; other.setAction(world.actions[State.DIGGING]);
    world.accessTasks[1] = [{ owner: other, action: other.action, targetX: other.x, targetY: other.y }]; world.setWorkerLimits({ diggers: 1 });
    actor.y = 96; world._synchronizeLane(actor);
    expect(world.accessTasks[0]).to.have.length(0); expect(world.accessTasks[1]).to.include(task);
    expect(actor.action).to.equal(world.actions[State.DIGGING]);
    expect(world._claimAccess(world._spawn(1, false), world.actions[State.DIGGING], 80)).to.equal(false); world.dispose();
  });
  it('reindexes blocker rectangles and removes their actual bucket after a transfer', () => {
    const { world, actor } = fixture(0);
    actor.y = 94; actor.setAction(world.actions[State.BLOCKING]); world.hasGroundAt = () => true; world.step();
    expect(world.triggerManager.byLane[0]).to.have.length(2);
    actor.y = 97; world._synchronizeLane(actor);
    expect(world.triggerManager.byLane[0]).to.have.length(0); expect(world.triggerManager.byLane[1]).to.have.length(2);
    expect(world.triggerManager.byLane[1][0].y1).to.equal(87);
    actor.setAction(world.actions[State.FALLING]); world.triggerManager.synchronize(actor);
    expect(world.triggerManager.snapshot().owners).to.equal(0); expect(world.triggerManager.byLane[1]).to.have.length(0); world.dispose();
  });
  it('keeps global out-of-world and unsafe fall deaths and permits real digging across stripes', () => {
    const { world, actor } = fixture(0); world._processingLane = 0;
    world.setGroundAt(40, 100); expect(world.hasGroundAt(40, 100)).to.equal(true);
    world.clearGroundAt(40, 100); expect(world.hasGroundAt(40, 100)).to.equal(false);
    expect(world.isOutOfLevel(96)).to.equal(false); expect(world.isOutOfLevel(world.height)).to.equal(true);
    actor.y = world.height + 6; world.step(); expect(actor.failureReason).to.equal('out-of-world'); world.dispose();
    const falling = fixture(0); falling.actor.y = 94; falling.actor.state = 60;
    falling.world.hasGroundAt = (_x, y) => y >= 97; falling.world.step(); falling.world.step();
    expect(falling.actor.failureReason).to.equal('unsafe-fall'); falling.world.dispose();
  });
  it('prepares a bounded arrival footprint far ahead of an adjacent frontier', () => {
    const growth = new ProcgenTerrainGrowth(2, 128), through = new Float64Array(2), frontiers = new Float64Array([36, 36]), prepared = [], revealed = [];
    growth.reset(through, frontiers);
    growth.ensureLocal(1, 4000, { through, frontiers, prepare: (lane, chunk) => prepared.push([lane, chunk]), reveal: (...args) => revealed.push(args) });
    expect(prepared.length).to.be.at.most(2); expect(prepared[0][1]).to.be.greaterThan(30);
    expect(through[1]).to.be.at.least(4064); expect(frontiers[1]).to.equal(4000); expect(revealed).to.have.length(1);
  });
  it('retains edits within a live actor footprint that straddles stripes', () => {
    const { world, actor } = fixture(1); actor.y = 99; actor.x = 200;
    world.setGroundAt(200, 95); world._pruneEdits();
    expect(world.hasGroundAt(200, 95)).to.equal(true); world.dispose();
  });
});
