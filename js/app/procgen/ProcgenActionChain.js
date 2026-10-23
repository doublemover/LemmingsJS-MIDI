import { Lemming } from '../../lemmings/Lemming.js';
import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';
import { ActionBuildSystem } from '../../actions/ActionBuildSystem.js';
import { ActionBashSystem } from '../../actions/ActionBashSystem.js';
import { ActionMineSystem } from '../../actions/ActionMineSystem.js';
import { ActionWalkSystem } from '../../actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../../actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../../actions/ActionFallSystem.js';
import { ActionShrugSystem } from '../../actions/ActionShrugSystem.js';
import { procgenTileRevision } from './ProcgenTerrainRetention.js';

const MAX_CHAIN_STAGES = 4;
const STATES = { builders: State.BUILDING, bashers: State.BASHING, miners: State.MINING };
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// Private edits are consumed by the very same action owners as the live world.
// Every mask pixel and simulation tick shares the lane's finite work allowance.
class ProcgenActionChain {
  constructor(world) {
    this.world = world;
    this.actions = { [State.BUILDING]: new ActionBuildSystem(), [State.BASHING]: new ActionBashSystem(), [State.MINING]: new ActionMineSystem(),
      [State.WALKING]: new ActionWalkSystem(), [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem(), [State.SHRUG]: new ActionShrugSystem() };
    this.runtime = { soundEvents: { emitSfx() {} } };
    for (const action of Object.values(this.actions)) action.setRuntime(this.runtime);
    this.stats = { proofs: 0, accepted: 0, work: 0, maxWork: 0 };
  }
  prove(actor, hazards = [], maxWork = 1024, options = {}) {
    const world = this.world, start = { x: actor.x, y: actor.y }, bounds = options.bounds || { x1: actor.x - 5, x2: actor.x + 111, y1: actor.y - 64, y2: actor.y + 49 };
    const cells = new Map(), edits = new Map(), tiles = new Map(), stages = [], triggers = [], direction = actor.lookRight !== false;
    const generation = world.generation, revision = world.terrainRevision, frontier = world.frontierRevision;
    let work = 0, ticks = 0, failure = null, failureAt = null, finalX = null, lastEndX = actor.x, stage = null;
    maxWork = Math.max(0, Math.min(4096, Math.floor(maxWork)));
    const charge = () => { if (work >= maxWork) { failure ||= 'budget'; return false; } work++; return true; };
    const key = (x, y) => `${x}:${y}`;
    const read = (x, y) => {
      if (failure) return 0;
      if (x < bounds.x1 || x >= bounds.x2 || y < bounds.y1 || y >= bounds.y2 || y < 0 || y >= world.height) { failure = 'bounds'; failureAt = { x, y }; return 0; }
      const lane = Math.floor(y / world.laneHeight), chunk = Math.floor(x / world.terrain.chunkWidth);
      if (x < world.leftEdgeX || x >= world.generatedThrough[lane] || world.terrainGrowth?.stateFor(lane, chunk) && !world.terrainGrowth.columnReady(lane, x)) { failure = 'unrevealed'; return 0; }
      const at = key(x, y);
      if (!cells.has(at)) {
        if (!charge()) return 0;
        cells.set(at, (world.hasGroundAt(x, y) ? 1 : 0) | (world.hasSteelAt(x, y) ? 2 : 0));
        const tile = lane * 0x800000 + chunk; tiles.set(tile, procgenTileRevision(world, tile));
      }
      return edits.has(at) ? edits.get(at) : cells.get(at);
    };
    const touch = (x, y) => {
      if (!stage) return;
      const b = stage.footprint;
      b.x1 = Math.min(b.x1, x); b.x2 = Math.max(b.x2, x + 1); b.y1 = Math.min(b.y1, y); b.y2 = Math.max(b.y2, y + 1);
    };
    const maskPixels = (mask, x, y, callback) => {
      for (let dy = 0; dy < mask.height && !failure; dy++) for (let dx = 0; dx < mask.width && !failure; dx++) if (!mask.at(dx, dy)) callback(x + mask.offsetX + dx, y + mask.offsetY + dy);
    };
    const level = { width: world.width, height: world.height, getGroundMaskLayer: () => level, hasGroundAt: (x, y) => !!(read(x, y) & 1),
      isArrowAt: (...args) => world.isArrowAt(...args),
      hasArrowUnderMask: (...args) => world.hasArrowUnderMask(...args),
      hasSteelUnderMask(mask, x, y) { let steel = false; maskPixels(mask, x, y, (px, py) => { steel ||= !!(read(px, py) & 2); }); if (steel) failure ||= 'steel'; return steel; },
      clearGroundWithMaskCount(mask, x, y) {
        let removed = 0;
        if (world.hasArrowUnderMask(mask, x, y, direction)) { failure ||= 'arrows'; return 0; }
        maskPixels(mask, x, y, (px, py) => {
          const before = read(px, py); touch(px, py);
          if (before & 2) failure ||= 'steel';
          else if (before & 1) { edits.set(key(px, py), 0); removed++; }
        });
        return removed;
      },
      setGroundAt(x, y) { const before = read(x, y); touch(x, y); if (before & 2 || world.isArrowAt(x, y, direction)) failure ||= 'protected'; else edits.set(key(x, y), 1); },
      getColumnStepHeight(x, y, height) { for (let i = 0; i < height; i++) if (!level.hasGroundAt(x, y + height - i - 1)) return i; return height; },
      getColumnGapDepth(x, y, height) { for (let i = 0; i < height; i++) if (level.hasGroundAt(x, y + i)) return i + 1; return height + 1; } };
    const safe = (x, y) => {
      if (hazards.some(h => x + 2 > h.x1 && x - 2 < h.x2 && y + 1 > h.y1 && y - 10 < h.y2)) { failure ||= 'hazard'; return false; }
      for (const trigger of triggers) {
        const owner = trigger.owner;
        if (owner && owner !== actor && !owner.removed && !owner.disabled && !owner.failureReason && !owner.terminalReason && owner.action === world.actions[State.BLOCKING] && x >= trigger.x1 && x < trigger.x2 && y >= trigger.y1 && y < trigger.y2) { failure ||= 'blocker'; return false; }
      }
      return true;
    };
    for (let lane = Math.max(0, Math.floor(bounds.y1 / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor((bounds.y2 - 1) / world.laneHeight)); lane++) {
      const list = world.triggerManager?.getLaneTriggers(lane) || [];
      if (list.length > 64) failure ||= 'blocker-limit'; else triggers.push(...list);
    }
    for (const state of [State.BASHING, State.MINING]) this.actions[state].masks = world.actions[state].masks;
    const worker = new Lemming(actor.x, actor.y, actor.id, this.runtime); worker.lookRight = direction; worker.setAction(this.actions[State.WALKING]);
    const advance = lem => {
      if (!charge() || !safe(lem.x, lem.y)) return;
      ticks++; const x = lem.x, y = lem.y, next = lem.process(level), distance = Math.max(Math.abs(lem.x - x), Math.abs(lem.y - y), 1);
      for (let i = 1; i <= distance; i++) safe(Math.round(x + (lem.x - x) * i / distance), Math.round(y + (lem.y - y) * i / distance));
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && lem.action === this.actions[State.JUMPING])) {
        if (!this.actions[next]) failure ||= 'terminal'; else lem.setAction(this.actions[next]);
      }
      if (lem.lookRight !== direction) failure ||= 'turn';
    };
    const needed = lem => {
      if (level.getColumnStepHeight(lem.x + 1, lem.y - 7, 8) === 8) return 'bashers';
      if (level.getColumnGapDepth(lem.x + 1, lem.y + 1, 3) <= 3) return null;
      for (let dy = 4; dy <= 32 && lem.y + dy < world.height; dy++) if (read(lem.x + 1, lem.y + dy) & 1) return null;
      return 'builders';
    };
    const launch = kind => {
      if (!STATES[kind] || !world.workerLimits[kind === 'miners' ? 'diggers' : kind] || stages.length >= MAX_CHAIN_STAGES || !read(worker.x, worker.y)) { failure ||= 'launch'; return; }
      stage = { kind, x: worker.x, y: worker.y, startTick: ticks, footprint: { x1: worker.x - 1, x2: worker.x + 2, y1: worker.y - 10, y2: worker.y + 1 } };
      stages.push(stage); worker.setAction(this.actions[STATES[kind]]);
    };
    this.stats.proofs++;
    if (!direction || !read(worker.x, worker.y)) failure ||= 'launch';
    let approachGap = true;
    for (let dy = 0; dy <= 32 && worker.y + dy < world.height; dy++) if (read(worker.x + 3, worker.y + dy) & 1) { approachGap = false; break; }
    const first = options.firstKind || needed(worker) || (approachGap ? 'builders' : null);
    if (!first) failure ||= 'passive'; else launch(first);
    while (!failure && ticks < 1200) {
      if (worker.action === this.actions[State.WALKING]) {
        if (stage && stage.exitTick == null) { stage.exitTick = ticks; stage.exitX = worker.x; stage.exitY = worker.y; lastEndX = worker.x; }
        const next = needed(worker);
        if (next) launch(next);
        else if (worker.x >= lastEndX + 8 && stages.length >= (options.minStages ?? 2)) { finalX = worker.x; break; }
        else if (worker.x >= lastEndX + 24) { failure = 'single-stage'; break; }
      }
      if (!failure) advance(worker);
    }
    if (finalX != null && !failure) {
      stage = null;
      const followerStart = options.followerStart || start;
      const follower = new Lemming(followerStart.x, followerStart.y, -1, this.runtime); follower.setAction(this.actions[State.WALKING]);
      while (!failure && follower.x < finalX && ticks < 1600) advance(follower);
      if (follower.action !== this.actions[State.WALKING] || Math.abs(follower.y - worker.y) > 3 || follower.x < finalX) failure ||= 'follower';
    } else failure ||= 'continuation';
    const footprint = stages.reduce((b, s) => ({ x1: Math.min(b.x1, s.footprint.x1), x2: Math.max(b.x2, s.footprint.x2), y1: Math.min(b.y1, s.footprint.y1), y2: Math.max(b.y2, s.footprint.y2) }), { x1: start.x, x2: start.x + 1, y1: start.y, y2: start.y + 1 });
    for (let lane = Math.max(0, Math.floor(bounds.y1 / world.laneHeight)); lane <= Math.min(world.laneCount - 1, Math.floor((bounds.y2 - 1) / world.laneHeight)); lane++)
      for (const task of world.accessTasks[lane] || []) if (task.owner && task.owner !== actor && !task.owner.removed && !task.owner.failureReason && task.owner.action === task.action && task.footprint && overlap(footprint, task.footprint)) failure ||= 'construction';
    if (world.generation !== generation || world.terrainRevision !== revision || world.frontierRevision !== frontier) failure ||= 'changed-terrain';
    this.stats.work += work; this.stats.maxWork = Math.max(this.stats.maxWork, work); if (!failure) this.stats.accepted++;
    return { safe: !failure, failure, failureAt, work, stages, footprint, bounds, tiles: [...tiles], generation, revision, exitX: worker.x, exitY: worker.y, ticks };
  }
  dispose() { this.world = null; }
}
export { ProcgenActionChain, MAX_CHAIN_STAGES };
