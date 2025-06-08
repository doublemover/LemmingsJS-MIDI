import { Lemmings } from './LemmingsNamespace.js';

class GameVictoryCondition {
  constructor(level) {
    this.isFinalize = false;
    this.needCount = level.needCount;
    this.releaseCount = level.releaseCount;
    this.leftCount = level.releaseCount;
    this.minReleaseRate = level.releaseRate;
    this.releaseRate = level.releaseRate;
    this.survivorCount = 0;
    this.outCount = 0;
  }
  getNeedCount() {
    return this.needCount;
  }
  getReleaseCount() {
    return this.releaseCount;
  }
  changeReleaseRate(count) {
    if (this.isFinalize) {
      return false;
    }
    let oldReleaseRate = this.releaseRate;
    let newReleaseRate = this.boundToRange(this.minReleaseRate, this.releaseRate + count, GameVictoryCondition.maxReleaseRate);
    if (newReleaseRate == oldReleaseRate) {
      return false;
    }
    this.releaseRate = newReleaseRate;
    return true;
  }
  boundToRange(min, value, max) {
    return Math.min(max, Math.max(min, value | 0)) | 0;
  }
  getMinReleaseRate() {
    return this.minReleaseRate;
  }
  getCurrentReleaseRate() {
    if (lemmings.bench == true && !lemmings._benchMeasureExtras) {
      return 99;
    }
    return this.releaseRate;
  }
  /** one lemming reached the exit */
  addSurvivor() {
    if (this.isFinalize) {
      return;
    }
    this.survivorCount++;
  }
  /** number of rescued lemmings */
  getSurvivorsCount() {
    return this.survivorCount;
  }
  /** number of rescued lemmings in percentage */
  getSurvivorPercentage() {
    return Math.floor(this.survivorCount / this.releaseCount * 100) | 0;
  }
  /** number of alive lemmings out in the level */
  getOutCount() {
    return this.outCount;
  }
  /** the number of lemmings not yet released */
  getLeftCount() {
    return this.leftCount;
  }
  /** release one new lemming */
  releaseOne() {
    if ((this.isFinalize) || (this.leftCount <= 0)) {
      return;
    }
    this.leftCount--;
    this.outCount++;
  }
  /** if a lemming die */
  removeOne() {
    if (this.isFinalize) {
      return;
    }
    this.outCount--;
  }
  /** stop releasing lemmings */
  doNuke() {
    if (this.isFinalize) {
      return;
    }
    this.leftCount = 0;
  }
  /** stop any changing in the conditions */
  doFinalize() {
    if (this.isFinalize) {
      return;
    }
    this.isFinalize = true;
  }
}
GameVictoryCondition.maxReleaseRate = 99;
Lemmings.GameVictoryCondition = GameVictoryCondition;

export { GameVictoryCondition };
