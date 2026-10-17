import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

describe('ordinary crews crossing actual source fire strips', function() {
  this.timeout(15000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [seed, horizon, exitX] of [[3, 2600, 1092], [42, 2200, 1147]]) {
    it(`keeps every original member alive through the seed ${seed} fire and returning traffic`, async () => {
      const terrain = await loadProcgenTerrain('lemmings', 1), world = new ProcgenLaneWorld({ terrain, masks, seed, populationPolicy: { scoutsEvery: 0 } });
      const arrivals = new Set(), events = []; let work = 0, overlapping = 0;
      world.soundEvents.onEvent.on(event => { if (event.type === 'procgen-route-complete' && event.sceneProduction === 'observed-fire-span') events.push(event); });
      try {
        while (world.tickIndex < horizon) {
          if (world.tickIndex > 0 && world.tickIndex % 6 === 0 && world.spawnedTotal < 16) world._spawn(0, false);
          world.step(); work = Math.max(work, world.hazardPlanner.admission.lanes[0].probes);
          for (const task of world.accessTasks[0] || []) overlapping = Math.max(overlapping, (task.blocker ? 1 : 0) + (task.coincidentBlockers?.size || 0));
          for (const actor of world.actors) if (actor.x >= exitX && actor.action === world.actions[State.WALKING] && world.hasGroundAt(actor.x, actor.y)) arrivals.add(actor.id);
        }
        expect(arrivals.size).to.equal(16); expect(world.spawnedTotal).to.equal(16); expect(world.activeCount).to.equal(16);
        expect(world.stats.failures).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0); expect(work).to.be.at.most(1024);
        expect(world.basinRoutes.snapshot()).to.include({ sections: 2, completed: 1, failed: 0, active: 0 });
        expect(events).to.have.length(1);
        expect(world.actors.every(actor => !actor.failureReason && !actor.terminalReason && !actor.canClimb && !actor.hasParachute && !actor.assistConstructionTask)).to.equal(true);
        if (seed === 42) expect(overlapping).to.be.at.least(2);
      } finally { world.dispose(); }
    });
  }
  it('charges the passive fire screen and builder rehearsal to one bounded budget without changing live terrain or actors', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1), world = new ProcgenLaneWorld({ terrain, masks, seed: 3, assists: false });
    try {
      world.frontiers[0] = 1120; world.terrainGrowth.reset(world.generatedThrough, world.frontiers); world.tickIndex = 1;
      const actor = world.actors[0];
      Object.assign(actor, { x: 1030, y: 62, lookRight: true }); actor.setAction(world.actions[State.WALKING]);
      const hazards = world.hazards.nearby(0, actor.x, { ahead: 64 });
      expect(hazards.some(hazard => hazard.type === TriggerTypes.FRYING)).to.equal(true);
      for (const limit of [0, 17, 1024]) {
        const result = world.basinRoutes.candidate(actor, hazards, limit);
        expect(result.handled).to.equal(true); expect(result.probes).to.be.at.most(limit);
        if (limit < 1024) expect(result.proposal).to.equal(null);
        else expect(result.proposal).to.include({ kind: 'builders', reason: 'staged-observed-fire' });
      }
      expect(actor).to.include({ x: 1030, y: 62, lookRight: true, action: world.actions[State.WALKING] });
      expect(world.editChunks.size).to.equal(0); expect(world.stats.builds).to.equal(0);
      expect(world.basinRoutes.snapshot().active).to.equal(0);
    } finally { world.dispose(); }
  });
  it('renders its real return wall consistently and turns an unassisted returning walker before the unchanged fire', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1), world = new ProcgenLaneWorld({ terrain, masks, seed: 3, assists: false });
    try {
      const descriptor = terrain.describe(world.laneSeeds[0], 8), wall = descriptor.fireReturnWalls[0], actor = world.actors[0];
      const collision = terrain.getChunk(world.laneSeeds[0], 8, true);
      for (let x = wall.x1 - 1; x <= wall.x2 + 1; x++) for (let y = wall.y - 1; y <= wall.y + 10; y++) {
        const bit = y * 128 + x - descriptor.origin, solid = !!(collision.solid[bit >>> 5] & (1 << (bit & 31)));
        expect(terrain.solidSample(world.laneSeeds[0], 8, x - descriptor.origin, y, descriptor)).to.equal(solid);
        expect((terrain.rasterSample(world.laneSeeds[0], 8, x - descriptor.origin, y, descriptor) >>> 24) > 0).to.equal(solid);
      }
      world.terrainGrowth.ensureLocal(0, wall.x1 - 24, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
      const hazards = world.hazards.nearby(0, wall.x1, { ahead: 40, behind: 32 });
      expect(hazards.find(hazard => hazard.type === TriggerTypes.FRYING)).to.include({ x1: 1052, x2: 1076, y1: 53, y2: 61 });
      const x = wall.x2 + 1; let y = wall.y;
      while (!world.hasGroundAt(x, y) && y < world.height) y++;
      Object.assign(actor, { x, y, furthestX: x, lookRight: false, scout: false }); actor.setAction(world.actions[State.WALKING]);
      for (let tick = 0; tick < 24; tick++) world.step();
      expect(actor.lookRight).to.equal(true); expect(actor.x).to.be.greaterThan(x);
      expect(world.hazards.stats.contacts).to.equal(0); expect(world.stats.builds + world.stats.bashes).to.equal(0);
    } finally { world.dispose(); }
  });
});
