import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';

const RELIEF_DISTANCE = 40, RELIEF_DROP = 32, RELIEF_ACTION_STEPS = 384, RELIEF_WORK = 1024;
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const contact = (h, x, y) => x + 2 > h.x1 && x - 2 < h.x2 && y + 1 > h.y1 && y - 10 < h.y2;

// A short real BASH may stop an otherwise fatal ascent by naturally entering
// FALL. Observe ordinary entry and the actual rear blocker before assignment.
class ProcgenSupportedRelief {
  constructor(world) {
    this.world = world; this.hazards = []; this.nearby = [];
    this.actions = { [State.BASHING]: new ActionBashSystem(), [State.WALKING]: new ActionWalkSystem(),
      [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem() };
    this.stats = { proofs: 0, accepted: 0, candidates: 0, maxWork: 0, maxActions: 0 };
  }
  prove(actor, maxWork, rearGuard = null) {
    const world = this.world;
    if (!world || !actor || actor.runtime !== world.runtime || actor.action !== world.actions[State.WALKING] || !actor.lookRight || actor.scout ||
        actor.canClimb || actor.hasParachute || actor.removed || actor.disabled || actor.failureReason || actor.terminalReason || !world.workerLimits.bashers) return { proposal: null, probes: 0, actionSteps: 0, failure: 'actor' };
    const left = Math.max(world.leftEdgeX, actor.x - 32), right = actor.x + RELIEF_DISTANCE, top = actor.y - 40, bottom = actor.y + RELIEF_DROP + 1;
    const bounds = { x1: left, x2: right + 1, y1: top, y2: bottom + 1 }, generation = world.generation, revision = world.terrainRevision, frontier = world.frontierRevision;
    const guardPose = rearGuard && { x: rearGuard.x, y: rearGuard.y, id: rearGuard.id };
    const cells = new Map(), removed = new Set(), triggers = [], key = (x, y) => (y - top) * (right - left + 1) + x - left;
    let terminalState = null, failure = null, steps = 0, fallingTick = null, walkingTick = null, contactOwner = null, minX = actor.x, maxX = actor.x, minY = actor.y, maxY = actor.y;
    maxWork = Math.max(0, Math.min(RELIEF_WORK, Math.trunc(maxWork) || 0)); this.stats.proofs++;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth), at = key(x, y);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x)) { failure ||= 'unrevealed'; return 0; }
      if (!cells.has(at)) {
        if (cells.size + steps >= maxWork) { failure ||= 'budget'; return 0; }
        cells.set(at, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return removed.has(at) ? 0 : cells.get(at);
    };
    this.hazards.length = 0;
    const firstLane = Math.max(0, Math.floor(top / world.laneHeight)), lastLane = Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight));
    for (let lane = Math.max(0, firstLane - 1); lane <= Math.min(world.laneCount - 1, lastLane + 1); lane++) {
      const bucket = world.triggerManager?.byLane[lane] || [];
      if (bucket.length > 64) failure ||= 'blocker-limit';
      else for (const t of bucket) if (t.owner && t.owner !== actor && !t.owner.removed && !t.owner.disabled && !t.owner.failureReason && !t.owner.terminalReason &&
          t.owner.action === world.actions[State.BLOCKING] && overlap(bounds, t)) triggers.push({ x1: t.x1, x2: t.x2, y1: t.y1, y2: t.y2, type: t.type, ownerId: t.owner.id });
    }
    for (let lane = firstLane; lane <= lastLane; lane++) {
      for (const task of world.accessTasks[lane] || []) if (task.owner && task.owner !== actor && !task.owner.removed && !task.owner.disabled && !task.owner.failureReason && !task.owner.terminalReason && task.owner.action === task.action && task.footprint && overlap(bounds, task.footprint)) failure ||= 'construction';
      world.hazards.nearby(lane, actor.x, { ahead: 40, behind: 32 }, this.nearby);
      if (this.nearby.length >= 8) failure ||= 'hazard-limit'; else this.hazards.push(...this.nearby);
    }
    const safe = (x, y) => !this.hazards.some(h => contact(h, x, y));
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; },
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      hasSteelUnderMask(mask, x, y) { for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 2) return true; return false; },
      clearGroundWithMaskCount(mask, x, y) {
        if (world.hasArrowUnderMask(mask, x, y, true)) { failure ||= 'protected'; return 0; }
        let count = 0;
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) {
          const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy, before = read(px, py);
          if (before & 2) { failure ||= 'protected'; continue; }
          if (before & 1) { removed.add(key(px, py)); count++; }
        }
        return count;
      }
    };
    const interaction = { triggerManager: { trigger(x, y, lem) {
      for (const t of triggers) if (x >= t.x1 && x < t.x2 && y >= t.y1 && y < t.y2) {
        if (t.type === TriggerTypes.BLOCKER_RIGHT && !lem.lookRight || t.type === TriggerTypes.BLOCKER_LEFT && lem.lookRight) contactOwner = t.ownerId;
        return t.type;
      }
      return TriggerTypes.NO_TRIGGER;
    } } };
    const copy = (x, y, state, lookRight = true) => { const lem = new Lemming(x, y, actor.id); lem.lookRight = lookRight; lem.setAction(this.actions[state]); return lem; };
    const advance = lem => {
      if (steps >= RELIEF_ACTION_STEPS || cells.size + steps >= maxWork) { failure ||= 'budget'; return; }
      steps++; const x = lem.x, y = lem.y;
      if (!safe(x, y)) { failure ||= 'hazard'; return; }
      const next = lem.process(level), distance = Math.max(Math.abs(lem.x - x), Math.abs(lem.y - y), 1);
      for (let at = 0; at <= distance; at++) if (!safe(Math.round(x + (lem.x - x) * at / distance), Math.round(y + (lem.y - y) * at / distance))) failure ||= 'hazard';
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && lem.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { terminalState = next; failure ||= 'terminal'; return; } lem.setAction(this.actions[next]);
      }
      lemmingManagerInteractionMethods.runTrigger.call(interaction, lem, world.tickIndex + steps);
    };
    const forward = lem => {
      for (let tick = 0; tick < 128 && !failure && !(lem.x >= right && lem.action === this.actions[State.WALKING]); tick++) { advance(lem); if (!lem.lookRight) failure ||= 'turn'; }
      if (lem.x < right || lem.action !== this.actions[State.WALKING] || !read(lem.x, lem.y)) failure ||= 'continuation';
    };
    if (!read(actor.x, actor.y) || !safe(actor.x, actor.y)) failure ||= 'launch';
    // An unresolved bound is not evidence that excavation is useful. Require
    // the unchanged shared walk to encounter a real fatal fall in this window.
    const passive = copy(actor.x, actor.y, State.WALKING); forward(passive);
    const passiveFailure = failure, passiveTerminal = terminalState;
    if (!passiveFailure) failure = 'passive-safe';
    else if (passiveFailure === 'terminal' && passiveTerminal === State.SPLATTING) failure = null;
    else failure = passiveFailure;
    terminalState = null;
    this.actions[State.BASHING].masks = world.actions[State.BASHING].masks;
    const worker = copy(actor.x, actor.y, State.BASHING);
    for (let tick = 1; tick <= 32 && !failure; tick++) {
      advance(worker);
      if (!worker.lookRight) failure ||= 'turn';
      if (worker.action === this.actions[State.FALLING]) fallingTick ??= tick;
      if (worker.action === this.actions[State.WALKING]) { walkingTick = tick; break; }
    }
    if (fallingTick == null || walkingTick == null || !removed.size) failure ||= 'not-short-relief';
    const landingX = worker.x, landingY = worker.y;
    forward(worker);
    const entry = copy(actor.x, actor.y, State.WALKING); forward(entry);
    const forwardSafe = !failure;
    let guardX = rearGuard?.x ?? null, guardY = rearGuard?.y ?? null;
    if (forwardSafe) {
      const returning = copy(actor.x, actor.y, State.WALKING, false); contactOwner = null;
      for (let tick = 0; tick < 64 && !failure; tick++) {
        advance(returning);
        if (rearGuard && returning.lookRight) break;
        if (!rearGuard && returning.x <= actor.x - 28 && returning.action === this.actions[State.WALKING] && read(returning.x, returning.y) && read(returning.x, returning.y + 1)) { guardX = returning.x - 4; guardY = returning.y; break; }
      }
      if (rearGuard) {
        const owned = world.triggerManager?.byOwner.get(rearGuard) || [];
        const liveRight = owned.some(t => t.type === TriggerTypes.BLOCKER_RIGHT && t.x1 === rearGuard.x + 4 && t.x2 === rearGuard.x + 7 && t.y1 === rearGuard.y - 10 && t.y2 === rearGuard.y + 4);
        if (!liveRight || contactOwner !== rearGuard.id || !returning.lookRight || rearGuard.runtime !== world.runtime || rearGuard.action !== world.actions[State.BLOCKING] ||
            rearGuard.removed || rearGuard.disabled || rearGuard.failureReason || rearGuard.terminalReason || !read(rearGuard.x, rearGuard.y + 1)) failure ||= 'containment';
        forward(returning);
      } else if (guardX == null || !read(guardX, guardY) || !read(guardX, guardY + 1)) failure ||= 'return';
    }
    if (!failure && guardX != null) {
      const masks = world.actions[State.BASHING].masks?.get('right');
      for (let index = 0; index < 4 && !failure; index++) {
        const mask = masks?.GetMask(index); if (!mask) { failure = 'masks'; break; }
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(guardX + mask.offsetX + dx, guardY + mask.offsetY + dy)) failure ||= 'blocked-recovery';
      }
    }
    if (rearGuard && (rearGuard.id !== guardPose.id || rearGuard.x !== guardPose.x || rearGuard.y !== guardPose.y || rearGuard.action !== world.actions[State.BLOCKING] || rearGuard.removed || rearGuard.disabled)) failure ||= 'changed-guard';
    if (world.generation !== generation || world.terrainRevision !== revision || world.frontierRevision !== frontier) failure ||= 'changed-terrain';
    const cost = cells.size + steps, footprint = { x1: guardX ?? left, x2: right + 1, y1: minY, y2: maxY + 1 };
    const evidence = { startX: actor.x, startY: actor.y, guardX, guardY, rearBlockerId: rearGuard?.id,
      exitX: right, exitY: worker.y, landingX, landingY, fallingTick, naturalWalkingTick: walkingTick, removedPixels: removed.size,
      passiveTerminal, passiveFallDistance: passive.state, actionSteps: steps, observations: cells.size, work: cost, observedBounds: { x1: minX, x2: maxX + 1, y1: minY, y2: maxY + 1 }, independentQualification: false };
    this.stats.maxWork = Math.max(this.stats.maxWork, cost); this.stats.maxActions = Math.max(this.stats.maxActions, steps);
    if (!failure) this.stats[rearGuard ? 'accepted' : 'candidates']++;
    return { proposal: failure || !rearGuard ? null : { kind: 'bashers', targetX: actor.x + 1, startX: actor.x, footprint, continuationY: worker.y,
      estimatedTicks: walkingTick, materialCost: 0, reason: 'observed-guarded-relief', routeEvidence: evidence },
    guardCandidate: !failure && !rearGuard ? evidence : null, forwardSafe, failure, probes: cost, actionSteps: steps };
  }
  reset() { this.hazards.length = 0; this.nearby.length = 0; }
  dispose() { this.reset(); this.world = null; }
}
export { ProcgenSupportedRelief, RELIEF_DISTANCE, RELIEF_DROP, RELIEF_ACTION_STEPS, RELIEF_WORK };



