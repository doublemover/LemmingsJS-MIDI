class ProcgenTerrainGrowth {
  constructor(laneCount, chunkWidth) {
    this.chunkWidth = chunkWidth; this.quantum = 8;
    this.preparationBudget = Math.min(16, Math.max(4, Math.ceil(laneCount / 64)));
    this.revealBudget = Math.min(256, Math.max(8, Math.ceil(laneCount / 4)));
    this.safetyLead = 64;
    this.targetLead = this.safetyLead + 2 * (Math.ceil(laneCount / this.preparationBudget) + Math.ceil(laneCount / this.revealBudget));
    this.preparationLead = this.targetLead + 2 * Math.ceil(laneCount / this.preparationBudget) + this.quantum;
    this.preparedThrough = new Float64Array(laneCount); this.pending = new Uint32Array(laneCount);
    this.speed = new Float32Array(laneCount); this.heap = new Int32Array(laneCount); this.priority = new Float64Array(laneCount);
    this.size = 0; this.stats = { prepared: 0, revealed: 0, lastPrepared: 0, lastRevealed: 0, minimumMargin: Infinity };
  }
  reset(through, frontiers) {
    for (let lane = 0; lane < through.length; lane++) {
      through[lane] = Math.ceil((frontiers[lane] + this.targetLead) / this.quantum) * this.quantum;
      this.preparedThrough[lane] = Math.ceil(through[lane] / this.chunkWidth) * this.chunkWidth;
    }
    this.pending.fill(0); this.speed.fill(1); this.size = 0;
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
  update({ through, frontiers, lanes, prepare, reveal }) {
    this.size = 0; let prepared = 0, revealed = 0;
    for (let lane = 0; lane < through.length; lane++) if (lanes[lane].alive && this.preparedThrough[lane] < frontiers[lane] + this.preparationLead) {
      this.priority[lane] = (this.preparedThrough[lane] - frontiers[lane]) / this.speed[lane]; this._push(lane);
    }
    while (this.size && prepared < this.preparationBudget) {
      const lane = this._pop(), chunk = Math.floor(this.preparedThrough[lane] / this.chunkWidth);
      prepare(lane, chunk); this.preparedThrough[lane] = (chunk + 1) * this.chunkWidth; prepared++;
    }
    this.size = 0;
    for (let lane = 0; lane < through.length; lane++) {
      if (!lanes[lane].alive) { this.pending[lane] = 0; continue; }
      const target = Math.ceil((frontiers[lane] + this.targetLead) / this.quantum) * this.quantum;
      this.pending[lane] = Math.min(65535, Math.max(0, Math.ceil((target - through[lane]) / this.quantum)));
      this.stats.minimumMargin = Math.min(this.stats.minimumMargin, through[lane] - frontiers[lane]);
      if (this.pending[lane]) { this.priority[lane] = (through[lane] - frontiers[lane]) / this.speed[lane]; this._push(lane); }
      if (this.preparedThrough[lane] < frontiers[lane] + this.preparationLead) this.pending[lane]++;
    }
    while (this.size && revealed < this.revealBudget) {
      const lane = this._pop(), previous = through[lane], next = previous + this.quantum;
      if (next > this.preparedThrough[lane]) continue;
      through[lane] = next; this.pending[lane]--; revealed++; reveal(lane, previous, next);
    }
    this.stats.prepared += prepared; this.stats.revealed += revealed; this.stats.lastPrepared = prepared; this.stats.lastRevealed = revealed;
  }
  snapshot() { return { ...this.stats, quantum: this.quantum, safetyLead: this.safetyLead, targetLead: this.targetLead, preparationLead: this.preparationLead, preparationBudget: this.preparationBudget, revealBudget: this.revealBudget }; }
}
export { ProcgenTerrainGrowth };
