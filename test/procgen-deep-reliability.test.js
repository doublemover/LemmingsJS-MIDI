import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const advance = (world, horizon) => {
  let maxWork = 0;
  while (world.tickIndex < horizon) {
    if (world.tickIndex > 0 && world.tickIndex % 6 === 0 && world.spawnedTotal < 16) world._spawn(0, false);
    world.step(); maxWork = Math.max(maxWork, world.hazardPlanner.admission.lanes[0].probes);
  }
  return maxWork;
};

describe('deeper source crew reliability', function() {
  this.timeout(15000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [ground, seed] of [[1, 42], [0, 7]]) it(`retains the original sixteen ordinary actors in source ${ground}, seed ${seed}`, async () => {
    const terrain = await loadProcgenTerrain('lemmings', ground), world = new ProcgenLaneWorld({ terrain, masks, seed, populationPolicy: { scoutsEvery: 0 } });
    try {
      expect(advance(world, 3000)).to.be.at.most(1024);
      expect(world.spawnedTotal).to.equal(16); expect(world.activeCount).to.equal(16); expect(world.stats.failures).to.equal(0);
      expect(world.hazards.stats.contacts).to.equal(0);
      expect(world.actors.every(actor => !actor.scout && !actor.canClimb && !actor.hasParachute && !actor.failureReason && !actor.terminalReason)).to.equal(true);
      if (ground === 1) {
        expect(world.basinRoutes.snapshot()).to.include({ completed: 1, failed: 0, active: 0, sections: 2 });
        expect(world.actors.filter(actor => actor.furthestX > 1251)).to.have.length(16);
      } else {
        expect(terrain.describe(world.laneSeeds[0], 11)).to.include({ gapFloor: 80, gapWidth: 7 });
        expect(world.stats.builds).to.be.greaterThan(0);
      }
    } finally { world.dispose(); }
  });
  it('authorizes only rehearsed recovery cells and still rejects an unrelated edit by the same guard', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1), world = new ProcgenLaneWorld({ terrain, masks, seed: 42, populationPolicy: { scoutsEvery: 0 } });
    try {
      let scene, guard;
      while (world.tickIndex < 2500 && !guard) {
        advance(world, world.tickIndex + 1); scene = world.basinRoutes.scenes[0];
        if (scene?.phase === 'connected') guard = world.actors.find(actor => scene.recoveries?.has(actor.id) && actor.action === world.actions[State.BASHING]);
      }
      expect(guard).to.exist;
      expect(scene.phase).to.equal('connected'); expect(scene.recoveries.has(guard.id)).to.equal(true);
      expect(guard.action).to.equal(world.actions[State.BASHING]);
      expect(world.hasGroundAt(scene.startX, scene.startY)).to.equal(true);
      world._processingActorId = guard.id; world.clearGroundAt(scene.startX, scene.startY);
      expect(scene.failure).to.equal('foreign-route-edit');
    } finally { world.dispose(); }
  });
  it('keeps intermediate recovery and deep return-wall collision, raster and query order identical', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0), world = new ProcgenLaneWorld({ terrain, masks, seed: 7, assists: false });
    try {
      const seed = world.laneSeeds[0], before = new Map([11, 17, 25].map(chunk => [chunk, terrain.getChunk(seed, chunk, true)]));
      terrain.reset();
      for (const chunk of [25, 17, 11]) {
        const descriptor = terrain.describe(seed, chunk), raster = terrain.getChunk(seed, chunk, true);
        expect(raster.solid).to.deep.equal(before.get(chunk).solid); expect(raster.pixels).to.deep.equal(before.get(chunk).pixels);
        for (let x = 24; x < 128; x++) for (let y = 30; y < 96; y++) {
          const at = y * 128 + x, solid = !!(raster.solid[at >>> 5] & (1 << (at & 31)));
          expect(terrain.solidSample(seed, chunk, x, y, descriptor)).to.equal(solid);
          expect((terrain.rasterSample(seed, chunk, x, y, descriptor) >>> 24) > 0).to.equal(solid);
        }
      }
    } finally { world.dispose(); }
  });
});
