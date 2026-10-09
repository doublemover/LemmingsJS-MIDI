import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const make = async masks => {
  const terrain = await loadProcgenTerrain('lemmings', 4);
  const world = new ProcgenLaneWorld({ terrain, masks, seed: 1322764708, laneHeight: 144, assists: false, populationPolicy: { scoutsEvery: 0 } });
  expect(world.laneSeeds[0]).to.equal(8);
  world.terrainGrowth.ensureLocal(0, 1380, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
  world.terrainGrowth.ensureLocal(0, 1470, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
  // Controlled previously excavated approach; every source assembly pixel
  // from x1421 onward remains intact. This is not an unaided arrival receipt.
  for (let x = 1384; x <= 1420; x++) for (let y = 85; y < 109; y++) world.clearGroundAt(x, y);
  const actor = world.actors[0]; Object.assign(actor, { x: 1398, y: 109 }); actor.setAction(world.actions[State.WALKING]);
  return { world, actor };
};
const proof = (world, actor, maxWork = 1024, hazards = []) => {
  const planner = world.hazardPlanner; planner.probes = 0; planner.exhausted = false; planner.unrevealed = false;
  return planner.building.prove(actor, (x, y) => planner._ground(x, y), hazards, maxWork);
};
const pixels = world => {
  const result = [];
  for (let x = 1397; x <= 1438; x++) for (let y = 85; y <= 121; y++) result.push(world.groundPixelAt(x, y));
  return result;
};

describe('actual sourced builder lifecycle qualification', function() {
  this.timeout(10000); let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('rejects the Crystal shoulder whose instantaneous column continuation falsely predicts a useful stair', async () => {
    const { world, actor } = await make(masks);
    try {
      const assembly = world.terrain.describe(8, 11).assemblies[0];
      expect(assembly.id).to.equal('lemmings/4/2a9029a0955fcf7f'); expect(assembly.bounds).to.include({ x1: 1421, x2: 1501 });
      const planner = world.hazardPlanner; planner.probes = 0; planner.observations.length = 0;
      expect(planner._continuation(1422, 97)).to.include({ y: 71 });
      const events = []; world.soundEvents.onEvent.on(event => events.push(event));
      const before = { pixels: pixels(world), actor: [actor.x, actor.y, actor.state, actor.action], revision: world.terrainRevision, stats: { ...world.stats }, triggers: world.triggerManager.byOwner.size };
      const result = proof(world, actor); expect(result).to.include({ safe: false, failure: 'turn', built: 72 });
      expect(result.actionSteps).to.equal(203); expect(result.probes + result.actionSteps).to.be.at.most(1024);
      expect(events).to.have.length(0); expect(pixels(world)).to.deep.equal(before.pixels); expect([actor.x, actor.y, actor.state, actor.action]).to.deep.equal(before.actor);
      expect(world.terrainRevision).to.equal(before.revision); expect(world.stats.removedPixels).to.equal(before.stats.removedPixels); expect(world.triggerManager.byOwner.size).to.equal(before.triggers);
      planner.probes = 0; expect(planner._builder(actor)).to.equal(null);
      expect(world.assignWorker(actor, 'builders', 1422)).to.equal(true);
      while (actor.lookRight && world.tickIndex < 220) world.step();
      expect(world.tickIndex).to.equal(203); expect(actor).to.include({ x: 1424, y: 89, lookRight: false }); expect(world.stats.builds).to.equal(1); expect(world.stats.removedPixels).to.equal(before.stats.removedPixels);
    } finally { world.dispose(); }
  });
  it('rejects hidden geometry, protected stamps, contact envelopes, shared budget exhaustion and a construction owner beyond the brick endpoint', async () => {
    for (const mode of ['hidden', 'steel', 'arrow', 'hazard', 'budget', 'construction', 'changed']) {
      const { world, actor } = await make(masks);
      try {
        const removed = world.stats.removedPixels;
        if (mode === 'hidden') world.generatedThrough[0] = 1400;
        if (mode === 'steel') { world.setGroundAt(1398, 108); world.hasSteelAt = (x, y) => x === 1398 && y === 108; }
        if (mode === 'arrow') world.isArrowAt = (x, y) => x === 1398 && y === 108;
        if (mode === 'construction') {
          const owner = world._spawn(0, false); owner.setAction(world.actions[State.BUILDING]);
          world.accessTasks[0] = [{ owner, action: owner.action, footprint: { x1: 1430, x2: 1435, y1: 85, y2: 110 } }];
        }
        if (mode === 'changed') { const ground = world.hasGroundAt.bind(world); world.hasGroundAt = (x, y) => { world.terrainRevision++; return ground(x, y); }; }
        const result = proof(world, actor, mode === 'budget' ? 1 : 1024, mode === 'hazard' ? [{ x1: 1398, x2: 1400, y1: 106, y2: 108 }] : []);
        expect(result.safe, mode).to.equal(false); expect(result.failure, mode).to.equal({ hidden: 'unrevealed', steel: 'protected', arrow: 'protected', hazard: 'launch', budget: 'budget', construction: 'construction', changed: 'turn' }[mode]);
        expect(world.stats.builds).to.equal(0); expect(world.stats.removedPixels).to.equal(removed);
      } finally { world.dispose(); }
    }
  });
});



