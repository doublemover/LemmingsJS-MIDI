import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { normalizePopulationPolicy } from '../js/app/procgen/ProcgenPopulationPolicy.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('seeded tick admission and independent scout roles', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const cohort = (seed, spread = null) => {
    const world = new ProcgenLaneWorld({ masks, seed, laneCount: 8, laneHeight: 144, assists: false, cohorts: true, spawnSpreadTicks: spread }), events = [];
    world.soundEvents.onEvent.on(event => { if (event.type === 'lemming-spawn') events.push([event.laneIndex, event.spawnTick, event.spawnPhaseTicks, event.laneCount]); });
    for (let tick = 0; tick < 13; tick++) world.step();
    const actors = world.actors.map(actor => [actor.id, actor.laneIndex, actor.spawnTick, actor.spawnPhaseTicks, actor.scoutAbilities]);
    expect(world.spawnedTotal).to.equal(8); expect(world.activeCount).to.equal(8);
    expect(world.actors.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
    world.dispose(); return { actors, events };
  };
  it('replays staggered simulation-tick births and publishes the actual shared event origin', () => {
    const first = cohort(42); expect(first).to.deep.equal(cohort(42));
    expect(first.events.map(event => event[0])).to.not.deep.equal(cohort(43).events.map(event => event[0]));
    expect(new Set(first.events.map(event => event[1])).size).to.be.greaterThan(1);
    expect(first.events.every(([, tick, phase, count]) => tick === 1 + phase && count === 8)).to.equal(true);
    expect(new Set(first.events.map(event => event[0])).size).to.equal(8);
    expect(cohort(42, 0).events.every(([, tick, phase]) => tick === 1 && phase === 0)).to.equal(true);
  });
  it('normalizes saved live policy, preserves existing roles and resets phase ownership without a new clock', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 8, cohorts: true, laneHeight: 144 });
    const copy = world.setPopulationPolicy({ scoutsEvery: 0, scoutDelayTicks: -1, spawnSpreadTicks: 0 });
    expect(copy).to.deep.equal({ scoutsEvery: 0, scoutDelayTicks: 0, spawnSpreadTicks: 0, spawnBeatTicks: 0 }); copy.scoutsEvery = 1;
    world.step(); expect(world.actors).to.have.length(8); expect(world.actors.every(actor => !actor.scout)).to.equal(true);
    world.setPopulationPolicy({ scoutsEvery: 1, scoutDelayTicks: 180, spawnSpreadTicks: 12 }); expect(world.actors.every(actor => !actor.scout)).to.equal(true);
    world._restart([]); for (let tick = 0; tick < 13; tick++) world.step();
    expect(world.actors).to.have.length(8); expect(world.actors.every(actor => actor.scout && !actor.canClimb && !actor.hasParachute)).to.equal(true);
    expect(world.actors.every(actor => actor.spawnTick > world.generationStartTick)).to.equal(true);
    expect(normalizePopulationPolicy({ scoutsEvery: Infinity, scoutDelayTicks: '2.9', spawnSpreadTicks: 100 })).to.deep.equal({ scoutsEvery: 8, scoutDelayTicks: 2, spawnSpreadTicks: 53, spawnBeatTicks: 0 });
    world.dispose();
  });
  it('quantizes phases to the existing musical tick lattice and never duplicates a lane birth after live changes', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 8, laneHeight: 144, cohorts: true, assists: false,
      populationPolicy: { spawnBeatTicks: 60000 / 120 / 60 } });
    expect(world.timer.TIME_PER_FRAME_MS).to.equal(60);
    while (!world.activeCount) world.step(); const firstPhases = [...world._spawnPhases], firstStart = world.population.cohortStartTick;
    world.setPopulationPolicy({ spawnSpreadTicks: 0, spawnBeatTicks: 60000 / 80 / 60 });
    for (let tick = 0; tick < 12; tick++) world.step();
    expect(world.actors).to.have.length(8); expect(new Set(world.actors.map(actor => actor.laneIndex)).size).to.equal(8);
    expect([...world._spawnPhases]).to.deep.equal(firstPhases);
    const quarter = (60000 / 120 / 60) / 4;
    const grid = new Set(Array.from({ length: 16 }, (_, index) => Math.round(index * quarter)));
    expect(firstPhases.every(phase => grid.has(firstStart + phase) && phase >= 0 && phase <= 12)).to.equal(true);
    expect(world.actors.every(actor => grid.has(actor.spawnTick) && actor.spawnTick === firstStart + actor.spawnPhaseTicks)).to.equal(true);
    const next = world.population.nextCohortTick;
    while (world.tickIndex < next) world.step();
    expect(world.spawnedTotal).to.equal(16); expect([...world._spawnPhases].every(phase => phase === 0)).to.equal(true);
    world.dispose();
  });
  it('admits pure climbers, pure floaters and occasional dual scouts with real delayed action owners', () => {
    const world = new ProcgenLaneWorld({ masks, laneHeight: 144, assists: true });
    for (let ordinal = 1; ordinal < 128; ordinal++) world._spawn(0, false);
    const roles = world.actors.filter(actor => actor.scout);
    expect(roles).to.have.length(16); expect(new Set(roles.map(actor => actor.scoutAbilities))).to.deep.equal(new Set([1, 2, 3]));
    const climber = roles.find(actor => actor.scoutAbilities === 1), floater = roles.find(actor => actor.scoutAbilities === 2), dual = roles.find(actor => actor.scoutAbilities === 3);
    world.getColumnStepHeight = () => 8; world.hasGroundAt = (_x, y) => y >= 140; world._claimAccess = () => false;
    for (const actor of [climber, floater, dual]) { actor.x = 64; actor.y = 72; actor.setAction(world.actions[State.WALKING]); }
    world.tickIndex = 179; for (const actor of [climber, floater, dual]) world._assist(actor);
    expect([climber, floater, dual].every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
    world.tickIndex = 180; for (const actor of [climber, floater, dual]) world._assist(actor);
    expect(climber.canClimb).to.equal(true); expect(floater.canClimb).to.equal(false); expect(dual.canClimb).to.equal(true);
    for (const actor of [climber, floater, dual]) { actor.y = 10; actor.setAction(world.actions[State.FALLING]); actor.state = 18; world._assist(actor); }
    expect(climber.hasParachute).to.equal(false); expect(floater.hasParachute).to.equal(true); expect(dual.hasParachute).to.equal(true);
    world.step(); expect(floater.action).to.equal(world.actions[State.FLOATING]); expect(dual.action).to.equal(world.actions[State.FLOATING]);
    expect(world.actors.filter(actor => !actor.scout).every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
    world.dispose();
  });
});
