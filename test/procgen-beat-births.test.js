import { expect } from 'chai';
import { ProcgenPopulationPolicy, quantizeProcgenSpawnTick } from '../js/app/procgen/ProcgenPopulationPolicy.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const collectBirths = world => {
  const births = [];
  world.soundEvents.onEvent.on(event => {
    if (event.type !== 'lemming-spawn') return;
    births.push({ tick: event.tick, lane: event.laneIndex, id: event.lemmingId, phase: event.spawnPhaseTicks,
      cohort: world.population.cohortStartTick, beatTicks: world.population.cohortBeatTicks, origin: world.generationStartTick, generation: world.generation });
  });
  return births;
};
const stepTo = (world, tick) => { while (world.tickIndex < tick) world.step(); };
const assertGrid = births => {
  for (const birth of births) {
    const quarter = birth.beatTicks / 4, relative = birth.tick - birth.origin;
    const nearest = Math.round(relative / quarter);
    expect([nearest - 1, nearest, nearest + 1].some(index => Math.round(index * quarter) === relative), JSON.stringify(birth)).to.equal(true);
    expect(birth.phase).to.equal(birth.tick - birth.cohort);
  }
};

describe('absolute simulation-beat procgen births', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const makeWorld = options => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 8, cohorts: true, assists: false, maxActors: 128,
      stallPolicy: { releaseIntervalTicks: 17, secondsWithoutProgress: 1000 }, ...options });
    world.baseGroundAt = (_x, y) => y % world.laneHeight >= world.laneHeight - 16 ? 1 : 0;
    return world;
  };
  it('rounds fractional absolute quarters once, never clamps a non-grid spread endpoint', () => {
    expect(quantizeProcgenSpawnTick(19, 0, 40, 16, 19)).to.equal(null);
    expect(quantizeProcgenSpawnTick(19, 0, 40, 10, 19)).to.equal(10);
    expect(quantizeProcgenSpawnTick(8, 7, 25 / 3, 8)).to.equal(9);
    expect(quantizeProcgenSpawnTick(1, 0, 1e-200, 1)).to.equal(1);
    const run = speed => {
      const world = makeWorld({ speed, populationPolicy: { spawnSpreadTicks: 12, spawnBeatTicks: 25 / 3 } });
      const births = collectBirths(world);
      try {
        stepTo(world, 115); assertGrid(births);
        const cohorts = [...new Set(births.map(birth => birth.cohort))];
        for (const cohort of cohorts.filter(value => value + 12 <= world.tickIndex)) {
          const members = births.filter(birth => birth.cohort === cohort);
          expect(members).to.have.length(8); expect(new Set(members.map(birth => birth.lane)).size).to.equal(8);
          expect(members.every(birth => birth.phase >= 0 && birth.phase <= 12)).to.equal(true);
        }
        for (let index = 1; index < cohorts.length; index++) expect(cohorts[index] - cohorts[index - 1]).to.be.at.least(17).and.below(21);
        expect(cohorts[0]).to.equal(2); expect(cohorts[1]).to.equal(19); expect(cohorts[2]).to.equal(38);
        expect(world.population.intervalTicks).to.equal(17);
        return births;
      } finally { world.dispose(); }
    };
    expect(run(22)).to.deep.equal(run(1));
  });
  it('defers long-grid cohorts boundedly and admits every lane at a real grid point', () => {
    const world = makeWorld({ stallPolicy: { releaseIntervalTicks: 5 }, populationPolicy: { spawnSpreadTicks: 12, spawnBeatTicks: 80 } });
    const births = collectBirths(world);
    try {
      stepTo(world, 80); assertGrid(births); expect(births).to.have.length(32);
      expect([...new Set(births.map(birth => birth.tick))]).to.deep.equal([20, 40, 60, 80]);
      for (const tick of [20, 40, 60, 80]) expect(new Set(births.filter(birth => birth.tick === tick).map(birth => birth.lane)).size).to.equal(8);
      expect(births.every(birth => birth.phase === 0)).to.equal(true);
      expect(world.population.snapshot()).to.include({ baseIntervalTicks: 5, intervalTicks: 5, cohortIntervalTicks: 20,
        cohortDeferredTicks: 15, nextCohortTick: 100, nextCohortDeferredTicks: 15 });
      stepTo(world, 92); world.setPopulationPolicy({ scoutsEvery: 0 });
      expect(world.population.snapshot()).to.include({ nextCohortTick: 100, nextCohortDeferredTicks: 15 });
      expect(births).to.have.length(32);
    } finally { world.dispose(); }
  });
  it('keeps admitted cohort settings frozen and applies live changes to the next cohort', () => {
    const pending = new ProcgenPopulationPolicy(8, 20, { spawnBeatTicks: 20 }, true);
    pending.setSettings({ spawnSpreadTicks: 0, spawnBeatTicks: 32 });
    expect(pending.cohortStartTick).to.equal(8); expect(pending.cohortSpreadTicks).to.equal(0);
    expect(pending.phaseAt(7, 0)).to.equal(-1); expect(pending.phaseAt(8, 0)).to.equal(0);
    const world = makeWorld({ stallPolicy: { releaseIntervalTicks: 20 }, populationPolicy: { spawnSpreadTicks: 12, spawnBeatTicks: 20 } });
    const births = collectBirths(world);
    try {
      stepTo(world, 6); const phases = [...world._spawnPhases];
      world.setPopulationPolicy({ spawnSpreadTicks: 0, spawnBeatTicks: 32 });
      expect([...world._spawnPhases]).to.deep.equal(phases); expect(world.population.cohortBeatTicks).to.equal(20);
      stepTo(world, 32); assertGrid(births);
      const first = births.filter(birth => birth.cohort === 5), next = births.filter(birth => birth.cohort === 32);
      expect(first).to.have.length(8); expect(first.some(birth => birth.tick === 15)).to.equal(true);
      expect(next).to.have.length(8); expect(next.every(birth => birth.tick === 32 && birth.beatTicks === 32 && birth.phase === 0)).to.equal(true);
      expect(new Set(births.map(birth => birth.id)).size).to.equal(births.length);
    } finally { world.dispose(); }
  });
  it('keeps capacity admission honest, pause observations inert and restart origins exact', () => {
    const world = makeWorld({ laneCount: 2, maxActors: 2, stallPolicy: { releaseIntervalTicks: 20, secondsWithoutProgress: 1000 },
      populationPolicy: { spawnSpreadTicks: 12, spawnBeatTicks: 20 } });
    const births = collectBirths(world);
    try {
      stepTo(world, 20); expect(world.activeCount).to.equal(2); expect(births).to.have.length(2);
      const paused = world.population.snapshot();
      for (let repeat = 0; repeat < 32; repeat++) expect(world.population.phaseAt(20, world.activeCount)).to.equal(15);
      expect(world.population.snapshot()).to.deep.equal(paused); expect(births).to.have.length(2);
      stepTo(world, 30); expect(births).to.have.length(2); expect(world.admissionPaused).to.equal(true);
      for (const actor of world.actors) actor.remove(); world.step(); expect(world.activeCount).to.equal(0);
      stepTo(world, 50); expect(births).to.have.length(4); expect(world.activeCount).to.equal(2);
      expect(births.slice(2).map(birth => birth.tick)).to.deep.equal([45, 50]); assertGrid(births);
      const origin = world.tickIndex; world._restart([]); const before = births.length;
      stepTo(world, origin + 4); expect(births).to.have.length(before);
      stepTo(world, origin + 15); const restarted = births.slice(before); expect(restarted).to.have.length(2);
      expect(restarted.every(birth => birth.origin === origin && birth.generation === 2)).to.equal(true); assertGrid(restarted);
    } finally { world.dispose(); }
  });
  it('bounds adaptive nominal intervals separately from grid defer and avoids late catch-up cohorts', () => {
    const policy = new ProcgenPopulationPolicy(128, 54, { spawnBeatTicks: 25 / 3 });
    let previousInterval = policy.intervalTicks;
    for (let count = 0; count < 24; count++) {
      const next = policy.nextCohortTick;
      expect(policy.phaseAt(next, 4000)).to.equal(0);
      expect(policy.intervalTicks).to.be.at.least(previousInterval).and.at.most(324);
      expect(policy.nextCohortTick - policy.cohortStartTick).to.be.at.least(policy.intervalTicks);
      expect(policy.nextCohortDeferredTicks).to.be.at.least(0).and.below(4); previousInterval = policy.intervalTicks;
    }
    const slow = new ProcgenPopulationPolicy(8, 5, { spawnBeatTicks: 400 }, true);
    expect(slow.phaseAt(251, 0)).to.equal(-1); expect(slow.cohortStartTick).to.equal(300);
    const state = slow.snapshot(); for (let repeat = 0; repeat < 10; repeat++) expect(slow.phaseAt(251, 0)).to.equal(-1);
    expect(slow.snapshot()).to.deep.equal(state); expect(slow.phaseAt(300, 0)).to.equal(0);
  });
});
