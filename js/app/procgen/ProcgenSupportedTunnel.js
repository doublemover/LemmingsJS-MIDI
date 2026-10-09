import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';

const MAX_SUPPORTED_TUNNEL_DISTANCE = 112;
const MAX_RETURN_DISTANCE = 64;
const MAX_TUNNEL_PROBES = 1024;
const MAX_TUNNEL_TICKS = 384;
const hazardContact = (hazard, x, y) => x + 2 > hazard.x1 && x - 2 < hazard.x2 && y + 1 > hazard.y1 && y - 10 < hazard.y2;
const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// This bounded cold decision executes the shared actions on private observed
// cells. It neither changes runtime actors/terrain nor substitutes action rules.
class ProcgenSupportedTunnel {
  constructor(world) {
    this.world = world; this.bash = new ActionBashSystem(); this.walk = new ActionWalkSystem();
    this.cache = new Array(world.laneCount); this.hazards = []; this.nearby = [];
    this.stats = { proofs: 0, probes: 0, accepted: 0, rejected: 0, cacheHits: 0 };
  }
  _busy(footprint) {
    const world = this.world, first = Math.max(0, Math.floor(footprint.y1 / 96)), last = Math.min(world.laneCount - 1, Math.floor((footprint.y2 - 1) / 96));
    for (let lane = first; lane <= last; lane++) for (const task of world.accessTasks[lane] || []) {
      const owner = task.owner;
      if (owner && !owner.removed && !owner.disabled && !owner.failureReason && !owner.terminalReason && owner.action === task.action && task.footprint && overlaps(footprint, task.footprint)) return true;
    }
    return false;
  }
  prove(actor, maxProbes) {
    maxProbes = Math.max(0, Math.min(MAX_TUNNEL_PROBES, Math.trunc(maxProbes) || 0));
    if (this._busy({ x1: actor.x - 1, x2: actor.x + 1, y1: actor.y - 10, y2: actor.y + 2 })) return { proposal: null, probes: 0 };
    const world = this.world, firstLane = Math.max(0, Math.floor((actor.y - 10) / 96)), lastLane = Math.min(world.laneCount - 1, Math.floor((actor.y + 3) / 96));
    const firstChunk = Math.floor(Math.max(world.leftEdgeX, actor.x - MAX_RETURN_DISTANCE) / world.terrain.chunkWidth), lastChunk = Math.floor((actor.x + MAX_SUPPORTED_TUNNEL_DISTANCE) / world.terrain.chunkWidth);
    let key = `${world.generation}:${actor.x}:${actor.y}`;
    for (let lane = firstLane; lane <= lastLane; lane++) {
      key += `:${Math.min(world.generatedThrough[lane], actor.x + MAX_SUPPORTED_TUNNEL_DISTANCE + 1)}`;
      for (let chunk = firstChunk; chunk <= lastChunk; chunk++) key += `:${world.terrainTileRevisions.get(lane * 0x800000 + chunk) || 0}`;
    }
    const cached = this.cache[actor.laneIndex];
    if (cached?.key === key && (cached.failure !== 'budget' || cached.maxProbes >= maxProbes)) { this.stats.cacheHits++; return { proposal: cached.proposal && !this._busy(cached.proposal.footprint) ? cached.proposal : null, probes: 0 }; }
    const cells = new Map(), startX = actor.x, startY = actor.y, left = Math.max(world.leftEdgeX, startX - MAX_RETURN_DISTANCE), right = startX + MAX_SUPPORTED_TUNNEL_DISTANCE;
    let failure = null, probes = 0, observedX = startX;
    const read = (x, y) => {
      if (x < left || x > right || y < startY - 10 || y > startY + 3 || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / 96), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk)) { failure ||= 'unrevealed'; return 0; }
      const at = (y - startY + 10) * (right - left + 1) + x - left;
      if (!cells.has(at)) {
        if (++probes > maxProbes) { failure ||= 'budget'; return 0; }
        observedX = Math.max(observedX, x);
        cells.set(at, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
      }
      return cells.get(at);
    };
    const safe = lem => !this.hazards.some(hazard => hazardContact(hazard, lem.x, lem.y));
    const laneFirst = Math.max(0, Math.floor((startY - 10) / 96)), laneLast = Math.min(world.laneCount - 1, Math.floor((startY + 3) / 96));
    this.hazards.length = 0;
    for (let lane = laneFirst; lane <= laneLast; lane++) for (const [x, ahead, behind] of [[startX - 32, 32, 32], [startX, 64, 0], [startX + 64, 48, 0]]) {
      world.hazards.nearby(lane, x, { ahead, behind }, this.nearby); this.hazards.push(...this.nearby);
    }
    const level = {
      getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; },
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      hasSteelUnderMask(mask, x, y) {
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 2) return true;
        return false;
      },
      clearGroundWithMaskCount(mask, x, y) {
        if (world.hasArrowUnderMask(mask, x, y, true)) { failure ||= 'arrows'; return 0; }
        let removed = 0;
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) {
          const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy, before = read(px, py);
          if (before & 2) { failure ||= 'steel'; continue; }
          if (before & 1) { cells.set((py - startY + 10) * (right - left + 1) + px - left, 0); removed++; }
        }
        return removed;
      }
    };
    const copy = lookRight => ({ id: actor.id, x: startX, y: startY, frameIndex: 0, state: 0, canClimb: false, lookRight,
      getDirection() { return this.lookRight ? 'right' : 'left'; } });
    // A naturally bouncing wall within the observed return corridor contains
    // ordinary followers. An open rear edge is not inferred safe from a hero.
    const returning = copy(false); let rearX = null;
    for (let tick = 0; tick < MAX_RETURN_DISTANCE && !failure; tick++) {
      if (!safe(returning) || !level.hasGroundAt(returning.x, returning.y)) { failure ||= 'return'; break; }
      const state = this.walk.process(level, returning);
      if (state !== State.NO_STATE_TYPE || returning.y !== startY || !safe(returning)) { failure ||= 'return'; break; }
      if (returning.lookRight) { rearX = returning.x - 1; break; }
    }
    if (rearX == null) failure ||= 'containment';
    const lem = copy(true); this.bash.masks = world.actions[State.BASHING].masks;
    let ticks = 0, completed = false;
    for (; ticks < MAX_TUNNEL_TICKS && !failure; ticks++) {
      if (!safe(lem) || !level.hasGroundAt(lem.x, lem.y)) { failure ||= 'support'; break; }
      const state = this.bash.process(level, lem);
      if (lem.y !== startY || !safe(lem)) { failure ||= 'support'; break; }
      if (state === State.WALKING) { ticks++; completed = true; break; }
      if (state !== State.NO_STATE_TYPE) { failure ||= 'termination'; break; }
    }
    if (!completed || lem.x - startX <= 24) failure ||= 'termination';
    const endX = lem.x;
    for (let tick = 0; tick < 8 && !failure; tick++) {
      const state = this.walk.process(level, lem);
      if (state !== State.NO_STATE_TYPE || !lem.lookRight || lem.y !== startY || !safe(lem)) failure ||= 'continuation';
    }
    const footprint = { x1: rearX ?? startX - 1, x2: Math.max(lem.x, observedX) + 1, y1: startY - 10, y2: startY + 2 };
    const proposal = failure ? null : { kind: 'bashers', targetX: startX + 1, startX, footprint, continuationY: startY,
      estimatedTicks: ticks, materialCost: 0, reason: 'observed-contained-tunnel',
      routeEvidence: { sharedAction: 'bashing', naturalWalkingTick: ticks, exitX: endX, rearWallX: rearX, observedThrough: observedX + 1,
        probes, wholeCrewContainment: 'observed-wall', independentQualification: false } };
    this.cache[actor.laneIndex] = { key, proposal, failure, maxProbes }; this.stats.proofs++; this.stats.probes += Math.min(probes, maxProbes);
    this.stats[proposal ? 'accepted' : 'rejected']++;
    return { proposal: proposal && !this._busy(footprint) ? proposal : null, probes: Math.min(probes, maxProbes) };
  }
  reset() { this.cache.fill(null); this.hazards.length = 0; this.nearby.length = 0; }
  dispose() { this.reset(); this.world = null; this.bash.masks = null; }
}
export { ProcgenSupportedTunnel, MAX_SUPPORTED_TUNNEL_DISTANCE, MAX_RETURN_DISTANCE, MAX_TUNNEL_TICKS, MAX_TUNNEL_PROBES };
