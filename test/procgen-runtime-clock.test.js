import { expect } from 'chai';
import { advanceProcgenClock } from '../js/app/procgen/ProcgenLaneRuntime.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { changeProcgenSpeed } from '../js/app/procgen/ProcgenSpeedControl.js';

describe('Procgen real-time stepping clock', () => {
  it('advances at 0.1x across frame boundaries instead of permanently dropping slow ticks', () => {
    let elapsed = 0, ticks = 0;
    for (let frame = 0; frame < 120; frame++) elapsed = advanceProcgenClock(elapsed, 10, 0.1, () => ticks++, () => 0);
    expect(ticks).to.equal(2); expect(elapsed).to.equal(0);
  });
  it('keeps extreme finite speed bounded by execution time and recovers after lowering it', () => {
    let time = 0, ticks = 0;
    const step = () => { ticks++; time += 1; };
    let elapsed = advanceProcgenClock(0, 16, 1e308, step, () => time);
    expect(ticks).to.equal(8); expect(Number.isFinite(elapsed)).to.equal(true);
    elapsed = advanceProcgenClock(elapsed, 60, 1, step, () => time);
    expect(ticks).to.equal(9); expect(elapsed).to.be.closeTo(16, 1e-9);
    elapsed = advanceProcgenClock(elapsed, 584, 0.1, step, () => time);
    expect(ticks).to.equal(9);
    elapsed = advanceProcgenClock(elapsed, 250, 0.1, step, () => time);
    elapsed = advanceProcgenClock(elapsed, 84, 0.1, step, () => time);
    expect(ticks).to.equal(10); expect(elapsed).to.equal(0);
  });
  it('keeps the requested multiplier while reporting finite representable tick rates', () => {
    const world = new ProcgenLaneWorld({ laneCount: 1, speed: 1e308 });
    expect(world.timer.speedFactor).to.equal(1e308);
    expect(world.timer.tps).to.equal(Number.MAX_VALUE);
    world.timer.speedFactor = 1; expect(world.timer.tps).to.be.closeTo(1000 / 60, 1e-9);
    world.dispose();
  });
  it('uses the same mutable timer rate for initialized and live high speed under the same work budget', () => {
    for (const speed of [20, 100, 1000]) {
      const run = live => {
        const world = new ProcgenLaneWorld({ laneCount: 1, speed: live ? 3 : speed }); if (live) world.timer.speedFactor = speed;
        let elapsed = 0, cost = 0, ticks = 0;
        for (let frame = 0; frame < 60; frame++) elapsed = advanceProcgenClock(elapsed, 1000 / 60, world.getGameTimer().speedFactor, () => { ticks++; cost += 0.1; }, () => cost);
        world.dispose(); return { ticks, elapsed };
      };
      expect(run(true)).to.deep.equal(run(false));
    }
  });
  it('preserves a huge finite multiplier when incrementing and decrementing its control', () => {
    expect(changeProcgenSpeed(1e308, 1)).to.equal(1e308);
    expect(changeProcgenSpeed(1e308, -1)).to.equal(1e308);
  });
});
