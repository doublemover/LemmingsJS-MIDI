import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';

const BUILD_EXIT_DISTANCE = 8, BUILD_ACTION_STEPS = 264;
const contact = (h, x, y) => x + 2 > h.x1 && x - 2 < h.x2 && y + 1 > h.y1 && y - 10 < h.y2;
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// Rehearse the shared owners on a bounded private brick patch. In particular,
// a jagged six-pixel shoulder must complete real JUMP, not an instant y shift.
class ProcgenSupportedBuild {
  constructor(world) {
    this.world = world;
    this.actions = { [State.BUILDING]: new ActionBuildSystem(), [State.SHRUG]: new ActionShrugSystem(),
      [State.WALKING]: new ActionWalkSystem(), [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem() };
    this.runtime = { soundEvents: { emitSfx() {} } };
    for (const action of Object.values(this.actions)) action.setRuntime(this.runtime);
    this.stats = { proofs: 0, accepted: 0, actionSteps: 0, maxWork: 0 };
  }
  prove(actor, ground, hazards, maxWork, requireOpening = false) {
    const world = this.world, left = actor.x - 1, right = actor.x + 40, top = actor.y - 32, bottom = actor.y + 32;
    const footprint = { x1: actor.x, x2: actor.x + 28, y1: actor.y - 12, y2: actor.y + 1 };
    const observedBounds = { x1: left, x2: right + 1, y1: top, y2: bottom + 1 };
    const cells = new Map(), patch = new Set(), triggers = [], generation = world.generation, revision = world.terrainRevision, frontier = world.frontierRevision;
    let failure = null, steps = 0, built = 0, shrugged = false, fell = false;
    maxWork = Math.max(0, Math.trunc(maxWork) || 0);
    for (let lane = Math.max(0, Math.floor(top / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight)); lane++) {
      for (const task of world.accessTasks[lane] || []) if (task.owner && task.owner !== actor && !task.owner.removed && !task.owner.failureReason && !task.owner.terminalReason && task.owner.action === task.action && task.footprint && overlap(observedBounds, task.footprint)) failure ||= 'construction';
      const owned = world.triggerManager?.byLane[lane] || [];
      if (owned.length > 64) failure ||= 'blocker-limit';
      else triggers.push(...owned);
    }
    const key = (x, y) => (y - top) * 42 + x - left;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x)) { failure ||= 'unrevealed'; return 0; }
      const at = key(x, y);
      if (!cells.has(at)) {
        if (cells.size + steps >= maxWork) { failure ||= 'budget'; return 0; }
        cells.set(at, ground(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
      }
      return patch.has(at) ? 1 : cells.get(at);
    };
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      isArrowAt: (...args) => world.isArrowAt(...args),
      setGroundAt(x, y) {
        if (read(x, y) & 2 || world.isArrowAt(x, y, true)) { failure ||= 'protected'; return; }
        patch.add(key(x, y)); built++;
      },
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; } };
    const interaction = { triggerManager: { trigger(x, y) {
      for (const t of triggers) if (t.owner !== actor && !t.owner.removed && !t.owner.disabled && !t.owner.failureReason && !t.owner.terminalReason && t.owner.action === world.actions[State.BLOCKING] && x >= t.x1 && x < t.x2 && y >= t.y1 && y < t.y2) return t.type;
      return TriggerTypes.NO_TRIGGER;
    } } };
    const safe = (x, y) => !hazards.some(h => contact(h, x, y));
    if (!read(actor.x, actor.y) || !safe(actor.x, actor.y)) failure ||= 'launch';
    if (requireOpening && !failure) {
      // This exception is for an actual imminent FALL into an observed deep
      // opening, not every flat floor below the hypothetical brick endpoint.
      const passive = new Lemming(actor.x, actor.y, actor.id, this.runtime); passive.setAction(this.actions[State.WALKING]);
      let opening = false;
      for (let tick = 0; tick < 16 && !failure && passive.x < actor.x + 4; tick++) {
        if (cells.size + steps >= maxWork) { failure ||= 'budget'; break; }
        steps++; const next = passive.process(level);
        if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && passive.action === this.actions[State.JUMPING])) {
          if (!this.actions[next]) { failure ||= 'opening-continuation'; break; }
          passive.setAction(this.actions[next]);
        }
        lemmingManagerInteractionMethods.runTrigger.call(interaction, passive, world.tickIndex + steps);
        if (!passive.lookRight) failure ||= 'turn';
        if (!safe(passive.x, passive.y)) failure ||= 'hazard';
        if (passive.action === this.actions[State.FALLING]) {
          opening = true;
          for (let y = passive.y; y <= bottom && opening && !failure; y++) if (read(passive.x, y)) opening = false;
          break;
        }
      }
      if (!opening) failure ||= 'no-deep-opening';
    }
    const openingSteps = steps;
    const worker = new Lemming(actor.x, actor.y, actor.id, this.runtime); worker.setAction(this.actions[State.BUILDING]);
    this.stats.proofs++;
    for (; steps < BUILD_ACTION_STEPS && !failure;) {
      if (cells.size + steps >= maxWork) { failure ||= 'budget'; break; }
      steps++; const x = worker.x, y = worker.y, next = worker.process(level), distance = Math.max(Math.abs(worker.x - x), Math.abs(worker.y - y), 1);
      for (let at = 0; at <= distance; at++) if (!safe(Math.round(x + (worker.x - x) * at / distance), Math.round(y + (worker.y - y) * at / distance))) failure ||= 'hazard';
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && worker.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'terminal'; break; }
        worker.setAction(this.actions[next]);
      }
      shrugged ||= worker.action === this.actions[State.SHRUG]; fell ||= worker.action === this.actions[State.FALLING];
      lemmingManagerInteractionMethods.runTrigger.call(interaction, worker, world.tickIndex + steps);
      if (!worker.lookRight) failure ||= 'turn';
      if (shrugged && worker.x >= actor.x + 24 + BUILD_EXIT_DISTANCE && worker.action === this.actions[State.WALKING] && read(worker.x, worker.y)) break;
    }
    if (built !== 72 || !shrugged || worker.x < actor.x + 24 + BUILD_EXIT_DISTANCE || worker.action !== this.actions[State.WALKING]) failure ||= 'continuation';
    if (world.generation !== generation || world.terrainRevision !== revision || world.frontierRevision !== frontier) failure ||= 'changed-terrain';
    this.stats.actionSteps += steps; this.stats.maxWork = Math.max(this.stats.maxWork, cells.size + steps); if (!failure) this.stats.accepted++;
    return { safe: !failure, failure, actionSteps: steps, exitTicks: steps - openingSteps, probes: cells.size, built, fell, x: worker.x, y: worker.y, footprint };
  }
  reset() {}
  dispose() { this.world = null; }
}
export { ProcgenSupportedBuild, BUILD_EXIT_DISTANCE, BUILD_ACTION_STEPS };
