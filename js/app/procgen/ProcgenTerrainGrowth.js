const EMPTY_STATE = Object.freeze({ active: new Uint8Array(0), complete: false, revision: 0 });
const MAX_PIECES_PER_CHUNK = 32;
const MAX_LOCAL_COVERAGE_RANGES = 4;
class ProcgenTerrainGrowth {
  constructor(laneCount, chunkWidth) {
    this.chunkWidth = chunkWidth;
    this.preparationBudget = Math.min(16, Math.max(4, Math.ceil(laneCount / 64)));
    this.revealBudget = Math.min(1024, Math.max(8, laneCount));
    this.safetyLead = 64;
    this.targetLead = this.safetyLead + 2 * (Math.ceil(laneCount / this.preparationBudget) + MAX_PIECES_PER_CHUNK);
    this.preparationLead = this.targetLead + 2 * Math.ceil(laneCount / this.preparationBudget) + chunkWidth;
    this.preparedThrough = new Float64Array(laneCount); this.pending = new Uint32Array(laneCount);
    this.speed = new Float32Array(laneCount); this.heap = new Int32Array(laneCount); this.priority = new Float64Array(laneCount);
    this.queues = Array.from({ length: laneCount }, () => []); this.completed = Array.from({ length: laneCount }, () => []);
    this.states = new Map(); this.size = 0; this._forcedSinceUpdate = 0; this._forcedPreparedSinceUpdate = 0;
    this.localCoverage = Array.from({ length: laneCount }, () => []);
    this.stats = { prepared: 0, revealed: 0, normalPrepared: 0, normalRevealed: 0, forcedPrepared: 0, forced: 0,
      localRequests: 0, deduplicated: 0, lastPreparationAttempts: 0, lastPrepared: 0, lastRevealed: 0,
      lastForcedPrepared: 0, lastForced: 0, lastTotalPrepared: 0, lastTotalRevealed: 0, minimumMargin: Infinity };
  }
  _key(lane, chunk) { return lane * 0x800000 + chunk; }
  reset(through, frontiers) {
    this.states.clear(); this.size = 0;
    for (let lane = 0; lane < through.length; lane++) {
      through[lane] = Math.ceil((frontiers[lane] + this.targetLead) / this.chunkWidth) * this.chunkWidth;
      this.preparedThrough[lane] = through[lane]; this.queues[lane].length = 0; this.completed[lane] = [[0, through[lane]]]; this.localCoverage[lane].length = 0;
    }
    this.pending.fill(0); this.speed.fill(1); this._forcedSinceUpdate = 0; this._forcedPreparedSinceUpdate = 0;
    this.stats.lastPrepared = this.stats.lastRevealed = this.stats.lastPreparationAttempts = 0;
    this.stats.lastForcedPrepared = this.stats.lastForced = this.stats.lastTotalPrepared = this.stats.lastTotalRevealed = 0;
  }
  stateFor(lane, chunk) {
    const state = this.states.get(this._key(lane, chunk));
    if (state) return state.complete ? null : state;
    const start = chunk * this.chunkWidth;
    return this.completed[lane]?.some(range => start >= range[0] && start + this.chunkWidth <= range[1]) ? null : EMPTY_STATE;
  }
  objectReady(lane, chunk, objectIndex) {
    const state = this.stateFor(lane, chunk);
    if (!state) return true;
    const index = state.plan?.objectJobs?.[objectIndex];
    return Number.isInteger(index) && !!state.active[index];
  }
  _remember(lane, start, end) {
    const ranges = this.completed[lane]; let at = 0;
    while (at < ranges.length && ranges[at][1] < start) at++;
    while (at < ranges.length && ranges[at][0] <= end) { start = Math.min(start, ranges[at][0]); end = Math.max(end, ranges[at][1]); ranges.splice(at, 1); }
    ranges.splice(at, 0, [start, end]);
  }
  _prepare(lane, chunk, prepare) {
    const key = this._key(lane, chunk), previous = this.states.get(key);
    if (previous) return previous;
    if (!this.stateFor(lane, chunk)) return null;
    const result = prepare(lane, chunk), plan = result?.jobs ? result : { jobs: [{ index: 0, kind: 'foundation', x1: 0, x2: this.chunkWidth, dependencies: [] }], objectJobs: [] };
    if (!plan.jobs.length || plan.jobs.length > MAX_PIECES_PER_CHUNK) throw new Error('Terrain growth requires 1-32 source pieces per chunk');
    for (let index = 0; index < plan.jobs.length; index++) {
      const job = plan.jobs[index];
      if (!Number.isFinite(job.x1) || !Number.isFinite(job.x2) || job.x1 < 0 || job.x2 > this.chunkWidth || job.x1 >= job.x2 ||
          job.dependencies?.some(dependency => !Number.isInteger(dependency) || dependency < 0 || dependency >= index)) throw new Error('Invalid terrain construction dependencies');
    }
    const state = { plan, lane, chunk, active: new Uint8Array(plan.jobs.length), complete: false, revision: 0, remaining: plan.jobs.length };
    this.states.set(key, state); this.queues[lane].push(state); this.queues[lane].sort((a, b) => a.chunk - b.chunk); this.stats.prepared++;
    return state;
  }
  _activate(state, index, through, reveal) {
    if (state.active[index]) return false;
    const job = state.plan.jobs[index];
    if (job.dependencies?.some(dependency => !state.active[dependency])) return false;
    state.active[index] = 1; state.revision++; state.remaining--; this.stats.revealed++;
    const previous = through[state.lane]; through[state.lane] = Math.max(previous, state.chunk * this.chunkWidth + job.x2);
    state.complete = state.remaining === 0;
    if (state.complete) this._remember(state.lane, state.chunk * this.chunkWidth, (state.chunk + 1) * this.chunkWidth);
    reveal(state.lane, previous, through[state.lane], state.chunk, job); return true;
  }
  _rememberLocal(lane, x1, x2) {
    const ranges = this.localCoverage[lane];
    for (const range of ranges) if (x1 >= range[0] && x2 <= range[1]) return;
    // These ranges describe monotonic activated jobs, never terrain edits or actor positions.
    // Dropping a memo merely permits another bounded check; it cannot retire geometry.
    const range = ranges.length < MAX_LOCAL_COVERAGE_RANGES ? [] : ranges.shift();
    range[0] = x1; range[1] = x2; ranges.push(range);
  }
  ensureLocal(lane, x, { through, frontiers, prepare, reveal }) {
    if (!Number.isFinite(x) || x < 0 || !Number.isInteger(lane) || lane < 0 || lane >= through.length) return;
    this.stats.localRequests++;
    const x1 = Math.max(0, x - 16), x2 = x + this.safetyLead;
    if (this.localCoverage[lane].some(range => x1 >= range[0] && x2 <= range[1])) { this.stats.deduplicated++; return; }
    const first = Math.max(0, Math.floor(x1 / this.chunkWidth)), last = Math.floor(x2 / this.chunkWidth);
    let needed = x + 8 >= through[lane];
    for (let chunk = first; !needed && chunk <= last; chunk++) needed = this.stateFor(lane, chunk) !== null;
    if (!needed) { this._rememberLocal(lane, first * this.chunkWidth, x2); return; }
    const preparedBefore = this.stats.prepared; let forced = 0;
    for (let chunk = first; chunk <= last; chunk++) {
      const state = this._prepare(lane, chunk, prepare); if (!state) continue;
      const required = new Uint8Array(state.active.length);
      const requireJob = index => { if (required[index] || state.active[index]) return; required[index] = 1; for (const dependency of state.plan.jobs[index].dependencies || []) requireJob(dependency); };
      for (let index = 0; index < state.plan.jobs.length; index++) if (chunk * this.chunkWidth + state.plan.jobs[index].x1 < x2) requireJob(index);
      for (let index = 0; index < state.active.length; index++) if (required[index] && this._activate(state, index, through, reveal)) forced++;
    }
    const prepared = this.stats.prepared - preparedBefore;
    this.preparedThrough[lane] = Math.max(this.preparedThrough[lane], (last + 1) * this.chunkWidth);
    frontiers[lane] = Math.max(frontiers[lane], x); this.stats.forced += forced; this._forcedSinceUpdate += forced;
    this.stats.forcedPrepared += prepared; this._forcedPreparedSinceUpdate += prepared;
    this._rememberLocal(lane, first * this.chunkWidth, x2);
  }
  observe(lane, forwardPixels) { this.speed[lane] = Math.max(this.speed[lane], Math.min(2, forwardPixels)); }
  _push(lane) {
    let at = this.size++;
    while (at > 0) { const parent = (at - 1) >>> 1, other = this.heap[parent]; if (this.priority[other] <= this.priority[lane]) break; this.heap[at] = other; at = parent; }
    this.heap[at] = lane;
  }
  _pop() {
    const lane = this.heap[0], last = this.heap[--this.size]; let at = 0;
    while (at * 2 + 1 < this.size) {
      let child = at * 2 + 1;
      if (child + 1 < this.size && this.priority[this.heap[child + 1]] < this.priority[this.heap[child]]) child++;
      if (this.priority[last] <= this.priority[this.heap[child]]) break;
      this.heap[at] = this.heap[child]; at = child;
    }
    if (this.size) this.heap[at] = last;
    return lane;
  }
  _next(lane, frontier) {
    for (const state of this.queues[lane]) if (!state.complete) for (let index = 0; index < state.active.length; index++) {
      const job = state.plan.jobs[index];
      if (!state.active[index] && !job.dependencies?.some(dependency => !state.active[dependency]) && state.chunk * this.chunkWidth + job.x1 <= frontier + this.targetLead) return { state, index };
    }
    return null;
  }
  update({ through, frontiers, lanes, prepare, reveal }) {
    this.size = 0; let attempts = 0, revealed = 0; const preparedBefore = this.stats.prepared;
    this.stats.lastForced = this._forcedSinceUpdate; this.stats.lastForcedPrepared = this._forcedPreparedSinceUpdate;
    this._forcedSinceUpdate = 0; this._forcedPreparedSinceUpdate = 0;
    for (let lane = 0; lane < through.length; lane++) {
      const queue = this.queues[lane];
      for (let index = queue.length - 1; index >= 0; index--) if (queue[index].complete) { this.states.delete(this._key(lane, queue[index].chunk)); queue.splice(index, 1); }
      if (lanes[lane].alive && this.preparedThrough[lane] < frontiers[lane] + this.preparationLead) { this.priority[lane] = (this.preparedThrough[lane] - frontiers[lane]) / this.speed[lane]; this._push(lane); }
    }
    while (this.size && attempts < this.preparationBudget) {
      const lane = this._pop(), chunk = Math.floor(this.preparedThrough[lane] / this.chunkWidth);
      this._prepare(lane, chunk, prepare); this.preparedThrough[lane] = (chunk + 1) * this.chunkWidth; attempts++;
    }
    this.size = 0;
    for (let lane = 0; lane < through.length; lane++) {
      if (!lanes[lane].alive) { this.pending[lane] = 0; continue; }
      this.pending[lane] = this.queues[lane].reduce((count, state) => count + (state.plan.jobs.some((job, index) => !state.active[index] && state.chunk * this.chunkWidth + job.x1 <= frontiers[lane] + this.targetLead && !job.dependencies?.some(dependency => !state.active[dependency])) ? state.remaining : 0), 0) + (this.preparedThrough[lane] < frontiers[lane] + this.preparationLead ? 1 : 0);
      this.stats.minimumMargin = Math.min(this.stats.minimumMargin, through[lane] - frontiers[lane]);
      const next = this._next(lane, frontiers[lane]);
      if (next) { this.priority[lane] = (next.state.chunk * this.chunkWidth + next.state.plan.jobs[next.index].x1 - frontiers[lane]) / this.speed[lane]; this._push(lane); }
    }
    while (this.size && revealed < this.revealBudget) {
      const lane = this._pop(), next = this._next(lane, frontiers[lane]);
      if (next && this._activate(next.state, next.index, through, reveal)) { this.pending[lane]--; revealed++; }
    }
    const prepared = this.stats.prepared - preparedBefore;
    this.stats.normalPrepared += prepared; this.stats.normalRevealed += revealed;
    this.stats.lastPreparationAttempts = attempts; this.stats.lastPrepared = prepared; this.stats.lastRevealed = revealed;
    this.stats.lastTotalPrepared = prepared + this.stats.lastForcedPrepared; this.stats.lastTotalRevealed = revealed + this.stats.lastForced;
  }
  dispose() { this.states.clear(); for (const queue of this.queues) queue.length = 0; for (const ranges of this.completed) ranges.length = 0;
    for (const ranges of this.localCoverage) ranges.length = 0; this.pending.fill(0); this.size = 0; this._forcedSinceUpdate = 0; this._forcedPreparedSinceUpdate = 0; }
  snapshot() { return { ...this.stats, materialization: 'source-pieces', maxPiecesPerChunk: MAX_PIECES_PER_CHUNK, cachedStates: this.states.size,
    completedRanges: this.completed.reduce((n, ranges) => n + ranges.length, 0), localCoverageRanges: this.localCoverage.reduce((n, ranges) => n + ranges.length, 0),
    pendingForcedPrepared: this._forcedPreparedSinceUpdate, pendingForcedRevealed: this._forcedSinceUpdate, safetyLead: this.safetyLead, targetLead: this.targetLead, preparationLead: this.preparationLead, preparationBudget: this.preparationBudget, revealBudget: this.revealBudget }; }
}
export { ProcgenTerrainGrowth, MAX_PIECES_PER_CHUNK, MAX_LOCAL_COVERAGE_RANGES };
