import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { MAX_LOCAL_ROUTE_DISTANCE, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK } from '../js/app/procgen/ProcgenHazardPlanner.js';

// A declared finite physical scene, not a catalogue route hint. Original shared
// actions query these actual bits; spawn positions, directions and ticks are never rewritten.
const terrainFor = ({ ceiling = false } = {}) => {
  const collision = new Map(), height = 144;
  const solidAt = (x, y) => (x === 12 || x === 510) && y >= 80 ||
    (x >= 509 && x <= 514 || x >= 8 && x <= 13) && y >= 75 && y <= 79 ||
    (ceiling ? x >= 270 && x < 280 && y >= 96 || x >= 269 && x <= 280 && y >= 104 && y <= 106 || y >= 120 : y >= (x >= 270 ? 112 : 120));
  return { recipe: { id: 'finite-physical-ahead-scout' }, chunkWidth: 128, objects: [], collision, configure() {}, reset() { collision.clear(); },
    describe: () => ({ objects: [] }), solidSample: (_seed, chunk, x, y) => solidAt(chunk * 128 + x, y),
    getChunk(seed, chunk) {
      const key = `${seed}:${chunk}`;
      if (!collision.has(key)) {
        const solid = new Uint32Array(128 * height / 32), steel = new Uint32Array(solid.length), topProfile = new Int16Array(128); topProfile.fill(-1);
        for (let y = 0; y < height; y++) for (let x = 0; x < 128; x++) if (solidAt(chunk * 128 + x, y)) {
          const at = y * 128 + x; solid[at >>> 5] |= 1 << (at & 31);
          if (chunk * 128 + x === 510) steel[at >>> 5] |= 1 << (at & 31);
          if (topProfile[x] < 0) topProfile[x] = y;
        }
        collision.set(key, { solid, steel, topProfile, objects: [] });
      }
      return collision.get(key);
    }, surface(seed, x) { return this.getChunk(seed, Math.floor(x / 128)).topProfile[x % 128]; }
  };
};
const replay = (masks, count) => {
  const world = new ProcgenLaneWorld({ masks, terrain: terrainFor(), seed: 15, laneHeight: 144, cohorts: true, maxActors: count,
    workerLimits: { builders: 1, bashers: 0, diggers: 0 } });
  world.generatedThrough.fill(1024);
  const arrivals = new Set(), births = [], brickEvents = [], builds = []; let maximumAhead = 0, firstWalkingTick = null;
  world.soundEvents.onEvent.on(event => { if (event.type === 'lemming-spawn') births.push([event.tick, event.lemmingId, event.x, event.y]); if (event.type === 'builder-step') brickEvents.push([event.tick, event.lemmingId]); });
  while (world.tickIndex < 2400 && arrivals.size < count) {
    const before = world.stats.builds; world.step();
    // Close this finite naturally admitted cohort; no replacement births or timer reset.
    if (world.spawnedTotal === count) world.cohorts = false;
    const scout = world.actors[0], ordinary = world.actors.filter(actor => !actor.scout);
    if (scout && ordinary.length) maximumAhead = Math.max(maximumAhead, scout.x - Math.max(...ordinary.map(actor => actor.x)));
    if (world.stats.builds > before) builds.push([world.tickIndex, ...world.actors.filter(actor => actor.action === world.actions[State.BUILDING]).map(actor => [actor.id, actor.x, actor.y])]);
    if (world.stats.builds && scout.action === world.actions[State.WALKING] && firstWalkingTick == null) firstWalkingTick = world.tickIndex;
    for (const actor of world.actors) {
      expect(actor.x).to.be.within(9, 510); expect(actor.failureReason).to.equal(null);
      if (actor.x > 350 && actor.action === world.actions[State.WALKING]) arrivals.add(actor.id);
    }
    expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(MAX_ROUTE_PROBES);
  }
  const scout = world.actors[0], ordinary = world.actors.filter(actor => !actor.scout);
  expect(scout.spawnTick).to.equal(1); expect(scout.spawnOrdinal).to.equal(0); expect(scout.scoutAbilities).to.equal(1);
  expect(world.population.settings.scoutDelayTicks).to.equal(180); expect(world.population.settings.scoutsEvery).to.equal(8);
  expect(births).to.have.length(count); expect(births.every((birth, index) => index === 0 || birth[0] > births[index - 1][0])).to.equal(true);
  expect(builds[0]).to.deep.equal([222, [0, 246, 120]]); expect(maximumAhead).to.be.at.least(40);
  expect(brickEvents.filter(event => event[1] === scout.id)).to.have.length(12); expect(firstWalkingTick).to.equal(421);
  expect(arrivals.size).to.equal(count); expect(world.activeCount).to.equal(count); expect(world.spawnedTotal).to.equal(count);
  expect(ordinary).to.have.length(count === 8 ? 7 : 14); expect(ordinary.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
  expect(world.stats.failures + world.stats.removedPixels + world.stats.bashes + world.stats.mines + world.stats.digs).to.equal(0);
  expect(world.hazards.stats.contacts).to.equal(0); expect(world.hasGroundAt(510, 112)).to.equal(true); expect(world.hasSteelAt(510, 112)).to.equal(true);
  expect(world.getLanePolicySignals(0).successes).to.be.at.least(1); expect(world.getLanePolicySignals(0).ordinaryCrossings).to.be.greaterThan(0);
  expect(MAX_LOCAL_ROUTE_DISTANCE).to.equal(40); expect(ROUTE_LANES_PER_TICK).to.equal(8);
  const receipt = { tick: world.tickIndex, builds, births, brickEvents, arrivals: [...arrivals], firstWalkingTick, maximumAhead,
    actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.lookRight, actor.state, actor.scoutAbilities, actor.canClimb, actor.hasParachute]), ordinary: ordinary.length };
  world.dispose(); return receipt;
};

describe('actual physically ahead scouts and ordinary shared construction', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const count of [8, 16]) it(`freshly replays all ${count} naturally born actors over scout-led construction with explicit construction-only limits`, () => {
    const receipt = replay(masks, count); expect(replay(masks, count)).to.deep.equal(receipt);
  });
  it('observes the genuine ceiling-rejected CLIMB to FALL turn, shares nearby knowledge, and invalidates only changed local terrain', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: terrainFor({ ceiling: true }), seed: 15, laneHeight: 144, cohorts: true, maxActors: 2,
      workerLimits: { builders: 0, bashers: 0, diggers: 0 } }); world.generatedThrough.fill(1024);
    let failure = null, climbSeen = false, minimumAbilityTick = Infinity;
    for (let tick = 0; tick < 400 && !failure; tick++) {
      const scout = world.actors[0], previous = scout && { action: scout.action, x: scout.x, right: scout.lookRight };
      world.step(); if (world.spawnedTotal === 2) world.cohorts = false;
      const current = world.actors[0];
      if (current.canClimb) minimumAbilityTick = Math.min(minimumAbilityTick, world.tickIndex);
      if (current.action === world.actions[State.CLIMBING]) { climbSeen = true; expect(current.x).to.be.greaterThan(world.actors[1].x); }
      if (previous?.action === world.actions[State.CLIMBING] && current.action === world.actions[State.FALLING]) {
        expect(current.lookRight).to.equal(!previous.right); expect(Math.abs(current.x - previous.x)).to.equal(2);
        failure = { tick: world.tickIndex, x: current.x, y: current.y };
      }
    }
    expect(climbSeen).to.equal(true); expect(failure).to.exist; expect(minimumAbilityTick).to.be.at.least(181);
    const records = world.getLanePolicySignals(0).knowledge, record = records.find(entry => entry.kind === 'failed-climb');
    expect(record).to.include(failure); expect(record.tiles.length).to.be.at.most(4); expect('actor' in record).to.equal(false);
    const ordinary = world.actors[1]; while (ordinary.x < record.x - 40 && world.tickIndex < 400) world.step();
    expect(ordinary.canClimb || ordinary.hasParachute).to.equal(false);
    const observed = world.lanePolicy.score(ordinary, { kind: 'builders' });
    world.setGroundAt(900, 20); expect(world.lanePolicy.score(ordinary, { kind: 'builders' })).to.equal(observed);
    world.setGroundAt(record.x, 20); expect(world.lanePolicy.score(ordinary, { kind: 'builders' })).to.equal(observed - 4);
    expect(world.getLanePolicySignals(0).knowledge).to.have.length(0);
    expect(world.stats.failures).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0); world.dispose();
  });
});
