import { causalRandomDecision } from './workstation/CausalRandom.js';
import { validateReleaseGesture } from './ReleaseGesture.js';
const DEFAULT_PROCGEN_POPULATION = Object.freeze({ highLaneThreshold: 64, highLaneMultiplier: 1.5,
  targetLivePerLane: 8, maximumMultiplier: 4, easing: 0.25, scoutsEvery: 8, scoutDelayTicks: 180, spawnSpreadTicks: 12, spawnBeatTicks: 0 });

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
    this.releaseGesture = null; this.pendingReleaseGesture = null; this.cohortReleaseGesture = null; this.gestureRun = null; this.releaseGestureCommandId = null; this.pendingGestureCommandId = null;
    this.reset(0);
  }
  reset(generationStartTick) {
    this.pendingReleaseGesture = null; this.pendingGestureCommandId = null; this.cohortReleaseGesture = null;
    if (this.releaseGesture?.finiteBurstCount != null) { this.gestureRun = { remaining: 0, admitted: 0, missed: 0, cohortOrdinal: -1, status: 'generation-discarded' }; }
    else if (this.releaseGesture) this.gestureRun = { remaining: null, admitted: 0, missed: 0, cohortOrdinal: -1, status: this.releaseGesture.paused ? 'paused' : 'active' };
    this.generationStartTick = generationStartTick; this.intervalTicks = this.baseInterval; this.populationHighWater = 0;
    this.cohortReleaseGesture = this.releaseGesture; if (this.releaseGesture) this.gestureRun.cohortOrdinal = 0;
    this.cohortBeatTicks = this.releaseGesture ? 0 : this.settings.spawnBeatTicks; this.cohortSpreadTicks = this.releaseGesture?.spreadTicks ?? this.settings.spawnSpreadTicks;
    this.cohortStartTick = quantizeProcgenSpawnTick(generationStartTick + 1, generationStartTick, this.cohortBeatTicks, generationStartTick + 1);
    this.cohortDeferredTicks = this.cohortStartTick - generationStartTick - 1;
    this.cohortIntervalTicks = this.cohortStartTick - generationStartTick; this._lastTick = generationStartTick;
    this._cohortStarted = false; this._cohortMinimumTick = generationStartTick + 1; this._previousCohortStartTick = generationStartTick;
    this._scheduleNextCohort();
  }
  _scheduleNextCohort() {
    const gesture = this.pendingReleaseGesture || this.releaseGesture;
    const interval = this.pendingReleaseGesture ? gesture.nominalGapTicks : this.intervalTicks;
    const minimum = Math.max(this.cohortStartTick + interval, this.cohortStartTick + Math.min(this.cohortSpreadTicks, this.intervalTicks - 1) + 1, this._lastTick + 1);
    this.nextCohortBeatTicks = gesture ? 0 : this.settings.spawnBeatTicks; this.nextCohortSpreadTicks = gesture ? gesture.spreadTicks : this.settings.spawnSpreadTicks;
    this.nextCohortTick = quantizeProcgenSpawnTick(minimum, this.generationStartTick, this.nextCohortBeatTicks, minimum);
    this.nextCohortDeferredTicks = this.nextCohortTick - this.cohortStartTick - interval;
  }
  phaseAt(tick, liveActors) {
    this._lastTick = tick;
    if (tick < this.cohortStartTick) return -1;
    if (tick >= this.nextCohortTick) {
      if (this.releaseGesture && !this.pendingReleaseGesture && !Number.isSafeInteger(this.gestureRun.cohortOrdinal + 1)) throw new RangeError('Release cohort identity exhausted.');
      const previousStart = this.cohortStartTick, previousInterval = this.intervalTicks;
      if (this.pendingReleaseGesture) { this.releaseGesture = this.pendingReleaseGesture; this.releaseGestureCommandId = this.pendingGestureCommandId; this.pendingReleaseGesture = null; this.pendingGestureCommandId = null; this.baseInterval = this.releaseGesture.nominalGapTicks; this.intervalTicks = this.baseInterval; this.adaptive = this.releaseGesture.clockMode === 'adaptive'; this.gestureRun = { remaining: this.releaseGesture.finiteBurstCount, admitted: 0, missed: 0, cohortOrdinal: -1, status: this.releaseGesture.paused ? 'paused' : 'active' }; }
      if (this.releaseGesture) { this.cohortReleaseGesture = this.releaseGesture; this.gestureRun.cohortOrdinal++; }
      this._previousCohortStartTick = previousStart; this._cohortMinimumTick = previousStart + previousInterval; this._cohortStarted = false;
      // A late observation does not replay missed beat-grid cohorts in a burst.
      // Legacy unquantized schedules retain their existing skipped-cohort math.
      this.cohortStartTick = this.releaseGesture ? Math.max(tick, this.nextCohortTick) : this.nextCohortBeatTicks > 0
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
  initializeReleaseGesture(value) {
    if (this._lastTick !== this.generationStartTick || this._cohortStarted || this.releaseGesture || this.pendingReleaseGesture) throw new Error('Initial release policy must be installed before any cohort or gesture exists.');
    const gesture = validateReleaseGesture(value, this.laneCount);
    this.releaseGesture = this.cohortReleaseGesture = gesture; this.baseInterval = this.intervalTicks = gesture.nominalGapTicks; this.adaptive = gesture.clockMode === 'adaptive';
    this.gestureRun = { remaining: gesture.finiteBurstCount, admitted: 0, missed: 0, cohortOrdinal: 0, status: gesture.paused ? 'paused' : 'active' };
    this.cohortStartTick = this.generationStartTick + 1; this.cohortSpreadTicks = gesture.spreadTicks; this.cohortBeatTicks = this.cohortDeferredTicks = 0; this.cohortIntervalTicks = 1;
    this._cohortMinimumTick = this.cohortStartTick; this._previousCohortStartTick = this.generationStartTick; this._scheduleNextCohort();
    return { status: 'initialized', effectiveBoundary: this.cohortStartTick, source: 'authored-initial-world;not-a-live-intervention' };
  }
  setReleaseGesture(value, commandId = null) {
    const gesture = validateReleaseGesture(value, this.laneCount), latest = this.pendingReleaseGesture || this.releaseGesture;
    if (latest?.id === gesture.id && gesture.revision <= latest.revision) { if (JSON.stringify(latest) === JSON.stringify(gesture)) return { status: 'unchanged', effectiveBoundary: this.nextCohortTick }; throw new Error('A changed release gesture requires a newer revision.'); }
    this.pendingReleaseGesture = gesture; this.pendingGestureCommandId = commandId; this._scheduleNextCohort(); return { status: 'pending', effectiveBoundary: this.nextCohortTick, admittedCohortUnchanged: true };
  }
  admitGestureSlot(capacityAvailable) {
    const gesture = this.cohortReleaseGesture, run = this.gestureRun; if (!gesture) return { status: capacityAvailable ? 'admitted' : 'missed', reason: capacityAvailable ? null : 'population-cap' };
    if (gesture.paused || run.status === 'generation-discarded') return { status: 'suppressed', reason: gesture.paused ? 'gesture-paused' : 'generation-discarded' };
    if (run.remaining === 0) { run.status = 'exhausted'; return { status: 'suppressed', reason: 'finite-gesture-exhausted' }; }
    if (!Number.isSafeInteger((capacityAvailable ? run.admitted : run.missed) + 1)) throw new RangeError('Release gesture outcome counter exhausted.'); if (run.remaining != null) run.remaining--; if (capacityAvailable) run.admitted++; else run.missed++; if (run.remaining === 0) run.status = 'exhausted';
    return { status: capacityAvailable ? 'admitted' : 'missed', reason: capacityAvailable ? null : 'population-cap', gestureId: gesture.id, gestureRevision: gesture.revision, remainingAttempts: run.remaining };
  }
  scoutDecision(laneSeed, spawnOrdinal) {
    if (!Number.isSafeInteger(spawnOrdinal) || spawnOrdinal < 0) throw new Error('Invalid stable scout birth ordinal.');
    if (!this.settings.scoutsEvery) return Object.freeze({ version: 1, selected: false, abilities: 0, reason: 'scouts-disabled' });
    const every = this.settings.scoutsEvery, cadence = causalRandomDecision({ seed: laneSeed, namespace: 'population', mappingId: 'scout-admission', generation: 0, stableCauseId: 'lane-cadence', drawPurpose: 'scout-phase' });
    const selected = (spawnOrdinal + cadence.drawUint32 % every) % every === 0;
    if (!selected) return Object.freeze({ version: 1, selected, abilities: 0, cadence, spawnOrdinal });
    const variation = causalRandomDecision({ seed: laneSeed, namespace: 'population', mappingId: 'scout-admission', generation: 0, stableCauseId: `cycle:${Math.floor(spawnOrdinal / every)}`, drawPurpose: 'scout-abilities' }), choice = variation.drawUint32 % 8;
    return Object.freeze({ version: 1, selected, abilities: choice < 3 ? 1 : choice < 6 ? 2 : 3, cadence, variation, spawnOrdinal });
  }
  isScout(laneSeed, spawnOrdinal) { return this.scoutDecision(laneSeed, spawnOrdinal).selected; }
  scoutAbilities(laneSeed, spawnOrdinal) { return this.scoutDecision(laneSeed, spawnOrdinal).abilities; }
  setSettings(next = {}) {
    Object.assign(this.settings, normalizePopulationPolicy(next, this.settings));
    if (!this._cohortStarted && !this.releaseGesture && !this.pendingReleaseGesture) {
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
  snapshot() { return { releaseGesture: this.releaseGesture, pendingReleaseGesture: this.pendingReleaseGesture, cohortReleaseGesture: this.cohortReleaseGesture, gestureRun: this.gestureRun && { ...this.gestureRun }, releaseGestureCommandId: this.releaseGestureCommandId, nextAdmissionBoundary: this.nextCohortTick, adaptive: this.adaptive, baseIntervalTicks: this.baseInterval, intervalTicks: this.intervalTicks,
    populationHighWater: this.populationHighWater, generationStartTick: this.generationStartTick, cohortStartTick: this.cohortStartTick,
    cohortIntervalTicks: this.cohortIntervalTicks, cohortDeferredTicks: this.cohortDeferredTicks, cohortBeatTicks: this.cohortBeatTicks, cohortSpreadTicks: this.cohortSpreadTicks,
    nextCohortTick: this.nextCohortTick, nextCohortDeferredTicks: this.nextCohortDeferredTicks,
    scoutsEvery: this.settings.scoutsEvery, scoutDelayTicks: this.settings.scoutDelayTicks, spawnSpreadTicks: this.settings.spawnSpreadTicks, spawnBeatTicks: this.settings.spawnBeatTicks }; }
}
export { DEFAULT_PROCGEN_POPULATION, normalizePopulationPolicy, quantizeProcgenSpawnTick, ProcgenPopulationPolicy };
