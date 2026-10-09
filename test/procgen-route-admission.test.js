import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenRouteAdmission, MAX_ROUTE_CANDIDATES_PER_LANE, ROUTE_CANDIDATE_AGE_ROUNDS } from '../js/app/procgen/ProcgenRouteAdmission.js';
import { MAX_LOCAL_ROUTE_DISTANCE, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const terrainFor = (blocked = false) => {
  const collision = new Map();
  return { chunkWidth: 128, configure() {}, describe: () => ({ objects: [] }), reset() { collision.clear(); },
    getChunk(seed, chunk) {
      const key = seed + ':' + chunk; if (collision.has(key)) return collision.get(key);
      const solid = new Uint32Array(384), steel = new Uint32Array(384), topProfile = new Int16Array(128);
      for (let x = 0; x < 128; x++) {
        const wx = chunk * 128 + x, wall = blocked && wx >= 142 && wx < 200, floor = wall ? 20 : wx === 12 ? 56 : wx >= 80 ? 64 : 72;
        topProfile[x] = floor;
        for (let y = floor; y < 96; y++) { const at = y * 128 + x; solid[at >>> 5] |= 1 << (at & 31); if (wall) steel[at >>> 5] |= 1 << (at & 31); }
      }
      const result = { solid, steel, topProfile, gapWidth: 0, barrierWidth: 0 }; collision.set(key, result); return result;
    }
  };
};
const at = (world, actor, x, y = actor.laneIndex * 96 + 72) => { Object.assign(actor, { x, y, lookRight: true, scout: false }); actor.setAction(world.actions[State.WALKING]); return actor; };
describe('bounded useful procgen workfront admission', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('keeps the harmless older walker moving and admits the later real staircase in the same World tick', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(), assists: true, populationPolicy: { scoutsEvery: 0 } });
    const first = at(world, world.actors[0], 20), later = at(world, world._spawn(0, false), 64);
    world.step(); expect(first.action).to.equal(world.actions[State.WALKING]); expect(first.x).to.equal(21);
    expect(later.action).to.equal(world.actions[State.BUILDING]); expect(world.stats.builds).to.equal(1);
    expect(world.hazardPlanner.stats.plans).to.equal(1); expect(world.hazardPlanner.stats.admission.screened).to.equal(1);
    let highestQueries = world.hazardPlanner.stats.probes;
    for (let tick = 0; tick < 300; tick++) { const before = world.hazardPlanner.stats.probes; world.step(); highestQueries = Math.max(highestQueries, world.hazardPlanner.stats.probes - before); }
    expect(highestQueries).to.be.at.most(MAX_ROUTE_PROBES); expect(later.x).to.be.greaterThan(90);
    expect(first.x).to.be.greaterThan(90); expect(world.stats.failures).to.equal(0); expect(world.stats.builds).to.equal(1);
    expect(world.actors.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true); world.dispose();
  });
  it('rotates an actually rejected farther steel front to a later viable front within bounded service rounds', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(true), assists: false }), first = at(world, world.actors[0], 140, 64), later = at(world, world._spawn(0, false), 64);
    expect(world.hazardPlanner.plan(first)).to.equal(null); expect(world.hazardPlanner.plan(later)).to.equal(null);
    let proposal, rounds = 0;
    while (!proposal && rounds < ROUTE_CANDIDATE_AGE_ROUNDS + 1) {
      world.tickIndex++; const before = world.hazardPlanner.stats.probes; world.hazardPlanner.plan(first); proposal = world.hazardPlanner.plan(later); rounds++;
      expect(world.hazardPlanner.stats.probes - before).to.be.at.most(MAX_ROUTE_PROBES);
    }
    expect(proposal).to.include({ kind: 'builders', reason: 'short-stair-to-ledge' }); expect(rounds).to.be.at.most(ROUTE_CANDIDATE_AGE_ROUNDS);
    expect(world.hazardPlanner.stats.admission.agedSelections).to.be.greaterThan(0); expect(world.stats.removedPixels).to.equal(0); world.dispose();
  });
  it('retains at most four numeric candidates per lane, prioritizes frontier and age deterministically and never ages paused ticks', () => {
    const run = () => {
      const world = { laneCount: 1, tickIndex: 0 }, admission = new ProcgenRouteAdmission(world);
      for (let id = 0; id < 100; id++) admission.observe({ laneIndex: 0, id, x: id, y: 72 });
      expect(admission.lanes[0].records).to.have.length(MAX_ROUTE_CANDIDATES_PER_LANE);
      expect(admission.lanes[0].records.every(record => Object.values(record).every(value => typeof value === 'number'))).to.equal(true);
      const selected = admission.begin(0).selected; expect(selected.x).to.equal(99);
      for (let repeat = 0; repeat < 100; repeat++) expect(admission.begin(0).selected).to.equal(selected);
      expect(admission.lanes[0].round).to.equal(1); admission.served({ laneIndex: 0, id: selected.id, x: selected.x, y: selected.y }, 100);
      const records = admission.lanes[0].records.map(record => ({ ...record })); world.tickIndex++;
      const aged = admission.begin(0).selected; expect(aged.id).not.to.equal(selected.id);
      admission.reset(); expect(admission.stats.candidateCount).to.equal(0); expect(admission.lanes[0].records).to.have.length(0);
      admission.dispose(); expect(admission.world).to.equal(null); return records;
    };
    expect(run()).to.deep.equal(run());
  });
  it('keeps the eight-lane rotation and cumulative1024-probe budget with older flat actors in all64 lanes', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(), laneCount: 64, assists: false });
    for (const actor of [...world.actors]) { at(world, actor, 20); at(world, world._spawn(actor.laneIndex, false), 64); }
    let count = 0; for (const actor of world.actors) if (world.hazardPlanner.plan(actor)) count++;
    expect(count).to.equal(ROUTE_LANES_PER_TICK); expect(world.hazardPlanner.stats.plans).to.equal(ROUTE_LANES_PER_TICK);
    expect(world.hazardPlanner.stats.probes).to.be.at.most(MAX_ROUTE_PROBES * ROUTE_LANES_PER_TICK);
    expect(world.hazardPlanner.stats.admission.candidateCount).to.be.at.most(world.laneCount * MAX_ROUTE_CANDIDATES_PER_LANE);
    const paused = world.hazardPlanner.admission.lanes[0].round;
    for (let repeat = 0; repeat < 100; repeat++) world.hazardPlanner.plan(world.actors[0]);
    expect(world.hazardPlanner.admission.lanes[0].round).to.equal(paused);
    expect(MAX_LOCAL_ROUTE_DISTANCE).to.equal(40); expect(MAX_ROUTE_PROBES).to.equal(1024); expect(ROUTE_LANES_PER_TICK).to.equal(8);
    world.hazardPlanner.reset(); expect(world.hazardPlanner.stats.admission.candidateCount).to.equal(0); world.dispose();
  });
});
