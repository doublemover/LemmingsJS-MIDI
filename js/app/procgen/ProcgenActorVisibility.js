import { PROCGEN_ACTION_LABELS, createProcgenActionCodes } from './ProcgenActorActions.js';

const registered = new WeakMap();
const registerProcgenActorVisibility = (world, visibility) => { registered.set(world, visibility); };
const getProcgenActorVisibility = world => registered.get(world) || null;
const publishProcgenActorVisibility = world => registered.get(world)?.publish();

// Reuse bounded physical-row buckets during camera-only redraws. Cosmetic
// origins are included, so trap presentations can cross their simulation row.
class ProcgenActorVisibility {
  constructor(world) { this.world = world; this.rows = []; this.physicalRows = []; this.semanticLanes = []; this.physicalLeaders = []; this.semanticLeaders = [];
    this.observationLeaders = []; this.actionMasks = new Uint16Array(0); this.actionOrders = new Float64Array(0); this.actionCounts = new Uint32Array(0);
    this.wide = []; this.bounds = new Map(); this.seen = new Set(); this.candidates = []; this.tick = null; this.actorScans = 0; this.queryVisits = 0; }
  publish(force = false) {
    const world = this.world, height = world.laneHeight || 96, count = world.laneCount;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex) { this.deferredPublications = (this.deferredPublications || 0) + 1; return false; }
    if (!force && this.tick === world.tickIndex && this.generation === world.generation && this.actors === world.actors && this.actorCount === world.actors.length && this.height === height && this.actionOwner === world.actions) return false;
    if (this.rows.length !== count) {
      this.rows = Array.from({ length: count }, () => []);
      this.physicalRows = Array.from({ length: count }, () => []);
      this.semanticLanes = Array.from({ length: count }, () => []);
      this.physicalLeaders = new Array(count); this.semanticLeaders = new Array(count);
      this.observationLeaders = new Array(count); this.actionMasks = new Uint16Array(count); this.actionOrders = new Float64Array(count); this.actionCounts = new Uint32Array(count * PROCGEN_ACTION_LABELS.length);
    }
    if (this.actionOwner !== world.actions) { this.actionOwner = world.actions; this.actionCodes = createProcgenActionCodes(world.actions); }
    for (const row of this.physicalRows) row.length = 0;
    for (const lane of this.semanticLanes) lane.length = 0;
    this.physicalLeaders.fill(null); this.semanticLeaders.fill(null);
    this.observationLeaders.fill(null); this.actionMasks.fill(0); this.actionOrders.fill(0); this.actionCounts.fill(0);
    for (const actor of world.actors) {
      this.actorScans++;
      if (actor.failureReason || actor.removed) continue;
      const physical = Math.floor(actor.y / height), semantic = actor.laneIndex;
      if (Number.isFinite(actor.x) && Number.isFinite(actor.y)) {
        if (physical >= 0 && physical < count) {
          this.physicalRows[physical].push(actor);
          const previous = this.physicalLeaders[physical];
          if (!previous || actor.x > previous.x || actor.x === previous.x && actor.id < previous.id) this.physicalLeaders[physical] = actor;
        }
        if (semantic >= 0 && semantic < count) {
          this.semanticLanes[semantic].push(actor);
          const previous = this.semanticLeaders[semantic];
          if (!previous || actor.x > previous.x || actor.x === previous.x && actor.id < previous.id) this.semanticLeaders[semantic] = actor;
          if (actor.action) {
            const observed = this.observationLeaders[semantic];
            if (!observed || actor.x > observed.x || actor.x === observed.x && actor.id < observed.id) this.observationLeaders[semantic] = actor;
          }
          const code = this.actionCodes?.get(actor.action);
          if (code != null) {
            const bit = 1 << code;
            if (!(this.actionMasks[semantic] & bit)) this.actionOrders[semantic] = this.actionOrders[semantic] * 16 + code + 1;
            this.actionMasks[semantic] |= bit; this.actionCounts[semantic * PROCGEN_ACTION_LABELS.length + code]++;
          }
        }
      }
    }
    this.tick = world.tickIndex; this.generation = world.generation; this.actors = world.actors; this.actorCount = world.actors.length;
    this.height = height; this.revision = `${world.generation}:${world.tickIndex}`;
    this.publications = (this.publications || 0) + 1; this.displayTick = null; return true;
  }
  update(force = false) {
    this.publish(force);
    const world = this.world, height = this.height, count = world.laneCount;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex) return false;
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.();
    if (!force && this.displayTick === this.tick && this.displayGeneration === this.generation && this.sprites === world.sprites && this.appearance === appearance) return false;
    for (const row of this.rows) row.length = 0;
    this.wide.length = 0; this.bounds.clear();
    for (const actor of world.actors) {
      this.drawScans = (this.drawScans || 0) + 1;
      if (actor.failureReason || actor.removed) continue;
      const bounds = actor.action?.spriteProvider?.getActorDrawBounds?.(actor) || null;
      this.bounds.set(actor, bounds);
      let top = actor.y - 32, bottom = actor.y + 32;
      if (bounds && Number.isFinite(bounds.y) && Number.isFinite(bounds.height)) { top = Math.min(top, bounds.y); bottom = Math.max(bottom, bounds.y + bounds.height); }
      const first = Math.max(0, Math.floor(top / height)), last = Math.min(count - 1, Math.floor(bottom / height));
      // Unusual supplied presentations retain exact culling with O(live) storage.
      if (last - first >= 8) this.wide.push(actor);
      else for (let row = first; row <= last; row++) this.rows[row].push(actor);
    }
    this.displayTick = this.tick; this.displayGeneration = this.generation; this.sprites = world.sprites; this.appearance = appearance;
    this.rebuilds = (this.rebuilds || 0) + 1; return true;
  }
  query(y, height, force = false) {
    this.update(force); this.seen.clear(); this.candidates.length = 0;
    const add = actor => { this.queryVisits++; if (!this.seen.has(actor)) { this.seen.add(actor); this.candidates.push(actor); } };
    const first = Math.max(0, Math.floor(y / this.height)), last = Math.min(this.rows.length - 1, Math.floor((y + height) / this.height));
    for (let row = first; row <= last; row++) for (const actor of this.rows[row]) add(actor);
    for (const actor of this.wide) add(actor);
    return this.candidates;
  }
  physicalLeader(first, last, force = false) {
    this.publish(force); let leader = null;
    for (let lane = Math.max(0, first); lane < Math.min(this.physicalLeaders.length, last); lane++) {
      let actor = this.physicalLeaders[lane]; this.queryVisits++;
      if (actor?.failureReason || actor?.removed) {
        actor = null;
        for (const candidate of this.physicalRows[lane]) {
          this.queryVisits++;
          if (candidate.failureReason || candidate.removed) continue;
          if (!actor || candidate.x > actor.x || candidate.x === actor.x && candidate.id < actor.id) actor = candidate;
        }
      }
      if (actor && (!leader || actor.x > leader.x || actor.x === leader.x && actor.id < leader.id)) leader = actor;
    }
    return leader;
  }
  physicalActors(lane) { this.publish(); return this.physicalRows[lane] || []; }
  semanticActors(lane) { this.publish(); return this.semanticLanes[lane] || []; }
  semanticLeader(lane) { this.publish(); return this.semanticLeaders[lane] || null; }
  semanticObservationLeader(lane) { this.publish(); this.queryVisits++; return this.observationLeaders[lane] || null; }
  semanticActionMask(lane) { this.publish(); return this.actionMasks[lane] || 0; }
  semanticActionOrder(lane) { this.publish(); return this.actionOrders[lane] || 0; }
  semanticActionCount(lane, label) {
    this.publish(); const code = PROCGEN_ACTION_LABELS.indexOf(label);
    return code < 0 || lane < 0 || lane >= this.semanticLanes.length ? 0 : this.actionCounts[lane * PROCGEN_ACTION_LABELS.length + code];
  }
  getStats() { return { revision: this.revision || null, publications: this.publications || 0, rebuilds: this.rebuilds || 0,
    actorScans: this.actorScans, drawScans: this.drawScans || 0, queryVisits: this.queryVisits, deferredPublications: this.deferredPublications || 0,
    actionIndexBytes: this.actionMasks.byteLength + this.actionOrders.byteLength + this.actionCounts.byteLength,
    retainedActors: this.semanticLanes.reduce((sum, lane) => sum + lane.length, 0) }; }
  dispose() { if (registered.get(this.world) === this) registered.delete(this.world);
    this.rows.length = 0; this.physicalRows.length = 0; this.semanticLanes.length = 0; this.physicalLeaders.length = 0; this.semanticLeaders.length = 0;
    this.observationLeaders.length = 0; this.actionMasks = new Uint16Array(0); this.actionOrders = new Float64Array(0); this.actionCounts = new Uint32Array(0); this.actionCodes?.clear(); this.actionOwner = null;
    this.wide.length = 0; this.candidates.length = 0; this.bounds.clear(); this.seen.clear(); this.actors = this.world = this.sprites = this.appearance = null; }
}
export { ProcgenActorVisibility, registerProcgenActorVisibility, getProcgenActorVisibility, publishProcgenActorVisibility };

