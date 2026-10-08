const DEFAULT_STALL_POLICY = Object.freeze({ secondsWithoutProgress: 90, baseSpawnAllowance: 12,
  distanceGrowthPixels: 1200, additionalSpawnsPerGrowth: 4, maxSpawnAllowance: 64,
  transitSafetyFactor: 1.75, initialTicksPerPixel: 2, releaseIntervalTicks: 54, cascadeMinTicks: 1, cascadeMaxTicks: 2, ticksPerSecond: 1000 / 60,
  pileMinimumActors: 4, pileGrowthActors: 2, pileMinimumNonProgressSeconds: 12, pileSecondsWithoutProgress: 45,
  pileMaxSeconds: 180, pileSecondsPerGrowth: 15, workGraceSeconds: 10 });
const PILE_COLUMNS = 16, PILE_ROWS = 4, PILE_CELL_WIDTH = 24, PILE_SLOTS = PILE_COLUMNS * PILE_ROWS;
const WORK_ACTIONS = new Set(['building', 'bashing', 'mining', 'digging']);
class ProcgenStallPolicy {
  constructor(laneCount, settings = {}, previousDistances = []) {
    this.settings = { ...DEFAULT_STALL_POLICY, ...settings };
    this.lanes = Array.from({ length: laneCount }, (_, lane) => ({ maxX: 36, bestDistance: previousDistances[lane] || 0,
      previousDistance: previousDistances[lane] || 0, lastProgressTick: 0, spawnsSinceProgress: 0, spawned: 0, alive: 0,
      transitTicksPerPixel: this.settings.initialTicksPerPixel, probeSpawnTick: null, reason: null,
      peakAlive: 0, lowestSurvivingActorId: null, buildingCount: 0, bashingCount: 0, floatingCount: 0, diggingCount: 0, blockingCount: 0,
      busyActors: 0, workStartedTick: null, lastTerrainActivityTick: -Infinity, pendingTerrainWork: 0, activeWork: false,
      pileCount: 0, pileStartTick: null, pileInitialCount: 0, pilePeakCount: 0, pileGrowing: false,
      pileMinX: null, pileMaxX: null, pileMinY: null, pileMaxY: null }));
    this._pileCounts = new Uint16Array(laneCount * PILE_SLOTS);
    this._pileCells = new Int32Array(this._pileCounts.length);
    this.phase = 'running'; this.cascade = []; this.cursor = 0; this.restartReady = false;
  }
  allowance(lane) { const s = this.settings; return Math.min(s.maxSpawnAllowance, s.baseSpawnAllowance + Math.floor(Math.max(0, lane.maxX - 36) / s.distanceGrowthPixels) * s.additionalSpawnsPerGrowth); }
  transitTicks(lane) {
    return Math.ceil(Math.max(0, lane.maxX - 36) * Math.max(1, lane.transitTicksPerPixel) * this.settings.transitSafetyFactor);
  }
  graceTicks(lane) { return this.settings.secondsWithoutProgress * this.settings.ticksPerSecond + this.transitTicks(lane); }
  pileGraceTicks(lane) {
    const s = this.settings, difficulty = Math.floor(Math.max(0, lane.maxX - 36) / s.distanceGrowthPixels);
    return Math.min(s.pileMaxSeconds, s.pileSecondsWithoutProgress + difficulty * s.pileSecondsPerGrowth) * s.ticksPerSecond;
  }
  spawn(laneIndex, tick = 0) {
    const lane = this.lanes[laneIndex]; lane.spawned++; lane.spawnsSinceProgress++;
    if (lane.probeSpawnTick == null) lane.probeSpawnTick = tick;
  }
  _resetPile(lane) {
    lane.pileCount = 0; lane.pileStartTick = null; lane.pileInitialCount = 0; lane.pilePeakCount = 0; lane.pileGrowing = false;
    lane.pileMinX = null; lane.pileMaxX = null; lane.pileMinY = null; lane.pileMaxY = null;
  }
  _binCount(laneIndex, cell, row) {
    if (row >= PILE_ROWS) return 0;
    const index = laneIndex * PILE_SLOTS + row * PILE_COLUMNS + (cell & (PILE_COLUMNS - 1));
    return this._pileCells[index] === cell ? this._pileCounts[index] : 0;
  }
  _summarizePile(lane, laneIndex, tick) {
    if (lane.lastProgressTick === tick) { this._resetPile(lane); return; }
    let peak = 0, peakCell = 0, peakRow = 0;
    for (let row = 0; row < PILE_ROWS; row++) for (let column = 0; column < PILE_COLUMNS; column++) {
      const index = laneIndex * PILE_SLOTS + row * PILE_COLUMNS + column;
      if (!this._pileCounts[index]) continue;
      const cell = this._pileCells[index];
      if (cell * PILE_CELL_WIDTH + PILE_CELL_WIDTH < lane.maxX - PILE_COLUMNS * PILE_CELL_WIDTH / 2) continue;
      const count = this._pileCounts[index] + this._binCount(laneIndex, cell + 1, row) +
        this._binCount(laneIndex, cell, row + 1) + this._binCount(laneIndex, cell + 1, row + 1);
      if (count > peak) { peak = count; peakCell = cell; peakRow = row; }
    }
    if (peak < this.settings.pileMinimumActors) { this._resetPile(lane); return; }
    if (lane.pileStartTick == null) { lane.pileStartTick = tick; lane.pileInitialCount = peak; }
    lane.pileCount = peak; lane.pilePeakCount = Math.max(lane.pilePeakCount, peak);
    lane.pileGrowing = lane.pilePeakCount >= lane.pileInitialCount + this.settings.pileGrowthActors;
    lane.pileMinX = peakCell * PILE_CELL_WIDTH; lane.pileMaxX = lane.pileMinX + PILE_CELL_WIDTH * 2;
    lane.pileMinY = peakRow * PILE_CELL_WIDTH; lane.pileMaxY = Math.min(96, lane.pileMinY + PILE_CELL_WIDTH * 2);
  }
  update(actors, tick, work = null) {
    this._pileCounts.fill(0);
    for (const lane of this.lanes) { lane.alive = 0; lane.busyActors = 0; }
    for (const actor of actors) {
      const lane = this.lanes[actor.laneIndex];
      if (actor.removed || actor.failureReason) continue;
      lane.alive++;
      if (WORK_ACTIONS.has(actor.action?.actionName)) lane.busyActors++;
      if (actor.x > lane.maxX) {
        lane.maxX = actor.x; lane.lastProgressTick = tick; lane.spawnsSinceProgress = 0; lane.probeSpawnTick = null; lane.reason = null; lane.workStartedTick = null;
        if (Number.isFinite(actor.spawnTick) && actor.x > 100) {
          const observed = (tick - actor.spawnTick) / (actor.x - 36);
          lane.transitTicksPerPixel = Math.max(lane.transitTicksPerPixel, observed);
        }
      }
      lane.bestDistance = Math.max(lane.bestDistance, lane.maxX - 36);
      const lastProgress = actor.lastProgressTick ?? actor.spawnTick ?? tick;
      if (tick - lastProgress < this.settings.pileMinimumNonProgressSeconds * this.settings.ticksPerSecond ||
          actor.x < lane.maxX - PILE_COLUMNS * PILE_CELL_WIDTH / 2 || !Number.isFinite(actor.y)) continue;
      const cell = Math.floor(actor.x / PILE_CELL_WIDTH), row = Math.max(0, Math.min(PILE_ROWS - 1, Math.floor((actor.y - actor.laneIndex * 96) / PILE_CELL_WIDTH)));
      const index = actor.laneIndex * PILE_SLOTS + row * PILE_COLUMNS + (cell & (PILE_COLUMNS - 1));
      if (!this._pileCounts[index] || this._pileCells[index] !== cell) { this._pileCells[index] = cell; this._pileCounts[index] = 0; }
      if (this._pileCounts[index] < 65535) this._pileCounts[index]++;
    }
    let allStalled = true;
    for (let laneIndex = 0; laneIndex < this.lanes.length; laneIndex++) {
      const lane = this.lanes[laneIndex];
      lane.peakAlive = Math.max(lane.peakAlive, lane.alive);
      this._summarizePile(lane, laneIndex, tick);
      lane.lastTerrainActivityTick = work?.terrainActivityTicks?.[laneIndex] ?? -Infinity;
      lane.pendingTerrainWork = work?.pendingTerrainWork?.[laneIndex] || 0;
      if (lane.busyActors && lane.workStartedTick == null) lane.workStartedTick = tick;
      const workGrace = this.settings.workGraceSeconds * this.settings.ticksPerSecond;
      lane.activeWork = lane.pendingTerrainWork > 0 || tick - lane.lastTerrainActivityTick <= workGrace ||
        lane.busyActors > 0 && tick - lane.workStartedTick <= workGrace;
      const windowStart = Math.max(lane.lastProgressTick, lane.probeSpawnTick ?? lane.lastProgressTick, lane.lastTerrainActivityTick);
      const probesReady = lane.spawnsSinceProgress >= this.allowance(lane) && tick - windowStart >= this.transitTicks(lane);
      const growingPile = lane.pileGrowing && tick - lane.pileStartTick >= this.pileGraceTicks(lane);
      const stalled = !lane.activeWork && probesReady && (growingPile || tick - windowStart >= this.graceTicks(lane));
      lane.reason = stalled ? (lane.alive ? growingPile ? 'sustained-growing-pile' : 'frontier-probe-grace-exhausted' : 'no-survivors-after-grace') : null;
      if (!stalled) allStalled = false;
    }
    if (this.phase === 'running' && allStalled && actors.length) {
      this.phase = 'cascade';
      let due = tick;
      for (const actor of actors) {
        if (actor.removed || actor.failureReason) continue;
        this.cascade.push({ id: actor.id, tick: due });
        due += this.settings.cascadeMinTicks + (actor.id % (this.settings.cascadeMaxTicks - this.settings.cascadeMinTicks + 1));
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
    estimatedTransitTicks: this.transitTicks(lane), requiredGraceTicks: this.graceTicks(lane), pileRequiredTicks: this.pileGraceTicks(lane),
    pileDeadlineTick: lane.pileStartTick == null ? null : lane.pileStartTick + this.pileGraceTicks(lane),
    probeDeadlineTick: Math.max(lane.lastProgressTick, lane.probeSpawnTick ?? lane.lastProgressTick, lane.lastTerrainActivityTick) + this.graceTicks(lane),
    distance: Math.max(0, lane.maxX - 36), spawnAllowance: this.allowance(lane), secondsWithoutProgress: Math.max(0, tick - lane.lastProgressTick) / this.settings.ticksPerSecond })) }; }
}
export { DEFAULT_STALL_POLICY, ProcgenStallPolicy };
