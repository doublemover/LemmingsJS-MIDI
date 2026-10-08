import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const wallTerrain = ({ steelWall = false } = {}) => {
  const collision = new Map();
  return { chunkWidth: 128, collision, surface: () => 72, configure() {}, reset() { collision.clear(); },
    getChunk(seed, chunkIndex) {
      const key = seed + ':' + chunkIndex;
      if (collision.has(key)) return collision.get(key);
      const solid = new Uint32Array(384), steel = new Uint32Array(384);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
        const wx = chunkIndex * 128 + x, wall = wx >= 65 && wx < 83 && y >= 50 && y < 72;
        const bit = y * 128 + x;
        if (y >= 72 || wall) solid[bit >>> 5] |= 1 << (bit & 31);
        if (steelWall && wall) steel[bit >>> 5] |= 1 << (bit & 31);
      }
      const chunk = { solid, steel, topProfile: new Uint8Array(128), gapWidth: 0, barrierWidth: 0 };
      collision.set(key, chunk); return chunk;
    }
  };
};
const atWall = (world, actor) => {
  Object.assign(actor, { x: 64, y: 72, furthestX: 64, lookRight: true });
  actor.setAction(world.actions[State.WALKING]);
};
describe('procgen real wall access and ordinary bounce', function() {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('retains a follower wall bounce while one ordinary basher opens an unclassified source shelf', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: wallTerrain(), seed: 42, populationPolicy: { scoutsEvery: 8, scoutDelayTicks: 180 } });
    for (let i = 1; i < 8; i++) world._spawn(0);
    world.actors.forEach(actor => atWall(world, actor));
    world.step();
    const worker = world.actors.find(actor => actor.action === world.actions[State.BASHING]);
    const follower = world.actors.find(actor => actor !== worker && !actor.scout);
    expect(worker).not.to.equal(undefined); expect(world.stats.bashes).to.equal(1);
    expect(follower.x).to.equal(64); expect(follower.lookRight).to.equal(false);
    world.step(); expect(follower.x).to.equal(63); expect(follower.lookRight).to.equal(false);
    expect(world.actors.every(actor => !actor.canClimb)).to.equal(true);
    for (let tick = 0; tick < 600; tick++) world.step();
    expect(world.actors.filter(actor => !actor.scout && actor.x > 90)).to.have.length.at.least(6);
    expect(world.stats.removedPixels).to.be.greaterThan(0); expect(world.stats.bashes).to.equal(1);
    expect(world.generation).to.equal(1); expect(world.stats.failures).to.equal(0);
    expect(worker.action).to.equal(world.actions[State.WALKING]);
    world._accessTask(0); expect(world.accessTasks[0].owner).to.equal(null);
    world._restart([]); expect(world.accessTasks[0]).to.equal(null); world.dispose();
  });
  it('keeps sparse delayed scouts and real steel bounce without granting the ordinary crowd climbing', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: wallTerrain({ steelWall: true }), seed: 42,
      populationPolicy: { scoutsEvery: 4, scoutDelayTicks: 12 } });
    for (let i = 1; i < 8; i++) world._spawn(0);
    world.actors.forEach(actor => atWall(world, actor));
    world.tickIndex = 11; world.step();
    expect(world.actors.filter(actor => actor.canClimb)).to.have.length(2);
    const follower = world.actors.find(actor => !actor.scout);
    expect(follower.lookRight).to.equal(false); expect(follower.x).to.equal(64);
    world.step(); expect(follower.x).to.equal(63); expect(follower.lookRight).to.equal(false);
    expect(world.stats.bashes).to.equal(0); expect(world.actors.filter(actor => !actor.scout).every(actor => !actor.canClimb)).to.equal(true);
    world.dispose();
  });
  it('lets a working basher finish at a gap and does not replace its action with a builder', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: wallTerrain(), seed: 42 });
    const actor = world.actors[0]; Object.assign(actor, { x: 64, y: 72 });
    actor.setAction(world.actions[State.BASHING]);
    world.challengeAt = () => ({ gapX: 67, gapWidth: 8 }); world.hasGroundAt = () => false;
    world._assist(actor); expect(actor.action).to.equal(world.actions[State.BASHING]); expect(world.stats.builds).to.equal(0);
    world.dispose();
  });
  it('releases a removed task owner and bounds retries at the same physical footprint', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: wallTerrain() });
    const owner = world.actors[0], next = world._spawn(0), bash = world.actions[State.BASHING];
    expect(world._claimAccess(owner, bash, 65)).to.equal(true); owner.remove();
    expect(world._claimAccess(next, bash, 65)).to.equal(false);
    world.tickIndex += 90; expect(world._claimAccess(next, bash, 65)).to.equal(true);
    expect(world.accessTasks).to.have.length(1); world.dispose();
  });
});
