import { ProcgenActorProjection } from './ProcgenActorProjection.js';
import { PROCGEN_ACTION_LABELS } from './ProcgenActorActions.js';

const registered = new WeakMap();
const registerProcgenActorVisibility = (world, visibility) => { registered.set(world, visibility); };
const getProcgenActorVisibility = world => registered.get(world) || null;
const publishProcgenActorVisibility = world => registered.get(world)?.publish();

// Reuse bounded physical-row buckets during camera-only redraws. Cosmetic
// origins are included, so trap presentations can cross their simulation row.
class ProcgenActorVisibility {
  constructor(world, options = {}) { this.projections = new ProcgenActorProjection(options); this.liveActors = new Map(); this.world = world; this.rows = []; this.physicalRows = []; this.semanticLanes = []; this.physicalLeaders = []; this.semanticLeaders = [];
    this.observationLeaders = []; this.actionMasks = new Uint16Array(0); this.actionOrders = new Float64Array(0); this.actionCounts = new Uint32Array(0);
    this.actorIds = new Map();
    this.wide = []; this.bounds = new Map(); this.seen = new Set(); this.candidates = []; this.tick = null; this.actorScans = 0; this.queryVisits = 0; }
  publish(force = false) {
    const world = this.world, height = world.laneHeight || 96, count = world.laneCount;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex) { this.deferredPublications = (this.deferredPublications || 0) + 1; return false; }
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.();
    if (!force && this.projectionAppearance === appearance && this.projectionSprites === world.sprites && this.tick === world.tickIndex && this.generation === world.generation && this.actors === world.actors && this.actorCount === world.actors.length && this.height === height && this.actionOwner === world.actions) return false;
    const frame = this.projections.publish(world); if (!frame) return false;
    if (this.rows.length !== count) this.rows = Array.from({ length: count }, () => []);
    for (const key of ['physicalRows', 'semanticLanes', 'physicalLeaders', 'semanticLeaders', 'observationLeaders', 'actionMasks', 'actionOrders', 'actionCounts']) this[key] = frame[key];
    this.actorIds.clear();
    for (const actor of frame.actors) this.actorIds.set(actor.id, actor);
    this.liveActors = this.projections.current.liveActors; this.actorScans += world.actors.length;
    this.actionOwner = world.actions; this.projectionAppearance = appearance; this.projectionSprites = world.sprites;
    this.tick = world.tickIndex; this.generation = world.generation; this.actors = world.actors; this.actorCount = world.actors.length;
    this.height = height; this.revision = frame.revision;
    this.publications = (this.publications || 0) + 1; this.displayTick = null; return true;
  }
  update(force = false) {
    this.publish(force);
    const world = this.world, height = this.height, count = world.laneCount;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex || !this.isCurrent()) return false;
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.();
    if (!force && this.displayTick === this.tick && this.displayGeneration === this.generation && this.sprites === world.sprites && this.appearance === appearance) return false;
    for (const row of this.rows) row.length = 0;
    this.wide.length = 0; this.bounds.clear();
    for (const actor of world.actors) {
      this.drawScans = (this.drawScans || 0) + 1;
      if (actor.failureReason || actor.removed) continue;
      const bounds = this.actorIds.get(actor.id)?.drawBounds || null;
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
    if (!this.isCurrent()) return this.candidates;
    const add = actor => { this.queryVisits++; if (!this.seen.has(actor)) { this.seen.add(actor); this.candidates.push(actor); } };
    const first = Math.max(0, Math.floor(y / this.height)), last = Math.min(this.rows.length - 1, Math.floor((y + height) / this.height));
    for (let row = first; row <= last; row++) for (const actor of this.rows[row]) add(actor);
    for (const actor of this.wide) add(actor);
    return this.candidates;
  }
  isCurrent() { return !!this.world && this.tick === this.world.tickIndex && this.generation === this.world.generation; }
  acquireSnapshot(options) { this.publish(); return this.projections.acquire(options); }
  renderActor(id, revision = this.revision) { return this.isCurrent() && revision === this.revision ? this.liveActors.get(id) || null : null; }
  physicalLeader(first, last, force = false) {
    this.publish(force); const lease = this.projections.acquire(); if (!lease) return null;
    try {
      let leader = null;
      for (let lane = Math.max(0, first); lane < Math.min(lease.frame.physicalLeaders.length, last); lane++) {
        const actor = lease.frame.physicalLeaders[lane]; this.queryVisits++;
        if (actor && (!leader || actor.x > leader.x || actor.x === leader.x && actor.id < leader.id)) leader = actor;
      }
      return leader;
    } finally { lease.release(); }
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
  actorById(id) { this.publish(); return this.actorIds.get(id) || null; }
  getStats() { return { revision: this.revision || null, publications: this.publications || 0, rebuilds: this.rebuilds || 0,
    actorScans: this.actorScans, drawScans: this.drawScans || 0, queryVisits: this.queryVisits, deferredPublications: this.deferredPublications || 0,
    actionIndexBytes: this.actionMasks.length * 2 + this.actionOrders.length * 8 + this.actionCounts.length * 4, projection: this.projections.stats(),
    retainedActors: this.semanticLanes.reduce((sum, lane) => sum + lane.length, 0) }; }
  dispose() { if (registered.get(this.world) === this) registered.delete(this.world);
    this.projections.dispose(); this.liveActors = new Map();
    this.rows.length = 0; this.physicalRows = []; this.semanticLanes = []; this.physicalLeaders = []; this.semanticLeaders = [];
    this.observationLeaders = []; this.actionMasks = []; this.actionOrders = []; this.actionCounts = []; this.actionOwner = null; this.actorIds.clear();
    this.wide.length = 0; this.candidates.length = 0; this.bounds.clear(); this.seen.clear(); this.actors = this.world = this.sprites = this.appearance = null; }
}
export { ProcgenActorVisibility, registerProcgenActorVisibility, getProcgenActorVisibility, publishProcgenActorVisibility };
