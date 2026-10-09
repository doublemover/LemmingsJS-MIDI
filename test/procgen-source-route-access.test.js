import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

describe('bounded actual source ordinary route access', function() {
  this.timeout(30000);
  it('opens the real Brick support wall and naturally returns to walking under its sourced roof for eight ordinary actors', async () => {
    const terrain = await loadProcgenTerrain('lemmings_ohNo', 0), masks = await loadProcgenMasks();
    const world = new ProcgenLaneWorld({ terrain, masks, laneCount: 8, seed: 42,
      populationPolicy: { scoutsEvery: 1000000, scoutDelayTicks: 1000000 } });
    const lane = 5, descriptor = terrain.describe(world.laneSeeds[lane], 2);
    const pillar = descriptor.placements.find(p => p.piece.id === 28), roof = descriptor.placements.find(p => p.piece.id === 27);
    expect(pillar).to.include({ x: 13, y: 56 }); expect(roof).to.include({ x: 29, y: 48 });
    expect(pillar.assembly).to.equal(roof.assembly); expect(pillar.piece.isSteel).to.equal(false);
    const wallX = descriptor.origin + pillar.x, floor = lane * 96 + 72, actor = world.actors[lane];
    Object.assign(actor, { x: wallX - 1, y: floor, lookRight: true }); actor.setAction(world.actions[State.WALKING]);
    world._prepareActorTerrain(actor);
    expect(world.hasGroundAt(descriptor.origin + roof.x + 4, floor - 9)).to.equal(true);
    expect(world.getColumnStepHeight(descriptor.origin + roof.x + 4, floor - 7, 8)).to.equal(1);
    const proposal = world.hazardPlanner.plan(actor);
    expect(proposal).to.include({ kind: 'bashers', reason: 'supported-local-tunnel', continuationY: floor });
    expect(proposal.footprint.x2 - actor.x).to.be.at.most(40);
    const jobs = [], assign = world.assignWorker.bind(world);
    world.assignWorker = (owner, kind, ...args) => { const accepted = assign(owner, kind, ...args); if (accepted && owner.spawnLaneIndex === lane) jobs.push({ id: owner.id, kind, tick: world.tickIndex }); return accepted; };
    expect(world.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true);
    for (let ordinal = 1; ordinal < 8; ordinal++) {
      const follower = world._spawn(lane, false);
      Object.assign(follower, { x: wallX - 35 + ordinal % 4, y: floor, lookRight: true }); follower.setAction(world.actions[State.WALKING]);
    }
    let walkedAt = null, opened = false;
    for (let tick = 0; tick < 600; tick++) {
      world.step();
      if (walkedAt == null && actor.action === world.actions[State.WALKING]) {
        walkedAt = world.tickIndex; opened = !world.hasGroundAt(wallX + 7, floor - 6);
      }
    }
    const crew = world.actors.filter(owner => owner.spawnLaneIndex === lane);
    expect(walkedAt).to.equal(37); expect(opened).to.equal(true);
    expect(jobs[0]).to.deep.equal({ id: actor.id, kind: 'bashers', tick: 0 });
    expect(crew).to.have.length(8); expect(world.spawnedTotal).to.equal(15); expect(world.activeCount).to.equal(15);
    expect(world.stats.failures).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0); expect(world.stats.removedPixels).to.be.greaterThan(0);
    expect(crew.every(owner => owner.furthestX > pillar.assembly.bounds.x2 + 16 && !owner.failureReason && !owner.canClimb && !owner.hasParachute)).to.equal(true);
    world.dispose();
  });
});
