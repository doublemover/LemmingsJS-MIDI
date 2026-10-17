import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';

const chainWorld = (masks, mode = 'repeat', options = {}) => {
  const terrain = { chunkWidth: 256, surface: () => 72, configure() {}, reset() {}, getChunk(seed, index) {
    const solid = new Uint32Array(768), steel = new Uint32Array(768);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 256; x++) {
      const wx = index * 256 + x;
      let on = y >= 72;
      if (mode === 'repeat') on &&= wx < 64 || wx >= 102;
      if (mode === 'bashbuild') on = on && (wx < 80 || wx >= 104) || wx >= 64 && wx < 70 && y >= 48;
      if (mode === 'buildbash') on = on && (wx < 64 || wx >= 84) || wx >= 94 && wx < 101 && y >= 40;
      if (mode === 'triple' || mode === 'quad') on = on && (wx < 64 || wx >= 84 && wx < 102 || wx >= 120) || wx >= 94 && wx < 101 && y >= 40 || mode === 'quad' && wx >= 134 && wx < 141 && y >= 40;
      if (mode === 'quad') on = wx < 64 && y >= 72 || wx >= 84 && wx < 98 && y >= 60 || wx >= 122 && y >= 48 || wx >= 90 && wx < 97 && y >= 40 || wx >= 130 && wx < 137 && y >= 16;
      if (mode === 'minebuild') on = y >= 72 && y <= 73 && wx < 66 || y >= 82 && (wx < 69 || wx >= 90);
      if (options.ceiling && y === 60 && wx >= 64 && wx < 90) on = true;
      if (wx === 12 && y >= 48) on = true;
      const bit = y * 256 + x;
      if (on) solid[bit >>> 5] |= 1 << (bit & 31);
      if (options.steel && wx >= 65 && wx < 70 && y >= 48) steel[bit >>> 5] |= 1 << (bit & 31);
    }
    return { solid, steel, topProfile: new Uint8Array(256), gapWidth: 0, barrierWidth: 0 };
  } };
  const world = new ProcgenLaneWorld({ masks, terrain, assists: false, laneCount: options.laneCount || 1, cohorts: true, workstation: true, maxActors: 3, laneHeight: 96, populationPolicy: { scoutsEvery: 0 } });
  const actor = world._spawn(0, false);
  Object.assign(actor, { x: ['repeat', 'buildbash', 'triple', 'quad'].includes(mode) ? 61 : 63, y: 72, scout: false }); actor.setAction(world.actions[State.WALKING]);
  return { world, actor };
};
export { chainWorld };
