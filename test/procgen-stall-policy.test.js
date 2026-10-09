import { expect } from 'chai';
import { ProcgenStallPolicy } from '../js/app/procgen/ProcgenStallPolicy.js';
const settings = { secondsWithoutProgress: 10, ticksPerSecond: 10, baseSpawnAllowance: 3, distanceGrowthPixels: 100, additionalSpawnsPerGrowth: 2 };
const actor = (id, laneIndex, x = 36) => ({ id, laneIndex, x });
describe('procgen cohort stall policy', () => {
  it('requires both actual spawns and generous simulated time', () => {
    const p = new ProcgenStallPolicy(1, settings), a = [actor(0, 0)];
    p.spawn(0); p.spawn(0); p.update(a, 200); expect(p.phase).to.equal('running');
    p.spawn(0); p.update(a, 200); expect(p.phase).to.equal('cascade');
  });
  it('resets the spawn/time window only on new forward progress', () => {
    const p = new ProcgenStallPolicy(1, settings), a = [actor(0, 0)];
    for (let i = 0; i < 3; i++) p.spawn(0);
    a[0].x = 80; p.update(a, 99); expect(p.lanes[0].spawnsSinceProgress).to.equal(0);
    a[0].x = 70; p.update(a, 150); expect(p.lanes[0].lastProgressTick).to.equal(99);
  });
  it('never kills a progressing lane because another is stalled', () => {
    const p = new ProcgenStallPolicy(2, settings), a = [actor(0, 0), actor(1, 1)];
    for (let i = 0; i < 3; i++) { p.spawn(0); p.spawn(1); }
    a[1].x = 100; p.update(a, 200); expect(p.phase).to.equal('running');
  });
  it('uses fixed game ticks so repeated paused updates cannot age the grace', () => {
    const p = new ProcgenStallPolicy(1, settings), a = [actor(0, 0)];
    for (let i = 0; i < 3; i++) p.spawn(0);
    for (let i = 0; i < 100; i++) p.update(a, 99);
    expect(p.phase).to.equal('running'); p.update(a, 100); expect(p.phase).to.equal('cascade');
  });
  it('grows allowance with distance and staggers actors by one or two whole ticks', () => {
    const p = new ProcgenStallPolicy(1, settings), a = [actor(0, 0, 250), actor(1, 0, 250), actor(2, 0, 250)];
    p.update(a, 1); expect(p.allowance(p.lanes[0])).to.equal(7);
    for (let i = 0; i < 7; i++) p.spawn(0);
    const deadline = 1 + p.graceTicks(p.lanes[0]);
    p.update(a, deadline);
    expect(p.takeDue(deadline)).to.deep.equal([0]); expect(p.takeDue(deadline + 1)).to.deep.equal([1]); expect(p.takeDue(deadline + 2)).to.deep.equal([]); expect(p.takeDue(deadline + 3)).to.deep.equal([2]);
  });
  it('gives fresh probes the measured spawn-to-frontier transit time at 7168 pixels and beyond', () => {
    for (const distance of [7168, 15000, 50000]) {
      const p = new ProcgenStallPolicy(1), a = [actor(0, 0, distance + 36)];
      a[0].spawnTick = 0;
      p.update(a, distance * 3);
      const lastProgress = distance * 3;
      for (let i = 0; i < p.allowance(p.lanes[0]); i++) p.spawn(0, lastProgress + 1 + i * 54);
      p.update(a, lastProgress + 1500);
      expect(p.phase).to.equal('running');
      const snapshot = p.snapshot(lastProgress + 1500).lanes[0];
      expect(snapshot.estimatedTransitTicks).to.be.at.least(distance * 3 * 1.75);
      p.update(a, snapshot.probeDeadlineTick - 1); expect(p.phase).to.equal('running');
      p.update(a, snapshot.probeDeadlineTick); expect(p.phase).to.equal('cascade');
    }
  });
  it('does not immediately restart a lane after its first unsuccessful cohort', () => {
    const p = new ProcgenStallPolicy(1), a = [{ ...actor(0, 0), failureReason: 'unsafe-fall' }];
    p.spawn(0, 1); p.update(a, 20); expect(p.phase).to.equal('running');
    for (let i = 1; i < p.allowance(p.lanes[0]); i++) p.spawn(0, 1 + i * 54);
    p.update(a, p.graceTicks(p.lanes[0]) + 1); expect(p.phase).to.equal('finished');
  });
  it('restarts only after every actor dies, once, retaining previous distance', () => {
    const p = new ProcgenStallPolicy(1, settings, [300]), a = [actor(0, 0, 420)];
    p.update(a, 1); for (let i = 0; i < p.allowance(p.lanes[0]); i++) p.spawn(0); const deadline = 1 + p.graceTicks(p.lanes[0]); p.update(a, deadline);
    expect(p.consumeRestart()).to.equal(null); a[0].removed = true; p.update(a, deadline + 1);
    expect(p.consumeRestart()).to.deep.equal([384]); expect(p.consumeRestart()).to.equal(null);
  });
});

import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
describe('real-action stall cascade', () => {
  it('plays OHNO/explosion on integer ticks, waits for all deaths and restarts once with the record', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 2, cohorts: true, assists: false,
      maxActors: 2, stallPolicy: { baseSpawnAllowance: 2, secondsWithoutProgress: 1, ticksPerSecond: 10, releaseIntervalTicks: 5 } });
    const events = []; world.soundEvents.onEvent.on(e => events.push(e));
    // A real immovable enclosure, not a modified action implementation.
    world.baseGroundAt = (x, y) => y % 96 >= 72 || x >= 37 && x <= 45 && y % 96 >= 50 ? 1 : 0;
    for (let i = 0; i < 400 && world.generation === 1; i++) world.step();
    expect(world.generation).to.equal(2);
    const ohno = events.filter(e => e.type === 'lemming-ohno');
    const blasts = events.filter(e => e.type === 'lemming-explode');
    expect(ohno.length).to.be.greaterThan(0); expect(blasts.length).to.equal(ohno.length);
    for (let i = 1; i < ohno.length; i++) expect(ohno[i].tick - ohno[i - 1].tick).to.be.oneOf([1, 2]);
    expect(world.stall.lanes.every(l => Number.isFinite(l.previousDistance))).to.equal(true);
    expect(world.actors).to.have.length(0);
    world.step(); expect(world.generation).to.equal(2);
  });
});


const pileSettings = { secondsWithoutProgress: 1000, ticksPerSecond: 10, baseSpawnAllowance: 3,
  initialTicksPerPixel: 1, transitSafetyFactor: 1, pileMinimumNonProgressSeconds: 1, pileSecondsWithoutProgress: 3, pileSecondsPerGrowth: 1 };
const pileActors = count => Array.from({ length: count }, (_, id) => ({ id, laneIndex: 0, x: 40 + id % 2, y: 72, spawnTick: 0, lastProgressTick: 1 }));
const preparePile = () => {
  const policy = new ProcgenStallPolicy(1, pileSettings), actors = pileActors(4);
  policy.update(actors, 1); for (let spawn = 0; spawn < 6; spawn++) policy.spawn(0, 2);
  policy.update(actors, 20); actors.push(...pileActors(6).slice(4)); policy.update(actors, 21);
  return { policy, actors };
};
describe('bounded spatial pile and useful-work stall signals', () => {
  it('detects an observed growing oscillation only after its difficulty and transit grace', () => {
    const { policy, actors } = preparePile(), lane = policy.lanes[0];
    expect(lane.pileCount).to.equal(6); expect(lane.pileGrowing).to.equal(true);
    expect(lane.pileMaxX - lane.pileMinX).to.equal(48); expect(lane.pileMaxY - lane.pileMinY).to.be.at.most(48);
    policy.update(actors, 49); expect(policy.phase).to.equal('running');
    for (const actor of actors) actor.x = actor.x === 40 ? 41 : 40;
    policy.update(actors, 50); expect(policy.phase).to.equal('cascade'); expect(lane.reason).to.equal('sustained-growing-pile');
    expect(policy.pileGraceTicks({ maxX: 50000 })).to.be.at.most(policy.settings.pileMaxSeconds * 10);
  });
  it('protects pending terrain/mining work and actual edits, then permits a stale failed action to expire', () => {
    const { policy, actors } = preparePile();
    const work = { terrainActivityTicks: new Float64Array([-Infinity]), pendingTerrainWork: new Uint32Array([1]) };
    actors[0].action = { actionName: 'mining' };
    policy.update(actors, 50, work); expect(policy.phase).to.equal('running'); expect(policy.lanes[0].activeWork).to.equal(true);
    policy.update(actors, 249, work); expect(policy.phase).to.equal('running');
    const stale = preparePile(); stale.actors[0].action = { actionName: 'mining' };
    stale.policy.update(stale.actors, 50, work); stale.policy.update(stale.actors, 500, work); expect(stale.policy.phase).to.equal('cascade');
    work.pendingTerrainWork[0] = 0; work.terrainActivityTicks[0] = 500;
    policy.update(actors, 500, work); expect(policy.phase).to.equal('running');
    policy.update(actors, 601, work); expect(policy.phase).to.equal('cascade');
  });
  it('allows a newly started construction action time to begin without shielding it indefinitely', () => {
    const { policy, actors } = preparePile(); actors[0].action = { actionName: 'building' };
    policy.update(actors, 50); expect(policy.phase).to.equal('running'); expect(policy.lanes[0].busyActors).to.equal(1);
    policy.update(actors, 151); expect(policy.phase).to.equal('cascade');
  });
  it('clears observations on population loss or actual escape, and fixed paused ticks do not age a pile', () => {
    const { policy, actors } = preparePile();
    for (let repeat = 0; repeat < 100; repeat++) policy.update(actors, 21);
    expect(policy.phase).to.equal('running'); expect(policy.lanes[0].pileStartTick).to.equal(20);
    for (const actor of actors.slice(2)) actor.failureReason = 'fixture';
    policy.update(actors, 22); expect(policy.lanes[0].pileStartTick).to.equal(null); expect(policy.lanes[0].alive).to.equal(2);
    for (const actor of actors) actor.failureReason = null;
    policy.update(actors, 23); actors[0].x = 50; policy.update(actors, 24);
    expect(policy.lanes[0].pileCount).to.equal(0); expect(policy.lanes[0].spawnsSinceProgress).to.equal(0);
  });
  it('keeps summaries bounded and does not mistake a static initial crowd for growth and bounds an actually observed distant growing pile', () => {
    const policy = new ProcgenStallPolicy(64, pileSettings), actors = pileActors(10);
    policy.update(actors, 1); for (let spawn = 0; spawn < 12; spawn++) policy.spawn(0, 2);
    const counts = policy._pileCounts, cells = policy._pileCells;
    policy.update(actors, 20); policy.update(actors, 1000);
    expect(policy.lanes[0].pileGrowing).to.equal(false); expect(policy.lanes[0].reason).to.equal(null);
    expect(policy._pileCounts).to.equal(counts); expect(policy._pileCells).to.equal(cells); expect(counts.length).to.equal(64 * 64);
    const far = new ProcgenStallPolicy(1, pileSettings), probes = pileActors(4).map(actor => ({ ...actor, x: 5036 }));
    far.update(probes, 1); for (let spawn = 0; spawn < far.allowance(far.lanes[0]); spawn++) far.spawn(0, 2);
    far.update(probes, 20); probes.push(...probes.slice(0, 2).map(actor => ({ ...actor, id: actor.id + 4 })));
    far.update(probes, 21); far.update(probes, 3000); expect(far.phase).to.equal('cascade');
    expect(far.lanes[0].reason).to.equal('sustained-growing-pile');
  });
});

describe('local sustained pile detonation while other lanes progress', () => {
  it('queues only the actual growing stalled lane once on simulation ticks, preserves a progressing lane and bounds stale pending grace', () => {
    const policy = new ProcgenStallPolicy(2, pileSettings), actors = [...pileActors(4), { id: 99, laneIndex: 1, x: 40, y: 168, lastProgressTick: 1 }];
    policy.update(actors, 1); for (let count = 0; count < 6; count++) policy.spawn(0, 2);
    policy.update(actors, 20); actors.push(...pileActors(6).slice(4)); policy.update(actors, 21);
    actors[4].x = 100; policy.update(actors, 50); expect(policy.phase).to.equal('running');
    expect(policy.cascade.map(entry => entry.id)).to.have.members([0, 1, 2, 3, 4, 5]); expect(policy.lanes[0].detonationQueued).to.equal(true);
    const entries = policy.cascade.slice(); for (let repeat = 0; repeat < 20; repeat++) policy.update(actors, 50); expect(policy.cascade).to.deep.equal(entries);
    expect(policy.takeDue(100)).to.have.members([0, 1, 2, 3, 4, 5]); policy.update(actors, 100); expect(policy.cascade).to.have.length(6);
    actors[0].x = 70; policy.update(actors, 101); expect(policy.lanes[0].detonationQueued).to.equal(false); expect(policy.consumeRestart()).to.equal(null);
    const { policy: protectedPolicy, actors: crew } = preparePile(), work = { pendingTerrainWork: [1], terrainActivityTicks: [-Infinity] };
    for (let tick = 50; tick < 500; tick += 50) { work.pendingTerrainWork[0]++; work.terrainActivityTicks[0] = tick; protectedPolicy.update(crew, tick, work); expect(protectedPolicy.phase).to.equal('running'); }
    work.terrainActivityTicks[0] = -Infinity; protectedPolicy.update(crew, 551, work); expect(protectedPolicy.phase).to.equal('cascade');
  });
});
