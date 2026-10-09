import { procgenTileRevision } from './ProcgenTerrainRetention.js';
import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { TriggerTypes as Types } from '../../level/TriggerTypes.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';

const WALK_CONTINUATION_DISTANCE = 24;
const WALK_CONTINUATION_STEPS = 64;
const contact = (hazard, x, y) => x + 2 > hazard.x1 && x - 2 < hazard.x2 && y + 1 > hazard.y1 && y - 10 < hazard.y2;
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// Borrow only passive shared owners. A successful observation preserves the
// existing pixels; it never assigns an ability, worker or intended route.
class ProcgenWalkContinuation {
  constructor(world) {
    this.world = world;
    this.actions = { [State.WALKING]: new ActionWalkSystem(), [State.FALLING]: new ActionFallSystem(), [State.JUMPING]: new ActionJumpSystem() };
    this.stats = { proofs: 0, accepted: 0, actionSteps: 0 };
  }
  prove(actor, ground, hazards, maxWork) {
    const world = this.world, left = actor.x, right = left + WALK_CONTINUATION_DISTANCE, top = actor.y - 20, bottom = actor.y + 12;
    const bounds = { x1: left, x2: right + 1, y1: top, y2: bottom + 1 };
    const first = Math.max(0, Math.floor(top / world.laneHeight)), last = Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight));
    const triggers = [];
    for (let lane = first; lane <= last; lane++) {
      for (const task of world.accessTasks[lane] || []) {
        const owner = task.owner;
        if (owner && !owner.removed && !owner.disabled && !owner.failureReason && !owner.terminalReason && owner.action === task.action && task.footprint && overlap(bounds, task.footprint))
          return { safe: false, failure: 'construction', actionSteps: 0 };
      }
      const bucket = world.triggerManager?.byLane[lane] || [];
      if (bucket.length > 64) return { safe: false, failure: 'blocker-observation-limit', actionSteps: 0 };
      triggers.push(...bucket);
    }
    const cells = new Map(), revision = world.terrainRevision, frontier = world.frontierRevision, generation = world.generation;
    maxWork = Math.max(0, Math.trunc(maxWork) || 0);
    const maxSteps = Math.min(WALK_CONTINUATION_STEPS, maxWork);
    let failure = null, steps = 0, fell = false, terrainTurn = null, fullWalkColumn = false, touchedTrigger = false, invalidTurn = false;
    const tiles = new Map();
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { invalidTurn = true; failure ||= 'bounds'; return false; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || (world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x))) { invalidTurn = true; failure ||= 'unrevealed'; return false; }
      const key = (y - top) * (WALK_CONTINUATION_DISTANCE + 1) + x - left;
      if (!cells.has(key)) {
        if (cells.size >= maxWork) { invalidTurn = true; failure ||= 'budget'; return false; }
        cells.set(key, ground(x, y));
        const tile = lane * 0x800000 + chunk; if (!tiles.has(tile)) tiles.set(tile, procgenTileRevision(world, tile));
      }
      return cells.get(key);
    };
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: read,
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!read(x, y + height - i - 1)) return i; fullWalkColumn = height === 8; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (read(x, y + i)) return i + 1; return height + 1; } };
    const interaction = { triggerManager: { trigger(x, y) {
      for (const trigger of triggers) {
        const owner = trigger.owner;
        if (owner && owner !== actor && !owner.removed && !owner.disabled && !owner.failureReason && !owner.terminalReason && owner.action === world.actions[State.BLOCKING] &&
            x >= trigger.x1 && x < trigger.x2 && y >= trigger.y1 && y < trigger.y2) { touchedTrigger = true; return trigger.type; }
      }
      return Types.NO_TRIGGER;
    } } };
    const safe = (x, y) => !hazards.some(hazard => contact(hazard, x, y));
    const copy = new Lemming(actor.x, actor.y, actor.id); copy.setAction(this.actions[State.WALKING]);
    this.stats.proofs++;
    for (; steps < maxSteps && !failure;) {
      const x = copy.x, y = copy.y, walking = copy.action === this.actions[State.WALKING]; fullWalkColumn = false;
      if (!safe(x, y)) { failure = 'hazard'; break; }
      steps++;
      const next = copy.process(level), distance = Math.max(Math.abs(copy.x - x), Math.abs(copy.y - y), 1);
      for (let at = 0; at <= distance; at++) if (!safe(Math.round(x + (copy.x - x) * at / distance), Math.round(y + (copy.y - y) * at / distance))) failure ||= 'hazard';
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && copy.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'termination'; break; }
        copy.setAction(this.actions[next]);
      }
      if (!failure && walking && fullWalkColumn && !copy.lookRight && copy.x === x && next === State.NO_STATE_TYPE) terrainTurn = { x, y, steps: steps - 1 };
      fell ||= copy.action === this.actions[State.FALLING];
      lemmingManagerInteractionMethods.runTrigger.call(interaction, copy, world.tickIndex + steps);
      if (!copy.lookRight) failure ||= 'turn';
      if (!failure && copy.x === right && copy.action === this.actions[State.WALKING] && read(copy.x, copy.y)) { break; }
    }
    if (world.terrainRevision !== revision || world.frontierRevision !== frontier || world.generation !== generation) failure ||= 'changed-terrain';
    if (copy.x !== right || copy.action !== this.actions[State.WALKING] || !read(copy.x, copy.y)) failure ||= steps >= maxSteps ? 'budget' : 'continuation';
    this.stats.actionSteps += steps;
    if (!failure) this.stats.accepted++;
    if (failure !== 'turn' || touchedTrigger || invalidTurn || world.terrainRevision !== revision || world.frontierRevision !== frontier || world.generation !== generation || [...tiles].some(([tile, at]) => procgenTileRevision(world, tile) !== at)) terrainTurn = null;
    return { safe: !failure, failure, actionSteps: steps, fell, x: copy.x, y: copy.y, terrainTurn: terrainTurn && { ...terrainTurn, generation, tiles: [...tiles] } };
  }
  reset() { this.stats.proofs = 0; this.stats.accepted = 0; this.stats.actionSteps = 0; }
  dispose() { this.world = null; }
}
export { ProcgenWalkContinuation, WALK_CONTINUATION_DISTANCE, WALK_CONTINUATION_STEPS };
