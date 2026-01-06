import { expect } from 'chai';
import { Lemmings, useGlobalLemmings, withGlobalLemmings, withMissingGlobalLemmings } from './helpers/lemmings.js';
import { GameVictoryCondition } from '../js/game/GameVictoryCondition.js';

// minimal global environment
useGlobalLemmings(Lemmings);

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

  it('exposes release rate bounds and counts', function () {
    const vc = makeVC();
    expect(vc.getNeedCount()).to.equal(1);
    expect(vc.getReleaseCount()).to.equal(10);
    expect(vc.getMinReleaseRate()).to.equal(10);
    expect(vc.getMaxReleaseRate()).to.equal(GameVictoryCondition.maxReleaseRate);
  });

  it('sets current release rate with bounds and finalize checks', function () {
    const vc = makeVC();
    expect(vc.setCurrentReleaseRate(20)).to.equal(true);
    expect(vc.releaseRate).to.equal(20);
    expect(vc.setCurrentReleaseRate(20)).to.equal(false);
    expect(vc.setCurrentReleaseRate(200)).to.equal(true);
    expect(vc.releaseRate).to.equal(GameVictoryCondition.maxReleaseRate);
    vc.doFinalize();
    expect(vc.setCurrentReleaseRate(30)).to.equal(false);
  });

  it('uses normal release rate when measuring bench extras', function () {
    const vc = makeVC();
    lemmings.bench = true;
    lemmings._benchMeasureExtras = true;
    expect(vc.getCurrentReleaseRate()).to.equal(vc.releaseRate);
    lemmings.bench = false;
  });

  it('respects endless mode when releasing or nuking', function () {
    const vc = makeVC();
    lemmings.endless = true;
    vc.releaseOne();
    expect(vc.leftCount).to.equal(10);
    expect(vc.outCount).to.equal(1);
    vc.doNuke();
    expect(vc.leftCount).to.equal(10);
    lemmings.endless = false;
    vc.leftCount = 0;
    vc.releaseOne();
    expect(vc.outCount).to.equal(1);
  });

  it('handles missing app in getCurrentReleaseRate', function () {
    const vc = makeVC();
    withGlobalLemmings(null, () => {
      expect(vc.getCurrentReleaseRate()).to.equal(vc.releaseRate);
    });
    withMissingGlobalLemmings(() => {
      expect(vc.getCurrentReleaseRate()).to.equal(vc.releaseRate);
    });
  });
});
