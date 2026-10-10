import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSolverAdapter } from '../../js/solver/ProcgenSolverAdapter.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';

const blockerFactoryFor = (masks, options = {}) => () => {
  const height = options.height || 96, floor = height - 24, collision = new Map();
  return new ProcgenSolverAdapter({ id: 'independent-stationary-blocker-bypass',
    bounds: { x: 8, y: 0, width: 104, height }, goal: { x: options.reverse ? 16 : 58, y: floor - 4, width: 46, height: 8 },
    skills: { builder: 1 }, environmentalBlockers: options.environmentalBlockers ?? [0],
    createWorld() {
      const terrain = { chunkWidth: 128, configure() {}, reset() { collision.clear(); }, describe: () => ({ objects: [] }),
        getChunk(seed, chunk) {
          const key = seed + ':' + chunk; if (collision.has(key)) return collision.get(key);
          const solid = new Uint32Array(128 * height / 32), steel = new Uint32Array(solid.length);
          for (let y = 0; y < height; y++) for (let x = 0; x < 128; x++) {
            const wx = options.reverse ? 120 - (chunk * 128 + x) : chunk * 128 + x, at = y * 128 + x;
            const protectedBrick = options.steel && wx === 20 && y === floor - 1;
            if (options.blockedRoof && wx >= 14 && wx <= 103 && y < floor - 8 || options.steelWall && wx === 40 && y < floor || y >= floor && !(options.gap && wx >= 58 && wx < 90) || options.rear !== false && wx === 12 && y >= floor - 16 || wx === 104 && y >= floor - 16 || protectedBrick || options.ceiling && wx >= 24 && wx <= 54 && y === floor - 11) solid[at >>> 5] |= 1 << (at & 31);
            if (options.steelWall && wx === 40 && y < floor || wx === 104 && y >= floor - 16 || protectedBrick) steel[at >>> 5] |= 1 << (at & 31);
          }
          const result = { solid, steel, topProfile: new Uint8Array(128), gapWidth: 0, barrierWidth: 0 }; collision.set(key, result); return result;
        }
      };
      const world = new ProcgenLaneWorld({ masks, terrain, laneHeight: height, cohorts: true, maxActors: (options.crewCount || 8) + 1, assists: false,
        populationPolicy: { scoutsEvery: 0 }, workerLimits: { builders: 1, bashers: 0, diggers: 0 } });
      world.generatedThrough.fill(256);
      const blocker = world._spawn(0, false); Object.assign(blocker, { x: options.blockerX || (options.reverse ? 70 : 50), y: floor, scout: false, lookRight: !options.reverse }); blocker.setAction(world.actions[State.BLOCKING]);
      for (let index = 0; index < (options.crewCount || 8); index++) {
        const actor = world._spawn(0, false); Object.assign(actor, { x: options.reverse ? 100 : 20, y: floor, scout: false, lookRight: !options.reverse }); actor.setAction(world.actions[State.WALKING]);
      }
      options.initialize?.(world, blocker);
      if (options.onTick) world.timer.onGameTick.on(tick => options.onTick(world, blocker, tick));
      return world;
    }
  });
};
export { blockerFactoryFor };
