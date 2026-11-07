import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';

const LOCAL_TUNNEL_STEPS = 192;
const contact = (h, x, y) => x + 2 > h.x1 && x - 2 < h.x2 && y + 1 > h.y1 && y - 10 < h.y2;

// A scalar roof/floor scan cannot predict the basher's four masks or its
// frame-five termination. Rehearse those owners without editing the live world.
class ProcgenLocalTunnel {
  constructor(world) {
    this.world = world;
    this.actions = { [State.BASHING]: new ActionBashSystem(), [State.WALKING]: new ActionWalkSystem(),
      [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem() };
    this.runtime = { soundEvents: { emitSfx() {} } };
    for (const action of Object.values(this.actions)) action.setRuntime(this.runtime);
    this.stats = { proofs: 0, accepted: 0, actionSteps: 0 };
  }
  prove(actor, ground, hazards, maxWork, exitX, captureEdits = false) {
    const world = this.world, left = actor.x - 4, right = actor.x + 40, top = actor.y - 12, bottom = actor.y + 16;
    const cells = new Map(), removed = new Set(), triggers = [];
    const revision = world.terrainRevision, generation = world.generation, frontier = world.frontierRevision;
    let failure = null, steps = 0, bashTicks = 0, excavated = 0, walking = false;
    maxWork = Math.max(0, Math.trunc(maxWork) || 0);
    const key = (x, y) => (y - top) * 45 + x - left;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady?.(lane, x)) { failure ||= 'unrevealed'; return 0; }
      const at = key(x, y);
      if (!cells.has(at)) {
        if (cells.size + steps >= maxWork) { failure ||= 'budget'; return 0; }
        cells.set(at, ground(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
      }
      return removed.has(at) ? 0 : cells.get(at);
    };
    for (let lane = Math.max(0, Math.floor(top / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight)); lane++) {
      const owned = world.triggerManager?.getLaneTriggers(lane) || [];
      if (owned.length > 64) failure ||= 'blocker-limit'; else triggers.push(...owned);
      for (const task of world.accessTasks[lane] || []) {
        const owner = task.owner, bounds = task.footprint;
        if (owner && owner !== actor && !owner.removed && !owner.disabled && !owner.failureReason && !owner.terminalReason && owner.action === task.action && bounds &&
            bounds.x1 <= right && bounds.x2 > left && bounds.y1 <= bottom && bounds.y2 > top) failure ||= 'construction';
      }
    }
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; },
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      hasSteelUnderMask(mask, x, y) {
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 2) return true;
        return false;
      },
      clearGroundWithMaskCount(mask, x, y) {
        if (world.hasArrowUnderMask(mask, x, y, true)) { failure ||= 'arrows'; return 0; }
        let count = 0;
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) {
          const px = x + mask.offsetX + dx, py = y + mask.offsetY + dy, before = read(px, py);
          if (before & 2) { failure ||= 'steel'; continue; }
          if (before & 1) { removed.add(key(px, py)); count++; }
        }
        excavated += count; return count;
      } };
    const interaction = { triggerManager: { trigger(x, y) {
      for (const t of triggers) if (t.owner !== actor && !t.owner.removed && !t.owner.disabled && !t.owner.failureReason && !t.owner.terminalReason && t.owner.action === world.actions[State.BLOCKING] && x >= t.x1 && x < t.x2 && y >= t.y1 && y < t.y2) return t.type;
      return TriggerTypes.NO_TRIGGER;
    } } };
    this.actions[State.BASHING].masks = world.actions[State.BASHING].masks;
    const worker = new Lemming(actor.x, actor.y, actor.id, this.runtime); worker.setAction(this.actions[State.BASHING]);
    const safe = (x, y) => !hazards.some(h => contact(h, x, y));
    this.stats.proofs++;
    for (; steps < LOCAL_TUNNEL_STEPS && !failure;) {
      if (cells.size + steps >= maxWork) { failure = 'budget'; break; }
      if (!safe(worker.x, worker.y)) { failure = 'hazard'; break; }
      steps++; if (!walking) bashTicks++;
      const x = worker.x, y = worker.y, next = worker.process(level), distance = Math.max(Math.abs(worker.x - x), Math.abs(worker.y - y), 1);
      for (let at = 0; at <= distance; at++) if (!safe(Math.round(x + (worker.x - x) * at / distance), Math.round(y + (worker.y - y) * at / distance))) failure ||= 'hazard';
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && worker.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'terminal'; break; }
        worker.setAction(this.actions[next]);
      }
      walking ||= worker.action === this.actions[State.WALKING];
      lemmingManagerInteractionMethods.runTrigger.call(interaction, worker, world.tickIndex + steps);
      if (!worker.lookRight) failure ||= 'turn';
      if (walking && worker.x >= exitX && worker.action === this.actions[State.WALKING] && read(worker.x, worker.y)) break;
    }
    if (!walking || !excavated || worker.x < exitX || worker.action !== this.actions[State.WALKING]) failure ||= 'continuation';
    if (world.terrainRevision !== revision || world.generation !== generation || world.frontierRevision !== frontier) failure ||= 'changed-terrain';
    this.stats.actionSteps += steps; if (!failure) this.stats.accepted++;
    return { safe: !failure, failure, actionSteps: steps, probes: cells.size, bashTicks, excavated, x: worker.x, y: worker.y,
      ...(captureEdits && !failure ? { removedCells: [...removed].map(at => [left + at % 45, top + Math.floor(at / 45)]) } : {}) };
  }
  dispose() { this.world = null; this.actions[State.BASHING].masks = null; }
}
export { ProcgenLocalTunnel, LOCAL_TUNNEL_STEPS };
