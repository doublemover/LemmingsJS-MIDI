const MAX_ROUTE_CANDIDATES_PER_LANE = 4;
const ROUTE_CANDIDATE_AGE_ROUNDS = 2;
const older = (a, b) => a.servedRound < b.servedRound || a.servedRound === b.servedRound && (a.x > b.x || a.x === b.x && a.id < b.id);
const ahead = (a, b) => a.x > b.x || a.x === b.x && (a.servedRound < b.servedRound || a.servedRound === b.servedRound && a.id < b.id);
class ProcgenRouteAdmission {
  constructor(world) {
    this.world = world; this.lanes = Array.from({ length: world.laneCount }, () => ({ records: [], free: [], tick: -1, round: 0, selected: null, probes: 0, consumed: false }));
    this.stats = { screened: 0, agedSelections: 0, candidateCount: 0 };
  }
  begin(laneIndex) {
    const lane = this.lanes[laneIndex], tick = this.world.tickIndex;
    if (lane.tick === tick) return lane;
    for (let index = lane.records.length - 1; index >= 0; index--) if (tick - lane.records[index].seenTick > 1) {
      lane.free.push(lane.records.splice(index, 1)[0]); this.stats.candidateCount--;
    }
    lane.tick = tick; lane.round++; lane.probes = 0; lane.consumed = false;
    let aged = null, frontier = null;
    for (const record of lane.records) {
      if (!frontier || ahead(record, frontier)) frontier = record;
      if (lane.round - record.servedRound >= ROUTE_CANDIDATE_AGE_ROUNDS && (!aged || older(record, aged))) aged = record;
    }
    lane.selected = aged || frontier;
    if (aged) this.stats.agedSelections++;
    return lane;
  }
  observe(actor) {
    const lane = this.lanes[actor.laneIndex], tick = this.world.tickIndex;
    let record = null;
    for (const value of lane.records) if (value.id === actor.id || value.x === actor.x && value.y === actor.y) { record = value; break; }
    if (record) {
      if (record.id === actor.id || record.seenTick < tick) { record.id = actor.id; record.x = actor.x; record.y = actor.y; }
      record.seenTick = tick; return;
    }
    if (lane.records.length < MAX_ROUTE_CANDIDATES_PER_LANE) {
      record = lane.free.pop() || {}; lane.records.push(record); this.stats.candidateCount++;
    } else {
      let oldest = lane.records[0], frontier = oldest;
      for (const value of lane.records) { if (older(value, oldest)) oldest = value; if (ahead(value, frontier)) frontier = value; }
      for (const value of lane.records) if (value !== oldest && value !== frontier && value !== lane.selected && (!record || older(record, value))) record = value;
      if (!record) return;
    }
    record.id = actor.id; record.x = actor.x; record.y = actor.y; record.seenTick = tick; record.servedRound = lane.round;
  }
  accepts(actor) {
    const lane = this.lanes[actor.laneIndex];
    return !lane.selected || lane.selected.id === actor.id || lane.selected.x === actor.x && lane.selected.y === actor.y;
  }
  screened(actor, probes) {
    const lane = this.lanes[actor.laneIndex]; lane.probes = probes; this.stats.screened++;
    const index = lane.records.findIndex(record => record.id === actor.id || record.x === actor.x && record.y === actor.y);
    if (index >= 0) { lane.free.push(lane.records.splice(index, 1)[0]); this.stats.candidateCount--; }
    lane.selected = null;
  }
  served(actor, probes) {
    const lane = this.lanes[actor.laneIndex]; lane.probes = probes; lane.consumed = true;
    for (const record of lane.records) if (record.id === actor.id || record.x === actor.x && record.y === actor.y) { record.servedRound = lane.round; break; }
  }
  reset() {
    for (const lane of this.lanes) { lane.free.push(...lane.records); lane.records.length = 0; lane.tick = -1; lane.round = 0; lane.selected = null; lane.probes = 0; lane.consumed = false; }
    this.stats.candidateCount = 0;
  }
  dispose() { this.reset(); for (const lane of this.lanes) lane.free.length = 0; this.world = null; }
}
export { ProcgenRouteAdmission, MAX_ROUTE_CANDIDATES_PER_LANE, ROUTE_CANDIDATE_AGE_ROUNDS };
