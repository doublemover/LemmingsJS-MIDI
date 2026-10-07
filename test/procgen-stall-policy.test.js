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
