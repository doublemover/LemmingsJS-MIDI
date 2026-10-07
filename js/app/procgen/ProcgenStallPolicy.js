const DEFAULT_STALL_POLICY = Object.freeze({ secondsWithoutProgress: 90, baseSpawnAllowance: 12,
  distanceGrowthPixels: 1200, additionalSpawnsPerGrowth: 4, maxSpawnAllowance: 64,
  transitSafetyFactor: 1.75, initialTicksPerPixel: 2, releaseIntervalTicks: 54, cascadeMinTicks: 1, cascadeMaxTicks: 2, ticksPerSecond: 1000 / 60 });
class ProcgenStallPolicy {
  constructor(laneCount, settings = {}, previousDistances = []) {
    this.settings = { ...DEFAULT_STALL_POLICY, ...settings };
    this.lanes = Array.from({ length: laneCount }, (_, lane) => ({ maxX: 36, bestDistance: previousDistances[lane] || 0,
      previousDistance: previousDistances[lane] || 0, lastProgressTick: 0, spawnsSinceProgress: 0, spawned: 0, alive: 0,
      transitTicksPerPixel: this.settings.initialTicksPerPixel, probeSpawnTick: null, reason: null }));
    this.phase = 'running'; this.cascade = []; this.cursor = 0; this.restartReady = false;
  }
  allowance(lane) { const s = this.settings; return Math.min(s.maxSpawnAllowance, s.baseSpawnAllowance + Math.floor(Math.max(0, lane.maxX - 36) / s.distanceGrowthPixels) * s.additionalSpawnsPerGrowth); }
  transitTicks(lane) {
    return Math.ceil(Math.max(0, lane.maxX - 36) * Math.max(1, lane.transitTicksPerPixel) * this.settings.transitSafetyFactor);
  }
  graceTicks(lane) { return this.settings.secondsWithoutProgress * this.settings.ticksPerSecond + this.transitTicks(lane); }
  spawn(laneIndex, tick = 0) {
    const lane = this.lanes[laneIndex]; lane.spawned++; lane.spawnsSinceProgress++;
    if (lane.probeSpawnTick == null) lane.probeSpawnTick = tick;
  }
  update(actors, tick) {
    for (const lane of this.lanes) lane.alive = 0;
    for (const actor of actors) {
      const lane = this.lanes[actor.laneIndex];
      if (actor.removed || actor.failureReason) continue;
      lane.alive++;
      if (actor.x > lane.maxX) {
        lane.maxX = actor.x; lane.lastProgressTick = tick; lane.spawnsSinceProgress = 0; lane.probeSpawnTick = null; lane.reason = null;
        if (Number.isFinite(actor.spawnTick) && actor.x > 100) {
          const observed = (tick - actor.spawnTick) / (actor.x - 36);
          lane.transitTicksPerPixel = Math.max(lane.transitTicksPerPixel, observed);
        }
      }
      lane.bestDistance = Math.max(lane.bestDistance, lane.maxX - 36);
    }
    if (this.phase === 'running') {
      const allStalled = this.lanes.every(lane => {
        const windowStart = Math.max(lane.lastProgressTick, lane.probeSpawnTick ?? lane.lastProgressTick);
        const stalled = lane.spawnsSinceProgress >= this.allowance(lane) && tick - windowStart >= this.graceTicks(lane);
        lane.reason = stalled ? (lane.alive ? 'frontier-probe-grace-exhausted' : 'no-survivors-after-grace') : null;
        return stalled;
      });
      if (allStalled && actors.length) {
        this.phase = 'cascade';
        let due = tick;
        for (const actor of actors) {
          if (actor.removed || actor.failureReason) continue;
          this.cascade.push({ id: actor.id, tick: due });
          due += this.settings.cascadeMinTicks + (actor.id % (this.settings.cascadeMaxTicks - this.settings.cascadeMinTicks + 1));
        }
      }
    }
    if (this.phase === 'cascade' && this.lanes.every(lane => lane.alive === 0)) {
      this.phase = 'finished'; this.restartReady = true;
    }
  }
  takeDue(tick) {
    const ids = [];
    while (this.cursor < this.cascade.length && this.cascade[this.cursor].tick <= tick) ids.push(this.cascade[this.cursor++].id);
    return ids;
  }
  consumeRestart() { if (!this.restartReady) return null; this.restartReady = false; return this.lanes.map(lane => Math.max(lane.previousDistance, lane.maxX - 36)); }
  snapshot(tick) { return { phase: this.phase, settings: this.settings, lanes: this.lanes.map(lane => ({ ...lane,
    estimatedTransitTicks: this.transitTicks(lane), requiredGraceTicks: this.graceTicks(lane),
    probeDeadlineTick: Math.max(lane.lastProgressTick, lane.probeSpawnTick ?? lane.lastProgressTick) + this.graceTicks(lane),
    distance: Math.max(0, lane.maxX - 36), spawnAllowance: this.allowance(lane), secondsWithoutProgress: Math.max(0, tick - lane.lastProgressTick) / this.settings.ticksPerSecond })) }; }
}
export { DEFAULT_STALL_POLICY, ProcgenStallPolicy };
