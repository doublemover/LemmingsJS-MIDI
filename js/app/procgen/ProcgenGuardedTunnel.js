import { procgenTileRevision } from './ProcgenTerrainRetention.js';
import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';

const GUARDED_TUNNEL_STEPS = 384, GUARDED_TUNNEL_DISTANCE = 112;
const contact = (h, x, y) => x + 2 > h.x1 && x - 2 < h.x2 && y + 1 > h.y1 && y - 10 < h.y2;
class ProcgenGuardedTunnel {
  constructor(world) {
    this.world = world; this.nearby = []; this.hazards = [];
    this.runtime = { soundEvents: { emitSfx() {} } };
    this.actions = { [State.BASHING]: new ActionBashSystem(), [State.WALKING]: new ActionWalkSystem(), [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem() };
    for (const action of Object.values(this.actions)) action.setRuntime(this.runtime);
    this.stats = { proofs: 0, accepted: 0, maxWork: 0, maxActions: 0 };
  }
  prove(actor, maxWork, guard = null) {
    const world = this.world, left = actor.x - 16, right = actor.x + GUARDED_TUNNEL_DISTANCE, top = actor.y - 16, bottom = actor.y + 32;
    const generation = world.generation, revision = world.terrainRevision, frontier = world.frontierRevision;
    const tiles = new Map(), cells = new Map(), removed = new Set(), triggers = [], key = (x, y) => (y - top) * 129 + x - left;
    let failure = null, steps = 0, bashTicks = 0, terminationTick = null, walkingTick = null, endX = null, rearX = guard?.x ?? actor.x - 14, rearY = guard?.y ?? null;
    maxWork = Math.max(0, Math.min(1024, Math.trunc(maxWork) || 0)); this.stats.proofs++;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x)) { failure ||= 'unrevealed'; return 0; }
      const at = key(x, y);
      if (!cells.has(at)) {
        if (cells.size >= maxWork) { failure ||= 'budget'; return 0; }
        cells.set(at, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
        const tile = lane * 0x800000 + chunk; if (!tiles.has(tile)) tiles.set(tile, procgenTileRevision(world, tile));
      }
      return removed.has(at) ? 0 : cells.get(at);
    };
    this.hazards.length = 0;
    for (let lane = Math.max(0, Math.floor(top / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight)); lane++) {
      for (const [x, ahead, behind] of [[actor.x, 64, 16], [actor.x + 64, 48, 0]]) { world.hazards.nearby(lane, x, { ahead, behind }, this.nearby); this.hazards.push(...this.nearby); }
      const bucket = world.triggerManager.byLane[lane] || []; if (bucket.length > 64) failure ||= 'blocker-limit'; else triggers.push(...bucket);
      for (const task of world.accessTasks[lane] || []) if (task.owner && task.owner !== actor && task.owner.action === task.action && task.footprint && task.footprint.x1 < right && task.footprint.x2 > left && task.footprint.y1 < bottom && task.footprint.y2 > top) failure ||= 'construction';
    }
    const safe = lem => !this.hazards.some(h => contact(h, lem.x, lem.y));
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; },
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      hasSteelUnderMask(mask, x, y) { for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 2) return true; return false; },
      clearGroundWithMaskCount(mask, x, y) {
        if (world.hasArrowUnderMask(mask, x, y, true)) { failure ||= 'arrows'; return 0; }
        let count = 0;
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) {
          const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy, before = read(px, py);
          if (before & 2) { failure ||= 'steel'; continue; }
          if (before & 1) { removed.add(key(px, py)); count++; }
        }
        return count;
      }
    };
    const interaction = { triggerManager: { trigger(x, y) {
      for (const t of triggers) if (t.owner !== actor && !t.owner.removed && !t.owner.disabled && !t.owner.failureReason && !t.owner.terminalReason && t.owner.action === world.actions[State.BLOCKING] && x >= t.x1 && x < t.x2 && y >= t.y1 && y < t.y2) return t.type;
      return TriggerTypes.NO_TRIGGER;
    } } };
    const copy = (x, y, state, right = true) => { const lem = new Lemming(x, y, actor.id, this.runtime); lem.lookRight = right; lem.setAction(this.actions[state]); return lem; };
    const step = lem => {
      if (steps >= GUARDED_TUNNEL_STEPS || cells.size >= maxWork) { failure ||= 'budget'; return; }
      if (!safe(lem)) { failure ||= 'hazard'; return; }
      steps++; const x = lem.x, y = lem.y, next = lem.process(level), distance = Math.max(Math.abs(lem.x - x), Math.abs(lem.y - y), 1);
      for (let at = 0; at <= distance; at++) if (!safe({ x: Math.round(x + (lem.x - x) * at / distance), y: Math.round(y + (lem.y - y) * at / distance) })) failure ||= 'hazard';
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && lem.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'terminal'; return; } lem.setAction(this.actions[next]);
      }
      lemmingManagerInteractionMethods.runTrigger.call(interaction, lem, world.tickIndex + steps);
      if (!safe(lem)) failure ||= 'hazard';
    };
    // Observe the real shallow return descent before cutting. A proposed port
    // only requests a future actor; it is not an invented physical trigger.
    const returning = copy(actor.x, actor.y, State.WALKING, false);
    for (let tick = 0; tick < 64 && !failure; tick++) {
      step(returning);
      if (guard && returning.lookRight && returning.action === this.actions[State.WALKING]) break;
      if (!guard && returning.x <= rearX + 4 && returning.action === this.actions[State.WALKING] && read(returning.x, returning.y)) {
        rearY = returning.y; if (!read(rearX, rearY) || !read(rearX, rearY + 1)) failure ||= 'return'; break;
      }
    }
    if (guard ? !returning.lookRight : rearY == null) failure ||= 'return';
    this.actions[State.BASHING].masks = world.actions[State.BASHING].masks;
    if (!guard && !failure) {
      const masks = this.actions[State.BASHING].masks?.get('right');
      for (let index = 0; index < 4 && !failure; index++) {
        const mask = masks?.GetMask(index); if (!mask) { failure = 'masks'; break; }
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(rearX + mask.offsetX + dx, rearY + mask.offsetY + dy)) failure ||= 'blocked-recovery';
      }
    }
    const worker = copy(actor.x, actor.y, State.BASHING);
    for (; bashTicks < 384 && !failure; bashTicks++) {
      step(worker);
      if (!worker.lookRight) { failure ||= 'turn'; break; }
      if (endX == null && worker.action !== this.actions[State.BASHING]) { endX = worker.x; terminationTick = bashTicks + 1; }
      if (endX != null && worker.action === this.actions[State.WALKING]) walkingTick ??= bashTicks + 1;
      if (endX != null && worker.action === this.actions[State.WALKING] && worker.x >= endX + 8 && read(worker.x, worker.y)) break;
    }
    if (endX == null || endX - actor.x <= 24 || worker.action !== this.actions[State.WALKING] || worker.x < endX + 8) failure ||= 'termination';
    const follower = copy(rearX + 8, rearY, State.WALKING);
    for (let tick = 0; tick < 128 && !failure && follower.x < worker.x; tick++) { step(follower); if (!follower.lookRight) failure ||= 'follower-turn'; }
    if (follower.x < worker.x || follower.action !== this.actions[State.WALKING] || !read(follower.x, follower.y)) failure ||= 'follower-exit';
    if (world.generation !== generation || world.terrainRevision !== revision || world.frontierRevision !== frontier) failure ||= 'changed-terrain';
    const bounds = { x1: rearX, x2: worker.x + 1, y1: top, y2: bottom + 1 }, cost = cells.size;
    this.stats.maxWork = Math.max(this.stats.maxWork, cost); this.stats.maxActions = Math.max(this.stats.maxActions, steps);
    const evidence = { rearBlockerId: guard?.id, guardX: rearX, guardY: rearY, exitX: worker.x, exitY: worker.y, terminationTick, naturalWalkingTick: walkingTick, exitTicks: bashTicks + 1, startX: actor.x, startY: actor.y, actionSteps: steps, observations: cells.size, independentQualification: false };
    if (!failure) this.stats.accepted++;
    return { proposal: failure || !guard ? null : { kind: 'bashers', targetX: actor.x + 1, startX: actor.x, footprint: bounds, continuationY: worker.y, reason: 'observed-guarded-tunnel', estimatedTicks: walkingTick, materialCost: 0, routeEvidence: evidence },
      guardCandidate: !failure && !guard ? evidence : null, probes: cost, failure, actionSteps: steps, tiles: !failure ? [...tiles] : null };
  }
  dispose() { this.hazards.length = 0; this.nearby.length = 0; this.world = null; }
}
export { ProcgenGuardedTunnel, GUARDED_TUNNEL_STEPS, GUARDED_TUNNEL_DISTANCE };
