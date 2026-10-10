import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';
import { MAX_LOCAL_ROUTE_DISTANCE as DISTANCE, MAX_ROUTE_PROBES as WORK } from './ProcgenHazardPlanner.js';
import { procgenTileRevision } from './ProcgenTerrainRetention.js';

const GUARD_RECOVERY_STEPS = 64, GUARD_RECOVERY_EXIT = 8;
const rectKey = triggers => triggers.map(t => `${t.type}:${t.x1}:${t.x2}:${t.y1}:${t.y2}`).join(',');
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const contact = (h, x, y) => x + 2 > h.x1 && x - 2 < h.x2 && y + 1 > h.y1 && y - 10 < h.y2;

// Retiring an unstarted proposal does not certify its original route. Observe
// only the real service guard's current empty recovery and local passive exit.
class ProcgenGuardRecovery {
  constructor(world) {
    this.world = world; this.nearby = [];
    this.runtime = { soundEvents: { emitSfx() {} } };
    this.actions = { [State.BASHING]: new ActionBashSystem(), [State.WALKING]: new ActionWalkSystem(),
      [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem() };
    for (const action of Object.values(this.actions)) action.setRuntime(this.runtime);
  }
  validOwner(scene) {
    const world = this.world, actor = scene.guard, triggers = world.triggerManager.byOwner.get(actor) || [];
    return scene.phase === 'guarded' && !scene.worker && !scene.task && !scene.project && actor && actor._tunnelScene === scene &&
      actor.action === world.actions[State.BLOCKING] && actor.x === scene.guardX && actor.y === scene.guardY && actor.lookRight === true &&
      actor.laneIndex === scene.lane && !actor.scout && !actor.canClimb && !actor.hasParachute && !actor.removed && !actor.disabled && !actor.failureReason && !actor.terminalReason &&
      scene.generation === world.generation && triggers.length === 2 && scene.triggerKey === rectKey(triggers);
  }
  prove(scene, maxWork) {
    const world = this.world, actor = scene.guard;
    let failure = null, steps = 0, bashTick = null;
    maxWork = Math.max(0, Math.min(WORK, Math.trunc(maxWork) || 0));
    const fail = reason => ({ safe: false, failure: reason, probes: 0, actionSteps: 0 });
    if (!this.validOwner(scene)) return fail('guard-identity');
    const left = actor.x - DISTANCE, right = actor.x + DISTANCE, top = actor.y - 24, bottom = actor.y + 32;
    const bounds = { x1: actor.x - 2, x2: actor.x + 3, y1: actor.y - 10, y2: actor.y + 2 };
    const touch = (x, y) => { bounds.x1 = Math.min(bounds.x1, x); bounds.x2 = Math.max(bounds.x2, x + 1); bounds.y1 = Math.min(bounds.y1, y); bounds.y2 = Math.max(bounds.y2, y + 1); };
    const claims = [];
    const cells = new Map(), tiles = new Map(), hazards = [], triggers = [];
    const generation = world.generation, revision = world.terrainRevision, frontier = world.frontierRevision;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || x < world.leftEdgeX || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x)) { failure ||= 'unrevealed'; return 0; }
      touch(x, y); const key = `${x}:${y}`;
      if (!cells.has(key)) {
        if (cells.size + steps >= maxWork) { failure ||= 'budget'; return 0; }
        cells.set(key, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
        const tile = lane * 0x800000 + chunk; tiles.set(tile, procgenTileRevision(world, tile));
      }
      return cells.get(key);
    };
    for (let lane = Math.max(0, Math.floor(top / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight)); lane++) {
      for (const task of world.accessTasks[lane] || []) if (task.owner && !task.owner.removed && !task.owner.failureReason && !task.owner.disabled && !task.owner.terminalReason && task.owner.action === task.action && task.footprint) claims.push(task.footprint);
      world.hazards.nearby(lane, actor.x, { ahead: DISTANCE, behind: DISTANCE }, this.nearby);
      if (this.nearby.length >= 8) failure ||= 'hazard-limit'; hazards.push(...this.nearby);
      const bucket = world.triggerManager.byLane[lane] || [];
      if (bucket.length > 64) failure ||= 'blocker-limit'; else triggers.push(...bucket);
    }
    const masks = world.actions[State.BASHING].masks?.get(actor.getDirection());
    this.actions[State.BASHING].masks = world.actions[State.BASHING].masks;
    for (let index = 0; index < 4 && !failure; index++) {
      const mask = masks?.GetMask(index); if (!mask) { failure = 'masks'; break; }
      if (world.hasArrowUnderMask(mask, actor.x, actor.y, actor.lookRight)) failure ||= 'arrows';
      for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(actor.x + mask.offsetX + dx, actor.y + mask.offsetY + dy) & 1) failure ||= 'occupied-mask';
    }
    if (!read(actor.x, actor.y) || !read(actor.x, actor.y + 1)) failure ||= 'support';
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      hasSteelUnderMask(mask, x, y) { for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 2) return true; return false; },
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      clearGroundWithMaskCount(mask, x, y) { for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 1) failure ||= 'occupied-mask'; return 0; },
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; } };
    const interaction = { triggerManager: { trigger(x, y) {
      for (const t of triggers) if (t.owner !== actor && !t.owner.removed && !t.owner.disabled && !t.owner.failureReason && !t.owner.terminalReason && t.owner.action === world.actions[State.BLOCKING] && x >= t.x1 && x < t.x2 && y >= t.y1 && y < t.y2) return t.type;
      return TriggerTypes.NO_TRIGGER;
    } } };
    const safe = (x, y) => !hazards.some(h => contact(h, x, y));
    const copy = new Lemming(actor.x, actor.y, actor.id, this.runtime); copy.lookRight = actor.lookRight; copy.setAction(this.actions[State.BASHING]);
    for (; steps < GUARD_RECOVERY_STEPS && !failure;) {
      if (cells.size + steps >= maxWork) { failure = 'budget'; break; }
      if (!safe(copy.x, copy.y)) { failure = 'hazard'; break; }
      const x = copy.x, y = copy.y; steps++; const next = copy.process(level);
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && copy.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'terminal'; break; }
        copy.setAction(this.actions[next]);
      }
      const distance = Math.max(Math.abs(copy.x - x), Math.abs(copy.y - y), 1);
      for (let at = 0; at <= distance; at++) if (!safe(Math.round(x + (copy.x - x) * at / distance), Math.round(y + (copy.y - y) * at / distance))) failure ||= 'hazard';
      touch(copy.x - 2, copy.y - 10); touch(copy.x + 2, copy.y + 1);
      lemmingManagerInteractionMethods.runTrigger.call(interaction, copy, world.tickIndex + steps);
      if (bashTick == null && copy.action === this.actions[State.WALKING]) bashTick = steps;
      if (bashTick != null && copy.action === this.actions[State.WALKING] && Math.abs(copy.x - actor.x) >= GUARD_RECOVERY_EXIT && read(copy.x, copy.y) & 1) break;
    }
    if (bashTick == null || copy.action !== this.actions[State.WALKING] || Math.abs(copy.x - actor.x) < GUARD_RECOVERY_EXIT || !(read(copy.x, copy.y) & 1)) failure ||= 'passive-exit';
    if (claims.some(claim => overlap(bounds, claim))) failure ||= 'construction';
    if (world.generation !== generation || world.terrainRevision !== revision || world.frontierRevision !== frontier) failure ||= 'changed-terrain';
    return { safe: !failure, failure, probes: cells.size + steps, actionSteps: steps, bashTick, x: copy.x, y: copy.y, lookRight: copy.lookRight, bounds, tiles: [...tiles] };
  }
  reset() { this.nearby.length = 0; }
  dispose() { this.reset(); this.world = null; }
}
export { ProcgenGuardRecovery, GUARD_RECOVERY_STEPS, GUARD_RECOVERY_EXIT };
