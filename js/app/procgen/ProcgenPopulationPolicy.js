const DEFAULT_PROCGEN_POPULATION = Object.freeze({ highLaneThreshold: 64, highLaneMultiplier: 1.5,
  targetLivePerLane: 8, maximumMultiplier: 4, easing: 0.25, scoutsEvery: 8, scoutDelayTicks: 180, spawnSpreadTicks: 12, spawnBeatTicks: 0 });
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

const normalizePopulationPolicy = (next = {}, current = DEFAULT_PROCGEN_POPULATION) => {
  const result = {};
  for (const [name, maximum] of [['scoutsEvery', 1048576], ['scoutDelayTicks', 36000], ['spawnSpreadTicks', 53], ['spawnBeatTicks', 4096]]) {
    const value = Number(next[name] ?? current[name] ?? DEFAULT_PROCGEN_POPULATION[name]);
    result[name] = Number.isFinite(value) ? Math.max(0, Math.min(maximum, name === 'spawnBeatTicks' ? value : Math.trunc(value))) : (current[name] ?? DEFAULT_PROCGEN_POPULATION[name]);
  }
  return result;
};

class ProcgenPopulationPolicy {
  constructor(laneCount, releaseIntervalTicks = 54, settings = {}, explicitInterval = false) {
    this.laneCount = laneCount; this.settings = { ...DEFAULT_PROCGEN_POPULATION, ...settings, ...normalizePopulationPolicy(settings) };
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
    if (!this.settings.scoutsEvery) return false;
    const every = this.settings.scoutsEvery;
    return (spawnOrdinal + mix(laneSeed) % every) % every === 0;
  }
  scoutAbilities(laneSeed, spawnOrdinal) {
    if (!this.isScout(laneSeed, spawnOrdinal)) return 0;
    const cycle = Math.floor(spawnOrdinal / this.settings.scoutsEvery);
    const choice = mix(laneSeed ^ Math.imul(cycle + 1, 0x85ebca6b)) % 8;
    return choice < 3 ? 1 : choice < 6 ? 2 : 3;
  }
  setSettings(next = {}) {
    Object.assign(this.settings, normalizePopulationPolicy(next, this.settings));
    return normalizePopulationPolicy({}, this.settings);
  }
  scoutReady(actor, tick) { return !!actor.scout && tick - actor.spawnTick >= Math.max(0, this.settings.scoutDelayTicks); }
  snapshot() { return { adaptive: this.adaptive, baseIntervalTicks: this.baseInterval, intervalTicks: this.intervalTicks,
    populationHighWater: this.populationHighWater, nextCohortTick: this.nextCohortTick,
    scoutsEvery: this.settings.scoutsEvery, scoutDelayTicks: this.settings.scoutDelayTicks, spawnSpreadTicks: this.settings.spawnSpreadTicks, spawnBeatTicks: this.settings.spawnBeatTicks }; }
}
export { DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy, ProcgenPopulationPolicy };
