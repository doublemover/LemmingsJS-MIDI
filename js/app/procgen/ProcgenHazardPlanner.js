import { ProcgenRouteAdmission } from './ProcgenRouteAdmission.js';
import { ProcgenBlockerBypass } from './ProcgenBlockerBypass.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ProcgenSupportedTunnel } from './ProcgenSupportedTunnel.js';
import { ProcgenSupportedDescent } from './ProcgenSupportedDescent.js';
import { ProcgenWalkContinuation } from './ProcgenWalkContinuation.js';

const MAX_LOCAL_ROUTE_DISTANCE = 40;
const MAX_ROUTE_PROBES = 1024;
const ROUTE_LANES_PER_TICK = 8;
const intersects = (hazard, x, y) => x + 2 > hazard.x1 && x - 2 < hazard.x2 && y + 1 > hazard.y1 && y - 9 < hazard.y2;

class ProcgenHazardPlanner {
  constructor(world) {
    this.bypasses = new ProcgenBlockerBypass(world); this.tunnels = new ProcgenSupportedTunnel(world); this.descents = new ProcgenSupportedDescent(world);
    this.walking = new ProcgenWalkContinuation(world);
    this.world = world; this.observations = []; this.adjacentObservations = []; this.cache = new Array(world.laneCount);
    this.admission = new ProcgenRouteAdmission(world);
    this.stats = { plans: 0, deferred: 0, probes: 0, budgetExhausted: 0, admission: this.admission.stats };
  }
  _ground(x, y) {
    if (++this.probes > MAX_ROUTE_PROBES) { this.exhausted = true; return false; }
    this.stats.probes++;
    if (y < 0 || y >= this.world.height || x < this.world.leftEdgeX) return false;
    if (!this._revealed(x, y)) { this.unrevealed = true; return false; }
    return this.world.hasGroundAt(x, y);
  }
  _revealed(x, y) { return x >= this.world.leftEdgeX && y >= 0 && y < this.world.height && x < this.world.generatedThrough[Math.floor(y / this.world.laneHeight)]; }
  _floor(x, y, rise = 0, drop = 12) {
    if (!this._revealed(x, y)) return null;
    for (let at = y - rise; at <= y + drop; at++) if (this._ground(x, at)) return at;
    return null;
  }
  _safe(x, y) { return !this.observations.some(hazard => intersects(hazard, x, y)); }
  _continuation(x, y) {
    let last = this._ground(x, y) ? y : this._floor(x, y + 1, 0, 11);
    if (last == null) return null;
    for (let at = Math.min(y, last); at <= Math.max(y, last); at++) if (!this._safe(x, at)) return null;
    // Follow the shared walker's consecutive eight-pixel feet/up column. A
    // separated overhead roof does not turn walkers; a full column does. Query
    // every intervening x, including narrow supports and ordinary safe falls.
    for (let dx = 1; dx <= 8; dx++) {
      let up = 0;
      while (up < 8 && this._ground(x + dx, last - up)) up++;
      if (up === 8) return null;
      if (up) last -= up - 1;
      else {
        const floor = this._floor(x + dx, last + 1, 0, 11);
        if (floor == null) return null;
        for (let at = last + 1; at <= floor; at++) if (!this._safe(x + dx, at)) return null;
        last = floor;
      }
      if (!this._safe(x + dx, last)) return null;
    }
    return { y: last, span: 8 };
  }
  _constructionOverlap(bounds) {
    const first = Math.max(0, Math.floor(bounds.y1 / this.world.laneHeight)), last = Math.min(this.world.laneCount - 1, Math.floor((bounds.y2 - 1) / this.world.laneHeight));
    for (let lane = first; lane <= last; lane++) {
      const tasks = this.world.accessTasks[lane]; if (!tasks) continue;
      for (const task of tasks) {
        const owner = task.owner, footprint = task.footprint;
        if (!footprint || !owner || owner.removed || owner.disabled || owner.failureReason || owner.terminalReason || owner.action !== this.world.actions[State.BUILDING]) continue;
        if (bounds.x1 < footprint.x2 && bounds.x2 > footprint.x1 && bounds.y1 < footprint.y2 && bounds.y2 > footprint.y1) return true;
      }
    }
    return false;
  }
  _builder(actor) {
    if (!this.world.workerLimits?.builders || !this._ground(actor.x, actor.y) || !this._safe(actor.x, actor.y)) return null;
    let x = actor.x, y = actor.y;
    for (let step = 0; step < 12; step++) {
      if (!this._revealed(x + 5, y - 1) || !this._safe(x, y)) return null;
      y--;
      for (let advance = 0; advance < 2; advance++) {
        x++;
        if (this._ground(x, y - 1) || this.world.isArrowAt?.(x, y - 1, true) || !this._safe(x, y)) return null;
      }
      if (step < 11 && (this._ground(x + 2, y - 9) || this.world.isArrowAt?.(x + 2, y - 9, true))) return null;
    }
    const continuation = this._continuation(x, y);
    if (!continuation) return null;
    const gain = actor.y - continuation.y, crew = this.world.getLaneMusicSignals?.(actor.laneIndex);
    return { kind: 'builders', targetX: x, footprint: { x1: actor.x, x2: actor.x + 28, y1: actor.y - 12, y2: actor.y + 1 },
      continuationY: continuation.y, estimatedTicks: 192, materialCost: 12,
      score: 100 - 192 / 8 - 18 + Math.max(0, gain) * 4 + continuation.span + Math.min(8, crew?.alive || 1) - (crew?.buildingCount || 0) * 4 };
  }
  _basher(actor, cliff) {
    if (!cliff || !this.world.workerLimits?.bashers) return null;
    const action = this.world.actions[State.BASHING], mask = action?.masks?.get('right')?.GetMask(1);
    const startX = Math.max(actor.x, cliff.x - 8);
    if (!mask || !this._ground(startX, actor.y) || this.world.hasSteelUnderMask(mask, startX, actor.y) || this.world.hasArrowUnderMask(mask, startX, actor.y, true)) return null;
    let clear = 0, excavated = 0, end = null;
    for (let x = startX + 1; x <= Math.min(actor.x + MAX_LOCAL_ROUTE_DISTANCE - 9, this.through - 9); x++) {
      if (!this._ground(x, actor.y + 1) || !this._safe(x, actor.y)) return null;
      let solid = false;
      for (let y = actor.y - 9; y < actor.y; y++) if (this._ground(x, y)) {
        if (this.world.hasSteelAt(x, y)) return null;
        excavated++; if (y === actor.y - 6) solid = true;
      }
      clear = solid ? 0 : clear + 1;
      if (x >= cliff.x && clear >= 4) { end = x; break; }
    }
    if (end == null) return null;
    const footprint = { x1: startX - 1, x2: end + 9, y1: actor.y - 9, y2: actor.y + 2 };
    const continuation = this._continuation(end + 1, actor.y);
    if (!continuation || this._constructionOverlap(footprint)) return null;
    const depth = Math.max(0, actor.y - cliff.y), ticks = (startX - actor.x) + 16 * Math.ceil((end - startX) / 5);
    const crew = this.world.getLaneMusicSignals?.(actor.laneIndex);
    return { kind: 'bashers', targetX: cliff.x, startX, footprint, continuationY: continuation.y, estimatedTicks: ticks, materialCost: 0,
      score: 100 - ticks / 8 - excavated / 24 - depth * 4 + continuation.span + Math.min(8, crew?.alive || 1) - (crew?.bashingCount || 0) * 4 };
  }
  _digDescent(actor) {
    if (!this.world.workerLimits?.diggers || !this._ground(actor.x, actor.y) || !this._safe(actor.x, actor.y) ||
        this._constructionOverlap({ x1: actor.x - 4, x2: actor.x + 5, y1: actor.y - 2, y2: actor.y + 21 })) return null;
    // Prefer an already opened nearby descent. Ordinary followers can walk
    // into the real shaft and fall to its supported floor without another job.
    for (let dx = 1; dx <= 24; dx++) if (!this._ground(actor.x + dx, actor.y)) {
      const floor = this._floor(actor.x + dx, actor.y + 1, 0, 19);
      if (floor != null && this._safe(actor.x + dx, floor) && this._continuation(actor.x + dx, floor)) return null;
    }
    // The shared digger removes complete nine-pixel rows until the first empty
    // row, then naturally falls. Only a revealed thin roof and nearby safe cave
    // qualify; a solid downward shaft has no known completion and is rejected.
    let empty = null;
    for (let y = actor.y - 2; y <= actor.y + 12; y++) {
      let occupied = false;
      for (let x = actor.x - 4; x <= actor.x + 4; x++) {
        if (this._ground(x, y)) { if (this.world.hasSteelAt(x, y)) return null; occupied = true; }
        if (!this._safe(x, y)) return null;
      }
      if (y >= actor.y && !occupied) { empty = y; break; }
    }
    if (empty == null || empty === actor.y) return null;
    const landing = this._floor(actor.x, empty + 1, 0, 12);
    if (landing == null || landing <= empty + 1 || landing - actor.y > 20) return null;
    for (let x = actor.x - 4; x <= actor.x + 8; x += 2) {
      if (!this._ground(x, landing) || this._ground(x, landing - 9) || !this._safe(x, landing)) return null;
    }
    const continuation = this._continuation(actor.x, landing);
    if (!continuation) return null;
    const ticks = (empty - actor.y + 1) * 8 + Math.ceil((landing - empty) / 3) + 8, crew = this.world.getLaneMusicSignals?.(actor.laneIndex);
    return { kind: 'diggers', targetX: actor.x, footprint: { x1: actor.x - 4, x2: actor.x + 5, y1: actor.y - 2, y2: landing + 1 },
      continuationY: continuation.y, estimatedTicks: ticks, materialCost: 0, reason: 'known-safe-descent',
      score: 72 - ticks / 8 - (landing - actor.y) + continuation.span + Math.min(8, crew?.alive || 1) - (crew?.diggingCount || 0) * 4 };
  }
  _mineDescent(actor) {
    const action = this.world.actions[State.MINING], masks = action?.masks?.get('right');
    if (!masks || !this.world.workerLimits?.diggers || !this._ground(actor.x, actor.y) || !this._safe(actor.x, actor.y) ||
        this._constructionOverlap({ x1: actor.x - 1, x2: actor.x + 8, y1: actor.y - 12, y2: actor.y + 1 })) return null;
    let x = actor.x, y = actor.y, elapsed = 0, exit = null;
    // Both shared mining masks cut at the current feet row or above. The lower
    // support tested at frame3/15 is unchanged by those cuts, so a nearby natural
    // termination can be qualified from revealed source geometry alone.
    for (let cycle = 0; cycle < 4 && !exit; cycle++) {
      if (!this._safe(x, y)) return null;
      for (let index = 0; index < 2; index++) {
        const mask = masks.GetMask(index); if (!mask || this.world.hasArrowUnderMask(mask, x, y, true)) return null;
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) {
          const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy;
          if (py > y || !this._revealed(px, py)) return null;
          if (this._ground(px, py) && this.world.hasSteelAt(px, py)) return null;
        }
      }
      x++; y++;
      if (!this._safe(x, y)) return null;
      if (!this._ground(x, y)) { exit = { x, y }; elapsed += 3; break; }
      x++;
      if (!this._safe(x, y)) return null;
      if (!this._ground(x, y)) { exit = { x, y }; elapsed += 15; break; }
      elapsed += 24;
    }
    if (!exit) return null;
    const landing = this._floor(exit.x, exit.y + 1, 0, 12);
    if (landing == null || !this._safe(exit.x, landing) || this._ground(exit.x, landing - 9)) return null;
    const footprint = { x1: actor.x - 1, x2: exit.x + 8, y1: actor.y - 12, y2: landing + 1 };
    const continuation = this._continuation(exit.x, landing); if (!continuation || this._constructionOverlap(footprint)) return null;
    const ticks = elapsed + Math.ceil((landing - exit.y) / 3) + 8;
    return { kind: 'miners', targetX: exit.x, footprint,
      continuationY: continuation.y, estimatedTicks: ticks, materialCost: 0, reason: 'known-safe-mine-descent', score: 72 - ticks / 8 - (landing - actor.y) + continuation.span };
  }
  plan(actor) {
    const world = this.world;
    if (!world || !actor || actor.runtime !== world.runtime || actor.action !== world.actions[State.WALKING] || !actor.lookRight || actor.failureReason || actor.removed || actor.disabled || actor.terminalReason) return null;
    const lane = actor.laneIndex, stride = Math.max(1, Math.ceil(world.laneCount / ROUTE_LANES_PER_TICK));
    if (lane % stride !== world.tickIndex % stride) { this.admission.observe(actor); this.stats.deferred++; return null; }
    const service = this.admission.begin(lane); this.admission.observe(actor);
    const cached = this.cache[lane], key = `${world.generation}:${actor.x}:${actor.y}:${world.terrainRevision}:${world.frontierRevision}:${world.workerLimits?.builders}:${world.workerLimits?.bashers}:${world.workerLimits?.diggers}`;
    if (cached?.tick === world.tickIndex) {
      const proposal = cached.proposal;
      if (cached.key !== key || proposal && proposal.kind !== 'builders' && (this._constructionOverlap(proposal.footprint) || proposal.routeEvidence && this.tunnels._busy(proposal.footprint))) return null;
      return proposal;
    }
    if (!this.admission.accepts(actor) || service.consumed || service.probes >= MAX_ROUTE_PROBES) { this.stats.deferred++; return null; }
    this.top = lane * world.laneHeight; this.through = world.generatedThrough[lane]; this.probes = service.probes; this.exhausted = false; this.unrevealed = false;
    world.hazards.nearby(lane, actor.x, { ahead: MAX_LOCAL_ROUTE_DISTANCE, behind: 4 }, this.observations);
    for (const adjacent of [Math.floor((actor.y - 24) / this.world.laneHeight), Math.floor((actor.y + 12) / this.world.laneHeight)]) if (adjacent !== lane && adjacent >= 0 && adjacent < world.laneCount) {
      world.hazards.nearby(adjacent, actor.x, { ahead: MAX_LOCAL_ROUTE_DISTANCE, behind: 4 }, this.adjacentObservations);
      this.observations.push(...this.adjacentObservations);
    }
    const basin = world.basinRoutes?.candidate(actor, this.observations, MAX_ROUTE_PROBES - this.probes);
    if (basin?.handled) {
      this.probes += basin.probes; this.stats.probes += basin.probes;
      if (basin.proposal) this.admission.served(actor, this.probes);
      else this.admission.screened(actor, this.probes);
      return basin.proposal;
    }
    let cliff = null, gap = false;
    for (let dx = 2; dx <= 24 && !cliff; dx += 2) {
      const x = actor.x + dx;
      if (this._floor(x, actor.y, 0, 3) == null && this._revealed(x, actor.y)) gap = true;
      let rise = 0;
      while (rise < 24 && this._ground(x, actor.y - rise - 1)) rise++;
      if (rise >= 7) cliff = { x, y: actor.y - rise };
    }
    const threat = this.observations.find(hazard => hazard.x2 > actor.x && hazard.x1 < actor.x + 28 && actor.y + 1 > hazard.y1 && actor.y - 9 < hazard.y2);
    const bypass = this.bypasses.prove(actor, Math.max(0, MAX_ROUTE_PROBES - this.probes));
    this.probes += bypass.probes; this.stats.probes += bypass.probes;
    let proposal = bypass.proposal;
    if (bypass.failure === 'budget') this.exhausted = true;
    if (bypass.failure === 'unrevealed') this.unrevealed = true;
    if (!proposal && !threat && !cliff && !gap && !bypass.failure && !this.exhausted && !this.unrevealed) { this.admission.screened(actor, this.probes); return null; }
    if (!proposal && (threat || cliff || gap)) {
      const build = this._builder(actor);
      if (build) build.score += world.lanePolicy?.score(actor, build) || 0;
      // A coarse gap under existing bricks is not a reason to excavate their
      // safe passive exit. Retain proactive building unless completed nearby
      // construction and an actual ordinary shared-action replay justify WALK.
      if (!bypass.failure && (!build || world.lanePolicy?.connectedConstruction(actor))) {
        const walking = this.walking.prove(actor, (x, y) => this._ground(x, y), this.observations, MAX_ROUTE_PROBES - this.probes);
        if (walking.failure === 'unrevealed') this.unrevealed = true;
        if (walking.safe && !this.exhausted && !this.unrevealed) { this.admission.screened(actor, this.probes); return null; }
      }
      let bash = null, observedLong = false;
      if (!build && cliff && world.workerLimits?.bashers && this._ground(actor.x + 30, actor.y - 6)) {
        let up = 0; while (up < 8 && this._ground(actor.x + 1, actor.y - up)) up++;
        if (up === 8) {
          observedLong = true;
          const result = this.tunnels.prove(actor, Math.max(0, MAX_ROUTE_PROBES - this.probes));
          this.probes += result.probes; this.stats.probes += result.probes;
          if (result.proposal) proposal = result.proposal;
        }
      }
      if (!observedLong) bash = this._basher(actor, cliff);
      if (bash) bash.score += world.lanePolicy?.score(actor, bash) || 0;
      if (build && (!bash || build.score > bash.score)) proposal = { ...build, reason: threat ? 'supported-hazard-bypass' : cliff ? 'short-stair-to-ledge' : 'supported-local-gap' };
      else if (!proposal && bash && bash.startX === actor.x) proposal = { ...bash, reason: 'supported-local-tunnel' };
      if (!proposal && world.workerLimits?.diggers && this.probes < MAX_ROUTE_PROBES) {
        const result = this.descents.prove(actor, MAX_ROUTE_PROBES - this.probes, null, world.lanePolicy?.descentPreference(actor));
        this.probes += result.probes; this.stats.probes += result.probes;
        proposal = result.proposal;
        if (result.failure === 'budget') this.exhausted = true;
        if (result.failure === 'unrevealed') this.unrevealed = true;
      }
      if (!proposal && this.probes < MAX_ROUTE_PROBES) proposal = this._digDescent(actor) || this._mineDescent(actor);
    }
    if (this.unrevealed) proposal = null;
    if (this.exhausted) { proposal = null; this.stats.budgetExhausted++; }
    this.admission.served(actor, Math.min(MAX_ROUTE_PROBES, this.probes));
    this.cache[lane] = { tick: world.tickIndex, key, proposal }; this.stats.plans++;
    return proposal;
  }
  reset() { this.admission.reset(); this.bypasses.reset(); this.tunnels.reset(); this.descents.reset(); this.walking.reset(); this.cache.fill(null); this.observations.length = 0; this.adjacentObservations.length = 0; }
  dispose() { this.reset(); this.admission.dispose(); this.bypasses.dispose(); this.tunnels.dispose(); this.descents.dispose(); this.walking.dispose(); this.world = null; }
}
export { ProcgenHazardPlanner, MAX_LOCAL_ROUTE_DISTANCE, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK };
