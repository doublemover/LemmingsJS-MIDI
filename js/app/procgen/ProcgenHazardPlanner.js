import { ProcgenRouteAdmission } from './ProcgenRouteAdmission.js';
import { ProcgenBlockerBypass } from './ProcgenBlockerBypass.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ProcgenSupportedTunnel } from './ProcgenSupportedTunnel.js';
import { ProcgenSupportedDescent } from './ProcgenSupportedDescent.js';
import { ProcgenWalkContinuation } from './ProcgenWalkContinuation.js';
import { ProcgenSupportedRelief } from './ProcgenSupportedRelief.js';
import { ProcgenGuardedTunnel } from './ProcgenGuardedTunnel.js';
import { ProcgenSupportedBuild } from './ProcgenSupportedBuild.js';
import { ProcgenLocalTunnel } from './ProcgenLocalTunnel.js';
import { ProcgenActionChain } from './ProcgenActionChain.js';

const MAX_LOCAL_ROUTE_DISTANCE = 40;
const MAX_ROUTE_PROBES = 1024;
const ROUTE_LANES_PER_TICK = 8;
// A rejected builder must leave shared lane work for independent alternatives.
const BUILD_CANDIDATE_WORK = MAX_ROUTE_PROBES / 2;
const intersects = (hazard, x, y) => x + 2 > hazard.x1 && x - 2 < hazard.x2 && y + 1 > hazard.y1 && y - 9 < hazard.y2;

class ProcgenHazardPlanner {
  constructor(world) {
    this.bypasses = new ProcgenBlockerBypass(world); this.tunnels = new ProcgenSupportedTunnel(world); this.descents = new ProcgenSupportedDescent(world);
    this.walking = new ProcgenWalkContinuation(world); this.building = new ProcgenSupportedBuild(world); this.localTunnels = new ProcgenLocalTunnel(world); this.guardedTunnels = new ProcgenGuardedTunnel(world); this.relief = new ProcgenSupportedRelief(world);
    this.world = world; this.observations = []; this.adjacentObservations = []; this.cache = new Array(world.laneCount);
    this.chains = new ProcgenActionChain(world);
    this.admission = new ProcgenRouteAdmission(world);
    this.stats = { plans: 0, deferred: 0, probes: 0, contactReads: 0, budgetExhausted: 0, admission: this.admission.stats };
  }
  observeContact(actor) {
    const world = this.world;
    if (!world?.workstationEnabled || actor.action !== world.actions[State.WALKING] || !actor.lookRight) return null;
    const contact = actor._procgenContact ||= {};
    if (contact.tick === world.tickIndex && contact.x === actor.x && contact.y === actor.y && contact.revision === world.terrainRevision) return contact;
    Object.assign(contact, { tick: world.tickIndex, x: actor.x, y: actor.y, revision: world.terrainRevision, reads: 0, wall: true, gap: true, revealed: true });
    const ground = (x, y) => {
      contact.reads++; this.stats.contactReads++;
      if (!this._revealed(x, y)) { contact.revealed = false; return false; }
      return world.hasGroundAt(x, y);
    };
    for (let up = 0; up < 8; up++) if (!ground(actor.x + 1, actor.y - up)) { contact.wall = false; break; }
    if (contact.wall) contact.gap = false;
    else for (let down = 1; down <= 3; down++) if (ground(actor.x + 3, actor.y + down)) { contact.gap = false; break; }
    return contact;
  }
  _ground(x, y) {
    if (this.probes >= MAX_ROUTE_PROBES) { this.exhausted = true; return false; }
    this.probes++; this.stats.probes++;
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
    let endpointX = actor.x, endpointY = actor.y;
    for (let step = 0; step < 12; step++) {
      if (!this._revealed(endpointX + 5, endpointY - 1) || !this._safe(endpointX, endpointY)) return null;
      endpointY--;
      for (let advance = 0; advance < 2; advance++) {
        endpointX++;
        if (this._ground(endpointX, endpointY - 1) || this.world.isArrowAt?.(endpointX, endpointY - 1, true) || !this._safe(endpointX, endpointY)) return null;
      }
      if (step < 11 && (this._ground(endpointX + 2, endpointY - 9) || this.world.isArrowAt?.(endpointX + 2, endpointY - 9, true))) return null;
    }
    const requireOpening = !this._continuation(endpointX, endpointY);
    const result = this.building.prove(actor, (x, y) => this._ground(x, y), this.observations, Math.min(BUILD_CANDIDATE_WORK, MAX_ROUTE_PROBES - this.probes), requireOpening);
    this.probes += result.actionSteps; this.stats.probes += result.actionSteps;
    if (result.failure === 'unrevealed') this.unrevealed = true;
    if (!result.safe) return null;
    const x = actor.x + 24, continuation = { y: result.y, span: 8 };
    const gain = actor.y - continuation.y, crew = this.world.getLaneMusicSignals?.(actor.laneIndex);
    return { kind: 'builders', targetX: x, footprint: { x1: actor.x, x2: actor.x + 28, y1: actor.y - 12, y2: actor.y + 1 },
      continuationY: continuation.y, estimatedTicks: result.exitTicks, materialCost: 12,
      routeEvidence: { kind: 'shared-full-build', exitX: result.x, exitY: result.y, exitTicks: result.exitTicks, naturalFall: result.fell, observedBounds: { x1: actor.x - 1, x2: actor.x + 41, y1: actor.y - 32, y2: actor.y + 33 } },
      score: 100 - 192 / 8 - 18 + Math.max(0, gain) * 4 + continuation.span + Math.min(8, crew?.alive || 1) - (crew?.buildingCount || 0) * 4 };
  }
  _basher(actor, cliff) {
    if (!cliff || !this.world.workerLimits?.bashers) return null;
    const action = this.world.actions[State.BASHING], mask = action?.masks?.get('right')?.GetMask(1);
    const startX = Math.max(actor.x, cliff.x - 8);
    if (startX !== actor.x) return null;
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
    const result = this.localTunnels.prove(actor, (x, y) => this._ground(x, y), this.observations, MAX_ROUTE_PROBES - this.probes, end + 9);
    this.probes += result.actionSteps; this.stats.probes += result.actionSteps;
    if (result.failure === 'unrevealed') this.unrevealed = true;
    if (!result.safe) return null;
    const depth = Math.max(0, actor.y - cliff.y), ticks = result.actionSteps;
    const crew = this.world.getLaneMusicSignals?.(actor.laneIndex);
    return { kind: 'bashers', targetX: cliff.x, startX, footprint, continuationY: result.y, estimatedTicks: ticks, materialCost: 0,
      routeEvidence: { kind: 'shared-local-bash', exitX: result.x, exitY: result.y, bashTicks: result.bashTicks, excavated: result.excavated },
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
  _chainHazards(actor, bounds = { y1: actor.y - 64, y2: actor.y + 49 }) {
    const world = this.world, hazards = [], bucket = [], origin = bounds.x1 == null ? actor.x : bounds.x1 + 5;
    for (let lane = Math.max(0, Math.floor(bounds.y1 / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor((bounds.y2 - 1) / world.laneHeight)); lane++) {
      for (const offset of [0, 60]) {
        world.hazards.nearby(lane, origin + offset, { ahead: offset ? 52 : 64, behind: 5 }, bucket);
        if (bucket.length >= 8) return null;
        for (const hazard of bucket) if (!hazards.some(other => other.lane === hazard.lane && other.chunk === hazard.chunk && other.objectIndex === hazard.objectIndex)) hazards.push(hazard);
      }
    }
    return hazards;
  }
  revalidateChain(actor, project) {
    const world = this.world, lane = actor.laneIndex, stride = Math.max(1, Math.ceil(world.laneCount / ROUTE_LANES_PER_TICK));
    if (lane % stride !== world.tickIndex % stride) return { deferred: true };
    const service = this.admission.begin(lane);
    if (service.consumed || service.probes >= MAX_ROUTE_PROBES) return { deferred: true };
    const chain = project.chain, stage = chain.stages[chain.index];
    const hazards = this._chainHazards(actor, chain.bounds); if (!hazards) return { safe: false, failure: 'hazard-capacity' };
    const proof = this.chains.prove(actor, hazards, MAX_ROUTE_PROBES - service.probes, { firstKind: stage.kind, minStages: 1, bounds: chain.bounds, followerStart: { x: project.startX, y: project.startY } });
    this.admission.served(actor, service.probes + proof.work); this.stats.probes += proof.work;
    if (proof.stages.length + chain.index > 4) return { safe: false, failure: 'chain-stage-limit' };
    return proof;
  }
  plan(actor) {
    const world = this.world;
    if (!world || !actor || actor.runtime !== world.runtime || actor.action !== world.actions[State.WALKING] || !actor.lookRight || actor.failureReason || actor.removed || actor.disabled || actor.terminalReason) return null;
    const contact = this.observeContact(actor);
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
    for (const adjacent of [Math.floor((actor.y - 24) / this.world.laneHeight), Math.floor((actor.y + 32) / this.world.laneHeight)]) if (adjacent !== lane && adjacent >= 0 && adjacent < world.laneCount) {
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
    if (world.workstationEnabled) {
      // Eleven or fewer immediate reads run every walking tick. Broad proofs
      // still rotate through eight lanes and include these reads on service ticks.
      const stepHeight = (x, y, height) => { for (let i = 0; i < height; i++) if (!this._ground(x, y + height - i - 1)) return i; return height; };
      const contactWork = Math.min(contact.reads, MAX_ROUTE_PROBES - this.probes);
      this.probes += contactWork; this.stats.probes += contactWork;
      const wallContact = contact.revealed && contact.wall, gapContact = contact.revealed && contact.gap;
      if ((wallContact || gapContact) && world.lanePolicy.projects.canBegin(actor)) {
        const compound = gapContact ? this._floor(actor.x + 24, actor.y, 12, 32) == null || [28, 32, 36].some(dx => stepHeight(actor.x + dx, actor.y - 19, 8) === 8) :
          [12, 20, 28].some(dx => !this._ground(actor.x + dx, actor.y + 3));
        if (compound) {
          const hazards = this._chainHazards(actor); if (!hazards) { this.admission.served(actor, this.probes); return null; }
          let chain = this.chains.prove(actor, hazards, MAX_ROUTE_PROBES - this.probes);
          this.probes += chain.work; this.stats.probes += chain.work;
          if (!chain.safe && chain.failure === 'passive' && world.workerLimits.diggers && this._ground(actor.x, actor.y + 1) && !this._ground(actor.x, actor.y + 2)) {
            const walking = this.walking.prove(actor, (x, y) => this._ground(x, y), hazards, Math.floor((MAX_ROUTE_PROBES - this.probes) / 2));
            this.probes += walking.actionSteps; this.stats.probes += walking.actionSteps;
            if (walking.safe) { this.admission.screened(actor, this.probes); return null; }
            if (!['budget', 'unrevealed', 'construction'].includes(walking.failure) && this.probes < MAX_ROUTE_PROBES) {
              chain = this.chains.prove(actor, hazards, MAX_ROUTE_PROBES - this.probes, { firstKind: 'miners' });
              this.probes += chain.work; this.stats.probes += chain.work;
            }
          }
          if (chain.safe) {
            const first = chain.stages[0], proposal = { kind: first.kind, targetX: first.x + (first.kind === 'builders' ? 24 : 8), footprint: chain.footprint, chain, reason: 'shared-action-chain' };
            this.admission.served(actor, this.probes); this.cache[lane] = { tick: world.tickIndex, key, proposal }; this.stats.plans++; return proposal;
          }
          if (this.probes >= MAX_ROUTE_PROBES) { this.admission.served(actor, this.probes); this.stats.budgetExhausted++; return null; }
        }
      }
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
    if (!proposal && !bypass.failure && (cliff || gap) && world.workerLimits?.bashers && world.lanePolicy.projects.canBegin(actor)) {
      // A lower revealed endpoint is only a cheap candidate screen. The shared
      // unchanged walk must actually fail before any relief cut is admitted.
      const lower = this._floor(actor.x + MAX_LOCAL_ROUTE_DISTANCE, actor.y, 0, 32);
      if (lower != null && lower - actor.y > 12 && !this.exhausted && !this.unrevealed) {
        const result = this.relief.prove(actor, MAX_ROUTE_PROBES - this.probes, world.tunnelRoutes.guard(actor));
        this.probes += result.probes; this.stats.probes += result.probes;
        if (result.proposal) proposal = result.proposal;
        else if (result.guardCandidate) world.tunnelRoutes.request(actor, result.guardCandidate);
        if (result.proposal || result.guardCandidate || world.tunnelRoutes.guard(actor)) {
          this.admission.served(actor, Math.min(MAX_ROUTE_PROBES, this.probes));
          this.cache[lane] = { tick: world.tickIndex, key, proposal }; this.stats.plans++;
          return proposal;
        }
      }
    }
    if (!proposal && (threat || cliff || gap)) {
      const walking = !bypass.failure ? this.walking.prove(actor, (x, y) => this._ground(x, y), this.observations, MAX_ROUTE_PROBES - this.probes) : null;
      // Reads debit _ground immediately; include every action advance before
      // a safe-screen early return or another proof can reuse this lane budget.
      this.probes += walking?.actionSteps || 0; this.stats.probes += walking?.actionSteps || 0;
      if (walking?.failure === 'unrevealed') this.unrevealed = true;
      if (walking?.safe && !this.exhausted && !this.unrevealed) { this.admission.screened(actor, this.probes); return null; }
      const build = this._builder(actor);
      if (build) build.score += world.lanePolicy?.score(actor, build) || 0;
      const longWall = !build && cliff && world.workerLimits?.bashers && this._ground(actor.x + 30, actor.y - 6);
      let bash = null, shortTried = false;
      // A current short cut must get its budget before a speculative future
      // guarded entrance, or the first ordinary walker can miss its only pose.
      if (!build && !longWall) { bash = this._basher(actor, cliff); shortTried = true; }
      if (walking && !bash) {
        // Discover a real imminent WALK entrance before scalar excavation scans
        // spend its service. The live actor keeps following its shared actions.
        if (!build && walking.terrainTurn?.steps > 0 && !actor.scout && !actor.canClimb && !actor.hasParachute && world.workerLimits?.bashers &&
            !this.exhausted && !this.unrevealed && !world.tunnelRoutes.scenes[lane] && world.lanePolicy.projects.canBegin(actor)) {
          const pose = Object.assign(Object.create(actor), { x: walking.terrainTurn.x, y: walking.terrainTurn.y });
          const guarded = this.guardedTunnels.prove(pose, MAX_ROUTE_PROBES - this.probes);
          this.probes += guarded.probes; this.stats.probes += guarded.probes;
          if (guarded.guardCandidate && world.tunnelRoutes.request(actor, guarded.guardCandidate, walking.terrainTurn)) {
            this.admission.served(actor, Math.min(MAX_ROUTE_PROBES, this.probes));
            this.cache[lane] = { tick: world.tickIndex, key, proposal: null }; this.stats.plans++; return null;
          }
        }
      }
      let observedLong = false, guardedPending = false;
      if (longWall) {
        let up = 0; while (up < 8 && this._ground(actor.x + 1, actor.y - up)) up++;
        if (up === 8) {
          observedLong = true;
          const result = this.tunnels.prove(actor, Math.max(0, MAX_ROUTE_PROBES - this.probes));
          this.probes += result.probes; this.stats.probes += result.probes;
          if (result.proposal) proposal = result.proposal;
          else if (this.probes < MAX_ROUTE_PROBES && world.lanePolicy.projects.canBegin(actor)) {
            const guarded = this.guardedTunnels.prove(actor, MAX_ROUTE_PROBES - this.probes, world.tunnelRoutes.guard(actor));
            this.probes += guarded.probes; this.stats.probes += guarded.probes;
            if (guarded.proposal) proposal = guarded.proposal;
            else if (guarded.guardCandidate) world.tunnelRoutes.request(actor, guarded.guardCandidate);
            guardedPending = !!world.tunnelRoutes.scenes[lane];
          }
        }
      }
      if (!observedLong && !shortTried) bash = this._basher(actor, cliff);
      if (bash) bash.score += world.lanePolicy?.score(actor, bash) || 0;
      if (build && (!bash || build.score > bash.score)) proposal = { ...build, reason: threat ? 'supported-hazard-bypass' : cliff ? 'short-stair-to-ledge' : 'supported-local-gap' };
      else if (!proposal && bash && bash.startX === actor.x) proposal = { ...bash, reason: 'supported-local-tunnel' };
      // A working stair inside the passive corridor is not evidence that the
      // approach needs digging. Let that real job finish before opening a shaft.
      if (!proposal && walking?.failure === 'construction') { this.admission.screened(actor, this.probes); return null; }
      if (!proposal && !guardedPending && world.workerLimits?.diggers && this.probes < MAX_ROUTE_PROBES) {
        const result = this.descents.prove(actor, MAX_ROUTE_PROBES - this.probes, null, world.lanePolicy?.descentPreference(actor));
        this.probes += result.probes; this.stats.probes += result.probes;
        proposal = result.proposal;
        if (result.failure === 'budget') this.exhausted = true;
        if (result.failure === 'unrevealed') this.unrevealed = true;
      }
      if (!proposal && !guardedPending && this.probes < MAX_ROUTE_PROBES) proposal = this._digDescent(actor) || this._mineDescent(actor);
    }
    if (this.unrevealed) proposal = null;
    if (this.exhausted) { proposal = null; this.stats.budgetExhausted++; }
    this.admission.served(actor, Math.min(MAX_ROUTE_PROBES, this.probes));
    this.cache[lane] = { tick: world.tickIndex, key, proposal }; this.stats.plans++;
    return proposal;
  }
  reset() { this.admission.reset(); this.bypasses.reset(); this.tunnels.reset(); this.descents.reset(); this.walking.reset(); this.building.reset(); this.relief.reset(); this.cache.fill(null); this.observations.length = 0; this.adjacentObservations.length = 0; }
  dispose() { this.reset(); this.chains.dispose(); this.admission.dispose(); this.bypasses.dispose(); this.tunnels.dispose(); this.descents.dispose(); this.walking.dispose(); this.building.dispose(); this.localTunnels.dispose(); this.guardedTunnels.dispose(); this.relief.dispose(); this.world = null; }
}
export { ProcgenHazardPlanner, MAX_LOCAL_ROUTE_DISTANCE, MAX_ROUTE_PROBES, ROUTE_LANES_PER_TICK };
