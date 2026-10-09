import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';
import { ProcgenSolverAdapter } from '../../js/solver/ProcgenSolverAdapter.js';

const terrainFor = ({ wall = false, steelWall = false } = {}) => {
  const cache = new Map();
  return { chunkWidth: 256, surface: () => 72, configure() {}, reset() { cache.clear(); },
    getChunk(seed, index) {
      if (!cache.has(index)) {
        const solid = new Uint32Array(768), steel = new Uint32Array(768);
        for (let y = 0; y < 96; y++) for (let x = 0; x < 256; x++) {
          const worldX = index * 256 + x, inWall = wall && worldX >= 64 && worldX < 160 && y >= 48;
          const bit = y * 256 + x;
          if (y >= 72 || inWall || worldX === 12 && y >= 48) solid[bit >>> 5] |= 1 << (bit & 31);
          if (steelWall && inWall) steel[bit >>> 5] |= 1 << (bit & 31);
        }
        cache.set(index, { solid, steel, topProfile: new Uint8Array(256), gapWidth: 0, barrierWidth: 0 });
      }
      return cache.get(index);
    }
  };
};
const factoryFor = (masks, options = {}) => () => new ProcgenSolverAdapter({ id: 'real-wide-wall', goal: { x: 180, y: 64, width: 32, height: 16 }, bounds: { x: 8, y: 0, width: 248, height: 96 },
  skills: options.skills ?? { basher: 1 }, createWorld() {
    const world = new ProcgenLaneWorld({ masks, assists: false, terrain: terrainFor(options), laneCount: 1, cohorts: true, maxActors: 16 });
    for (let index = 0; index < (options.crewCount ?? 8); index++) {
      const actor = world._spawn(0, false), x = index === 0 ? 63 : 40 - index;
      Object.assign(actor, { x, y: 72, lookRight: true, furthestX: x, scout: false }); actor.setAction(world.actions[State.WALKING]);
    }
    return world;
  }
});

export { factoryFor, terrainFor };
