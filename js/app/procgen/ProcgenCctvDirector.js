const CCTV_MAX_PINS = 4;
const CCTV_DWELL_MS = 3000;
const CCTV_ROTATION_MS = 6000;
const signals = (world, lane) => world.getLaneMusicSignals?.(lane) || world.stall?.lanes[lane] || {};

class ProcgenCctvDirector {
  constructor() {
    this.mode = 'leaders'; this.pins = new Set(); this.revision = 0;
    this.reset();
  }
  reset() {
    this.generation = null; this.lastTick = -1; this.leader = null;
    this.leadTick = -Infinity; this.observed = []; this.selectedAt = new Map(); this.lastSeen = new Map(); this.lastRotation = null;
    this.reasons = new Map();
  }
  setMode(mode) {
    if (!['leaders', 'director'].includes(mode) || mode === this.mode) return false;
    this.mode = mode; this.revision++; this.selectedAt.clear(); return true;
  }
  setPins(lanes, laneCount) {
    const valid = [...new Set(lanes)].filter(lane => Number.isInteger(lane) && lane >= 0 && lane < laneCount).slice(0, CCTV_MAX_PINS);
    if (valid.join(',') === [...this.pins].join(',')) return false;
    this.pins = new Set(valid); this.revision++; return true;
  }
  togglePin(lane, laneCount) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= laneCount) return false;
    if (this.pins.has(lane)) this.pins.delete(lane);
    else if (this.pins.size < CCTV_MAX_PINS) this.pins.add(lane);
    else return false;
    this.revision++; return true;
  }
  select(world, ranked, previous, now) {
    const count = Math.min(8, ranked.length), tick = world.tickIndex;
    if (this.generation !== world.generation || tick < this.lastTick) {
      this.reset(); this.generation = world.generation;
      this.setPins([...this.pins], world.laneCount);
    }
    const advanced = tick !== this.lastTick;
    if (advanced && this.leader != null && ranked[0] !== this.leader) this.leadTick = tick;
    this.leader = ranked[0]; this.lastTick = tick;
    const scores = new Map(); this.reasons.clear();
    for (let rank = 0; rank < ranked.length; rank++) {
      const lane = ranked[rank], state = signals(world, lane), old = this.observed[lane];
      const movedTick = advanced && old && state.maxX > old.maxX ? tick : old?.movedTick ?? -Infinity;
      this.observed[lane] = { maxX: state.maxX, movedTick };
      let score = Math.max(0, 20 - rank), reason = 'Distance leader';
      if (state.alive > 0 && tick - movedTick <= 30) { score = 40; reason = 'Advancing'; }
      if (state.buildingCount > 0) { score = 70; reason = 'Building'; }
      else if (state.bashingCount > 0) { score = 65; reason = 'Bashing'; }
      if (state.peakAlive >= 6 && state.alive > 0 && state.alive <= 3 && state.alive < state.peakAlive / 2) {
        score = state.buildingCount > 0 || state.bashingCount > 0 ? 95 : 75;
        reason = state.buildingCount > 0 ? 'Small crew building' : state.bashingCount > 0 ? 'Small crew bashing' : 'Small surviving crew';
      }
      if (lane === this.leader && tick - this.leadTick <= 60) { score = 100; reason = 'New distance leader'; }
      scores.set(lane, score); this.reasons.set(lane, this.pins.has(lane) ? 'Pinned' : reason);
    }
    const selected = previous.filter(lane => ranked.includes(lane)).slice(0, count);
    for (const lane of ranked) if (selected.length < count && !selected.includes(lane)) selected.push(lane);
    for (const lane of this.pins) if (!selected.includes(lane)) {
      const index = selected.findLastIndex(value => !this.pins.has(value));
      if (index >= 0) selected[index] = lane;
    }
    if (this.lastRotation == null) this.lastRotation = now;
    // One rotating slot is reserved when outsiders exist; the other views keep
    // dwell and score hysteresis, while pinned slots never rotate.
    const rotationIndex = ranked.length > count ? selected.findLastIndex(lane => !this.pins.has(lane)) : -1;
    if (advanced && rotationIndex >= 0 && now - this.lastRotation >= CCTV_ROTATION_MS) {
      const outsiders = ranked.filter(lane => !selected.includes(lane));
      outsiders.sort((a, b) => (this.lastSeen.get(a) ?? -Infinity) - (this.lastSeen.get(b) ?? -Infinity) || a - b);
      if (outsiders.length) { selected[rotationIndex] = outsiders[0]; this.selectedAt.set(outsiders[0], now); }
      this.lastRotation = now;
    }
    if (rotationIndex >= 0) this.reasons.set(selected[rotationIndex], 'Rotation');
    const candidates = advanced ? ranked.filter(lane => !selected.includes(lane)).sort((a, b) => scores.get(b) - scores.get(a) || a - b) : [];
    for (const candidate of candidates) {
      let worst = -1;
      for (let i = 0; i < selected.length; i++) {
        const lane = selected[i];
        if (i === rotationIndex || this.pins.has(lane) || now - (this.selectedAt.get(lane) ?? -Infinity) < CCTV_DWELL_MS) continue;
        if (worst < 0 || scores.get(lane) < scores.get(selected[worst])) worst = i;
      }
      if (worst >= 0 && scores.get(candidate) > scores.get(selected[worst]) + 15) { selected[worst] = candidate; this.selectedAt.set(candidate, now); }
    }
    for (const lane of selected) { if (!this.selectedAt.has(lane)) this.selectedAt.set(lane, now); this.lastSeen.set(lane, now); }
    return selected;
  }
}
export { ProcgenCctvDirector, CCTV_MAX_PINS, CCTV_DWELL_MS, CCTV_ROTATION_MS };
