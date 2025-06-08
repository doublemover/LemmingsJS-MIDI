import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';

// minimal global environment
globalThis.lemmings = Lemmings;

describe('GameVictoryCondition methods', function () {
  function makeVC() {
    const level = { needCount: 1, releaseCount: 10, releaseRate: 10 };
    return new GameVictoryCondition(level);
  }

  describe('changeReleaseRate', function () {
    it('updates rate within bounds', function () {
      const vc = makeVC();
      expect(vc.changeReleaseRate(5)).to.be.true;
      expect(vc.releaseRate).to.equal(15);
    });

    it('clamps at minimum and maximum', function () {
      const vc = makeVC();
      // lower bound
      expect(vc.changeReleaseRate(-5)).to.be.false;
      expect(vc.releaseRate).to.equal(vc.minReleaseRate);
      // upper bound
      vc.releaseRate = 98;
      expect(vc.changeReleaseRate(10)).to.be.true;
      expect(vc.releaseRate).to.equal(GameVictoryCondition.maxReleaseRate);
    });

    it('does nothing after finalize', function () {
      const vc = makeVC();
      vc.doFinalize();
      expect(vc.changeReleaseRate(1)).to.be.false;
      expect(vc.releaseRate).to.equal(vc.minReleaseRate);
    });
  });

  it('tracks survivors', function () {
    const vc = makeVC();
    vc.addSurvivor();
    expect(vc.survivorCount).to.equal(1);
    vc.doFinalize();
    vc.addSurvivor();
    expect(vc.survivorCount).to.equal(1);
  });

  it('releases and removes lemmings', function () {
    const vc = makeVC();
    vc.releaseOne();
    expect(vc.leftCount).to.equal(9);
    expect(vc.outCount).to.equal(1);
    vc.removeOne();
    expect(vc.outCount).to.equal(0);
  });

  it('nukes remaining lemmings', function () {
    const vc = makeVC();
    vc.doNuke();
    expect(vc.leftCount).to.equal(0);
  });

  it('finalizes and blocks further changes', function () {
    const vc = makeVC();
    vc.doFinalize();
    expect(vc.isFinalize).to.be.true;
    vc.releaseOne();
    expect(vc.leftCount).to.equal(10);
    vc.doNuke();
    expect(vc.leftCount).to.equal(10);
  });

  it('returns the max bench rate when benchmarking', function () {
    const vc = makeVC();
    lemmings.bench = true;
    lemmings._benchMeasureExtras = false;
    expect(vc.getCurrentReleaseRate()).to.equal(99);
    lemmings.bench = false;
  });

  it('calculates survivor percentage', function () {
    const vc = makeVC();
    vc.releaseCount = 10;
    vc.survivorCount = 3;
    expect(vc.getSurvivorPercentage()).to.equal(30);
  });

  it('removeOne does nothing after finalize', function () {
    const vc = makeVC();
    vc.releaseOne();
    expect(vc.outCount).to.equal(1);
    vc.doFinalize();
    vc.removeOne();
    expect(vc.outCount).to.equal(1);
  });

  it('doFinalize is idempotent', function () {
    const vc = makeVC();
    vc.doFinalize();
    expect(vc.isFinalize).to.be.true;
    vc.doFinalize();
    expect(vc.isFinalize).to.be.true;
  });
});
