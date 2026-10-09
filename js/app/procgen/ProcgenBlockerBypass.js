import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { TriggerTypes as Types } from '../../level/TriggerTypes.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { lemmingManagerInteractionMethods } from '../../lemmings/lemming-manager/LemmingManagerInteraction.js';
const MAX_BYPASS_DISTANCE = 40, MAX_BYPASS_WORK = 1024;
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// A real arriving builder can rise above an existing directional blocker and
// naturally walk/fall onto measured support. Only private copies are stepped;
// live actions, owner triggers, terrain, cooldowns and sound remain untouched.
class ProcgenBlockerBypass {
  constructor(world) {
    this.world = world; this.nearby = []; this.hazards = [];
    const runtime = { soundEvents: { emitSfx() {} } };
    this.actions = { [State.BUILDING]: new ActionBuildSystem(), [State.SHRUG]: new ActionShrugSystem(),
      [State.WALKING]: new ActionWalkSystem(), [State.FALLING]: new ActionFallSystem(), [State.JUMPING]: new ActionJumpSystem() };
    for (const action of Object.values(this.actions)) action.setRuntime(runtime);
    this.runtime = runtime; this.stats = { proofs: 0, accepted: 0, probes: 0, actionSteps: 0 };
  }
  prove(actor, maxWork = MAX_BYPASS_WORK) {
    const world = this.world;
    if (!world?.terrain || !world.workerLimits.builders || actor?.action !== world.actions[State.WALKING] || !actor.lookRight || actor.canClimb || actor.hasParachute || actor.failureReason || actor.terminalReason || actor.removed) return { proposal: null, probes: 0 };
    const triggers = world.triggerManager?.byLane[actor.laneIndex] || [];
    if (triggers.length > 64) return { proposal: null, probes: 0, failure: 'blocker-observation-limit' };
    const target = triggers.find(trigger => trigger.type === Types.BLOCKER_LEFT && trigger.owner?.action === world.actions[State.BLOCKING] &&
      !trigger.owner.removed && !trigger.owner.failureReason && !trigger.owner.terminalReason && trigger.owner.x - actor.x >= 26 && trigger.owner.x - actor.x <= 32 && Math.abs(trigger.owner.y - actor.y) <= 2);
    if (!target) return { proposal: null, probes: 0 };
    maxWork = Math.max(0, Math.min(MAX_BYPASS_WORK, Math.trunc(maxWork) || 0)); this.stats.proofs++;
    const left = Math.max(world.leftEdgeX, actor.x - 16), right = actor.x + MAX_BYPASS_DISTANCE, top = actor.y - 24, bottom = actor.y + 13;
    const bounds = { x1: left, x2: right + 1, y1: top, y2: bottom + 1 };
    for (const task of world.accessTasks[actor.laneIndex] || []) if (task.owner?.action === task.action && task.footprint && overlap(bounds, task.footprint)) return { proposal: null, probes: 0, failure: 'construction' };
    const cells = new Map(), edits = new Set(); let probes = 0, actionSteps = 0, failure = null, fell = false, landing = null;
    const read = (x, y) => {
      if (x < left || x > right || y < top || y > bottom || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk)) { failure ||= 'unrevealed'; return 0; }
      const key = y * (MAX_BYPASS_DISTANCE + 17) + x - left;
      if (!cells.has(key)) {
        if (probes >= maxWork) { failure ||= 'budget'; return 0; }
        probes++; cells.set(key, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
      }
      return edits.has(key) ? 1 : cells.get(key);
    };
    // Returning followers need a physical rear wall or an existing real edge
    // blocker within this same observation. Open-left scenes are rejected.
    let contained = false;
    for (let x = actor.x; x >= left && !failure; x--) {
      let up = 0; while (up < 8 && read(x, actor.y - up) & 1) up++;
      if (up === 8) { contained = true; break; }
      if (up !== 1) break;
    }
    const edge = world.edgeBlockers[actor.laneIndex];
    if (edge?.action === world.actions[State.BLOCKING] && !edge.removed && !edge.failureReason && !edge.terminalReason && edge.x >= left && edge.x < actor.x && Math.abs(edge.y - actor.y) <= 2 && world.triggerManager.byOwner.has(edge)) contained = true;
    if (!contained) failure ||= 'return-containment';
    this.hazards.length = 0;
    for (let lane = Math.max(0, Math.floor(top / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor(bottom / world.laneHeight)); lane++) {
      world.hazards.nearby(lane, actor.x, { behind: actor.x - left, ahead: MAX_BYPASS_DISTANCE }, this.nearby);
      if (this.nearby.length >= 8) failure ||= 'hazard-observation-limit';
      this.hazards.push(...this.nearby);
    }
    const safe = (lem) => !this.hazards.some(h => lem.x + 2 > h.x1 && lem.x - 2 < h.x2 && lem.y + 1 > h.y1 && lem.y - 10 < h.y2);
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level,
      hasGroundAt: (x, y) => !!(read(x, y) & 1), isArrowAt: (...args) => world.isArrowAt(...args),
      setGroundAt(x, y) { if (read(x, y) & 2 || world.isArrowAt(x, y, true)) { failure ||= 'protected'; return; } edits.add(y * (MAX_BYPASS_DISTANCE + 17) + x - left); },
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; } };
    const contact = { triggerManager: { trigger(x, y) {
      for (const trigger of triggers) if (trigger.owner.action === world.actions[State.BLOCKING] && !trigger.owner.removed && !trigger.owner.failureReason && x >= trigger.x1 && x < trigger.x2 && y >= trigger.y1 && y < trigger.y2) return trigger.type;
      return Types.NO_TRIGGER;
    } } };
    const worker = new Lemming(actor.x, actor.y, actor.id, this.runtime); worker.lookRight = true; worker.setAction(this.actions[State.BUILDING]);
    for (let tick = 1; tick <= 256 && !failure; tick++) {
      if (actionSteps >= maxWork) { failure ||= 'budget'; break; }
      actionSteps++; const next = worker.process(level);
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && worker.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) { failure ||= 'terminal'; break; }
        worker.setAction(this.actions[next]);
      }
      if (!safe(worker)) { failure ||= 'hazard'; break; }
      lemmingManagerInteractionMethods.runTrigger.call(contact, worker, tick);
      if (!worker.lookRight) { failure ||= 'blocker-contact'; break; }
      if (worker.action === this.actions[State.FALLING]) fell = true;
      if (fell && worker.action === this.actions[State.WALKING]) landing ||= { x: worker.x, y: worker.y, tick };
      if (worker.action === this.actions[State.WALKING] && landing && worker.x >= target.owner.x + 8) break;
    }
    if (!landing || worker.action !== this.actions[State.WALKING] || worker.x < target.owner.x + 8 || !level.hasGroundAt(worker.x, worker.y)) failure ||= 'landing';
    // Screen the retained landing/forward corridor with the same feet/up rules.
    for (let x = target.owner.x; x <= Math.min(right, target.owner.x + 8) && !failure; x++) if (!(read(x, landing.y) & 1)) failure ||= 'landing-support';
    this.stats.probes += probes; this.stats.actionSteps += actionSteps;
    const proposal = failure ? null : { kind: 'builders', targetX: worker.x, footprint: { x1: actor.x, x2: right, y1: top, y2: bottom + 1 },
      reason: 'supported-blocker-bypass', score: 110, estimatedTicks: actionSteps, materialCost: 12,
      routeEvidence: { blockerId: target.owner.id, naturalFall: true, landingX: landing.x, landingY: landing.y, rearContainment: 'observed-physical-owner', independentQualification: false } };
    if (proposal) this.stats.accepted++;
    return { proposal, probes, actionSteps, failure };
  }
  reset() { this.nearby.length = 0; this.hazards.length = 0; }
  dispose() { this.reset(); this.world = null; }
}
export { ProcgenBlockerBypass, MAX_BYPASS_DISTANCE, MAX_BYPASS_WORK };
