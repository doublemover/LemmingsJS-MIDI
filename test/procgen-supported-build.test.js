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
  it('admits the genuine last supported lattice WALK poses through a full stair, natural fall and supported roof exit without live proof effects', async () => {
    for (const [x, y, exitY, observations] of [[1649, 47, 60, 142], [1650, 46, 60, 141], [1651, 46, 59, 140]]) {
      const terrain = await loadProcgenTerrain('lemmings', 4);
      const world = new ProcgenLaneWorld({ terrain, masks, seed: 1322764708, laneHeight: 144, assists: false, populationPolicy: { scoutsEvery: 0 } });
      try {
        expect(world.laneSeeds[0]).to.equal(8);
        for (const at of [1640, 1680]) world.terrainGrowth.ensureLocal(0, at, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
        const actor = world.actors[0]; Object.assign(actor, { x, y }); actor.setAction(world.actions[State.WALKING]);
        expect(world.hasGroundAt(x, y)).to.equal(true);
        const before = [], events = [], revision = world.terrainRevision;
        for (let px = x - 1; px <= x + 40; px++) for (let py = y - 32; py <= y + 32; py++) before.push(world.groundPixelAt(px, py));
        world.soundEvents.onEvent.on(event => events.push(event));
        const result = proof(world, actor, 512);
        expect(result).to.include({ safe: true, failure: null, built: 72, fell: true, actionSteps: 217, probes: observations, x: x + 32, y: exitY });
        expect(result.probes + result.actionSteps).to.be.at.most(512);
        expect(events).to.have.length(0); expect(world.terrainRevision).to.equal(revision); expect(world.stats.builds + world.stats.removedPixels).to.equal(0);
        expect(actor).to.include({ x, y }); expect(actor.action).to.equal(world.actions[State.WALKING]);
        const after = []; for (let px = x - 1; px <= x + 40; px++) for (let py = y - 32; py <= y + 32; py++) after.push(world.groundPixelAt(px, py));
        expect(after).to.deep.equal(before);
        const planner = world.hazardPlanner; planner.probes = 0;
        const proposal = planner._builder(actor); expect(proposal).to.include({ kind: 'builders', continuationY: exitY, materialCost: 12, estimatedTicks: 217 });
        expect(planner.probes).to.be.at.most(512);
        expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true); world.lanePolicy.begin(actor, proposal); world.assists = true;
        let sawShrug = false, sawFall = false;
        for (let tick = 0; tick < result.actionSteps; tick++) { world.step(); sawShrug ||= actor.action === world.actions[State.SHRUG]; sawFall ||= actor.action === world.actions[State.FALLING]; }
        expect(sawShrug && sawFall).to.equal(true); expect(actor._laneRouteAttempt).to.equal(null); expect(world.lanePolicy.lanes[0]).to.include({ successes: 1, failures: 0 }); expect(actor).to.include({ x: x + 32, y: exitY, lookRight: true, failureReason: null });
        expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor.terminalReason).to.not.exist; expect(actor.canClimb || actor.hasParachute).to.equal(false);
        expect(world.stats).to.include({ builds: 1, bashes: 0, digs: 0, mines: 0, removedPixels: 0, failures: 0 }); expect(world.hazards.stats.contacts).to.equal(0);
      } finally { world.dispose(); }
    }
  });
  it('does not extend the lower-landing opportunity to safe flat walking and rejects a real landing contact envelope', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 4), world = new ProcgenLaneWorld({ terrain, masks, seed: 1322764708, laneHeight: 144, assists: false });
    try {
      const actor = world.actors[0], planner = world.hazardPlanner;
      Object.assign(actor, { x: 60, y: 120 }); actor.setAction(world.actions[State.WALKING]);
      planner.probes = 0; planner.observations.length = 0;
      const flat = planner.building.prove(actor, world.hasGroundAt.bind(world), [], 512, true);
      expect(flat).to.include({ safe: false, failure: 'no-deep-opening', built: 0 });
      for (const x of [1640, 1680]) world.terrainGrowth.ensureLocal(0, x, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
      Object.assign(actor, { x: 1651, y: 46 });
      const result = planner.building.prove(actor, world.hasGroundAt.bind(world), [{ x1: 1678, x2: 1680, y1: 60, y2: 64 }], 512, true);
      expect(result).to.include({ safe: false, failure: 'hazard' }); expect(result.probes + result.actionSteps).to.be.at.most(512);
      expect(world.stats.builds + world.stats.removedPixels + world.hazards.stats.contacts).to.equal(0);
    } finally { world.dispose(); }
  });
});



