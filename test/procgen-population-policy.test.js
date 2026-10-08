import { expect } from 'chai';
import { ProcgenPopulationPolicy } from '../js/app/procgen/ProcgenPopulationPolicy.js';

describe('bounded procgen population and scout policy', () => {
  it('slows the default baseline above 64 lanes and preserves explicit interval overrides', () => {
    expect(new ProcgenPopulationPolicy(64).baseInterval).to.equal(54);
    expect(new ProcgenPopulationPolicy(65).baseInterval).to.equal(81);
    const explicit = new ProcgenPopulationPolicy(128, 5, {}, true);
    expect(explicit.baseInterval).to.equal(5);
    for (let tick = 1; tick < 100; tick++) explicit.phaseAt(tick, 100000);
    expect(explicit.intervalTicks).to.equal(5);
  });
  it('eases monotonically toward a bounded slower interval as the live population grows', () => {
    const policy = new ProcgenPopulationPolicy(128), intervals = [];
    for (let cohort = 0; cohort < 30; cohort++) {
      expect(policy.phaseAt(policy.nextCohortTick, cohort * 256)).to.equal(0); intervals.push(policy.intervalTicks);
    }
    expect(intervals.every((value, index) => !index || value >= intervals[index - 1])).to.equal(true);
    expect(intervals.at(-1)).to.be.greaterThan(81).and.at.most(324);
    const previous = policy.intervalTicks;
    policy.phaseAt(policy.nextCohortTick, 0); expect(policy.intervalTicks).to.be.at.least(previous);
  });
  it('uses simulation ticks, preserves cohort spread, resets per generation and replays deterministically', () => {
    const run = () => {
      const policy = new ProcgenPopulationPolicy(128), phases = [];
      for (let tick = 1; tick < 500; tick++) phases.push(policy.phaseAt(tick, 256));
      return { phases, state: policy.snapshot() };
    };
    expect(run()).to.deep.equal(run());
    const policy = new ProcgenPopulationPolicy(128);
    expect(policy.phaseAt(1, 0)).to.equal(0); expect(policy.phaseAt(13, 0)).to.equal(12);
    const state = policy.snapshot(); for (let repeat = 0; repeat < 100; repeat++) policy.phaseAt(13, 10000);
    expect(policy.snapshot()).to.deep.equal(state);
    policy.phaseAt(2000, 10000); policy.reset(2000);
    expect(policy.intervalTicks).to.equal(81); expect(policy.phaseAt(2001, 0)).to.equal(0); expect(policy.populationHighWater).to.equal(0);
  });
  it('chooses sparse deterministic scouts and delays their eligibility without assigning manual abilities', () => {
    const policy = new ProcgenPopulationPolicy(64);
    const chosen = Array.from({ length: 64 }, (_, spawn) => policy.isScout(42, spawn));
    expect(chosen.filter(Boolean)).to.have.length(8);
    expect(chosen).to.deep.equal(Array.from({ length: 64 }, (_, spawn) => policy.isScout(42, spawn)));
    const actor = { scout: true, spawnTick: 10, canClimb: false, hasParachute: false };
    expect(policy.scoutReady(actor, 189)).to.equal(false); expect(policy.scoutReady(actor, 190)).to.equal(true);
    expect(actor.canClimb).to.equal(false); expect(actor.hasParachute).to.equal(false);
  });
});
