import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSolverAdapter } from '../../js/solver/ProcgenSolverAdapter.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';

const challengeTerrain = (ground, protectedAt = () => false) => {
  const cache = new Map();
  return { chunkWidth: 128, surface: () => 72, configure() {}, reset() { cache.clear(); },
    getChunk(seed, chunk) {
      if (!cache.has(chunk)) {
        const solid = new Uint32Array(384), steel = new Uint32Array(384), topProfile = new Int16Array(128); topProfile.fill(-1);
        for (let x = 0; x < 128; x++) for (let y = 0; y < 96; y++) {
          const at = y * 128 + x, px = chunk * 128 + x;
          if (ground(px, y)) { solid[at >>> 5] |= 1 << (at & 31); if (topProfile[x] < 0) topProfile[x] = y; }
          if (protectedAt(px, y)) steel[at >>> 5] |= 1 << (at & 31);
        }
        cache.set(chunk, { solid, steel, topProfile, gapWidth: 0, barrierWidth: 0 });
      }
      return cache.get(chunk);
    } };
};
const challengeWorld = (masks, ground, options = {}) => {
  const world = new ProcgenLaneWorld({ masks, terrain: challengeTerrain(ground, options.steel), assists: false, seed: 42 });
  const actor = world.actors[0]; Object.assign(actor, { x: options.x ?? 64, y: 72, lookRight: true, canClimb: false, hasParachute: false, scout: false });
  actor.setAction(world.actions[State.WALKING]); return world;
};
const challengeAdapter = (masks, ground, { skills = { builder: 1 }, x = 64 } = {}) => () => new ProcgenSolverAdapter({
  createWorld: () => challengeWorld(masks, ground, { x }), skills, goal: { x: 110, y: 60, width: 16, height: 24 }, bounds: { x: 16, y: 0, width: 128, height: 96 } });
export { challengeTerrain, challengeWorld, challengeAdapter };
