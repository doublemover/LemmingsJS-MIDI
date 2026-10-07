const DEFAULT_STALL_POLICY = Object.freeze({ secondsWithoutProgress: 90, baseSpawnAllowance: 12,
  distanceGrowthPixels: 1200, additionalSpawnsPerGrowth: 4, maxSpawnAllowance: 64,
  releaseIntervalTicks: 54, cascadeMinTicks: 1, cascadeMaxTicks: 2, ticksPerSecond: 1000 / 60 });
class ProcgenStallPolicy {
  constructor(laneCount, settings = {}, previousDistances = []) {
    this.settings = { ...DEFAULT_STALL_POLICY, ...settings };
    this.lanes = Array.from({ length: laneCount }, (_, lane) => ({ maxX: 36, bestDistance: previousDistances[lane] || 0,
      previousDistance: previousDistances[lane] || 0, lastProgressTick: 0, spawnsSinceProgress: 0, spawned: 0, alive: 0 }));
    this.phase = 'running'; this.cascade = []; this.cursor = 0; this.restartReady = false;
  }
  allowance(lane) { const s = this.settings; return Math.min(s.maxSpawnAllowance, s.baseSpawnAllowance + Math.floor(Math.max(0, lane.maxX - 36) / s.distanceGrowthPixels) * s.additionalSpawnsPerGrowth); }
  spawn(laneIndex) { const lane = this.lanes[laneIndex]; lane.spawned++; lane.spawnsSinceProgress++; }
  update(actors, tick) {
    for (const lane of this.lanes) lane.alive = 0;
    for (const actor of actors) {
      const lane = this.lanes[actor.laneIndex];
      if (actor.removed || actor.failureReason) continue;
      lane.alive++;
      if (actor.x > lane.maxX) { lane.maxX = actor.x; lane.lastProgressTick = tick; lane.spawnsSinceProgress = 0; }
      lane.bestDistance = Math.max(lane.bestDistance, lane.maxX - 36);
    }
    if (this.phase === 'running') {
      const allStalled = this.lanes.every(lane => lane.alive === 0 ||
        lane.spawnsSinceProgress >= this.allowance(lane) && tick - lane.lastProgressTick >= this.settings.secondsWithoutProgress * this.settings.ticksPerSecond);
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
    distance: Math.max(0, lane.maxX - 36), spawnAllowance: this.allowance(lane), secondsWithoutProgress: Math.max(0, tick - lane.lastProgressTick) / this.settings.ticksPerSecond })) }; }
}
export { DEFAULT_STALL_POLICY, ProcgenStallPolicy };
