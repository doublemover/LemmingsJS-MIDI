import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const bridgeTerrain = () => {
  const collision = new Map(); let firstSeed;
  return { chunkWidth: 128, collision, surface: () => 72, configure() {}, registerLanes(seeds) { firstSeed = seeds[0]; }, reset() { collision.clear(); },
    getChunk(seed, chunkIndex) {
      const key = `${seed}:${chunkIndex}`;
      if (!collision.has(key)) {
        const solid = new Uint32Array(384), steel = new Uint32Array(384);
        for (let y = 56; y < 96; y++) for (let x = 0; x < 128; x++) {
          const wx = chunkIndex * 128 + x;
          if (seed === firstSeed && wx >= 80 && wx < 86) continue;
          if (y >= 72 || wx === 24) { const bit = y * 128 + x; solid[bit >>> 5] |= 1 << (bit & 31); }
        }
        collision.set(key, { solid, steel, topProfile: new Uint8Array(128), gapWidth: 0, barrierWidth: 0 });
      }
      return collision.get(key);
    }
  };
};
const crewFixture = (masks, workerLimits = {}) => {
  const world = new ProcgenLaneWorld({ masks, terrain: bridgeTerrain(), laneCount: 2, cohorts: true, maxActors: 8,
    stallPolicy: { releaseIntervalTicks: 100000 }, workerLimits: { builders: 1, diggers: 0, ...workerLimits } });
  const actors = Array.from({ length: 8 }, (_, index) => {
    const x = index ? index === 1 ? 40 : 32 : 64;
    const actor = world._spawn(0); Object.assign(actor, { x, y: 72, furthestX: x, scout: false });
    actor.setAction(world.actions[State.WALKING]); return actor;
  });
  world.assignWorker(actors[0], 'builders', 88); return { world, actors, task: world.accessTasks[0][0] };
};
const stepUntil = (world, condition, limit = 450) => {
  while (!condition() && world.tickIndex < limit) world.step();
  expect(condition()).to.equal(true);
};

describe('ordinary crew construction containment and route recovery', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('contains followers with real contacts then recovers the blocker through empty shared bash masks after the bridge connects', () => {
    const before = crewFixture(masks);
    before.world._assistConstructionCrew = () => false;
    for (let tick = 0; tick < 180; tick++) before.world.step();
    expect(before.actors.filter(actor => actor.failureReason === 'unsafe-fall')).to.have.length(7);
    before.world.dispose();

    const { world, actors, task } = crewFixture(masks), events = [];
    world.soundEvents.onEvent.on(event => events.push(event));
    let blocker = null, connectionTick = null, releaseTick = null, sawContact = false, removedAtRelease = null;
    for (let tick = 0; tick < 450; tick++) {
      world.step(); blocker ||= task.blocker;
      if (blocker && connectionTick == null && world._constructionPassage(task) === true) connectionTick = world.tickIndex;
      if (blocker?.action === world.actions[State.BASHING] && releaseTick == null) {
        releaseTick = world.tickIndex; removedAtRelease = world.stats.removedPixels;
        expect(connectionTick).to.be.a('number'); expect(world.triggerManager.byOwner.has(blocker)).to.equal(false);
      }
      sawContact ||= events.some(event => event.type === 'blocker-turn' && event.blockerId === blocker?.id);
    }
    expect(blocker).not.to.equal(null); expect(sawContact).to.equal(true);
    expect(releaseTick).to.be.at.least(connectionTick); expect(world.stats.removedPixels).to.equal(removedAtRelease);
    expect(blocker.assistConstructionTask).to.equal(null); expect(task.blocker).to.equal(null);
    expect(blocker.action).to.equal(world.actions[State.WALKING]); expect(blocker.x).to.be.greaterThan(96);
    expect(actors.every(actor => actor.x > 96 && actor.action === world.actions[State.WALKING] && !actor.failureReason)).to.equal(true);
    expect(world.stats.failures).to.equal(0); expect(actors.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
    expect(world.generation).to.equal(1); world.dispose();
  });
  it('honors disabled bashers and delays real blocker recovery while the existing shared worker cap is zero', () => {
    const disabled = crewFixture(masks, { bashers: 0 });
    for (let tick = 0; tick < 180; tick++) disabled.world.step();
    expect(disabled.task.blocker).to.equal(undefined); expect(disabled.world.stats.blockers).to.equal(0);
    expect(disabled.actors.filter(actor => actor.failureReason === 'unsafe-fall')).to.have.length(7); disabled.world.dispose();

    const { world, task } = crewFixture(masks);
    stepUntil(world, () => !!task.blocker); const blocker = task.blocker;
    world.setWorkerLimits({ bashers: 0 }); stepUntil(world, () => world._constructionPassage(task) === true);
    for (let tick = 0; tick < 8; tick++) world.step();
    expect(blocker.action).to.equal(world.actions[State.BLOCKING]); expect(world.triggerManager.byOwner.has(blocker)).to.equal(true);
    expect(world.stats.bashes).to.equal(0); world.setWorkerLimits({ bashers: 1 }); world.step();
    expect(blocker.action).to.equal(world.actions[State.BASHING]); expect(world.stats.bashes).to.equal(1);
    expect(world.triggerManager.byOwner.has(blocker)).to.equal(false); world.dispose();
  });
  it('requires every shared clearing mask to be empty and can recover into an actual safe wall turn', () => {
    const { world, task } = crewFixture(masks); stepUntil(world, () => !!task.blocker); const blocker = task.blocker;
    const mask = world.actions[State.BASHING].masks.get('right').GetMask(3);
    let obstruction;
    for (let dy = 0; dy < mask.height && !obstruction; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) {
      obstruction = { x: blocker.x + mask.offsetX + dx, y: blocker.y + mask.offsetY + dy }; break;
    }
    world.setGroundAt(obstruction.x, obstruction.y); stepUntil(world, () => world._constructionPassage(task) === true);
    world.step(); expect(blocker.action).to.equal(world.actions[State.BLOCKING]); expect(world.stats.removedPixels).to.equal(0);
    world.clearGroundAt(obstruction.x, obstruction.y); world.step(); expect(blocker.action).to.equal(world.actions[State.BASHING]); world.dispose();

    const stopped = crewFixture(masks); stepUntil(stopped.world, () => !!stopped.task.blocker); const waiting = stopped.task.blocker;
    for (let y = 56; y <= 72; y++) stopped.world.setGroundAt(68, y);
    expect(stopped.world._constructionPassage(stopped.task)).to.equal(null); stopped.world.step();
    expect(waiting.action).to.equal(stopped.world.actions[State.BASHING]);
    for (let tick = 0; tick < 40; tick++) stopped.world.step();
    expect(waiting.failureReason).to.equal(null); expect(waiting.x).to.be.lessThan(68); stopped.world.dispose();
  });
  it('cleans actual blocker contacts and task ownership on natural fall, lane transfer, reset and disposal', () => {
    const falling = crewFixture(masks); stepUntil(falling.world, () => !!falling.task.blocker); const dropped = falling.task.blocker;
    falling.world.clearGroundAt(dropped.x, dropped.y + 1); falling.world.step();
    expect(dropped.action).to.equal(falling.world.actions[State.FALLING]); expect(dropped.assistConstructionTask).to.equal(null);
    expect(falling.task.blocker).to.equal(null); expect(falling.world.triggerManager.byOwner.has(dropped)).to.equal(false); falling.world.dispose();

    const moved = crewFixture(masks); stepUntil(moved.world, () => !!moved.task.blocker); const transferred = moved.task.blocker;
    transferred.y += 96; moved.world._synchronizeLane(transferred);
    expect(transferred.laneIndex).to.equal(1); expect(transferred.action).to.equal(moved.world.actions[State.BLOCKING]);
    expect(transferred.assistConstructionTask).to.equal(null); expect(moved.task.blocker).to.equal(null);
    expect(moved.world.triggerManager.byLane[0]).to.have.length(0); expect(moved.world.triggerManager.byLane[1]).to.have.length(2);
    expect(moved.world.stall.lanes[0].transferredOut).to.equal(1); expect(moved.world.stall.lanes[1].transferredIn).to.equal(1);
    moved.world.dispose(); expect(moved.world.triggerManager.byOwner.size).to.equal(0);

    const reset = crewFixture(masks); stepUntil(reset.world, () => !!reset.task.blocker); const old = reset.task.blocker;
    reset.world._restart([]); expect(old.assistConstructionTask).to.equal(null); expect(reset.task.blocker).to.equal(null);
    expect(reset.world.triggerManager.byOwner.size).to.equal(0); expect(reset.world.accessTasks.every(tasks => tasks == null)).to.equal(true); reset.world.dispose();

    const disposed = crewFixture(masks); stepUntil(disposed.world, () => !!disposed.task.blocker); const retained = disposed.task.blocker;
    disposed.world.dispose(); expect(retained.assistConstructionTask).to.equal(null); expect(disposed.task.blocker).to.equal(null);
  });
});
