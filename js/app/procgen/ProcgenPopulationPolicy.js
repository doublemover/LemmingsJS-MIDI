const DEFAULT_PROCGEN_POPULATION = Object.freeze({ highLaneThreshold: 64, highLaneMultiplier: 1.5,
  targetLivePerLane: 8, maximumMultiplier: 4, easing: 0.25, scoutsEvery: 8, scoutDelayTicks: 180 });
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

class ProcgenPopulationPolicy {
  constructor(laneCount, releaseIntervalTicks = 54, settings = {}, explicitInterval = false) {
    this.laneCount = laneCount; this.settings = { ...DEFAULT_PROCGEN_POPULATION, ...settings };
    this.adaptive = settings.adaptive !== false && !explicitInterval;
    this.baseInterval = Math.max(1, Math.round(releaseIntervalTicks * (this.adaptive && laneCount > this.settings.highLaneThreshold ? this.settings.highLaneMultiplier : 1)));
    this.reset(0);
  }
  reset(generationStartTick) { this.cohortStartTick = generationStartTick + 1; this.intervalTicks = this.baseInterval; this.nextCohortTick = this.cohortStartTick + this.intervalTicks; this.populationHighWater = 0; }
  phaseAt(tick, liveActors) {
    if (tick < this.cohortStartTick) return -1;
    if (tick >= this.nextCohortTick) {
      const skipped = Math.floor((tick - this.nextCohortTick) / this.intervalTicks);
      this.cohortStartTick = this.nextCohortTick + skipped * this.intervalTicks;
      this.populationHighWater = Math.max(this.populationHighWater, Math.max(0, liveActors));
      if (this.adaptive) {
        const load = this.populationHighWater / Math.max(1, this.laneCount * this.settings.targetLivePerLane);
        const maximum = Math.max(1, this.settings.maximumMultiplier), factor = 1 + (maximum - 1) * load / (1 + load);
        const target = this.baseInterval * factor, easing = Math.max(0, Math.min(1, this.settings.easing));
        this.intervalTicks = Math.max(this.intervalTicks, Math.min(Math.ceil(this.baseInterval * maximum), Math.round(this.intervalTicks + (target - this.intervalTicks) * easing)));
      }
      this.nextCohortTick = this.cohortStartTick + this.intervalTicks;
    }
    return tick - this.cohortStartTick;
  }
  isScout(laneSeed, spawnOrdinal) {
    const every = Math.max(1, Math.trunc(this.settings.scoutsEvery));
    return (spawnOrdinal + mix(laneSeed) % every) % every === 0;
  }
  scoutReady(actor, tick) { return !!actor.scout && tick - actor.spawnTick >= Math.max(0, this.settings.scoutDelayTicks); }
  snapshot() { return { adaptive: this.adaptive, baseIntervalTicks: this.baseInterval, intervalTicks: this.intervalTicks,
    populationHighWater: this.populationHighWater, nextCohortTick: this.nextCohortTick,
    scoutsEvery: this.settings.scoutsEvery, scoutDelayTicks: this.settings.scoutDelayTicks }; }
}
export { DEFAULT_PROCGEN_POPULATION, ProcgenPopulationPolicy };
