import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSolverAdapter } from '../../js/solver/ProcgenSolverAdapter.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';

const createDescentTerrain = ({ forwardWall = true, steelRoof = false, rearWallX = 12, forwardWallX = 243, wallTop = 48, forwardWallTop = 88 } = {}) => {
  const collision = new Map(), lanes = new Map();
  const isGround = (x, y) => y >= 104 || y >= 72 && y < 80 || x === rearWallX && y >= wallTop ||
    x >= 80 && x < 90 && y >= wallTop && y < 99 || forwardWall && x === forwardWallX && y >= forwardWallTop;
  const isSteel = (x, y) => forwardWall && x === forwardWallX && y >= forwardWallTop || steelRoof && y >= 72 && y < 80;
  const terrain = { recipe: { id: 'finite-two-stripe-descent' }, chunkWidth: 256, collision, lanes,
    configure() {}, reset() { collision.clear(); },
    getChunk(seed, chunk) {
      const lane = lanes.get(seed); if (lane == null) throw new Error('Descent terrain lane is not bound');
      const key = `${lane}:${chunk}`;
      if (!collision.has(key)) {
        const solid = new Uint32Array(768), steel = new Uint32Array(768), topProfile = new Int16Array(256); topProfile.fill(-1);
        for (let x = 0; x < 256; x++) for (let y = 0; y < 96; y++) {
          const globalX = chunk * 256 + x, globalY = lane * 96 + y, bit = y * 256 + x;
          if (isGround(globalX, globalY)) { solid[bit >>> 5] |= 1 << (bit & 31); if (topProfile[x] < 0) topProfile[x] = y; }
          if (isSteel(globalX, globalY)) steel[bit >>> 5] |= 1 << (bit & 31);
        }
        collision.set(key, { solid, steel, topProfile, gapWidth: 0, barrierWidth: 0 });
      }
      return collision.get(key);
    },
    surface(seed, x) { return this.getChunk(seed, Math.floor(x / 256)).topProfile[x % 256]; }
  };
  return terrain;
};
const descentFactoryFor = (masks, { crewCount = 8, skill = 'digger', forwardWall = true, steelRoof = false, maxY = 192, maxX = 256, minX = 8, rearWallX = 12, forwardWallX = 243, wallTop = 48, forwardWallTop = 88, leadX = 63, followerStartX = 47, spacing = 1, goalX = 100 } = {}) => () => new ProcgenSolverAdapter({
  id: 'real-contained-descent', bounds: { x: minX, y: 0, width: maxX - minX, height: maxY }, goal: { x: goalX, y: 100, width: Math.min(32, maxX - goalX), height: 16 }, skills: { [skill]: 1 },
  createWorld() {
    const terrain = createDescentTerrain({ forwardWall, steelRoof, rearWallX, forwardWallX, wallTop, forwardWallTop });
    const world = new ProcgenLaneWorld({ terrain, masks, assists: false, laneCount: 2, seed: 42, cohorts: true, maxActors: crewCount });
    world.laneSeeds.forEach((seed, lane) => terrain.lanes.set(seed, lane));
    for (let index = 0; index < crewCount; index++) {
      const actor = world._spawn(0, false), x = index ? followerStartX - (index - 1) * spacing : leadX;
      Object.assign(actor, { x, y: 72, lookRight: true, furthestX: x, scout: false }); actor.setAction(world.actions[State.WALKING]);
    }
    return world;
  }
});
export { createDescentTerrain, descentFactoryFor };
