import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ActionDiggSystem } from '../../actions/ActionDiggSystem.js';
import { ActionMineSystem } from '../../actions/ActionMineSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';

const MAX_DESCENT_DISTANCE = 40;
const MAX_DESCENT_DROP = 32;
const MAX_DESCENT_PROBES = 1024;
const MAX_DESCENT_TICKS = 384;
const contact = (hazard, x, y) => x + 2 > hazard.x1 && x - 2 < hazard.x2 && y + 1 > hazard.y1 && y - 10 < hazard.y2;
const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// A cold local decision borrows real action owners on private observed cells.
// No runtime actor, terrain pixel, trigger, skill resource or sound is changed.
class ProcgenSupportedDescent {
  constructor(world) {
    this.world = world; this.cache = new Array(world.laneCount); this.hazards = []; this.nearby = [];
    this.actions = { [State.DIGGING]: new ActionDiggSystem(), [State.MINING]: new ActionMineSystem(),
      [State.FALLING]: new ActionFallSystem(), [State.WALKING]: new ActionWalkSystem(), [State.JUMPING]: new ActionJumpSystem() };
    this.stats = { proofs: 0, probes: 0, actionSteps: 0, accepted: 0, rejected: 0, cacheHits: 0 };
  }
  _busy(bounds) {
    const world = this.world;
    for (let lane = Math.max(0, Math.floor(bounds.y1 / 96)); lane <= Math.min(world.laneCount - 1, Math.floor((bounds.y2 - 1) / 96)); lane++) {
      for (const task of world.accessTasks[lane] || []) {
        const owner = task.owner;
        if (owner && !owner.removed && !owner.disabled && !owner.failureReason && !owner.terminalReason &&
            owner.action === task.action && task.footprint && overlaps(bounds, task.footprint)) return true;
      }
    }
    return false;
  }
  prove(actor, maxProbes, preferredKind = null) {
    const world = this.world;
    if (!world || !actor || actor.runtime !== world.runtime || actor.action !== world.actions[State.WALKING] || !actor.lookRight ||
        actor.failureReason || actor.removed || actor.disabled || actor.terminalReason || actor.canClimb || actor.hasParachute) return { proposal: null, probes: 0 };
    maxProbes = Math.max(0, Math.min(MAX_DESCENT_PROBES, Math.trunc(maxProbes) || 0));
    if (preferredKind && !['diggers', 'miners'].includes(preferredKind)) return { proposal: null, probes: 0 };
    // MINING deliberately shares the configured digging/mining worker cap.
    if (!world.workerLimits.diggers || this._busy({ x1: actor.x - 8, x2: actor.x + 8, y1: actor.y - 12, y2: actor.y + 33 })) return { proposal: null, probes: 0 };
    const startX = actor.x, startY = actor.y, left = Math.max(world.leftEdgeX, startX - MAX_DESCENT_DISTANCE), right = startX + MAX_DESCENT_DISTANCE;
    const firstLane = Math.max(0, Math.floor((startY - 12) / 96)), lastLane = Math.min(world.laneCount - 1, Math.floor((startY + 33) / 96));
    const firstChunk = Math.floor(left / world.terrain.chunkWidth), lastChunk = Math.floor(right / world.terrain.chunkWidth);
    let key = world.generation + ':' + startX + ':' + startY + ':' + preferredKind;
    for (let lane = firstLane; lane <= lastLane; lane++) {
      key += ':' + Math.min(world.generatedThrough[lane], right + 1);
      for (let chunk = firstChunk; chunk <= lastChunk; chunk++) key += ':' + (world.terrainTileRevisions.get(lane * 0x800000 + chunk) || 0);
    }
    const cached = this.cache[actor.laneIndex];
    if (cached?.key === key && (cached.failure !== 'budget' || cached.maxProbes >= maxProbes)) {
      this.stats.cacheHits++; return { proposal: cached.proposal && !this._busy(cached.proposal.footprint) ? cached.proposal : null, probes: 0, actionSteps: 0, failure: cached.failure };
    }
    const columns = right - left + 1, cells = new Map(), edits = new Set();
    let failure = null, probes = 0, actionSteps = 0, minX = startX, maxX = startX, minY = startY, maxY = startY;
    const address = (x, y) => (y - startY + 12) * columns + x - left;
    const read = (x, y) => {
      if (x < left || x > right || y < startY - 12 || y > startY + 33 || y < 0 || y >= world.height) { failure ||= 'bounds'; return 0; }
      const lane = Math.floor(y / 96), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk)) { failure ||= 'unrevealed'; return 0; }
      const at = address(x, y);
      if (!cells.has(at)) {
        if (probes >= maxProbes) { failure ||= 'budget'; return 0; }
        probes++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        cells.set(at, world.hasGroundAt(x, y) ? 1 | (world.hasSteelAt(x, y) ? 2 : 0) : 0);
      }
      return edits.has(at) ? 0 : cells.get(at);
    };
    const clear = (x, y) => {
      const before = read(x, y);
      if (before & 2 || world.isArrowAt?.(x, y, actor.lookRight)) { failure ||= 'protected'; return 0; }
      if (!(before & 1)) return 0;
      edits.add(address(x, y)); return 1;
    };
    this.hazards.length = 0;
    for (let lane = firstLane; lane <= lastLane; lane++) for (const [x, ahead, behind] of [[startX - 8, 8, 32], [startX, 40, 0]]) {
      world.hazards.nearby(lane, x, { ahead, behind }, this.nearby);
      if (this.nearby.length >= 8) failure ||= 'hazard-observation-limit';
      for (const hazard of this.nearby) if (!this.hazards.some(h => h.lane === hazard.lane && h.x1 === hazard.x1 && h.x2 === hazard.x2 && h.y1 === hazard.y1 && h.y2 === hazard.y2)) this.hazards.push(hazard);
    }
    const safe = (x, y) => !this.hazards.some(hazard => contact(hazard, x, y));
    const level = {
      width: world.width, height: world.height, getGroundMaskLayer: () => level,
      hasGroundAt: (x, y) => !!(read(x, y) & 1), isSteelGround: (x, y) => !!(read(x, y) & 2),
      isOutOfLevel: y => y < 0 || y >= world.height,
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; },
      clearGroundRow(x, y, width) { let removed = 0; for (let dx = 0; dx < width; dx++) removed += clear(x + dx, y); return removed; },
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      hasSteelUnderMask(mask, x, y) {
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy) && read(x + mask.offsetX + dx, y + mask.offsetY + dy) & 2) return true;
        return false;
      },
      clearGroundWithMaskCount(mask, x, y) {
        if (world.hasArrowUnderMask(mask, x, y, true)) { failure ||= 'protected'; return 0; }
        let removed = 0;
        for (let dy = 0; dy < mask.height; dy++) for (let dx = 0; dx < mask.width; dx++) if (!mask.at(dx, dy)) removed += clear(x + mask.offsetX + dx, y + mask.offsetY + dy);
        return removed;
      }
    };
    const copy = (x = startX, y = startY, lookRight = true, state = State.WALKING) => {
      const lem = new Lemming(x, y, actor.id); lem.lookRight = lookRight; lem.setAction(this.actions[state]); return lem;
    };
    const advance = lem => {
      if (actionSteps >= maxProbes) { failure ||= 'budget'; return; }
      actionSteps++;
      const x = lem.x, y = lem.y;
      if (!safe(x, y)) { failure ||= 'hazard'; return; }
      const state = lem.process(level), distance = Math.max(Math.abs(lem.x - x), Math.abs(lem.y - y), 1);
      for (let i = 0; i <= distance; i++) if (!safe(Math.round(x + (lem.x - x) * i / distance), Math.round(y + (lem.y - y) * i / distance))) failure ||= 'hazard';
      if (state !== State.NO_STATE_TYPE && !(state === State.JUMPING && lem.action === this.actions[state])) {
        if (!this.actions[state]) { failure ||= 'termination'; return; }
        lem.setAction(this.actions[state]);
      }
    };
    const wall = (x, y, lookRight) => {
      const lem = copy(x, y, lookRight);
      for (let tick = 0; tick <= MAX_DESCENT_DISTANCE * 2 && !failure; tick++) {
        advance(lem);
        if (lem.action !== this.actions[State.WALKING] || lem.y !== y) { failure ||= 'corridor'; break; }
        if (lem.lookRight !== lookRight) return lem.x + (lookRight ? 1 : -1);
      }
      failure ||= 'containment'; return null;
    };
    // This extension admits only a measured deeper cave. Existing shallow
    // routes retain their independent planner path and no work limit changes.
    let air = false, landing = null;
    for (let y = startY + 1; y <= startY + MAX_DESCENT_DROP && !failure; y++) {
      if (!(read(startX, y) & 1)) air = true;
      else if (air) { landing = y; break; }
    }
    if (landing == null || landing - startY <= 20 || !level.hasGroundAt(startX, startY)) failure ||= 'not-deep-descent';
    const rearWallX = failure ? null : wall(startX, startY, false), upperWallX = failure ? null : wall(startX, startY, true);
    const modes = failure ? [] : preferredKind ? [preferredKind] : ['diggers', 'miners'];
    let proposal = null;
    for (const kind of modes) {
      if (failure && !['protected', 'termination', 'entry', 'continuation', 'corridor'].includes(failure)) break;
      failure = null; edits.clear();
      const state = kind === 'diggers' ? State.DIGGING : State.MINING;
      this.actions[State.MINING].masks = world.actions[State.MINING].masks;
      const worker = copy(startX, startY, true, state);
      let fallingTick = null, landingTick = null;
      for (let tick = 1; tick <= MAX_DESCENT_TICKS && !failure; tick++) {
        advance(worker);
        if (worker.action === this.actions[State.FALLING]) fallingTick ??= tick;
        if (worker.action === this.actions[State.WALKING]) { landingTick = tick; break; }
      }
      if (landingTick == null || fallingTick == null || worker.y !== landing || worker.y - startY > MAX_DESCENT_DROP || !level.hasGroundAt(worker.x, landing)) failure ||= 'termination';
      const lowerRearWallX = failure ? null : wall(worker.x, landing, false), lowerWallX = failure ? null : wall(worker.x, landing, true);
      const entries = [];
      if (!failure) for (let x = left; x <= right; x++) if (edits.has(address(x, startY))) entries.push(x);
      if (!entries.length || entries.length > 32) failure ||= 'entry';
      // Every opened feet column is replayed from both directions by genuine
      // ordinary WALK/FALL/JUMP owners, including the actual return wall turn.
      const suffixes = new Map();
      for (const x of entries) for (const lookRight of [true, false]) {
        if (failure) break;
        const follower = copy(x + (lookRight ? -1 : 1), startY, lookRight), path = [];
        let arrived = false, fell = false, suffixFall = false;
        for (let tick = 0; tick < MAX_DESCENT_TICKS && !failure; tick++) {
          // These passive owners do not read frameIndex. The physical state
          // qualifies a suffix only on this fixed patch and hazard snapshot.
          const key = follower.x + ':' + follower.y + ':' + follower.lookRight + ':' + follower.action.actionName + ':' + follower.state;
          if (suffixes.has(key)) { arrived = true; suffixFall = suffixes.get(key); fell ||= suffixFall; break; }
          path.push({ key, fall: follower.action === this.actions[State.FALLING] });
          advance(follower); fell ||= follower.action === this.actions[State.FALLING];
          if (follower.action === this.actions[State.WALKING] && follower.y === landing && follower.lookRight && follower.x >= startX + 24) { arrived = true; break; }
        }
        if (!arrived || !fell) failure ||= 'entry';
        if (!failure) for (let index = path.length - 1; index >= 0; index--) {
          suffixFall ||= path[index].fall; suffixes.set(path[index].key, suffixFall);
        }
      }
      const footprint = { x1: minX, x2: maxX + 1, y1: minY, y2: maxY + 1 };
      if (!failure) {
        proposal = { kind, startX, targetX: startX, footprint, continuationY: landing, estimatedTicks: landingTick, materialCost: 0,
          reason: 'observed-contained-descent', routeEvidence: { sharedAction: kind === 'diggers' ? 'digging' : 'mining',
            naturalFallingTick: fallingTick, naturalWalkingTick: landingTick, drop: landing - startY, entryColumns: entries.length,
            rearWallX, upperWallX, lowerRearWallX, lowerWallX, probes, actionSteps, wholeCrewContainment: 'observed-walls', independentQualification: false } };
        break;
      }
    }
    this.cache[actor.laneIndex] = { key, proposal, failure, maxProbes }; this.stats.proofs++; this.stats.probes += probes; this.stats.actionSteps += actionSteps; this.stats[proposal ? 'accepted' : 'rejected']++;
    return { proposal: proposal && !this._busy(proposal.footprint) ? proposal : null, probes, actionSteps, failure };
  }
  reset() { this.cache.fill(null); this.hazards.length = 0; this.nearby.length = 0; }
  dispose() { this.reset(); this.actions[State.MINING].masks = null; this.world = null; }
}
export { ProcgenSupportedDescent, MAX_DESCENT_DISTANCE, MAX_DESCENT_DROP, MAX_DESCENT_PROBES, MAX_DESCENT_TICKS };