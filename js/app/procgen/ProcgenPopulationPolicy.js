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

// Births use the same generation-relative beat zero as musical transport. Clamp
// grid indices, never realized ticks: a spread endpoint may not be on the grid.
const quantizeProcgenSpawnTick = (targetTick, originTick, beatTicks, minimumTick = 0, maximumTick = Infinity) => {
  const minimum = Math.ceil(minimumTick), maximum = Math.floor(maximumTick), quarterBeat = beatTicks / 4;
  if (maximum < minimum) return null;
  if (!(quarterBeat > 1)) return Math.max(minimum, Math.min(maximum, Math.round(targetTick)));
  let first = Math.ceil((minimum - originTick - 0.5) / quarterBeat);
  let last = Math.ceil((maximum - originTick + 0.5) / quarterBeat) - 1;
  // Correct the boundary index if division rounded across a half-tick tie.
  if (Math.round(originTick + first * quarterBeat) < minimum) first++;
  if (Number.isFinite(maximum) && Math.round(originTick + last * quarterBeat) > maximum) last--;
  if (last < first) return null;
  const index = Math.max(first, Math.min(last, Math.round((targetTick - originTick) / quarterBeat)));
  return Math.round(originTick + index * quarterBeat);
};

class ProcgenPopulationPolicy {
  constructor(laneCount, releaseIntervalTicks = 54, settings = {}, explicitInterval = false) {
    this.laneCount = laneCount; this.settings = { ...DEFAULT_PROCGEN_POPULATION, ...settings, ...normalizePopulationPolicy(settings) };
    this.adaptive = settings.adaptive !== false && !explicitInterval;
    this.baseInterval = Math.max(1, Math.round(releaseIntervalTicks * (this.adaptive && laneCount > this.settings.highLaneThreshold ? this.settings.highLaneMultiplier : 1)));
    this.reset(0);
  }
  reset(generationStartTick) {
    this.generationStartTick = generationStartTick; this.intervalTicks = this.baseInterval; this.populationHighWater = 0;
    this.cohortBeatTicks = this.settings.spawnBeatTicks; this.cohortSpreadTicks = this.settings.spawnSpreadTicks;
    this.cohortStartTick = quantizeProcgenSpawnTick(generationStartTick + 1, generationStartTick, this.cohortBeatTicks, generationStartTick + 1);
    this.cohortDeferredTicks = this.cohortStartTick - generationStartTick - 1;
    this.cohortIntervalTicks = this.cohortStartTick - generationStartTick; this._lastTick = generationStartTick;
    this._cohortStarted = false; this._cohortMinimumTick = generationStartTick + 1; this._previousCohortStartTick = generationStartTick;
    this._scheduleNextCohort();
  }
  _scheduleNextCohort() {
    const minimum = Math.max(this.cohortStartTick + this.intervalTicks, this._lastTick + 1);
    this.nextCohortBeatTicks = this.settings.spawnBeatTicks; this.nextCohortSpreadTicks = this.settings.spawnSpreadTicks;
    this.nextCohortTick = quantizeProcgenSpawnTick(minimum, this.generationStartTick, this.nextCohortBeatTicks, minimum);
    this.nextCohortDeferredTicks = this.nextCohortTick - this.cohortStartTick - this.intervalTicks;
  }
  phaseAt(tick, liveActors) {
    this._lastTick = tick;
    if (tick < this.cohortStartTick) return -1;
    if (tick >= this.nextCohortTick) {
      const previousStart = this.cohortStartTick, previousInterval = this.intervalTicks;
      this._previousCohortStartTick = previousStart; this._cohortMinimumTick = previousStart + previousInterval; this._cohortStarted = false;
      // A late observation does not replay missed beat-grid cohorts in a burst.
      // Legacy unquantized schedules retain their existing skipped-cohort math.
      this.cohortStartTick = this.nextCohortBeatTicks > 0
        ? quantizeProcgenSpawnTick(tick, this.generationStartTick, this.nextCohortBeatTicks, tick)
        : this.nextCohortTick + Math.floor((tick - this.nextCohortTick) / this.intervalTicks) * this.intervalTicks;
      this.cohortBeatTicks = this.nextCohortBeatTicks; this.cohortSpreadTicks = this.nextCohortSpreadTicks;
      this.cohortIntervalTicks = this.cohortStartTick - previousStart;
      this.cohortDeferredTicks = this.cohortBeatTicks > 0 ? this.cohortStartTick - previousStart - previousInterval : 0;
      this.populationHighWater = Math.max(this.populationHighWater, Math.max(0, liveActors));
      if (this.adaptive) {
        const load = this.populationHighWater / Math.max(1, this.laneCount * this.settings.targetLivePerLane);
        const maximum = Math.max(1, this.settings.maximumMultiplier), factor = 1 + (maximum - 1) * load / (1 + load);
        const target = this.baseInterval * factor, easing = Math.max(0, Math.min(1, this.settings.easing));
        this.intervalTicks = Math.max(this.intervalTicks, Math.min(Math.ceil(this.baseInterval * maximum), Math.round(this.intervalTicks + (target - this.intervalTicks) * easing)));
      }
      this._scheduleNextCohort();
    }
    if (tick < this.cohortStartTick) return -1;
    this._cohortStarted = true;
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
    if (!this._cohortStarted) {
      const minimum = Math.max(this._cohortMinimumTick, this._lastTick + 1);
      this.cohortBeatTicks = this.settings.spawnBeatTicks; this.cohortSpreadTicks = this.settings.spawnSpreadTicks;
      this.cohortStartTick = quantizeProcgenSpawnTick(minimum, this.generationStartTick, this.cohortBeatTicks, minimum);
      this.cohortIntervalTicks = this.cohortStartTick - this._previousCohortStartTick;
      this.cohortDeferredTicks = this.cohortBeatTicks > 0 ? this.cohortStartTick - this._cohortMinimumTick : 0;
    }
    this._scheduleNextCohort();
    return normalizePopulationPolicy({}, this.settings);
  }
  scoutReady(actor, tick) { return !!actor.scout && tick - actor.spawnTick >= Math.max(0, this.settings.scoutDelayTicks); }
  snapshot() { return { adaptive: this.adaptive, baseIntervalTicks: this.baseInterval, intervalTicks: this.intervalTicks,
    populationHighWater: this.populationHighWater, generationStartTick: this.generationStartTick, cohortStartTick: this.cohortStartTick,
    cohortIntervalTicks: this.cohortIntervalTicks, cohortDeferredTicks: this.cohortDeferredTicks, cohortBeatTicks: this.cohortBeatTicks, cohortSpreadTicks: this.cohortSpreadTicks,
    nextCohortTick: this.nextCohortTick, nextCohortDeferredTicks: this.nextCohortDeferredTicks,
    scoutsEvery: this.settings.scoutsEvery, scoutDelayTicks: this.settings.scoutDelayTicks, spawnSpreadTicks: this.settings.spawnSpreadTicks, spawnBeatTicks: this.settings.spawnBeatTicks }; }
}
export { DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy, quantizeProcgenSpawnTick, ProcgenPopulationPolicy };
